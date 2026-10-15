import { Plugin, editorEditorField } from "obsidian";

import {
  Annotation,
  ChangeSet,
  EditorState,
  Extension,
  Transaction,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { Feature } from "./Feature";

import { BulletTypingPolicy } from "../services/BulletTypingPolicy";
import { Logger } from "../services/Logger";
import { MarkdownLineClassifier } from "../services/MarkdownLineClassifier";
import { Settings } from "../services/Settings";

const correctedNewlineInput = Annotation.define<boolean>();

export class BulletTypingGuard implements Feature {
  private classifier: MarkdownLineClassifier;
  private policy: BulletTypingPolicy;
  private filterExtension: Extension;
  private editorExtensions: Extension[] = [];

  constructor(
    private plugin: Plugin,
    private settings: Settings,
    logger: Logger,
  ) {
    this.classifier = new MarkdownLineClassifier();
    this.policy = new BulletTypingPolicy(this.classifier, logger);
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
        EditorView.updateListener.of((update) => {
          if (
            update.transactions.some((transaction) =>
              transaction.annotation(correctedNewlineInput),
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
      transaction.startState
        .field(editorEditorField, false)
        ?.dom.closest(".table-cell-wrapper")
    ) {
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
            ? correctedNewlineInput.of(true)
            : undefined,
        sequential: true,
      },
    ];
  };
}
