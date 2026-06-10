import { Feature } from "./Feature";

import { ObsidianSettings } from "../services/ObsidianSettings";
import { Settings } from "../services/Settings";

const BETTER_LISTS_BODY_CLASS = "bullet-plugin-better-lists";

export class BetterListsStyles implements Feature {
  private updateBodyClassInterval: number | null = null;

  constructor(
    private settings: Settings,
    private obsidianSettings: ObsidianSettings,
  ) {}

  async load() {
    this.updateBodyClass();
    this.updateBodyClassInterval = window.setInterval(() => {
      this.updateBodyClass();
    }, 1000);
  }

  async unload() {
    if (this.updateBodyClassInterval !== null) {
      window.clearInterval(this.updateBodyClassInterval);
      this.updateBodyClassInterval = null;
    }
    activeDocument.body.classList.remove(BETTER_LISTS_BODY_CLASS);
  }

  private updateBodyClass = () => {
    const shouldExists =
      this.obsidianSettings.isDefaultThemeEnabled() &&
      this.settings.betterListsStyles;
    const exists = activeDocument.body.classList.contains(
      BETTER_LISTS_BODY_CLASS,
    );

    if (shouldExists && !exists) {
      activeDocument.body.classList.add(BETTER_LISTS_BODY_CLASS);
    }

    if (!shouldExists && exists) {
      activeDocument.body.classList.remove(BETTER_LISTS_BODY_CLASS);
    }
  };
}
