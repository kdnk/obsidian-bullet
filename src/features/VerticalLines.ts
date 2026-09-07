import { Plugin } from "obsidian";

import { ViewPlugin } from "@codemirror/view";

import { DocumentBodyClass } from "./DocumentBodyClass";
import { Feature } from "./Feature";
import { GuideFoldingPluginValue } from "./GuideFolding";

import { Parser } from "../services/Parser";
import { Settings } from "../services/Settings";

const VERTICAL_LINES_ACTION_BODY_CLASS =
  "bullet-plugin-vertical-lines-action-toggle-folding";
const ENHANCED_VERTICAL_LINE_HOVER_BODY_CLASS =
  "bullet-plugin-enhanced-vertical-line-hover";

export class VerticalLines implements Feature {
  private actionBodyClass: DocumentBodyClass;
  private hoverBodyClass: DocumentBodyClass;

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
    this.hoverBodyClass = new DocumentBodyClass(
      this.plugin,
      ENHANCED_VERTICAL_LINE_HOVER_BODY_CLASS,
      this.shouldApplyHoverBodyClass,
    );
  }

  async load() {
    this.plugin.registerEditorExtension([
      ViewPlugin.define(
        (view) => new GuideFoldingPluginValue(this.settings, this.parser, view),
        { decorations: (value) => value.decorations },
      ),
    ]);

    this.settings.onChange(["listLineAction"], this.updateActionState);
    this.settings.onChange(
      ["enhanceVerticalLineHover"],
      this.updateHoverBodyClass,
    );
    this.actionBodyClass.load();
    this.hoverBodyClass.load();
  }

  async unload() {
    this.settings.removeCallback(this.updateActionState);
    this.settings.removeCallback(this.updateHoverBodyClass);
    this.actionBodyClass.unload();
    this.hoverBodyClass.unload();
  }

  private updateActionState = () => {
    this.actionBodyClass.update();
  };

  private updateHoverBodyClass = () => {
    this.hoverBodyClass.update();
  };

  private shouldApplyActionBodyClass = () => {
    return this.settings.verticalLinesAction === "toggle-folding";
  };

  private shouldApplyHoverBodyClass = () => {
    return this.settings.enhancedVerticalLineHover;
  };
}
