import { VerticalLinesPluginValue } from "../VerticalLines";

const mockGetEditorFromState = jest.fn();

jest.mock(
  "../../editor",
  () => ({
    getEditorFromState: (...args: unknown[]) => mockGetEditorFromState(...args),
  }),
  { virtual: true },
);

describe("VerticalLinesPluginValue", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockGetEditorFromState.mockReturnValue(null);
    Object.defineProperty(global, "window", {
      configurable: true,
      value: {
        setTimeout: global.setTimeout,
        clearTimeout: global.clearTimeout,
        getComputedStyle: jest
          .fn()
          .mockReturnValue({ paddingInlineStart: "28px" }),
        requestAnimationFrame: jest.fn(),
        cancelAnimationFrame: jest.fn(),
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function makeElement() {
    return {
      classList: { add: jest.fn() },
      setCssStyles(styles: Record<string, string>) {
        Object.assign(
          (this as { style?: Record<string, string> }).style ?? {},
          styles,
        );
      },
      appendChild: jest.fn(),
      removeChild: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };
  }

  test("cancels pending editor lookup when destroyed", () => {
    const scroller = makeElement();
    const contentContainer = makeElement();
    const viewDom = makeElement();
    const scrollDOM = makeElement();
    const setTimeoutSpy = jest.spyOn(window, "setTimeout");
    const clearTimeoutSpy = jest.spyOn(window, "clearTimeout");

    Object.defineProperty(global, "document", {
      configurable: true,
      value: {
        createElement: jest
          .fn()
          .mockReturnValueOnce(contentContainer)
          .mockReturnValueOnce(scroller),
      },
    });

    const pluginValue = new VerticalLinesPluginValue(
      {
        onChange: jest.fn(),
        removeCallback: jest.fn(),
      } as never,
      {} as never,
      {
        state: {},
        scrollDOM,
        dom: viewDom,
        contentDOM: makeElement(),
      } as never,
    );

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

    pluginValue.destroy();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(
      setTimeoutSpy.mock.results[0].value,
    );
  });

  test("measures clipped list lines from the visible range when the list start is not rendered", () => {
    const createdElements: unknown[] = [];
    const contentContainer = {
      ...makeElement(),
      style: {},
    };
    const overlayScroller = {
      ...makeElement(),
      style: {},
      scrollTo: jest.fn(),
    };
    const lineElement = {
      ...makeElement(),
      dataset: {},
      style: {
        top: "",
        left: "",
        width: "",
        height: "",
        display: "",
        getPropertyValue: jest.fn().mockReturnValue(""),
        setProperty: jest.fn(),
      },
    };
    createdElements.push(contentContainer, overlayScroller, lineElement);

    Object.defineProperty(global, "document", {
      configurable: true,
      value: {
        createElement: jest
          .fn()
          .mockImplementation(() => createdElements.shift()),
      },
    });

    Object.defineProperty(global, "window", {
      configurable: true,
      value: {
        setTimeout: global.setTimeout,
        clearTimeout: global.clearTimeout,
        getComputedStyle: jest
          .fn()
          .mockReturnValue({ paddingInlineStart: "28px" }),
        requestAnimationFrame: jest.fn(),
        cancelAnimationFrame: jest.fn(),
      },
    });
    class FakeHTMLElement {}
    Object.defineProperty(global, "HTMLElement", {
      configurable: true,
      value: FakeHTMLElement,
    });

    const editor = {
      offsetToPos: jest.fn((offset: number) =>
        offset === 100 ? { line: 10, ch: 0 } : { line: 20, ch: 0 },
      ),
      posToOffset: jest.fn(({ line }: { line: number }) =>
        line === 0 ? 0 : line === 30 ? 300 : 100,
      ),
      lastLine: jest.fn().mockReturnValue(40),
      getLine: jest.fn().mockReturnValue("  note"),
    };
    mockGetEditorFromState.mockReturnValue(editor);

    const child = {
      getChildren: jest.fn().mockReturnValue([]),
      isEmpty: jest.fn().mockReturnValue(true),
    };
    const list = {
      getID: jest.fn().mockReturnValue(40),
      getChildren: jest.fn().mockReturnValue([child]),
      getFirstLineContentStart: jest.fn().mockReturnValue({ line: 0, ch: 2 }),
      getFirstLineIndent: jest.fn().mockReturnValue(""),
      getParent: jest.fn().mockReturnValue(null),
      getParentOrThrow: jest.fn().mockReturnValue({
        getNextSiblingOf: jest.fn().mockReturnValue(null),
      }),
      hasCheckbox: jest.fn().mockReturnValue(false),
      isFolded: jest.fn().mockReturnValue(false),
      isEmpty: jest.fn().mockReturnValue(false),
    };
    const root = {
      getContentEnd: jest.fn().mockReturnValue({ line: 30, ch: 0 }),
      getChildren: jest.fn().mockReturnValue([list]),
    };
    const parser = {
      parseRange: jest.fn().mockReturnValue([root]),
    };

    const renderedLine = Object.assign(new FakeHTMLElement(), {
      classList: { contains: jest.fn().mockReturnValue(true) },
      style: { paddingInlineStart: "28px", paddingLeft: "" },
      querySelector: jest.fn().mockReturnValue(null),
    });
    const view = {
      state: {},
      viewport: { from: 100, to: 200 },
      viewportLineBlocks: [{}],
      visibleRanges: [{ from: 100, to: 200 }],
      scrollDOM: {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        getBoundingClientRect: jest.fn().mockReturnValue({ left: 10 }),
        scrollLeft: 0,
        offsetTop: 0,
      },
      dom: {
        appendChild: jest.fn(),
        removeChild: jest.fn(),
        querySelector: jest.fn().mockReturnValue({
          getBoundingClientRect: jest.fn().mockReturnValue({ left: 20 }),
        }),
      },
      contentDOM: {
        parentElement: {
          offsetLeft: 0,
          parentElement: {
            children: [{ clientHeight: 400 }],
          },
        },
        firstElementChild: Object.assign(new FakeHTMLElement(), {
          offsetTop: 24,
        }),
      },
      coordsAtPos: jest.fn((offset: number) =>
        offset === 0 ? null : { right: 48 },
      ),
      lineBlockAt: jest.fn((offset: number) =>
        offset === 0
          ? { top: -100, bottom: -80 }
          : offset === 199
            ? { top: 180, bottom: 200 }
            : { top: 0, bottom: 20 },
      ),
      domAtPos: jest.fn().mockReturnValue({ node: renderedLine }),
    };

    const pluginValue = new VerticalLinesPluginValue(
      {
        verticalLines: true,
        onChange: jest.fn(),
        removeCallback: jest.fn(),
      } as never,
      parser as never,
      view as never,
    );

    jest.runOnlyPendingTimers();
    (pluginValue as unknown as { calculate(): void }).calculate();

    expect(view.coordsAtPos).toHaveBeenCalledWith(100, 1);
    expect(lineElement.style.display).toBe("block");

    pluginValue.destroy();
  });

  test("keeps clipped list lines visible when coordinates are unavailable for the visible range start", () => {
    const createdElements: unknown[] = [];
    const contentContainer = {
      ...makeElement(),
      style: {},
    };
    const overlayScroller = {
      ...makeElement(),
      style: {},
      scrollTo: jest.fn(),
    };
    const lineElement = {
      ...makeElement(),
      dataset: {},
      style: {
        top: "",
        left: "",
        width: "",
        height: "",
        display: "",
        getPropertyValue: jest.fn().mockReturnValue(""),
        setProperty: jest.fn(),
      },
    };
    createdElements.push(contentContainer, overlayScroller, lineElement);

    Object.defineProperty(global, "document", {
      configurable: true,
      value: {
        createElement: jest
          .fn()
          .mockImplementation(() => createdElements.shift()),
      },
    });

    Object.defineProperty(global, "window", {
      configurable: true,
      value: {
        setTimeout: global.setTimeout,
        clearTimeout: global.clearTimeout,
        getComputedStyle: jest
          .fn()
          .mockReturnValue({ paddingInlineStart: "64px" }),
        requestAnimationFrame: jest.fn(),
        cancelAnimationFrame: jest.fn(),
      },
    });
    class FakeHTMLElement {}
    Object.defineProperty(global, "HTMLElement", {
      configurable: true,
      value: FakeHTMLElement,
    });

    const editor = {
      offsetToPos: jest.fn((offset: number) =>
        offset === 100 ? { line: 10, ch: 0 } : { line: 20, ch: 0 },
      ),
      posToOffset: jest.fn(({ line }: { line: number }) =>
        line === 0 ? 0 : line === 30 ? 300 : 100,
      ),
      lastLine: jest.fn().mockReturnValue(40),
      getLine: jest.fn().mockReturnValue("  note"),
    };
    mockGetEditorFromState.mockReturnValue(editor);

    const child = {
      getChildren: jest.fn().mockReturnValue([]),
      isEmpty: jest.fn().mockReturnValue(true),
    };
    const list = {
      getID: jest.fn().mockReturnValue(41),
      getChildren: jest.fn().mockReturnValue([child]),
      getFirstLineContentStart: jest.fn().mockReturnValue({ line: 0, ch: 2 }),
      getFirstLineIndent: jest.fn().mockReturnValue(""),
      getParent: jest.fn().mockReturnValue(null),
      getParentOrThrow: jest.fn().mockReturnValue({
        getNextSiblingOf: jest.fn().mockReturnValue(null),
      }),
      hasCheckbox: jest.fn().mockReturnValue(false),
      isFolded: jest.fn().mockReturnValue(false),
      isEmpty: jest.fn().mockReturnValue(false),
    };
    const root = {
      getContentEnd: jest.fn().mockReturnValue({ line: 30, ch: 0 }),
      getChildren: jest.fn().mockReturnValue([list]),
    };
    const parser = {
      parseRange: jest.fn().mockReturnValue([root]),
    };

    const renderedLine = Object.assign(new FakeHTMLElement(), {
      classList: { contains: jest.fn().mockReturnValue(true) },
      style: { paddingInlineStart: "64px", paddingLeft: "" },
      querySelector: jest.fn().mockReturnValue(null),
    });
    const view = {
      state: {},
      viewport: { from: 100, to: 200 },
      viewportLineBlocks: [{}],
      visibleRanges: [{ from: 100, to: 200 }],
      scrollDOM: {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        getBoundingClientRect: jest.fn().mockReturnValue({ left: 10 }),
        scrollLeft: 0,
        offsetTop: 0,
      },
      dom: {
        appendChild: jest.fn(),
        removeChild: jest.fn(),
        querySelector: jest.fn().mockReturnValue({
          getBoundingClientRect: jest.fn().mockReturnValue({ left: 20 }),
        }),
      },
      contentDOM: {
        parentElement: {
          offsetLeft: 0,
          parentElement: {
            children: [{ clientHeight: 400 }],
          },
        },
        firstElementChild: Object.assign(new FakeHTMLElement(), {
          offsetTop: 24,
        }),
      },
      coordsAtPos: jest.fn().mockReturnValue(null),
      lineBlockAt: jest.fn((offset: number) =>
        offset === 0
          ? { top: -100, bottom: -80 }
          : offset === 199
            ? { top: 180, bottom: 200 }
            : { top: 0, bottom: 20 },
      ),
      domAtPos: jest.fn().mockReturnValue({ node: renderedLine }),
    };

    const pluginValue = new VerticalLinesPluginValue(
      {
        verticalLines: true,
        onChange: jest.fn(),
        removeCallback: jest.fn(),
      } as never,
      parser as never,
      view as never,
    );

    jest.runOnlyPendingTimers();
    (pluginValue as unknown as { calculate(): void }).calculate();

    expect(lineElement.style.display).toBe("block");

    pluginValue.destroy();
  });

  test("reuses the last guide position when mobile scrolling temporarily loses coordinates and line DOM", () => {
    const createdElements: unknown[] = [];
    const contentContainer = {
      ...makeElement(),
      style: {},
    };
    const overlayScroller = {
      ...makeElement(),
      style: {},
      scrollTo: jest.fn(),
    };
    const lineElement = {
      ...makeElement(),
      dataset: {},
      style: {
        top: "",
        left: "",
        width: "",
        height: "",
        display: "",
        getPropertyValue: jest.fn().mockReturnValue(""),
        setProperty: jest.fn(),
      },
    };
    createdElements.push(contentContainer, overlayScroller, lineElement);

    Object.defineProperty(global, "document", {
      configurable: true,
      value: {
        createElement: jest
          .fn()
          .mockImplementation(() => createdElements.shift()),
      },
    });

    Object.defineProperty(global, "window", {
      configurable: true,
      value: {
        setTimeout: global.setTimeout,
        clearTimeout: global.clearTimeout,
        getComputedStyle: jest
          .fn()
          .mockReturnValue({ paddingInlineStart: "64px" }),
        requestAnimationFrame: jest.fn(),
        cancelAnimationFrame: jest.fn(),
      },
    });
    class FakeHTMLElement {}
    Object.defineProperty(global, "HTMLElement", {
      configurable: true,
      value: FakeHTMLElement,
    });

    const editor = {
      offsetToPos: jest.fn((offset: number) =>
        offset === 100 ? { line: 10, ch: 0 } : { line: 20, ch: 0 },
      ),
      posToOffset: jest.fn(({ line }: { line: number }) =>
        line === 0 ? 0 : line === 30 ? 300 : 100,
      ),
      lastLine: jest.fn().mockReturnValue(40),
      getLine: jest.fn().mockReturnValue("  note"),
    };
    mockGetEditorFromState.mockReturnValue(editor);

    const child = {
      getChildren: jest.fn().mockReturnValue([]),
      isEmpty: jest.fn().mockReturnValue(true),
    };
    const list = {
      getID: jest.fn().mockReturnValue(42),
      getChildren: jest.fn().mockReturnValue([child]),
      getFirstLineContentStart: jest.fn().mockReturnValue({ line: 0, ch: 2 }),
      getFirstLineIndent: jest.fn().mockReturnValue(""),
      getParent: jest.fn().mockReturnValue(null),
      getParentOrThrow: jest.fn().mockReturnValue({
        getNextSiblingOf: jest.fn().mockReturnValue(null),
      }),
      hasCheckbox: jest.fn().mockReturnValue(false),
      isFolded: jest.fn().mockReturnValue(false),
      isEmpty: jest.fn().mockReturnValue(false),
    };
    const root = {
      getContentEnd: jest.fn().mockReturnValue({ line: 30, ch: 0 }),
      getChildren: jest.fn().mockReturnValue([list]),
    };
    const parser = {
      parseRange: jest.fn().mockReturnValue([root]),
    };

    const renderedLine = Object.assign(new FakeHTMLElement(), {
      classList: { contains: jest.fn().mockReturnValue(true) },
      style: { paddingInlineStart: "64px", paddingLeft: "" },
      querySelector: jest.fn().mockReturnValue(null),
    });
    let coordinatesAvailable = true;
    const view = {
      state: {},
      viewport: { from: 100, to: 200 },
      viewportLineBlocks: [{}],
      visibleRanges: [{ from: 100, to: 200 }],
      scrollDOM: {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        getBoundingClientRect: jest.fn().mockReturnValue({ left: 10 }),
        scrollLeft: 0,
        offsetTop: 0,
      },
      dom: {
        appendChild: jest.fn(),
        removeChild: jest.fn(),
        querySelector: jest.fn().mockReturnValue({
          getBoundingClientRect: jest.fn().mockReturnValue({ left: 20 }),
        }),
      },
      contentDOM: {
        parentElement: {
          offsetLeft: 0,
          parentElement: {
            children: [{ clientHeight: 400 }],
          },
        },
        firstElementChild: Object.assign(new FakeHTMLElement(), {
          offsetTop: 24,
        }),
      },
      coordsAtPos: jest.fn(() => (coordinatesAvailable ? { right: 84 } : null)),
      lineBlockAt: jest.fn((offset: number) =>
        offset === 0
          ? { top: -100, bottom: -80 }
          : offset === 199
            ? { top: 180, bottom: 200 }
            : { top: 0, bottom: 20 },
      ),
      domAtPos: jest.fn(() => ({
        node: coordinatesAvailable ? renderedLine : null,
      })),
    };

    const pluginValue = new VerticalLinesPluginValue(
      {
        verticalLines: true,
        onChange: jest.fn(),
        removeCallback: jest.fn(),
      } as never,
      parser as never,
      view as never,
    );

    jest.runOnlyPendingTimers();
    (pluginValue as unknown as { calculate(): void }).calculate();
    expect(lineElement.style.display).toBe("block");

    lineElement.setCssStyles({ display: "" });
    coordinatesAvailable = false;
    (pluginValue as unknown as { calculate(): void }).calculate();

    expect(lineElement.style.display).toBe("block");

    pluginValue.destroy();
  });
});
