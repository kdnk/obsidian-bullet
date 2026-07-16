import { Platform, Plugin } from "obsidian";

import { DocumentBodyClass } from "./DocumentBodyClass";
import { Feature } from "./Feature";

import { Settings } from "../services/Settings";

const MOBILE_RIGHT_FOLD_CONTROLS_BODY_CLASS =
  "bullet-plugin-mobile-right-fold-controls";

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
