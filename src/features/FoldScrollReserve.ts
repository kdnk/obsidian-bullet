import { Platform, Plugin } from "obsidian";

import { Extension } from "@codemirror/state";
import {
  EditorView,
  PluginValue,
  ViewPlugin,
  ViewUpdate,
  scrollPastEnd,
} from "@codemirror/view";

import { Feature } from "./Feature";
import { foldScrollReserveHeight } from "./FoldScroll";
import { foldScrollResize } from "./FoldScrollResize";

import { Settings } from "../services/Settings";

const RESERVE_CLASS = "bullet-plugin-fold-scroll-reserve";
const RESERVE_PROPERTY = "--bullet-fold-scroll-reserve";

export class FoldScrollReservePluginValue implements PluginValue {
  private destroyed = false;

  private measure = {
    read: () => foldScrollReserveHeight(this.view),
    write: (height: number) => {
      if (this.destroyed || !Number.isFinite(height) || height < 0) return;
      this.view.dom.style.setProperty(RESERVE_PROPERTY, `${height}px`);
      this.view.dom.classList.add(RESERVE_CLASS);
    },
  };

  constructor(private view: EditorView) {
    view.requestMeasure(this.measure);
  }

  update(update: ViewUpdate) {
    if (update.geometryChanged) this.view.requestMeasure(this.measure);
  }

  destroy() {
    this.destroyed = true;
    this.view.dom.classList.remove(RESERVE_CLASS);
    this.view.dom.style.removeProperty(RESERVE_PROPERTY);
  }
}

export function foldScrollReserve() {
  return [
    scrollPastEnd(),
    foldScrollResize(),
    ViewPlugin.fromClass(FoldScrollReservePluginValue),
    EditorView.baseTheme({
      // Obsidian writes an inline 100px padding on resize. Keep the standard
      // reserve in CSS so that write cannot clamp the scroll position first.
      [`&.${RESERVE_CLASS} .cm-content`]: {
        paddingBottom: `var(${RESERVE_PROPERTY}) !important`,
      },
    }),
  ];
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
