import { Plugin } from "obsidian";

import { DocumentBodyClass } from "./DocumentBodyClass";
import { Feature } from "./Feature";

import { ObsidianSettings } from "../services/ObsidianSettings";
import { Settings } from "../services/Settings";

const BETTER_LISTS_BODY_CLASS = "bullet-plugin-better-lists";

export class BetterListsStyles implements Feature {
  private bodyClass: DocumentBodyClass;

  constructor(
    private plugin: Plugin,
    private settings: Settings,
    private obsidianSettings: ObsidianSettings,
  ) {
    this.bodyClass = new DocumentBodyClass(
      this.plugin,
      BETTER_LISTS_BODY_CLASS,
      this.shouldApplyBodyClass,
    );
  }

  async load() {
    this.settings.onChange(this.updateBodyClass);
    this.plugin.registerEvent(
      this.plugin.app.workspace.on("css-change", this.updateBodyClass),
    );
    this.updateBodyClass();
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
    return (
      this.obsidianSettings.isDefaultThemeEnabled() &&
      this.settings.betterListsStyles
    );
  };
}
