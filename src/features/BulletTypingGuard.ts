import { Plugin, editorEditorField } from "obsidian";

import {
  Annotation,
  ChangeSet,
  EditorSelection,
  EditorState,
  Extension,
  Text,
  Transaction,
} from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

import { Feature } from "./Feature";

import { BulletTypingPolicy } from "../services/BulletTypingPolicy";
import { Logger } from "../services/Logger";
import { MarkdownLineClassifier } from "../services/MarkdownLineClassifier";
import { Settings } from "../services/Settings";

const correctedInput = Annotation.define<boolean>();
const completedComposition = Annotation.define<object>();

type CompositionSession =
  | { kind: "idle" }
  | {
      kind: "composing" | "ended";
      token: object;
      originDoc: Text;
      originSelection: EditorSelection;
      changes: ChangeSet;
      selection: EditorSelection;
      time: number | null;
    };

class BulletComposition {
  private session: CompositionSession = { kind: "idle" };
  private alive = true;
  private measurement = {
    read: (): CompositionSession => this.session,
    write: (session: CompositionSession) => {
      if (session.kind !== "ended" || this.view.compositionStarted) {
        return;
      }
      queueMicrotask(() => {
        if (!this.alive || !this.enabled()) {
          return;
        }
        if (this.session !== session) {
          if (this.session.kind === "ended") {
            this.view.requestMeasure(this.measurement);
          }
          return;
        }
        this.complete(session);
      });
    },
  };

  constructor(
    private view: EditorView,
    private classifier: MarkdownLineClassifier,
    private policy: BulletTypingPolicy,
    private enabled: () => boolean,
  ) {}

  start() {
    if (!this.enabled()) {
      return;
    }
    if (
      this.session.kind !== "idle" &&
      this.session.changes.apply(this.session.originDoc).eq(this.view.state.doc)
    ) {
      this.session = { ...this.session, kind: "composing", token: {} };
      return;
    }
    this.capture(this.view.state);
  }

  end() {
    if (this.session.kind === "idle") {
      return;
    }
    this.session = { ...this.session, kind: "ended" };
    this.view.requestMeasure(this.measurement);
    queueMicrotask(() => this.beforeInput());
  }

  beforeInput() {
    if (
      this.session.kind !== "ended" ||
      this.view.compositionStarted ||
      !this.enabled() ||
      !flushNativeComposition(this.view)
    ) {
      return;
    }
    this.complete(this.session);
  }

  filter(transaction: Transaction): Transaction | null {
    return transaction.isUserEvent("input.type.compose") ||
      this.isInitialDeletion(transaction)
      ? transaction
      : null;
  }

  private complete(session: CompositionSession) {
    if (
      !this.alive ||
      !this.enabled() ||
      session.kind !== "ended" ||
      this.session !== session ||
      this.view.compositionStarted
    ) {
      return;
    }
    const correction = this.correction(this.view.state);
    this.session = { kind: "idle" };
    if (correction && !correction.changes.empty) {
      const mappedOrigin = session.originSelection.map(
        session.changes.compose(correction.changes),
        1,
      );
      this.view.dispatch({
        ...correction,
        userEvent: "input.type.compose",
        annotations: [
          completedComposition.of(session.token),
          ...(!mappedOrigin.eq(correction.selection)
            ? [correctedInput.of(true)]
            : []),
          ...(session.time === null ? [] : [Transaction.time.of(session.time)]),
        ],
      });
    }
  }

  update(update: ViewUpdate) {
    for (const transaction of update.transactions) {
      if (transaction.annotation(completedComposition)) {
        this.session = { kind: "idle" };
        continue;
      }
      const nativeComposition = transaction.isUserEvent("input.type.compose");
      if (this.session.kind === "idle") {
        if (!nativeComposition) {
          continue;
        }
        this.capture(transaction.startState);
      }
      const session = this.session;
      if (session.kind === "idle") {
        continue;
      }
      if (
        transaction.annotation(Transaction.remote) ||
        (transaction.docChanged &&
          !nativeComposition &&
          !this.isInitialDeletion(transaction)) ||
        transaction.isUserEvent("undo") ||
        transaction.isUserEvent("redo") ||
        transaction.isUserEvent("set") ||
        !session.changes.apply(session.originDoc).eq(transaction.startState.doc)
      ) {
        this.session = { kind: "idle" };
        continue;
      }
      this.session = {
        ...session,
        changes: session.changes.compose(transaction.changes),
        selection: transaction.newSelection,
        time: transaction.docChanged
          ? (transaction.annotation(Transaction.time) ?? null)
          : session.time,
      };
    }
  }

  destroy() {
    this.alive = false;
    this.session = { kind: "idle" };
  }

  private capture(state: EditorState) {
    this.session = {
      kind: "composing",
      token: {},
      originDoc: state.doc,
      originSelection: state.selection,
      changes: state.changes(),
      selection: state.selection,
      time: null,
    };
  }

