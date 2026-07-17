import { Platform, Plugin } from "obsidian";

import { foldEffect, unfoldEffect } from "@codemirror/language";
import { EditorState, Extension } from "@codemirror/state";
import { EditorView, PluginValue, ViewPlugin } from "@codemirror/view";

import { DocumentBodyClass } from "./DocumentBodyClass";
import { Feature } from "./Feature";
import {
  ensureFoldScrollReserve,
  stableFoldScrollSnapshot,
} from "./FoldScroll";

import { Settings } from "../services/Settings";

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

type FoldScrollSnapshot = ReturnType<EditorView["scrollSnapshot"]>;
type FoldScrollSnapshotFactory = (view: EditorView) => FoldScrollSnapshot;

export class MobileNativeFoldScroll {
  private pendingSnapshots = new WeakMap<EditorState, FoldScrollSnapshot>();

  readonly extension: Extension = EditorState.transactionExtender.of(
    (transaction) => {
      const snapshot = this.pendingSnapshots.get(transaction.startState);
      if (
        !snapshot ||
        !transaction.effects.some(
          (effect) => effect.is(foldEffect) || effect.is(unfoldEffect),
        )
      ) {
        return null;
      }

      this.pendingSnapshots.delete(transaction.startState);
      return { effects: snapshot };
    },
  );

  constructor(
    private createSnapshot: FoldScrollSnapshotFactory = stableFoldScrollSnapshot,
  ) {}

  prepare(view: EditorView): void {
    const state = view.state;
    this.pendingSnapshots.set(state, this.createSnapshot(view));
    view.dom.ownerDocument.defaultView?.setTimeout(
      () => this.pendingSnapshots.delete(state),
      0,
    );
  }
}

export class MobileRightFoldControlsPluginValue implements PluginValue {
  constructor(
    private view: EditorView,
    private nativeFoldScroll: MobileNativeFoldScroll,
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
      !this.view.dom.ownerDocument.body.classList.contains(
        MOBILE_RIGHT_FOLD_CONTROLS_BODY_CLASS,
      ) ||
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

export class MobileRightFoldControls implements Feature {
  private bodyClass: DocumentBodyClass;
  private nativeFoldScroll = new MobileNativeFoldScroll();

  constructor(
    private plugin: Plugin,
    private settings: Settings,
  ) {
    this.bodyClass = new DocumentBodyClass(
      this.plugin,
      MOBILE_RIGHT_FOLD_CONTROLS_BODY_CLASS,
      this.shouldApplyBodyClass,
    );
  }

  async load() {
    this.plugin.registerEditorExtension([
      this.nativeFoldScroll.extension,
      ViewPlugin.define(
        (view) =>
          new MobileRightFoldControlsPluginValue(view, this.nativeFoldScroll),
      ),
    ]);
    this.settings.onChange(["mobileRightFoldControls"], this.updateBodyClass);
    this.bodyClass.load();
  }

  async unload() {
    this.settings.removeCallback(this.updateBodyClass);
    this.bodyClass.unload();
  }

  private updateBodyClass = () => {
    this.bodyClass.update();
  };

  private shouldApplyBodyClass = () => {
    return Platform.isMobile && this.settings.mobileRightFoldControls;
  };
}
