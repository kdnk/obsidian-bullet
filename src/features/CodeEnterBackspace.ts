import { isolateHistory } from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  Extension,
  Prec,
  Text,
  Transaction,
} from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate, keymap } from "@codemirror/view";

import { MarkdownLineClassifier } from "../services/MarkdownLineClassifier";
import {
  getFenceContent,
  getFenceOpening,
  isFenceClosing,
} from "../utils/fencedCode";

type EnterAction =
  | { kind: "idle" }
  | { kind: "capture"; before: EditorState; cursor: number }
  | { kind: "receipt"; afterDoc: Text; from: number; inserted: string };

export function codeEnterBackspace(enabled: () => boolean): Extension {
  const classifier = new MarkdownLineClassifier();
  class CodeEnter {
    private action: EnterAction = { kind: "idle" };

    constructor(private view: EditorView) {}

    clear() {
      this.action = { kind: "idle" };
    }

    destroy() {
      this.clear();
    }

    keydown(event: KeyboardEvent) {
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      if (
        event.key === "Backspace" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      )
        return;
      this.clear();
      if (
        event.key !== "Enter" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.isComposing ||
        this.view.composing ||
        this.view.state.readOnly ||
        !enabled()
      )
        return;
      const before = this.view.state;
      if (before.selection.ranges.length !== 1 || !before.selection.main.empty)
        return;
      const cursor = before.selection.main.head;
      const line = before.doc.lineAt(cursor);
      const fence = classifier.getCodeFence(before, line.number);
      if (!fence || line.number === fence.openingLineNumber) return;
      const opening = before.doc.line(fence.openingLineNumber).text;
      const marker = getFenceOpening(
        getFenceContent(opening, fence.containerIndent)?.text ??
          opening.replace(/^\s*(?:[-*+]|\d+\.)[ \t]+/, ""),
      );
      const content = getFenceContent(line.text, fence.containerIndent);
      if (!marker || (content && isFenceClosing(content.text, marker))) return;
      const capture: EnterAction = { kind: "capture", before, cursor };
      this.action = capture;
      queueMicrotask(() => {
        if (this.action === capture) this.clear();
      });
    }

    update(update: ViewUpdate) {
      for (const transaction of update.transactions) {
        const action = this.action;
        if (action.kind === "idle") continue;
        if (
          !enabled() ||
          this.view.composing ||
          transaction.annotation(Transaction.remote) ||
          /^(?:input\.(?:paste|drop|.*compose)|undo|redo|set)(?:\.|$)/.test(
            transaction.annotation(Transaction.userEvent) ?? "",
          )
        ) {
          this.clear();
        } else if (transaction.docChanged) {
          this.clear();
          if (
            action.kind !== "capture" ||
            transaction.startState.doc !== action.before.doc ||
            !transaction.startState.selection.eq(action.before.selection)
          )
            continue;
          let changes = 0;
          transaction.changes.iterChanges(
            (from, to, _fromAfter, _toAfter, insertedText) => {
              changes++;
              const deleted = transaction.startState.doc.sliceString(from, to);
              const inserted = insertedText.toString();
              let prefix = 0;
              while (
                prefix < deleted.length &&
                prefix < inserted.length &&
                deleted[prefix] === inserted[prefix]
              )
                prefix++;
              let suffix = 0;
              while (
                suffix < deleted.length - prefix &&
                suffix < inserted.length - prefix &&
                deleted[deleted.length - 1 - suffix] ===
                  inserted[inserted.length - 1 - suffix]
              )
                suffix++;
              const effective = inserted.slice(
                prefix,
                inserted.length - suffix,
              );
              const start = from + prefix;
              const selection = transaction.newSelection;
              if (
                deleted.length !== prefix + suffix ||
                start !== action.cursor ||
                !/^\n[ \t]+$/.test(effective) ||
                selection.ranges.length !== 1 ||
                !selection.main.empty ||
                selection.main.head !== start + effective.length ||
                !/^[ \t]*$/.test(
                  transaction.newDoc.lineAt(selection.main.head).text,
                )
              )
                return;
              if (
                !action.before.doc
                  .replace(start, start, Text.of(effective.split("\n")))
                  .eq(transaction.newDoc)
              )
                return;
              this.action = {
                kind: "receipt",
                afterDoc: transaction.newDoc,
                from: start,
                inserted: effective,
              };
            },
          );
          if (changes !== 1) this.clear();
        } else if (
          !transaction.newSelection.eq(transaction.startState.selection)
        ) {
          this.clear();
        }
      }
    }

    reverse() {
      const action = this.action;
      this.clear();
      const { state } = this.view;
      if (
        action.kind !== "receipt" ||
        !enabled() ||
        this.view.composing ||
        state.readOnly ||
        state.doc !== action.afterDoc ||
        state.selection.ranges.length !== 1 ||
        !state.selection.main.empty ||
        state.selection.main.head !== action.from + action.inserted.length ||
        state.doc.sliceString(
          action.from,
          action.from + action.inserted.length,
        ) !== action.inserted
      )
        return false;
      this.view.dispatch({
        changes: {
          from: action.from,
          to: action.from + action.inserted.length,
        },
        selection: EditorSelection.cursor(action.from),
        userEvent: "delete.backward",
        annotations: isolateHistory.of("full"),
        scrollIntoView: true,
      });
      return true;
    }
  }
  const plugin = ViewPlugin.define((view) => new CodeEnter(view), {
    eventObservers: {
      keydown(event) {
        this.keydown(event);
      },
      pointerdown() {
        this.clear();
      },
      mousedown() {
        this.clear();
      },
      compositionstart() {
        this.clear();
      },
      blur() {
        this.clear();
      },
      paste() {
        this.clear();
      },
      drop() {
        this.clear();
      },
    },
  });
  return [
    classifier.extension,
    plugin,
    Prec.highest(
      keymap.of([
        {
          key: "Backspace",
          run: (view) => view.plugin(plugin)?.reverse() ?? false,
        },
      ]),
    ),
  ];
}
