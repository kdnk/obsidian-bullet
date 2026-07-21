import { Plugin } from "obsidian";

import { DocumentBodyClass } from "./DocumentBodyClass";
import { Feature } from "./Feature";

import { Settings } from "../services/Settings";

const BETTER_LISTS_BODY_CLASS = "bullet-plugin-better-lists";

export class BetterListsStyles implements Feature {
  private bodyClass: DocumentBodyClass;

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
    this.settings.onChange(["styleLists"], this.updateBodyClass);
    this.bodyClass.load();
  }

  async unload() {
    this.settings.removeCallback(this.updateBodyClass);
    this.bodyClass.unload();
  }

  private updateBodyClass = () => {
    this.bodyClass.update();
  };
}
