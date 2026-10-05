import { Platform, Plugin } from "obsidian";

import { Extension } from "@codemirror/state";

import { Feature } from "./Feature";
import { foldScrollReserveExtension } from "./FoldScroll";
import { foldScrollResize } from "./FoldScrollResize";

import { Settings } from "../services/Settings";

export function foldScrollReserve() {
  return [foldScrollResize(), foldScrollReserveExtension()];
}

const FOLD_SCROLL_RESERVE_EXTENSION = foldScrollReserve();

export class FoldScrollReserve implements Feature {
  private editorExtensions: Extension[] = [];

  constructor(
    private plugin: Plugin,
    private settings: Settings,
  ) {}

  async load() {
    this.synchronize(false);
    this.plugin.registerEditorExtension(this.editorExtensions);
    this.settings.onChange(
      ["listLineAction", "mobileRightFoldControls"],
      this.update,
    );
  }

  async unload() {
    this.settings.removeCallback(this.update);
  }

  private update = () => this.synchronize(true);

  private synchronize(updateViews: boolean) {
    const enabled =
      !Platform.isMobile ||
      this.settings.mobileRightFoldControls ||
      this.settings.verticalLinesAction === "toggle-folding";
    if (enabled === this.editorExtensions.length > 0) return;
    this.editorExtensions.splice(
      0,
      this.editorExtensions.length,
      ...(enabled ? [FOLD_SCROLL_RESERVE_EXTENSION] : []),
    );
    if (updateViews) this.plugin.app.workspace.updateOptions();
  }
}