  private isInitialDeletion(transaction: Transaction): boolean {
    const session = this.session;
    if (
      session.kind === "idle" ||
      !session.changes.empty ||
      transaction.annotation(Transaction.userEvent) !== "input" ||
      !transaction.docChanged ||
      !transaction.startState.doc.eq(session.originDoc)
    ) {
      return false;
    }
    const ranges = session.originSelection.ranges.filter(
      (range) => !range.empty,
    );
    let index = 0;
    let matches = true;
    transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      const range = ranges[index++];
      matches &&=
        range !== undefined &&
        range.from === from &&
        range.to === to &&
        inserted.length === 0;
    }, true);
    return matches && index === ranges.length;
  }

  private correction(state: EditorState) {
    const session = this.session;
    if (
      session.kind === "idle" ||
      !session.changes.apply(session.originDoc).eq(state.doc) ||
      state.doc.eq(session.originDoc)
    ) {
      return null;
    }
    const decision = this.policy.decide(
      this.shadowState(session.originDoc, session.originSelection).update({
        changes: session.changes,
        selection: session.selection,
        userEvent: "input.type.compose",
        filter: false,
      }),
    );
    if (decision.kind === "reject") {
      return {
        changes: session.changes.invert(session.originDoc),
        selection: session.originSelection,
      };
    }
    if (decision.kind === "pass") {
      return null;
    }
    const changes = ChangeSet.of(decision.changes, state.doc.length);
    return { changes, selection: state.selection.map(changes, 1) };
  }

  private shadowState(doc: Text, selection: EditorSelection) {
    return EditorState.create({
      doc,
      selection,
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        this.classifier.extension,
      ],
    });
  }
}

export class BulletTypingGuard implements Feature {
  private classifier: MarkdownLineClassifier;
  private policy: BulletTypingPolicy;
  private filterExtension: Extension;
  private compositionExtension: ViewPlugin<BulletComposition>;
  private editorExtensions: Extension[] = [];

  constructor(
    private plugin: Plugin,
    private settings: Settings,
    logger: Logger,
  ) {
    this.classifier = new MarkdownLineClassifier();
    this.policy = new BulletTypingPolicy(this.classifier, logger);
    this.compositionExtension = ViewPlugin.define(
      (view) =>
        new BulletComposition(
          view,
          this.classifier,
          this.policy,
          () =>
            this.settings.keepBodyTextInBullets &&
            !view.dom.closest(".table-cell-wrapper"),
        ),
      {
        eventObservers: {
          compositionstart() {
            this.start();
          },
          compositionend() {
            this.end();
          },
          keydown() {
            this.beforeInput();
          },
          paste() {
            this.beforeInput();
          },
          cut() {
            this.beforeInput();
          },
          drop() {
            this.beforeInput();
          },
        },
      },
    );
    this.filterExtension = EditorState.transactionFilter.of(
      this.filterTransaction,
    );
  }

  async load() {
    this.synchronizeEditorExtensions(false);
    this.plugin.registerEditorExtension(this.editorExtensions);
    this.settings.onChange(
      ["keepBodyTextInBullets"],
      this.handleSettingsChange,
    );
  }

  async unload() {
    this.settings.removeCallback(this.handleSettingsChange);
  }

  private handleSettingsChange = () => {
    this.synchronizeEditorExtensions(true);
  };

  private synchronizeEditorExtensions(updateViews: boolean) {
    const shouldEnable = this.settings.keepBodyTextInBullets;
    const enabled = this.editorExtensions.length > 0;
    if (enabled === shouldEnable) {
      return;
    }

    if (shouldEnable) {
      this.editorExtensions.push(
        this.classifier.extension,
        this.filterExtension,
        this.compositionExtension,
        EditorView.updateListener.of((update) => {
          if (
            update.transactions.some((transaction) =>
              transaction.annotation(correctedInput),
            )
          ) {
            update.view.dispatch({ selection: update.view.state.selection });
          }
        }),
      );
    } else {
      this.editorExtensions.splice(0);
    }

    if (updateViews) {
      this.plugin.app.workspace.updateOptions();
    }
  }

  private filterTransaction = (transaction: Transaction) => {
    if (
      !this.settings.keepBodyTextInBullets ||
      transaction.annotation(completedComposition) ||
      transaction.startState
        .field(editorEditorField, false)
        ?.dom.closest(".table-cell-wrapper")
    ) {
      return transaction;
    }

    const view = transaction.startState.field(editorEditorField, false);
    const composition = view?.plugin(this.compositionExtension);
    const deferred = composition?.filter(transaction);
    if (deferred) {
      return deferred;
    }
    if (transaction.isUserEvent("input.type.compose")) {
      return transaction;
    }

    const decision = this.policy.decide(transaction);
    if (decision.kind === "pass") {
      return transaction;
    }
    if (decision.kind === "reject") {
      return {};
    }
    const corrections = ChangeSet.of(
      decision.changes,
      transaction.newDoc.length,
    );
    return [
      transaction,
      {
        changes: corrections,
        selection: transaction.newSelection.map(corrections, 1),
        annotations:
          transaction.annotation(Transaction.userEvent) === "input"
            ? correctedInput.of(true)
            : undefined,
        sequential: true,
      },
    ];
  };
}

function flushNativeComposition(view: EditorView): boolean {
  const observer: unknown = Reflect.get(view, "observer");
  if (typeof observer !== "object" || observer === null) return false;
  const flush: unknown = Reflect.get(observer, "forceFlush");
  const pendingRecords: unknown = Reflect.get(observer, "pendingRecords");
  const delayedFlush: unknown = Reflect.get(observer, "delayedFlush");
  if (
    typeof flush !== "function" ||
    typeof pendingRecords !== "function" ||
    (typeof delayedFlush === "number" && delayedFlush >= 0) ||
    Reflect.get(observer, "delayedAndroidKey")
  )
    return false;
  flush.call(observer);
  const remaining: unknown = pendingRecords.call(observer);
  return (
    Array.isArray(remaining) &&
    remaining.length === 0 &&
    !Reflect.get(observer, "delayedAndroidKey")
  );
}
