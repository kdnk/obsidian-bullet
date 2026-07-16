import { Platform, Plugin } from "obsidian";

import { EditorView, PluginValue, ViewPlugin } from "@codemirror/view";

import { DocumentBodyClass } from "./DocumentBodyClass";
import { Feature } from "./Feature";
import { ensureFoldScrollReserve } from "./FoldScroll";

import { Settings } from "../services/Settings";

const MOBILE_RIGHT_FOLD_CONTROLS_BODY_CLASS =
  "bullet-plugin-mobile-right-fold-controls";
const NATIVE_LIST_FOLD_CONTROL_SELECTOR =
  ".HyperMD-list-line .cm-fold-indicator .collapse-indicator";

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

export class MobileRightFoldControlsPluginValue implements PluginValue {
  constructor(private view: EditorView) {
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
      !event.target.closest(NATIVE_LIST_FOLD_CONTROL_SELECTOR)
    ) {
      return;
    }

    ensureFoldScrollReserve(this.view);
    // Commit the restored reserve to layout before Obsidian's native handler
    // changes document height, otherwise bottom anchoring can move the row.
    void this.view.scrollDOM.scrollHeight;
  };
}

export class MobileRightFoldControls implements Feature {
  private bodyClass: DocumentBodyClass;

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
    this.plugin.registerEditorExtension(
      ViewPlugin.define((view) => new MobileRightFoldControlsPluginValue(view)),
    );
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
