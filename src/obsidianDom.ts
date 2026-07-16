interface ObsidianDomWindow extends Window {
  createDiv(): HTMLDivElement;
  createSpan(): HTMLSpanElement;
}

export function getObsidianDomWindow(doc: Document): ObsidianDomWindow {
  return doc.win as ObsidianDomWindow;
}
