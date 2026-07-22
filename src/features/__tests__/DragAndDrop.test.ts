import {
  EditorState,
  Extension,
  StateField,
  TransactionSpec,
} from "@codemirror/state";
import { DecorationSet } from "@codemirror/view";

import { readFileSync } from "fs";
import { join } from "path";

import { DragAndDrop } from "../DragAndDrop";

const mockNotice = jest.fn<void, unknown[]>();
const mockGetEditorFromState = jest.fn<unknown, unknown[]>();

jest.mock(
  "obsidian",
  () => ({
    Notice: class Notice {
      constructor(...args: unknown[]) {
        mockNotice(...args);
      }
    },
    Platform: { isMobile: false, isDesktop: true },
    Plugin: class Plugin {},
  }),
  { virtual: true },
);

jest.mock(
  "../../editor",
  () => ({
    getEditorFromState: (...args: unknown[]) => {
      return mockGetEditorFromState(...args);
    },
  }),
  { virtual: true },
);

describe("DragAndDrop", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(global, "window");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalWindow) {
      Object.defineProperty(global, "window", originalWindow);
    } else {
      delete (global as { window?: unknown }).window;
    }
  });

  function makeClassList() {
    const values = new Set<string>();

    return {
      add: jest.fn((value: string) => {
        values.add(value);
      }),
      remove: jest.fn((value: string) => {
        values.delete(value);
      }),
      toggle: jest.fn((value: string, force?: boolean) => {
        if (force ?? !values.has(value)) {
          values.add(value);
          return true;
        }

        values.delete(value);
        return false;
      }),
      contains: (value: string) => values.has(value),
    };
  }

  interface FakeElement {
    classList: {
      add: jest.Mock<void, [string]>;
      remove: jest.Mock<void, [string]>;
      toggle: jest.Mock<boolean, [string, boolean?]>;
      contains: (value: string) => boolean;
    };
    style: Record<string, string>;
    children: unknown[];
    parentNode: unknown;
    setCssStyles: (styles: Record<string, string>) => void;
    appendChild: (child: unknown) => void;
    removeChild?: (child: unknown) => void;
  }

  function makeElement(): FakeElement {
    return {
      classList: makeClassList(),
      style: {},
      children: [],
      parentNode: null,
      setCssStyles(styles: Record<string, string>) {
        Object.assign(this.style, styles);
      },
      appendChild(child: unknown) {
        this.children.push(child);
        (child as { parentNode: unknown }).parentNode = this;
      },
    };
  }

  function makeDocument() {
    const body = makeElement();
    const appended: unknown[] = [];
    const removed: unknown[] = [];
    const createDiv = jest.fn(() => makeElement());

    body.appendChild = jest.fn((child: unknown) => {
      appended.push(child);
      (child as { parentNode: unknown }).parentNode = body;
    });
    body.removeChild = jest.fn((child: unknown) => {
      removed.push(child);
      (child as { parentNode: unknown }).parentNode = null;
    });

    return {
      body,
      win: { createDiv },
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      appended,
      removed,
    };
  }

  test("subscribes to drag-and-drop setting changes through its lifecycle", async () => {
    const document = makeDocument();
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: document,
    });
    const settings = {
      dragAndDrop: true,
      onChange: jest.fn(),
      removeCallback: jest.fn(),
    };
    const workspace = { on: jest.fn().mockReturnValue({}) };
    const plugin = {
      app: { workspace },
      registerEditorExtension: jest.fn(),
      registerEvent: jest.fn(),
    };
    const feature = new DragAndDrop(
      plugin as never,
      settings as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await feature.load();

    expect(settings.onChange).toHaveBeenCalledWith(
      ["dnd"],
      expect.any(Function),
    );

    await feature.unload();
    expect(settings.removeCallback).toHaveBeenCalledWith(expect.any(Function));
  });

  test("marks only the dragged item's first line as the source", async () => {
    const document = makeDocument();
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: document,
    });
    const settings = {
      dragAndDrop: true,
      onChange: jest.fn(),
      removeCallback: jest.fn(),
    };
    const plugin = {
      app: { workspace: { on: jest.fn().mockReturnValue({}) } },
      registerEditorExtension: jest.fn<void, [Extension]>(),
      registerEvent: jest.fn(),
    };
    const feature = new DragAndDrop(
      plugin as never,
      settings as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await feature.load();

    const extension = plugin.registerEditorExtension.mock.calls[0]?.[0];
    if (!Array.isArray(extension) || !extension[0]) {
      throw new Error("DragAndDrop did not register its decoration state");
    }
    const decorationField = extension[0] as StateField<DecorationSet>;
    let editorState = EditorState.create({
      doc: "- parent\n\t- child\n\t- leaf",
      extensions: extension,
    });
    const view = {
      get state() {
        return editorState;
      },
      dispatch: jest.fn((spec: TransactionSpec) => {
        editorState = editorState.update(spec).state;
      }),
    };
    const editor = {
      posToOffset: jest.fn(({ line }: { line: number }) => {
        return editorState.doc.line(line + 1).from;
      }),
    };
    const list = {
      getFirstLineContentStart: jest.fn().mockReturnValue({ line: 0, ch: 0 }),
      getContentEndIncludingChildren: jest
        .fn()
        .mockReturnValue({ line: 2, ch: 6 }),
    };
    (
      feature as unknown as {
        state: unknown;
      }
    ).state = { document, doc: document, editor, list, view };

    (
      feature as unknown as {
        highlightDraggingLines: () => void;
      }
    ).highlightDraggingLines();

    const renderedDecorations: Array<{
      from: number;
      className: string | undefined;
    }> = [];
    const decorations = editorState.field(decorationField);
    for (let cursor = decorations.iter(); cursor.value; cursor.next()) {
      renderedDecorations.push({
        from: cursor.from,
        className: (
          cursor.value.spec as {
            class?: string;
          }
        ).class,
      });
    }

    expect(renderedDecorations).toEqual([
      {
        from: editorState.doc.line(1).from,
        className:
          "bullet-plugin-dragging-line bullet-plugin-dragging-source-line",
      },
      {
        from: editorState.doc.line(2).from,
        className: "bullet-plugin-dragging-line",
      },
      {
        from: editorState.doc.line(3).from,
        className: "bullet-plugin-dragging-line",
      },
    ]);
    expect(document.body.classList.contains("bullet-plugin-dragging")).toBe(
      true,
    );
  });

  interface DragMeasurement {
    renderedLineLeft?: number;
    scrollerLeft?: number;
    scrollerPaddingLeft?: string;
  }

  interface TestDragAndDropState {
    calculateNearestDropVariant: (x: number, y: number) => void;
    getDropVariants: () => Array<{ left: number }>;
  }

  function createDragStateForMeasurement(
    measurement: DragMeasurement,
  ): TestDragAndDropState {
    const editor = {
      offsetToPos: jest.fn().mockReturnValue({ line: 1, ch: 0 }),
      posToOffset: jest.fn(({ line }: { line: number }) => line * 10),
    };
    const draggedList = {
      getFirstLineContentStart: jest.fn().mockReturnValue({ line: 1, ch: 0 }),
      getContentEndIncludingChildren: jest
        .fn()
        .mockReturnValue({ line: 1, ch: 5 }),
      getLevel: jest.fn().mockReturnValue(1),
      isEmpty: jest.fn().mockReturnValue(true),
    };
    const root = {
      getListUnderLine: jest.fn().mockReturnValue(draggedList),
      getChildren: jest.fn().mockReturnValue([draggedList]),
    };
    const parser = {
      parse: jest.fn().mockReturnValue(root),
    };
    const defaultView = {
      getComputedStyle: jest.fn().mockReturnValue({
        paddingLeft: measurement.scrollerPaddingLeft ?? "0",
      }),
    };
    const ownerDocument = { defaultView };
    const renderedLine =
      measurement.renderedLineLeft === undefined
        ? null
        : {
            ownerDocument,
            getBoundingClientRect: jest.fn().mockReturnValue({
              left: measurement.renderedLineLeft,
            }),
          };
    const scroller =
      measurement.scrollerLeft === undefined
        ? null
        : {
            ownerDocument,
            getBoundingClientRect: jest.fn().mockReturnValue({
              left: measurement.scrollerLeft,
            }),
          };
    Object.defineProperty(global, "window", {
      configurable: true,
      value: defaultView,
    });
    const feature = new DragAndDrop(
      {} as never,
      { dragAndDrop: true } as never,
      {} as never,
      parser as never,
      {} as never,
    );
    const view = {
      state: {},
      defaultCharacterWidth: 7,
      dom: {
        ownerDocument,
        querySelector: jest.fn((selector: string) => {
          if (selector === ".cm-indent") {
            return { offsetWidth: 14 };
          }
          if (selector === "div.cm-line") {
            return renderedLine;
          }
          if (selector === "div.cm-scroller") {
            return scroller;
          }
          return null;
        }),
      },
      coordsAtPos: jest.fn().mockReturnValue({ left: 0, top: 100 }),
      lineBlockAt: jest.fn().mockReturnValue({ height: 20 }),
      posAtCoords: jest.fn().mockReturnValue(10),
    };
    mockGetEditorFromState.mockReturnValue(editor);

    (feature as unknown as { preStart: unknown }).preStart = {
      x: 10,
      y: 20,
      view,
      target: null,
    };
    jest
      .spyOn(
        feature as unknown as { highlightDraggingLines: () => void },
        "highlightDraggingLines",
      )
      .mockImplementation(() => {});

    (feature as unknown as { startDragging: () => void }).startDragging();

    const state = (feature as unknown as { state: TestDragAndDropState }).state;
    state.calculateNearestDropVariant(0, 92);
    return state;
  }

  test.each([
    ["the scroller is unavailable", { renderedLineLeft: 88 }],
    [
      "the scroller is also measurable",
      {
        renderedLineLeft: 88,
        scrollerLeft: 120,
        scrollerPaddingLeft: "24px",
      },
    ],
  ])("should position drop variants from a rendered line when %s", (_, dom) => {
    const state = createDragStateForMeasurement(dom);

    expect(state.getDropVariants()).toEqual(
      expect.arrayContaining([expect.objectContaining({ left: 88 })]),
    );
  });

  test("should position drop variants from scroller padding when no line is rendered", () => {
    const state = createDragStateForMeasurement({
      scrollerLeft: 120,
      scrollerPaddingLeft: "24px",
    });

    expect(state.getDropVariants()).toEqual(
      expect.arrayContaining([expect.objectContaining({ left: 144 })]),
    );
  });

  test("should position drop variants at zero when measurement DOM is missing", () => {
    const state = createDragStateForMeasurement({});

    expect(state.getDropVariants()).toEqual(
      expect.arrayContaining([expect.objectContaining({ left: 0 })]),
    );
  });

  test("should stop dragging and show a notice when the list cannot be parsed", () => {
    const editor = {
      offsetToPos: jest.fn().mockReturnValue({ line: 2, ch: 0 }),
    };
    mockGetEditorFromState.mockReturnValue(editor);

    const feature = new DragAndDrop(
      {} as never,
      { dragAndDrop: true } as never,
      {} as never,
      { parse: jest.fn().mockReturnValue(null) } as never,
      {} as never,
    );

    (feature as unknown as { preStart: unknown }).preStart = {
      x: 10,
      y: 20,
      view: {
        state: {},
        posAtCoords: jest.fn().mockReturnValue(4),
      },
    };

    (
      feature as unknown as {
        startDragging: () => void;
      }
    ).startDragging();

    expect(mockNotice).toHaveBeenCalledWith(
      "The item cannot be moved. Fix the invalid list indentation and try again.",
      5000,
    );
    expect((feature as unknown as { state: unknown }).state).toBeNull();
  });

  test("should start dragging from the clicked marker instead of ambiguous coordinates", () => {
    const editor = {
      offsetToPos: jest.fn((offset: number) =>
        offset === 60 ? { line: 6, ch: 0 } : { line: 5, ch: 0 },
      ),
    };
    const draggedList = {
      getFirstLineContentStart: jest.fn().mockReturnValue({ line: 6, ch: 2 }),
      getContentEndIncludingChildren: jest
        .fn()
        .mockReturnValue({ line: 6, ch: 5 }),
      getLevel: jest.fn().mockReturnValue(1),
      isEmpty: jest.fn().mockReturnValue(true),
    };
    const root = {
      getListUnderLine: jest.fn((line: number) =>
        line === 6 ? draggedList : null,
      ),
      getChildren: jest.fn().mockReturnValue([draggedList]),
    };
    const parser = {
      parse: jest.fn().mockReturnValue(root),
    };
    mockGetEditorFromState.mockReturnValue(editor);

    const feature = new DragAndDrop(
      {} as never,
      { dragAndDrop: true } as never,
      {} as never,
      parser as never,
      {} as never,
    );

    (
      feature as unknown as {
        preStart: unknown;
      }
    ).preStart = {
      x: 10,
      y: 20,
      view: {
        state: {},
        defaultCharacterWidth: 7,
        dom: {
          ownerDocument: {},
          querySelector: jest.fn((selector: string) =>
            selector === ".cm-indent" ? { offsetWidth: 14 } : null,
          ),
        },
        posAtCoords: jest.fn().mockReturnValue(50),
        posAtDOM: jest.fn().mockReturnValue(60),
      },
      target: {},
    };

    jest
      .spyOn(
        feature as unknown as { highlightDraggingLines: () => void },
        "highlightDraggingLines",
      )
      .mockImplementation(() => {});

    (
      feature as unknown as {
        startDragging: () => void;
      }
    ).startDragging();

    expect(parser.parse).toHaveBeenCalledWith(editor, { line: 6, ch: 0 });
    expect(root.getListUnderLine).toHaveBeenCalledWith(6);
    expect(
      (feature as unknown as { state: { list: unknown } }).state.list,
    ).toBe(draggedList);
  });

  test("should create and remove drag-and-drop contexts for pop-out windows", () => {
    const settings = {
      dragAndDrop: true,
      onChange: jest.fn(),
      removeCallback: jest.fn(),
    };

    const feature = new DragAndDrop(
      {} as never,
      settings as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const popoutDocument = makeDocument();

    (
      feature as unknown as {
        addManagedDocument: (doc: unknown) => void;
        removeManagedDocument: (doc: unknown) => void;
      }
    ).addManagedDocument(popoutDocument);

    expect(popoutDocument.body.classList.contains("bullet-plugin-dnd")).toBe(
      true,
    );
    expect(popoutDocument.win.createDiv).toHaveBeenCalledTimes(1);
    expect(popoutDocument.appended).toHaveLength(1);
    expect(popoutDocument.addEventListener).toHaveBeenCalledTimes(4);

    (
      feature as unknown as {
        removeManagedDocument: (doc: unknown) => void;
      }
    ).removeManagedDocument(popoutDocument);

    expect(popoutDocument.removed).toHaveLength(1);
    expect(popoutDocument.removeEventListener).toHaveBeenCalledTimes(4);
  });

  test("should update the drag-and-drop body class across all managed documents", () => {
    const settings = {
      dragAndDrop: true,
      onChange: jest.fn(),
      removeCallback: jest.fn(),
    };

    const feature = new DragAndDrop(
      {} as never,
      settings as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const mainDocument = makeDocument();
    const popoutDocument = makeDocument();

    (
      feature as unknown as {
        addManagedDocument: (doc: unknown) => void;
      }
    ).addManagedDocument(mainDocument);
    (
      feature as unknown as {
        addManagedDocument: (doc: unknown) => void;
      }
    ).addManagedDocument(popoutDocument);

    settings.dragAndDrop = false;
    (
      feature as unknown as {
        handleSettingsChange: () => void;
      }
    ).handleSettingsChange();

    expect(mainDocument.body.classList.contains("bullet-plugin-dnd")).toBe(
      false,
    );
    expect(popoutDocument.body.classList.contains("bullet-plugin-dnd")).toBe(
      false,
    );
  });

  test("should not start dragging until the pointer moves far enough", () => {
    const feature = new DragAndDrop(
      {} as never,
      { dragAndDrop: true } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const startDragging = jest.fn();
    (feature as unknown as { startDragging: () => void }).startDragging =
      startDragging;
    (feature as unknown as { preStart: unknown }).preStart = {
      x: 10,
      y: 20,
      view: {},
      doc: {},
    };

    (
      feature as unknown as {
        handleMouseMove: (e: Pick<MouseEvent, "x" | "y">) => void;
      }
    ).handleMouseMove({ x: 13, y: 22 });

    expect(startDragging).not.toHaveBeenCalled();
  });

  test("should start dragging once the pointer moves past the drag threshold", () => {
    const feature = new DragAndDrop(
      {} as never,
      { dragAndDrop: true } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const startDragging = jest.fn();
    (feature as unknown as { startDragging: () => void }).startDragging =
      startDragging;
    (feature as unknown as { preStart: unknown }).preStart = {
      x: 10,
      y: 20,
      view: {},
      doc: {},
    };

    (
      feature as unknown as {
        handleMouseMove: (e: Pick<MouseEvent, "x" | "y">) => void;
      }
    ).handleMouseMove({ x: 18, y: 20 });

    expect(startDragging).toHaveBeenCalledTimes(1);
  });

  test("draws the same single separator at the semantic indent for an inside drop", () => {
    const feature = new DragAndDrop(
      {} as never,
      { dragAndDrop: true } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const doc = makeDocument();
    const dropZone = makeElement();
    const dragState = {
      doc,
      view: { contentDOM: { offsetWidth: 400 } },
      dropVariant: {
        left: 80,
        top: 120,
        whereToMove: "inside",
      },
      leftPadding: 20,
    };

    (
      feature as unknown as {
        documents: Map<unknown, unknown>;
        state: unknown;
      }
    ).documents.set(doc, { doc, dropZone });
    (
      feature as unknown as {
        state: unknown;
      }
    ).state = dragState;

    (
      feature as unknown as {
        drawDropZone: () => void;
      }
    ).drawDropZone();

    expect(dropZone.style).toEqual({
      display: "block",
      top: "122px",
      left: "80px",
      width: "340px",
    });
    expect(dragState.dropVariant.top).toBe(120);
    expect(dropZone.children).toEqual([]);
    expect(dropZone.classList.contains("bullet-plugin-drop-zone-inside")).toBe(
      false,
    );
  });
});

test("uses neutral Logseq-style drag feedback", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
  const dragging = styles.match(
    /\.bullet-plugin-dragging-line\s*\{([^}]*)\}/,
  )?.[1];
  const dropZone = styles.match(/\.bullet-plugin-drop-zone\s*\{([^}]*)\}/)?.[1];
  const normalize = (value: string | undefined) =>
    value?.replace(/\s+/g, " ").trim();

  expect(normalize(dragging)).toBe(
    "background-color: var(--background-modifier-hover);",
  );
  expect(normalize(dropZone)).toBe(
    "width: 300px; height: 3px; background: var(--text-muted); z-index: 999; position: absolute; pointer-events: none;",
  );
  expect(styles).not.toMatch(
    /\.bullet-plugin-drop-zone(?:::before|-inside|-padding)/,
  );
  expect(styles).not.toContain(".bullet-plugin-dropping-line");
});

