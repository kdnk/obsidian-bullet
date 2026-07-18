import { Plugin } from "obsidian";

import { EditorState, Transaction } from "@codemirror/state";

import { Feature } from "./Feature";

import { BulletTypingPolicy } from "../services/BulletTypingPolicy";
import { Logger } from "../services/Logger";
import { MarkdownLineClassifier } from "../services/MarkdownLineClassifier";
import { Settings } from "../services/Settings";

export class BulletTypingGuard implements Feature {
  private policy: BulletTypingPolicy;

  constructor(
    private plugin: Plugin,
    private settings: Settings,
    logger: Logger,
  ) {
    this.policy = new BulletTypingPolicy(new MarkdownLineClassifier(), logger);
  }

  async load() {
    this.plugin.registerEditorExtension(
      EditorState.transactionFilter.of(this.filterTransaction),
    );
  }

  async unload() {}

  private filterTransaction = (transaction: Transaction) => {
    if (!this.settings.keepBodyTextInBullets) {
      return transaction;
    }

    const decision = this.policy.decide(transaction);
    if (decision.kind === "pass") {
      return transaction;
    }
    if (decision.kind === "reject") {
      return {};
    }
    return [
      transaction,
      {
        changes: decision.changes,
        sequential: true,
      },
    ];
  };
}
