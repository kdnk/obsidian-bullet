import { Platform } from "obsidian";

import { IMEDetector } from "../IMEDetector";

jest.mock("obsidian", () => ({ Platform: { isDesktop: true } }), {
  virtual: true,
});

function makeWorkspace(
  mainDocument: EventTarget,
  existingDocuments: EventTarget[],
) {
  type Handler = (...args: never[]) => void;
  const handlers = new Map<string, Handler>();
  const workspace = {
    containerEl: { ownerDocument: mainDocument },
    iterateAllLeaves(callback: (leaf: unknown) => void) {
      existingDocuments.forEach((ownerDocument) =>
        callback({ view: { containerEl: { ownerDocument } } }),
      );
    },
    on(name: string, handler: Handler) {
      handlers.set(name, handler);
      return { name };
    },
    offref(ref: { name: string }) {
      handlers.delete(ref.name);
    },
  };
  return {
    plugin: { app: { workspace }, registerEvent: jest.fn() },
    emit(name: string, document: EventTarget) {
      handlers.get(name)?.({} as never, { document } as never);
    },
  };
}

function focus(document: EventTarget) {
  Object.defineProperty(global, "activeDocument", {
    configurable: true,
    value: document,
  });
}

describe("IMEDetector document lifecycle", () => {
  let detector: IMEDetector;
  let mainDocument: EventTarget;
  let popoutDocument: EventTarget;
  let workspace: ReturnType<typeof makeWorkspace>;

  beforeEach(() => {
    mainDocument = new EventTarget();
    popoutDocument = new EventTarget();
    focus(mainDocument);
    workspace = makeWorkspace(mainDocument, [mainDocument, popoutDocument]);
    detector = new IMEDetector(workspace.plugin as never);
    Object.defineProperty(Platform, "isDesktop", {
      configurable: true,
      value: true,
    });
  });

  afterEach(async () => {
    await detector.unload();
    Reflect.deleteProperty(global, "activeDocument");
  });

  test("recognizes composition in a popout already open at plugin reload", async () => {
    await detector.load();
    focus(popoutDocument);
    popoutDocument.dispatchEvent(new Event("compositionstart"));
    expect(detector.isOpened()).toBe(true);
    popoutDocument.dispatchEvent(new Event("compositionend"));
    expect(detector.isOpened()).toBe(false);
  });

  test("keeps composition local to the focused document", async () => {
    await detector.load();
    mainDocument.dispatchEvent(new Event("compositionstart"));
    expect(detector.isOpened()).toBe(true);
    focus(popoutDocument);
    expect(detector.isOpened()).toBe(false);
    popoutDocument.dispatchEvent(new Event("compositionend"));
    focus(mainDocument);
    expect(detector.isOpened()).toBe(true);
  });

  test("registers the main document when a popout is focused and the main window has no leaves", async () => {
    workspace = makeWorkspace(mainDocument, [popoutDocument]);
    detector = new IMEDetector(workspace.plugin as never);
    focus(popoutDocument);
    await detector.load();
    mainDocument.dispatchEvent(new Event("compositionstart"));
    focus(mainDocument);
    expect(detector.isOpened()).toBe(true);
  });

  test("tracks newly opened windows and forgets closed composition", async () => {
    await detector.load();
    const document = new EventTarget();
    workspace.emit("window-open", document);
    focus(document);
    document.dispatchEvent(new Event("compositionstart"));
    expect(detector.isOpened()).toBe(true);
    workspace.emit("window-close", document);
    expect(detector.isOpened()).toBe(false);
    document.dispatchEvent(new Event("compositionstart"));
    expect(detector.isOpened()).toBe(false);
  });

  test("removes original listeners even after focus changes and clears state on reload", async () => {
    await detector.load();
    mainDocument.dispatchEvent(new Event("compositionstart"));
    focus(popoutDocument);
    await detector.unload();
    focus(mainDocument);
    expect(detector.isOpened()).toBe(false);
    mainDocument.dispatchEvent(new Event("compositionstart"));
    expect(detector.isOpened()).toBe(false);
    workspace.emit("window-open", popoutDocument);
    focus(popoutDocument);
    popoutDocument.dispatchEvent(new Event("compositionstart"));
    expect(detector.isOpened()).toBe(false);
    await detector.load();
    expect(detector.isOpened()).toBe(false);
  });

  test("preserves desktop-only composition gating", async () => {
    await detector.load();
    Object.defineProperty(Platform, "isDesktop", {
      configurable: true,
      value: false,
    });
    mainDocument.dispatchEvent(new Event("compositionstart"));
    expect(detector.isOpened()).toBe(false);
  });
});
