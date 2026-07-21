import { Plugin } from "obsidian";

import { foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language";
import { EditorState, Extension, RangeSet } from "@codemirror/state";
import { EditorView, PluginValue, ViewPlugin } from "@codemirror/view";

import { Feature } from "./Feature";
import {
  ensureFoldScrollReserve,
  stableFoldScrollSnapshot,
} from "./FoldScroll";

const MOBILE_RIGHT_FOLD_CONTROLS_BODY_CLASS =
  "bullet-plugin-mobile-right-fold-controls";
const NATIVE_FOLD_CONTROL_SELECTOR = [
  ".HyperMD-list-line .cm-fold-indicator .collapse-indicator",
  ".HyperMD-header .cm-fold-indicator .collapse-indicator",
].join(", ");

function hasClosest(target: EventTarget | null): target is EventTarget & {
  closest(selector: string): Element | null;
} {
  return (
    typeof target === "object" &&
    target !== null &&
    "closest" in target &&
    typeof target.closest === "function"
  );
}

function isNativeFoldScrollEnabled(document: Document): boolean {
  return (
    !document.body.classList.contains("is-mobile") ||
    document.body.classList.contains(MOBILE_RIGHT_FOLD_CONTROLS_BODY_CLASS)
  );
}

type FoldScrollSnapshot = ReturnType<EditorView["scrollSnapshot"]>;
type FoldScrollSnapshotFactory = (view: EditorView) => FoldScrollSnapshot;

interface PendingFoldScrollSnapshot {
  active: boolean;
  snapshot: FoldScrollSnapshot;
  state: EditorState;
}

export class NativeFoldScrollState {
  private pendingSnapshots = new WeakMap<
    EditorState,
    PendingFoldScrollSnapshot
  >();

  readonly extension: Extension = EditorState.transactionExtender.of(
    (transaction) => {
      const pending = this.pendingSnapshots.get(transaction.startState);
      if (!pending || !pending.active) {
        return null;
      }

      this.pendingSnapshots.delete(transaction.startState);
      if (
        transaction.effects.some(
          (effect) => effect.is(foldEffect) || effect.is(unfoldEffect),
        ) ||
        !RangeSet.eq(
          [foldedRanges(transaction.startState)],
          [foldedRanges(transaction.state)],
        )
      ) {
        pending.active = false;
        return { effects: pending.snapshot };
      }

      pending.state = transaction.state;
      this.pendingSnapshots.set(pending.state, pending);
      return null;
    },
  );

  constructor(
    private createSnapshot: FoldScrollSnapshotFactory = stableFoldScrollSnapshot,
  ) {}

  prepare(view: EditorView): void {
    const pending: PendingFoldScrollSnapshot = {
      active: true,
      snapshot: this.createSnapshot(view),
      state: view.state,
    };
    this.pendingSnapshots.set(pending.state, pending);
    view.dom.ownerDocument.defaultView?.setTimeout(
      () => this.expire(pending),
      0,
    );
  }

  private expire(pending: PendingFoldScrollSnapshot): void {
    pending.active = false;
    if (this.pendingSnapshots.get(pending.state) === pending) {
      this.pendingSnapshots.delete(pending.state);
    }
  }
}

export class NativeFoldScrollPluginValue implements PluginValue {
  constructor(
    private view: EditorView,
    private nativeFoldScroll: NativeFoldScrollState,
  ) {
    this.view.contentDOM.addEventListener(
      "pointerdown",
      this.prepareNativeFoldScroll,
      true,
    );
    this.view.contentDOM.addEventListener(
      "click",
      this.prepareNativeFoldScroll,
      true,
    );
  }

  destroy() {
    this.view.contentDOM.removeEventListener(
      "pointerdown",
      this.prepareNativeFoldScroll,
      true,
    );
    this.view.contentDOM.removeEventListener(
      "click",
      this.prepareNativeFoldScroll,
      true,
    );
  }

  private prepareNativeFoldScroll = (event: Event) => {
    if (
      !isNativeFoldScrollEnabled(this.view.dom.ownerDocument) ||
      !hasClosest(event.target) ||
      !event.target.closest(NATIVE_FOLD_CONTROL_SELECTOR)
    ) {
      return;
    }

    ensureFoldScrollReserve(this.view);
    // Commit the restored reserve to layout before Obsidian's native handler
    // changes document height, otherwise bottom anchoring can move the row.
    void this.view.scrollDOM.scrollHeight;
    if (event.type === "click") {
      this.nativeFoldScroll.prepare(this.view);
    }
  };
}

export class NativeFoldScroll implements Feature {
  private nativeFoldScroll = new NativeFoldScrollState();

  constructor(private plugin: Plugin) {}

  async load() {
    this.plugin.registerEditorExtension([
      this.nativeFoldScroll.extension,
      ViewPlugin.define(
        (view) => new NativeFoldScrollPluginValue(view, this.nativeFoldScroll),
      ),
    ]);
  }

  async unload() {}
}
