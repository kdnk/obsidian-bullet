import { Plugin } from "obsidian";

import { Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";

import { DocumentBodyClass } from "./DocumentBodyClass";
import { Feature } from "./Feature";
import {
  GUIDE_FOLDING_SCROLL_PAST_END_EXTENSION,
  GuideFoldingPluginValue,
} from "./GuideFolding";

import { Parser } from "../services/Parser";
import { Settings } from "../services/Settings";

const VERTICAL_LINES_ACTION_BODY_CLASS =
  "bullet-plugin-vertical-lines-action-toggle-folding";

export class VerticalLines implements Feature {
  private actionBodyClass: DocumentBodyClass;
  private editorExtensions: Extension[] = [];

  constructor(
    private plugin: Plugin,
    private settings: Settings,
    private parser: Parser,
  ) {
    this.actionBodyClass = new DocumentBodyClass(
      this.plugin,
      VERTICAL_LINES_ACTION_BODY_CLASS,
      this.shouldApplyActionBodyClass,
    );
  }

  async load() {
    this.editorExtensions = [
      ViewPlugin.define(
        (view) => new GuideFoldingPluginValue(this.settings, this.parser, view),
        { decorations: (value) => value.decorations },
      ),
    ];
    this.synchronizeScrollPastEndExtension(false);
    this.plugin.registerEditorExtension(this.editorExtensions);

    this.settings.onChange(["listLineAction"], this.updateActionState);
    this.actionBodyClass.load();
  }

  async unload() {
    this.settings.removeCallback(this.updateActionState);
    this.actionBodyClass.unload();
  }

  private updateActionState = () => {
    this.actionBodyClass.update();
    this.synchronizeScrollPastEndExtension(true);
  };

  private synchronizeScrollPastEndExtension(updateViews: boolean) {
    const extensionIndex = this.editorExtensions.indexOf(
      GUIDE_FOLDING_SCROLL_PAST_END_EXTENSION,
    );
    const enabled = extensionIndex !== -1;
    const shouldEnable = this.shouldApplyActionBodyClass();
    if (enabled === shouldEnable) {
      return;
    }

    if (shouldEnable) {
      this.editorExtensions.push(GUIDE_FOLDING_SCROLL_PAST_END_EXTENSION);
    } else {
      this.editorExtensions.splice(extensionIndex, 1);
    }

    if (updateViews) {
      this.plugin.app.workspace.updateOptions();
    }
  }

  private shouldApplyActionBodyClass = () => {
    return this.settings.verticalLinesAction === "toggle-folding";
  };
}
