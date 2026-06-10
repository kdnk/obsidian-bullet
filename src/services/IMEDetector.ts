import { Platform } from "obsidian";

export class IMEDetector {
  private composition = false;

  async load() {
    activeDocument.addEventListener(
      "compositionstart",
      this.onCompositionStart,
    );
    activeDocument.addEventListener("compositionend", this.onCompositionEnd);
  }

  async unload() {
    activeDocument.removeEventListener("compositionend", this.onCompositionEnd);
    activeDocument.removeEventListener(
      "compositionstart",
      this.onCompositionStart,
    );
  }

  isOpened() {
    return this.composition && Platform.isDesktop;
  }

  private onCompositionStart = () => {
    this.composition = true;
  };

  private onCompositionEnd = () => {
    this.composition = false;
  };
}
