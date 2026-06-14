import { VerticalLines, VerticalLinesPluginValue } from "../VerticalLines";

const mockGetEditorFromState = jest.fn<unknown, unknown[]>();

jest.mock(
  "../../editor",
  () => ({
    getEditorFromState: (...args: unknown[]) => {
      return mockGetEditorFromState(...args);
    },
  }),
  { virtual: true },
);

function makeClassList() {
  const values = new Set<string>();

  return {
    add: jest.fn((value: string) => {
      values.add(value);
    }),
    remove: jest.fn((value: string) => {
      values.delete(value);
    }),
    contains: (value: string) => values.has(value),
  };
}

function makeDocument() {
  return {
    body: {
      classList: makeClassList(),
    },
  };
}

function makePlugin() {
  const eventHandlers = new Map<string, (...args: never[]) => void>();
  const workspace = {
    on: jest.fn((eventName: string, handler: (...args: never[]) => void) => {
      eventHandlers.set(eventName, handler);
      return { eventName };
    }),
  };

  return {
    eventHandlers,
    plugin: {
      app: { workspace },
      registerEditorExtension: jest.fn(),
      registerEvent: jest.fn(),
    },
    workspace,
  };
}

describe("VerticalLines", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("manages the body class for pop-out windows", async () => {
    const mainDocument = makeDocument();
    const popoutDocument = makeDocument();
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: mainDocument,
    });
    Object.defineProperty(global, "window", {
      configurable: true,
      value: {
        clearInterval: jest.fn(),
        setInterval: jest.fn(),
      },
    });

    const { eventHandlers, plugin, workspace } = makePlugin();
    const settingsCallbacks: Array<() => void> = [];
    const settings = {
      verticalLines: true,
      onChange: jest.fn((callback: () => void) => {
        settingsCallbacks.push(callback);
      }),
      removeCallback: jest.fn(),
    };

    const feature = new VerticalLines(
      plugin as never,
      settings as never,
      {} as never,
    );

    await feature.load();

    expect(plugin.registerEditorExtension).toHaveBeenCalled();
    expect(workspace.on).toHaveBeenCalledWith(
      "window-open",
      expect.any(Function),
    );
    expect(workspace.on).toHaveBeenCalledWith(
      "window-close",
      expect.any(Function),
    );
    expect(
      mainDocument.body.classList.contains("bullet-plugin-vertical-lines"),
    ).toBe(true);

    eventHandlers.get("window-open")?.(
      {} as never,
      { document: popoutDocument } as never,
    );
    expect(
      popoutDocument.body.classList.contains("bullet-plugin-vertical-lines"),
    ).toBe(true);

    settings.verticalLines = false;
    const settingsCallback = settingsCallbacks[0];
    if (!settingsCallback) {
      throw new Error("Expected settings callback to be registered");
    }
    settingsCallback();

    expect(
      mainDocument.body.classList.contains("bullet-plugin-vertical-lines"),
    ).toBe(false);
    expect(
      popoutDocument.body.classList.contains("bullet-plugin-vertical-lines"),
    ).toBe(false);

    eventHandlers.get("window-close")?.(
      {} as never,
      { document: popoutDocument } as never,
    );
    await feature.unload();

    expect(
      mainDocument.body.classList.contains("bullet-plugin-vertical-lines"),
    ).toBe(false);
    expect(settings.removeCallback).toHaveBeenCalledWith(expect.any(Function));
  });
});

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
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: {
        createElement: jest.fn(),
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
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: global.document,
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

  test("syncs overlay scroll position immediately on editor scroll", () => {
    const scrollHandlers: Array<(event: Event) => void> = [];
    const contentContainer = makeElement();
    const overlayScroller = {
      ...makeElement(),
      scrollLeft: 0,
      scrollTop: 0,
    };
    const viewDom = makeElement();
    const scrollDOM = {
      ...makeElement(),
      addEventListener: jest.fn(
        (_eventName: string, handler: (event: Event) => void) => {
          scrollHandlers.push(handler);
        },
      ),
    };

    Object.defineProperty(global, "document", {
      configurable: true,
      value: {
        createElement: jest
          .fn()
          .mockReturnValueOnce(contentContainer)
          .mockReturnValueOnce(overlayScroller),
      },
    });
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: global.document,
    });

    const requestAnimationFrameSpy = jest
      .spyOn(window, "requestAnimationFrame")
      .mockReturnValue(1);
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

    expect(scrollHandlers).toHaveLength(1);
    scrollHandlers[0]({
      target: { scrollLeft: 12, scrollTop: 34 },
    } as unknown as Event);

    expect(overlayScroller.scrollLeft).toBe(12);
    expect(overlayScroller.scrollTop).toBe(34);
    expect(requestAnimationFrameSpy).toHaveBeenCalled();

    pluginValue.destroy();
  });

  test("measures clipped list lines from the visible range when the list start is not rendered", () => {
    const createdElements: unknown[] = [];
    const contentContainer = {
      ...makeElement(),
      style: { height: "" },
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
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: global.document,
    });
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: global.document,
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
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: global.document,
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
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: global.document,
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

  test("keeps the overlay scroll range at least as tall as the editor scroll range", () => {
    const createdElements: unknown[] = [];
    const contentContainer = {
      ...makeElement(),
      style: { height: "" },
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
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: global.document,
    });

    class FakeHTMLElement {}
    Object.defineProperty(global, "HTMLElement", {
      configurable: true,
      value: FakeHTMLElement,
    });

    const editor = {
      offsetToPos: jest.fn((offset: number) =>
        offset === 2000 ? { line: 200, ch: 0 } : { line: 210, ch: 0 },
      ),
      posToOffset: jest.fn(({ line }: { line: number }) =>
        line === 200 ? 2000 : line === 210 ? 2100 : 2000,
      ),
      lastLine: jest.fn().mockReturnValue(240),
      getLine: jest.fn().mockReturnValue("not a list"),
    };
    mockGetEditorFromState.mockReturnValue(editor);

    const child = {
      getChildren: jest.fn().mockReturnValue([]),
      isEmpty: jest.fn().mockReturnValue(true),
    };
    const list = {
      getID: jest.fn().mockReturnValue(43),
      getChildren: jest.fn().mockReturnValue([child]),
      getFirstLineContentStart: jest.fn().mockReturnValue({
        line: 200,
        ch: 2,
      }),
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
      getContentEnd: jest.fn().mockReturnValue({ line: 210, ch: 0 }),
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
      viewport: { from: 2000, to: 2100 },
      viewportLineBlocks: [{}],
      visibleRanges: [{ from: 2000, to: 2100 }],
      scrollDOM: {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        getBoundingClientRect: jest.fn().mockReturnValue({ left: 10 }),
        scrollLeft: 0,
        offsetTop: 0,
        scrollHeight: 2400,
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
      coordsAtPos: jest.fn().mockReturnValue({ right: 84 }),
      lineBlockAt: jest.fn().mockReturnValue({ top: 2000, bottom: 2100 }),
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

    expect(contentContainer.style.height).toBe("2400px");

    pluginValue.destroy();
  });

  test("parses from the start of a list block when the viewport starts inside it", () => {
    const contentContainer = {
      ...makeElement(),
      style: {},
    };
    const overlayScroller = {
      ...makeElement(),
      style: {},
      scrollTo: jest.fn(),
    };

    Object.defineProperty(global, "document", {
      configurable: true,
      value: {
        createElement: jest
          .fn()
          .mockReturnValueOnce(contentContainer)
          .mockReturnValueOnce(overlayScroller),
      },
    });
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: global.document,
    });

    class FakeHTMLElement {}
    Object.defineProperty(global, "HTMLElement", {
      configurable: true,
      value: FakeHTMLElement,
    });

    const lines = ["- parent"];
    for (let i = 1; i <= 30; i++) {
      lines.push("  - child " + i);
    }

    const editor = {
      offsetToPos: jest.fn((offset: number) =>
        offset === 100 ? { line: 10, ch: 0 } : { line: 20, ch: 0 },
      ),
      getLine: jest.fn((line: number) => lines[line] ?? ""),
      lastLine: jest.fn().mockReturnValue(lines.length - 1),
    };
    mockGetEditorFromState.mockReturnValue(editor);

    const parser = {
      parseRange: jest.fn().mockReturnValue([]),
    };
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
        scrollHeight: 600,
      },
      dom: {
        appendChild: jest.fn(),
        removeChild: jest.fn(),
        querySelector: jest.fn().mockReturnValue(null),
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

    expect(parser.parseRange).toHaveBeenCalledWith(editor, 0, 20);

    pluginValue.destroy();
  });

  test("reuses guide positions across recalculations for nested list lines", () => {
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
    const parentLineElement = {
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
    const childLineElement = {
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
    createdElements.push(
      contentContainer,
      overlayScroller,
      parentLineElement,
      childLineElement,
    );

    Object.defineProperty(global, "document", {
      configurable: true,
      value: {
        createElement: jest
          .fn()
          .mockImplementation(() => createdElements.shift()),
      },
    });
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: global.document,
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
        line === 0 ? 0 : line === 1 ? 10 : line === 30 ? 300 : 100,
      ),
      lastLine: jest.fn().mockReturnValue(40),
      getLine: jest.fn().mockReturnValue("  - nested"),
    };
    mockGetEditorFromState.mockReturnValue(editor);

    const emptyLeaf = {
      getChildren: jest.fn().mockReturnValue([]),
      isEmpty: jest.fn().mockReturnValue(true),
    };

    const makeLists = () => {
      const child = {
        getID: jest.fn().mockReturnValue(Math.random()),
        getChildren: jest.fn().mockReturnValue([emptyLeaf]),
        getFirstLineContentStart: jest.fn().mockReturnValue({
          line: 1,
          ch: 4,
        }),
        getFirstLineIndent: jest.fn().mockReturnValue("  "),
        getParent: jest.fn().mockReturnValue(null),
        getParentOrThrow: jest.fn(),
        hasCheckbox: jest.fn().mockReturnValue(false),
        isFolded: jest.fn().mockReturnValue(false),
        isEmpty: jest.fn().mockReturnValue(false),
      };
      const parent = {
        getID: jest.fn().mockReturnValue(Math.random()),
        getChildren: jest.fn().mockReturnValue([child]),
        getFirstLineContentStart: jest.fn().mockReturnValue({
          line: 0,
          ch: 2,
        }),
        getFirstLineIndent: jest.fn().mockReturnValue(""),
        getParent: jest.fn().mockReturnValue(null),
        getParentOrThrow: jest.fn(),
        getNextSiblingOf: jest.fn().mockReturnValue(null),
        hasCheckbox: jest.fn().mockReturnValue(false),
        isFolded: jest.fn().mockReturnValue(false),
        isEmpty: jest.fn().mockReturnValue(false),
      };
      child.getParent.mockReturnValue(parent);
      child.getParentOrThrow.mockReturnValue(parent);
      parent.getParentOrThrow.mockReturnValue({
        getNextSiblingOf: jest.fn().mockReturnValue(null),
      });
      const root = {
        getContentEnd: jest.fn().mockReturnValue({ line: 30, ch: 0 }),
        getChildren: jest.fn().mockReturnValue([parent]),
      };
      return root;
    };

    const parser = {
      parseRange: jest.fn().mockImplementation(() => [makeLists()]),
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
        scrollHeight: 600,
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
        offset === 199 ? { top: 180, bottom: 200 } : { top: 0, bottom: 20 },
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
    expect(parentLineElement.style.display).toBe("block");
    expect(childLineElement.style.display).toBe("block");

    parentLineElement.setCssStyles({ display: "" });
    childLineElement.setCssStyles({ display: "" });
    coordinatesAvailable = false;
    (pluginValue as unknown as { calculate(): void }).calculate();

    expect(parentLineElement.style.display).toBe("block");
    expect(childLineElement.style.display).toBe("block");

    pluginValue.destroy();
  });

  test("uses the same content-left measurement for line layout and container margin", () => {
    const createdElements: unknown[] = [];
    const contentContainer = {
      ...makeElement(),
      style: { marginLeft: "" },
    };
    const overlayScroller = {
      ...makeElement(),
      style: {},
      scrollLeft: 0,
      scrollTop: 0,
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
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: global.document,
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
      getID: jest.fn().mockReturnValue(44),
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
    const measuredLineLefts = [30, 999];
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
        scrollHeight: 600,
      },
      dom: {
        appendChild: jest.fn(),
        removeChild: jest.fn(),
        querySelector: jest.fn().mockReturnValue({
          getBoundingClientRect: jest.fn(() => ({
            left: measuredLineLefts.shift() ?? 999,
          })),
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
      coordsAtPos: jest.fn().mockReturnValue({ right: 84 }),
      lineBlockAt: jest.fn((offset: number) =>
        offset === 199 ? { top: 180, bottom: 200 } : { top: 0, bottom: 20 },
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

    expect(contentContainer.style.marginLeft).toBe("20px");

    pluginValue.destroy();
  });

  test("keeps cached parent guide position when the list start scrolls out of view", () => {
    const createdElements: unknown[] = [];
    const contentContainer = {
      ...makeElement(),
      style: {},
    };
    const overlayScroller = {
      ...makeElement(),
      style: {},
      scrollLeft: 0,
      scrollTop: 0,
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
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: global.document,
    });

    class FakeHTMLElement {}
    Object.defineProperty(global, "HTMLElement", {
      configurable: true,
      value: FakeHTMLElement,
    });

    let viewportFrom = 0;
    const editor = {
      offsetToPos: jest.fn((offset: number) =>
        offset === 0 ? { line: 0, ch: 0 } : { line: 20, ch: 0 },
      ),
      posToOffset: jest.fn(({ line }: { line: number }) =>
        line === 0 ? 0 : line === 30 ? 300 : 100,
      ),
      lastLine: jest.fn().mockReturnValue(40),
      getLine: jest.fn().mockReturnValue("  - child"),
    };
    mockGetEditorFromState.mockReturnValue(editor);

    const child = {
      getChildren: jest.fn().mockReturnValue([]),
      isEmpty: jest.fn().mockReturnValue(true),
    };
    const list = {
      getID: jest.fn().mockReturnValue(45),
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
      get viewport() {
        return { from: viewportFrom, to: 200 };
      },
      viewportLineBlocks: [{}],
      get visibleRanges() {
        return [{ from: viewportFrom, to: 200 }];
      },
      scrollDOM: {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        getBoundingClientRect: jest.fn().mockReturnValue({ left: 10 }),
        scrollLeft: 0,
        offsetTop: 0,
        scrollHeight: 600,
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
        offset === 0 && viewportFrom === 0
          ? { right: 84 }
          : offset === viewportFrom
            ? { right: 180 }
            : null,
      ),
      lineBlockAt: jest.fn((offset: number) =>
        offset === 199 ? { top: 180, bottom: 200 } : { top: 0, bottom: 20 },
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
    const firstLeft = lineElement.style.left;

    viewportFrom = 100;
    lineElement.setCssStyles({ left: "" });
    (pluginValue as unknown as { calculate(): void }).calculate();

    expect(lineElement.style.left).toBe(firstLeft);

    pluginValue.destroy();
  });
});
