import { EventRef, Platform, Plugin } from "obsidian";

export class IMEDetector {
  private documents = new Map<
    Document,
    { composing: boolean; dispose: () => void }
  >();
  private events: EventRef[] = [];

  constructor(private plugin: Plugin) {}

  async load() {
    if (this.events.length > 0) {
      return;
    }

    const workspace = this.plugin.app.workspace;
    this.addDocument(workspace.containerEl.ownerDocument);
    this.addDocument(activeDocument);
    workspace.iterateAllLeaves((leaf) => {
      this.addDocument(leaf.view.containerEl.ownerDocument);
    });
    this.events = [
      workspace.on("window-open", (_workspaceWindow, window) => {
        this.addDocument(window.document);
      }),
      workspace.on("window-close", (_workspaceWindow, window) => {
        this.removeDocument(window.document);
      }),
    ];
    for (const event of this.events) {
      this.plugin.registerEvent(event);
    }
  }

  async unload() {
    for (const event of this.events) {
      this.plugin.app.workspace.offref(event);
    }
    this.events = [];
    for (const doc of this.documents.keys()) {
      this.removeDocument(doc);
    }
  }

  isOpened() {
    return (
      Platform.isDesktop &&
      (this.documents.get(activeDocument)?.composing ?? false)
    );
  }

  private addDocument(doc: Document) {
    if (this.documents.has(doc)) {
      return;
    }

    const state = {
      composing: false,
      dispose: () => {
        doc.removeEventListener("compositionstart", onStart);
        doc.removeEventListener("compositionend", onEnd);
      },
    };
    const onStart = () => {
      state.composing = true;
    };
    const onEnd = () => {
      state.composing = false;
    };
    doc.addEventListener("compositionstart", onStart);
    doc.addEventListener("compositionend", onEnd);
    this.documents.set(doc, state);
  }

  private removeDocument(doc: Document) {
    this.documents.get(doc)?.dispose();
    this.documents.delete(doc);
  }
}
