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
      createElement: jest.fn(() => makeElement()),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      appended,
      removed,
    };
  }

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

  test("should mark the drop zone when moving an item inside another item", () => {
    Object.defineProperty(global, "getComputedStyle", {
      configurable: true,
      value: jest.fn().mockReturnValue({
        getPropertyValue: jest.fn().mockReturnValue("#8a5cf6"),
      }),
    });

    const feature = new DragAndDrop(
      {} as never,
      { dragAndDrop: true } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const doc = makeDocument();
    const dropZone = makeElement();
    const dropZonePadding = makeElement();
    const parent = {
      getLevel: jest.fn().mockReturnValue(2),
      getParent: jest.fn().mockReturnValue(null),
      getFirstLineContentStart: jest.fn().mockReturnValue({ line: 1, ch: 0 }),
    };

    (
      feature as unknown as {
        documents: Map<unknown, unknown>;
        state: unknown;
      }
    ).documents.set(doc, { doc, dropZone, dropZonePadding });
    (
      feature as unknown as {
        state: unknown;
      }
    ).state = {
      doc,
      view: {
        contentDOM: { offsetWidth: 400 },
        dispatch: jest.fn(),
      },
      editor: { posToOffset: jest.fn().mockReturnValue(0) },
      dropVariant: {
        left: 80,
        top: 120,
        whereToMove: "inside",
        placeToMove: parent,
      },
      leftPadding: 20,
      tabWidth: 30,
    };

    (
      feature as unknown as {
        drawDropZone: () => void;
      }
    ).drawDropZone();

    expect(dropZone.classList.contains("bullet-plugin-drop-zone-inside")).toBe(
      true,
    );
  });
});
