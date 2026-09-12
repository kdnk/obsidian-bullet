import { Plugin } from "obsidian";

import { Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";

import { DocumentBodyClass } from "./DocumentBodyClass";
import { Feature } from "./Feature";
import { NestedCodeBlockLayoutPluginValue } from "./NestedCodeBlockLayout";

import { Settings } from "../services/Settings";

const BETTER_LISTS_BODY_CLASS = "bullet-plugin-better-lists";

export class BetterListsStyles implements Feature {
  private bodyClass: DocumentBodyClass;
  private editorExtensions: Extension[] = [];

  constructor(
    private plugin: Plugin,
    private settings: Settings,
  ) {
    this.bodyClass = new DocumentBodyClass(
      this.plugin,
      BETTER_LISTS_BODY_CLASS,
      () => this.settings.betterListsStyles,
    );
  }

  async load() {
    this.synchronizeEditorExtension(false);
    this.plugin.registerEditorExtension(this.editorExtensions);
    this.settings.onChange(["styleLists"], this.update);
    this.bodyClass.load();
  }

  async unload() {
    this.settings.removeCallback(this.update);
    this.bodyClass.unload();
  }

  private update = () => {
    this.bodyClass.update();
    this.synchronizeEditorExtension(true);
  };

  private synchronizeEditorExtension(updateViews: boolean) {
    const enabled = this.settings.betterListsStyles;
    if (enabled === this.editorExtensions.length > 0) return;
    this.editorExtensions.splice(
      0,
      this.editorExtensions.length,
      ...(enabled
        ? [
            ViewPlugin.define(
              (view) => new NestedCodeBlockLayoutPluginValue(view),
              { decorations: (value) => value.decorations },
            ),
          ]
        : []),
    );
    if (updateViews) this.plugin.app.workspace.updateOptions();
  }
}
