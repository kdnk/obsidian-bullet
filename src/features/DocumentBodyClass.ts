import { EventRef, Plugin } from "obsidian";

export class DocumentBodyClass {
  private documents = new Set<Document>();
  private events: EventRef[] = [];

  constructor(
    private plugin: Plugin,
    private className: string,
    private shouldApply: () => boolean,
  ) {}

  load() {
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
      workspace.on("window-open", this.handleWindowOpen),
      workspace.on("window-close", this.handleWindowClose),
    ];
    for (const event of this.events) {
      this.plugin.registerEvent(event);
    }
  }

  unload() {
    for (const event of this.events) {
      this.plugin.app.workspace.offref(event);
    }
    this.events = [];
    for (const doc of this.documents) {
      this.removeDocument(doc);
    }
  }

  update = () => {
    for (const doc of this.documents) {
      this.updateDocument(doc);
    }
  };

  private handleWindowOpen = (_workspaceWindow: unknown, window: Window) => {
    this.addDocument(window.document);
  };

  private handleWindowClose = (_workspaceWindow: unknown, window: Window) => {
    this.removeDocument(window.document);
  };

  private addDocument(doc: Document) {
    if (this.documents.has(doc)) {
      return;
    }

    this.documents.add(doc);
    this.updateDocument(doc);
  }

  private removeDocument(doc: Document) {
    doc.body.classList.remove(this.className);
    this.documents.delete(doc);
  }

  private updateDocument(doc: Document) {
    if (this.shouldApply()) {
      doc.body.classList.add(this.className);
    } else {
      doc.body.classList.remove(this.className);
    }
  }
}