test("uses Logseq-style cursors for drag handles and active drags", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
  const idleDeclarations = styles.match(
    /body:not\(\.is-mobile\)\.bullet-plugin-dnd:not\(\.bullet-plugin-dragging\)\s+\.markdown-source-view\.mod-cm6\s+\.cm-formatting-list,\s*body:not\(\.is-mobile\)\.bullet-plugin-dnd:not\(\.bullet-plugin-dragging\)\s+\.markdown-source-view\.mod-cm6\s+\.task-list-item-checkbox,\s*body:not\(\.is-mobile\)\.bullet-plugin-dnd:not\(\.bullet-plugin-dragging\)\s+\.markdown-source-view\.mod-cm6\s+\.HyperMD-list-line\s+\.cm-fold-indicator\s+\.collapse-indicator\s*\{([^}]*)\}/,
  )?.[1];
  const draggingDeclarations = styles.match(
    /html\s+body:not\(\.is-mobile\)\.bullet-plugin-dnd\.bullet-plugin-dragging\s+\.markdown-source-view\.mod-cm6,\s*html\s+body:not\(\.is-mobile\)\.bullet-plugin-dnd\.bullet-plugin-dragging\s+\.markdown-source-view\.mod-cm6\s+\*\s*\{([^}]*)\}/,
  )?.[1];
  const normalize = (value: string | undefined) =>
    value?.replace(/\s+/g, " ").trim();

  expect(normalize(idleDeclarations)).toBe("cursor: pointer;");
  expect(normalize(draggingDeclarations)).toBe("cursor: copy;");
  expect(styles).not.toMatch(
    /body:not\(\.is-mobile\)\.bullet-plugin-dnd:not\(\.bullet-plugin-dragging\)[^{}]*(?:\.HyperMD-header|\.cm-indent)[^{}]*\{[^{}]*cursor:\s*pointer\s*;[^{}]*\}/,
  );
  expect(styles).not.toMatch(/cursor:\s*(?:grab|grabbing)\s*;/);
});
