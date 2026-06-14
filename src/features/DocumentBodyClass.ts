import { Plugin } from "obsidian";

export class DocumentBodyClass {
  private documents = new Set<Document>();

  constructor(
    private plugin: Plugin,
    private className: string,
    private shouldApply: () => boolean,
  ) {}

  load() {
    this.addDocument(activeDocument);
    this.plugin.registerEvent(
      this.plugin.app.workspace.on("window-open", this.handleWindowOpen),
    );
    this.plugin.registerEvent(
      this.plugin.app.workspace.on("window-close", this.handleWindowClose),
    );
  }

  unload() {
    for (const doc of Array.from(this.documents)) {
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
