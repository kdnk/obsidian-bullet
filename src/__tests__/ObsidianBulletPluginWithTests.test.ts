import ObsidianBulletPlugin from "../ObsidianBulletPlugin";
import ObsidianBulletPluginWithTests from "../ObsidianBulletPluginWithTests";

const RENDERER_TEST_CONNECT_DELAY_MS = 1_000;
const RENDERER_TEST_CONNECT_TIMEOUT_MS = 10_000;

type TestWindow = Window & {
  ObsidianBulletPlugin?: ObsidianBulletPluginWithTests;
};

type GuideClickOptions = {
  line: number;
  kind: "indent" | "outer";
  prefix?: string;
};

class ControlledBrowserWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: ControlledBrowserWebSocket[] = [];

  readonly sent: string[] = [];
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  readyState = ControlledBrowserWebSocket.CONNECTING;
  closeCalls = 0;

  constructor(readonly url: string) {
    ControlledBrowserWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void) {
    const listeners = this.listeners.get(type);
    listeners?.delete(listener);
    if (listeners?.size === 0) {
      this.listeners.delete(type);
    }
  }

  send(data: string) {
    if (this.readyState !== ControlledBrowserWebSocket.OPEN) {
      throw new Error("Socket is not open");
    }
    this.sent.push(data);
  }

  close() {
    this.closeCalls += 1;
    this.readyState = ControlledBrowserWebSocket.CLOSING;
  }

  open() {
    this.readyState = ControlledBrowserWebSocket.OPEN;
    this.emit("open", { type: "open" });
  }

  fail(message: string) {
    this.emit("error", { message, type: "error" });
  }

  closeFromPeer() {
    this.readyState = ControlledBrowserWebSocket.CLOSED;
    this.emit("close", { type: "close" });
  }

  private emit(type: string, event: unknown) {
    for (const listener of [...(this.listeners.get(type) || [])]) {
      listener(event);
    }
  }
}

class FakeTextNode {
  readonly nodeType = 3;
  parentElement: FakeElement | null = null;

  constructor(readonly textContent: string) {}
}

class FakeElement {
  readonly nodeType = 1;
  readonly childNodes: Array<FakeElement | FakeTextNode> = [];
  readonly dispatchedEvents: MouseEvent[] = [];
  readonly ownerDocument: {
    defaultView: {
      getComputedStyle(element: FakeElement): {
        display: string;
        visibility: string;
        opacity: string;
      };
    };
  };
  parentElement: FakeElement | null = null;
  private readonly hasLayout: boolean;
  private readonly computedStyle: {
    display: string;
    visibility: string;
    opacity: string;
  };

  constructor(
    private readonly className: string,
    visibility:
      | boolean
      | {
          hasLayout?: boolean;
          display?: string;
          visibility?: string;
          opacity?: string;
        } = true,
  ) {
    const options =
      typeof visibility === "boolean" ? { hasLayout: visibility } : visibility;
    this.hasLayout = options.hasLayout ?? true;
    this.computedStyle = {
      display: options.display ?? "inline",
      visibility: options.visibility ?? "visible",
      opacity: options.opacity ?? "1",
    };
    this.ownerDocument = {
      defaultView: {
        getComputedStyle: (element) => element.computedStyle,
      },
    };
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }

  append(...children: Array<FakeElement | FakeTextNode>) {
    children.forEach((child) => {
      child.parentElement = this;
      this.childNodes.push(child);
    });
  }

  matches(selector: string) {
    return selector === `.${this.className}`;
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const result: FakeElement[] = [];

    for (const child of this.childNodes) {
      if (!(child instanceof FakeElement)) {
        continue;
      }
      if (child.matches(selector)) {
        result.push(child);
      }
      result.push(...child.querySelectorAll(selector));
    }

    return result;
  }

  dispatchEvent(event: MouseEvent) {
    this.dispatchedEvents.push(event);
    return true;
  }

  getClientRects() {
    return this.hasLayout ? [{}] : [];
  }
}

class FakeMouseEvent {
  readonly bubbles: boolean;
  readonly cancelable: boolean;

  constructor(
    readonly type: string,
    init: MouseEventInit = {},
  ) {
    this.bubbles = init.bubbles ?? false;
    this.cancelable = init.cancelable ?? false;
  }
}

jest.mock(
  "obsidian",
  () => ({
    MarkdownView: class MarkdownView {},
  }),
  { virtual: true },
);

jest.mock(
  "@codemirror/view",
  () => ({
    EditorView: class EditorView {},
  }),
  { virtual: true },
);

jest.mock("../editor", () => ({
  MyEditor: class MyEditor {},
  MyEditorPosition: class MyEditorPosition {},
}));

jest.mock("../features/EditorSelectionsBehaviourOverride", () => ({
  EditorSelectionsBehaviourOverride: class EditorSelectionsBehaviourOverride {},
}));

jest.mock("../ObsidianBulletPlugin", () => ({
  __esModule: true,
  default: class ObsidianBulletPlugin {
    async onload() {}

    async onunload() {}

    async prepareSettings() {}
  },
}));

describe("ObsidianBulletPluginWithTests", () => {
  const originalTestPlatform = process.env.TEST_PLATFORM;
  const originalMouseEvent = global.MouseEvent;
  const originalWebSocket = global.WebSocket;

  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(global, "window", {
      configurable: true,
      value: {
        setTimeout: global.setTimeout,
        clearTimeout: global.clearTimeout,
      },
    });
    Object.defineProperty(global, "MouseEvent", {
      configurable: true,
      value: FakeMouseEvent,
    });
    ControlledBrowserWebSocket.instances.length = 0;
    Object.defineProperty(global, "WebSocket", {
      configurable: true,
      value: ControlledBrowserWebSocket,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();

    if (originalTestPlatform === undefined) {
      delete process.env.TEST_PLATFORM;
    } else {
      process.env.TEST_PLATFORM = originalTestPlatform;
    }

    Object.defineProperty(global, "MouseEvent", {
      configurable: true,
      value: originalMouseEvent,
    });
    Object.defineProperty(global, "WebSocket", {
      configurable: true,
      value: originalWebSocket,
    });
  });

  test("connects after a bounded delay on the test platform", async () => {
    process.env.TEST_PLATFORM = "1";

    const parentOnload = jest
      .spyOn(ObsidianBulletPlugin.prototype, "onload")
      .mockResolvedValue(undefined);
    const plugin = Object.create(
      ObsidianBulletPluginWithTests.prototype,
    ) as ObsidianBulletPluginWithTests;
    const connect = jest.fn().mockResolvedValue(undefined);
    plugin.connect = connect;

    await plugin.onload();
    await jest.advanceTimersByTimeAsync(RENDERER_TEST_CONNECT_DELAY_MS - 1);

    expect(parentOnload).toHaveBeenCalled();
    expect((window as TestWindow).ObsidianBulletPlugin).toBe(plugin);
    expect(connect).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalled();
  });

  test("cancels the delayed connection when unloaded", async () => {
    process.env.TEST_PLATFORM = "1";
    const parentOnunload = jest.spyOn(
      ObsidianBulletPlugin.prototype,
      "onunload",
    );
    const plugin = Object.create(
      ObsidianBulletPluginWithTests.prototype,
    ) as ObsidianBulletPluginWithTests;
    const connect = jest.fn();
    plugin.connect = connect;

    await plugin.onload();
    plugin.onunload();
    await jest.runAllTimersAsync();

    expect(connect).not.toHaveBeenCalled();
    expect(parentOnunload).toHaveBeenCalled();
    expect((window as TestWindow).ObsidianBulletPlugin).toBeUndefined();
  });

  test("handles a rejected fire-and-forget renderer connection", async () => {
    process.env.TEST_PLATFORM = "1";
    const plugin = Object.create(
      ObsidianBulletPluginWithTests.prototype,
    ) as ObsidianBulletPluginWithTests;
    const failure = new Error("relay unavailable");
    plugin.connect = jest.fn().mockRejectedValue(failure);
    const consoleError = jest.spyOn(console, "error").mockImplementation();

    await plugin.onload();
    await jest.advanceTimersByTimeAsync(RENDERER_TEST_CONNECT_DELAY_MS);

    expect(consoleError).toHaveBeenCalledWith(
      "Obsidian test renderer connection failed",
      failure,
    );
  });

  test("waits for open, sends ready, and closes the socket on unload", async () => {
    const { plugin } = createPreparationPlugin({
      existingFile: true,
      openFile: jest.fn().mockResolvedValue(undefined),
      wait: jest.fn().mockResolvedValue(undefined),
    });

    const connection = plugin.connect();
    const socket = ControlledBrowserWebSocket.instances[0];
    expect(socket).toBeDefined();
    expect(socket.sent).toEqual([]);

    socket.open();
    await connection;
    expect(socket.sent).toEqual(["ready"]);

    plugin.onunload();
    expect(socket.closeCalls).toBe(1);
  });

  test("closes a ready renderer socket when its transport errors", async () => {
    const { plugin } = createPreparationPlugin({
      existingFile: true,
      openFile: jest.fn().mockResolvedValue(undefined),
      wait: jest.fn().mockResolvedValue(undefined),
    });
    const connection = plugin.connect();
    const socket = ControlledBrowserWebSocket.instances[0];
    socket.open();
    await connection;

    socket.fail("runtime reset");

    expect(socket.closeCalls).toBe(1);
    plugin.onunload();
    expect(socket.closeCalls).toBe(1);
  });

  test("bounds a renderer connection that never opens", async () => {
    expect(RENDERER_TEST_CONNECT_TIMEOUT_MS).toBeLessThan(15_000);
    const { plugin } = createPreparationPlugin({
      existingFile: true,
      openFile: jest.fn().mockResolvedValue(undefined),
      wait: jest.fn().mockResolvedValue(undefined),
    });
    const connection = plugin.connect();
    const rejection = expect(connection).rejects.toThrow(
      "Obsidian test renderer connection timed out",
    );

    await jest.advanceTimersByTimeAsync(RENDERER_TEST_CONNECT_TIMEOUT_MS);

    await rejection;
    expect(ControlledBrowserWebSocket.instances[0].closeCalls).toBe(1);
  });

  test.each([
    ["error", "Obsidian test renderer connection error: refused"],
    ["close", "Obsidian test renderer connection closed before ready"],
  ])("rejects a pre-ready renderer socket %s", async (event, expected) => {
    const { plugin } = createPreparationPlugin({
      existingFile: true,
      openFile: jest.fn().mockResolvedValue(undefined),
      wait: jest.fn().mockResolvedValue(undefined),
    });
    const connection = plugin.connect();
    const rejection = expect(connection).rejects.toThrow(expected);
    const socket = ControlledBrowserWebSocket.instances[0];

    if (event === "error") {
      socket.fail("refused");
    } else {
      socket.closeFromPeer();
    }

    await rejection;
  });

  test("stops preparation after an in-flight file creation resolves following unload", async () => {
    const createdFile = createDeferred<TestMarkdownFile>();
    const wait = jest.fn().mockResolvedValue(undefined);
    const openFile = jest.fn().mockResolvedValue(undefined);
    const { createFile, plugin } = createPreparationPlugin({
      createFile: () => createdFile.promise,
      openFile,
      wait,
    });
    const connection = plugin.connect();
    const rejection = expect(connection).rejects.toThrow(
      "Obsidian test renderer connection cancelled by unload",
    );
    const socket = ControlledBrowserWebSocket.instances[0];

    socket.open();
    await flushAsyncContinuation();
    expect(createFile).toHaveBeenCalledTimes(1);

    plugin.onunload();
    await rejection;
    createdFile.resolve(TEST_MARKDOWN_FILE);
    await flushAsyncContinuation();

    expect(wait).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
  });

  test("does not open the test file after transport cancellation during the pre-open wait", async () => {
    const preOpenWait = createDeferred<void>();
    const wait = jest.fn(() => preOpenWait.promise);
    const openFile = jest.fn().mockResolvedValue(undefined);
    const { plugin } = createPreparationPlugin({
      existingFile: true,
      openFile,
      wait,
    });
    const connection = plugin.connect();
    const rejection = expect(connection).rejects.toThrow(
      "Obsidian test renderer connection error: reset",
    );
    const socket = ControlledBrowserWebSocket.instances[0];

    socket.open();
    await flushAsyncContinuation();
    expect(wait).toHaveBeenCalledTimes(1);

    socket.fail("reset");
    await rejection;
    preOpenWait.resolve();
    await flushAsyncContinuation();

    expect(openFile).not.toHaveBeenCalled();
  });

  test("does not start post-open preparation after an in-flight open resolves following unload", async () => {
    const openedFile = createDeferred<void>();
    const wait = jest.fn().mockResolvedValue(undefined);
    const openFile = jest.fn(() => openedFile.promise);
    const { getActiveViewOfType, plugin } = createPreparationPlugin({
      existingFile: true,
      openFile,
      wait,
    });
    const connection = plugin.connect();
    const rejection = expect(connection).rejects.toThrow(
      "Obsidian test renderer connection cancelled by unload",
    );
    const socket = ControlledBrowserWebSocket.instances[0];

    socket.open();
    await flushAsyncContinuation();
    expect(openFile).toHaveBeenCalledTimes(1);

    plugin.onunload();
    await rejection;
    openedFile.resolve();
    await flushAsyncContinuation();

    expect(wait).toHaveBeenCalledTimes(1);
    expect(getActiveViewOfType).not.toHaveBeenCalled();
  });

  test("does not initialize the editor after transport cancellation during the post-open wait", async () => {
    const postOpenWait = createDeferred<void>();
    const wait = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => postOpenWait.promise);
    const openFile = jest.fn().mockResolvedValue(undefined);
    const { getActiveViewOfType, plugin } = createPreparationPlugin({
      existingFile: true,
      openFile,
      wait,
    });
    const connection = plugin.connect();
    const rejection = expect(connection).rejects.toThrow(
      "Obsidian test renderer connection closed before ready",
    );
    const socket = ControlledBrowserWebSocket.instances[0];

    socket.open();
    await flushAsyncContinuation();
    expect(wait).toHaveBeenCalledTimes(2);

    socket.closeFromPeer();
    await rejection;
    postOpenWait.resolve();
    await flushAsyncContinuation();

    expect(getActiveViewOfType).not.toHaveBeenCalled();
  });

  test("dispatches applyState once through the command registry", async () => {
    const plugin = Object.create(
      ObsidianBulletPluginWithTests.prototype,
    ) as ObsidianBulletPluginWithTests;
    const applyState = jest
      .spyOn(plugin, "applyState")
      .mockResolvedValue(undefined);
    const dispatch = (
      plugin as unknown as {
        handleTestCommand(
          type: string,
          data: unknown,
        ): Promise<State | undefined>;
      }
    ).handleTestCommand.bind(plugin);
    const state = ["- |one"];

    await expect(dispatch("applyState", state)).resolves.toBeUndefined();

    expect(applyState).toHaveBeenCalledTimes(1);
    expect(applyState).toHaveBeenCalledWith(state);
  });

  test("rejects unknown test commands", async () => {
    const plugin = Object.create(
      ObsidianBulletPluginWithTests.prototype,
    ) as ObsidianBulletPluginWithTests;
    const dispatch = (
      plugin as unknown as {
        handleTestCommand(
          type: string,
          data: unknown,
        ): Promise<State | undefined>;
      }
    ).handleTestCommand.bind(plugin);

    await expect(dispatch("unknown", undefined)).rejects.toThrow(
      "Unknown test command: unknown",
    );
  });

  test.each([
    ["applyState", { value: "- one", folds: [], selections: "invalid" }],
    ["drag", { from: { line: 0, ch: "0" } }],
    ["move", { to: { line: 0, ch: 0 }, offsetX: "0", offsetY: 0 }],
    ["setSetting", { k: "listLines", v: "true" }],
    ["setSetting", { k: "listLineAction", v: true }],
    ["clickGuide", { line: 0, kind: "middle", prefix: "" }],
  ])("rejects malformed %s command data", async (type, data) => {
    const plugin = Object.create(
      ObsidianBulletPluginWithTests.prototype,
    ) as ObsidianBulletPluginWithTests;
    const dispatch = (
      plugin as unknown as {
        handleTestCommand(
          type: string,
          data: unknown,
        ): Promise<State | undefined>;
      }
    ).handleTestCommand.bind(plugin);

    await expect(dispatch(type, data)).rejects.toThrow(
      `Invalid data for test command: ${type}`,
    );
  });

  test("validates command data before invoking its handler", async () => {
    const plugin = Object.create(
      ObsidianBulletPluginWithTests.prototype,
    ) as ObsidianBulletPluginWithTests;
    const applyState = jest.spyOn(plugin, "applyState");
    const dispatch = (
      plugin as unknown as {
        handleTestCommand(
          type: string,
          data: unknown,
        ): Promise<State | undefined>;
      }
    ).handleTestCommand.bind(plugin);

    await expect(
      dispatch("applyState", {
        value: "- one",
        folds: [],
        selections: "invalid",
      }),
    ).rejects.toThrow("Invalid data for test command: applyState");
    expect(applyState).not.toHaveBeenCalled();
  });

  test("clicks the indent guide with the exact raw prefix in pointer order", async () => {
    const firstLine = new FakeElement("cm-line");
    const targetLine = new FakeElement("cm-line");
    const indentContainer = new FakeElement("cm-hmd-list-indent");
    const firstGuide = new FakeElement("cm-indent");
    const secondGuide = new FakeElement("cm-indent");
    indentContainer.append(
      new FakeTextNode("\t"),
      firstGuide,
      new FakeTextNode("  "),
      secondGuide,
    );
    targetLine.append(indentContainer);
    const { plugin, domAtPos } = createPluginWithLineDom([
      firstLine,
      targetLine,
    ]);

    await callClickGuide(plugin, {
      line: 1,
      kind: "indent",
      prefix: "\t  ",
    });

    expect(domAtPos).toHaveBeenCalledWith(1);
    expect(firstGuide.dispatchedEvents).toEqual([]);
    expect(secondGuide.dispatchedEvents.map((event) => event.type)).toEqual([
      "mousedown",
      "mouseup",
      "click",
    ]);
    expect(secondGuide.dispatchedEvents).toHaveLength(3);
    expect(new Set(secondGuide.dispatchedEvents).size).toBe(3);
    secondGuide.dispatchedEvents.forEach((event) => {
      expect(event.bubbles).toBe(true);
      expect(event.cancelable).toBe(true);
    });
  });

  test("resolves the current line DOM for every guide click", async () => {
    const firstLine = createLineWithIndentGuide("  ");
    const secondLine = createLineWithIndentGuide("  ");
    const { plugin, domAtPos } = createPluginWithLineDom([firstLine]);
    domAtPos
      .mockReturnValueOnce({ node: firstLine, offset: 0 })
      .mockReturnValueOnce({ node: secondLine, offset: 0 });

    await callClickGuide(plugin, {
      line: 0,
      kind: "indent",
      prefix: "  ",
    });
    await callClickGuide(plugin, {
      line: 0,
      kind: "indent",
      prefix: "  ",
    });

    expect(domAtPos).toHaveBeenCalledTimes(2);
    expect(
      firstLine.querySelector(".cm-indent")?.dispatchedEvents,
    ).toHaveLength(3);
    expect(
      secondLine.querySelector(".cm-indent")?.dispatchedEvents,
    ).toHaveLength(3);
  });

  test("asserts a native list bullet from fresh line DOM", () => {
    const firstLine = createLineWithNativeListBullet();
    const staleLine = createLineWithNativeListBullet();
    const currentLine = new FakeElement("cm-line");
    const { plugin, domAtPos } = createPluginWithLineDom([firstLine]);
    domAtPos
      .mockReturnValueOnce({ node: staleLine, offset: 0 })
      .mockReturnValueOnce({ node: currentLine, offset: 0 });

    expect(() => callAssertNativeListBullet(plugin, { line: 0 })).not.toThrow();
    expect(() => callAssertNativeListBullet(plugin, { line: 0 })).toThrow(
      "Unable to assert native list bullet on line 0: found 0 visible native .list-bullet elements",
    );
    expect(domAtPos).toHaveBeenCalledTimes(2);
  });

  test.each([
    ["a zero layout rect", { hasLayout: false }],
    ["display none", { display: "none" }],
    ["hidden visibility", { visibility: "hidden" }],
    ["collapsed visibility", { visibility: "collapse" }],
    ["zero opacity", { opacity: "0" }],
  ])("rejects a native list bullet with %s", (_description, visibility) => {
    const line = createLineWithNativeListBullet(visibility);
    const { plugin } = createPluginWithLineDom([line]);

    expect(() => callAssertNativeListBullet(plugin, { line: 0 })).toThrow(
      "Unable to assert native list bullet on line 0: found 0 visible native .list-bullet elements",
    );
  });

  test("accepts at least one explicitly visible native list bullet", () => {
    const line = createLineWithNativeListBullet({ display: "none" });
    line.append(
      new FakeElement("list-bullet", {
        hasLayout: true,
        display: "inline-block",
        visibility: "visible",
        opacity: "1",
      }),
    );
    const { plugin } = createPluginWithLineDom([line]);

    expect(() => callAssertNativeListBullet(plugin, { line: 0 })).not.toThrow();
  });

  test("rejects a visible raw formatting marker beside a native list bullet", () => {
    const line = createLineWithNativeListBullet();
    const rawMarker = new FakeElement("cm-formatting-list");
    rawMarker.append(new FakeTextNode("-"));
    line.append(rawMarker);
    const { plugin } = createPluginWithLineDom([line]);

    expect(() => callAssertNativeListBullet(plugin, { line: 0 })).toThrow(
      "Unable to assert native list bullet on line 0: found a visible raw formatting marker",
    );
  });

  test("ignores a hidden raw formatting marker beside a native list bullet", () => {
    const line = createLineWithNativeListBullet();
    const hiddenRawMarker = new FakeElement("cm-formatting-list", false);
    hiddenRawMarker.append(new FakeTextNode("-"));
    line.append(hiddenRawMarker);
    const { plugin } = createPluginWithLineDom([line]);

    expect(() => callAssertNativeListBullet(plugin, { line: 0 })).not.toThrow();
  });

  test("ignores a computed-style-hidden raw formatting marker", () => {
    const line = createLineWithNativeListBullet();
    const hiddenRawMarker = new FakeElement("cm-formatting-list", {
      hasLayout: true,
      visibility: "hidden",
    });
    hiddenRawMarker.append(new FakeTextNode("-"));
    line.append(hiddenRawMarker);
    const { plugin } = createPluginWithLineDom([line]);

    expect(() => callAssertNativeListBullet(plugin, { line: 0 })).not.toThrow();
  });

  test("rejects an invalid editor line for a guide click", async () => {
    const { plugin } = createPluginWithLineDom([new FakeElement("cm-line")]);

    await expect(
      callClickGuide(plugin, {
        line: 1,
        kind: "indent",
        prefix: "  ",
      }),
    ).rejects.toThrow(
      "Unable to click indent guide on line 1: line must be between 0 and 0",
    );
  });

  test("requires a raw prefix for an indent guide click", async () => {
    const { plugin } = createPluginWithLineDom([
      createLineWithIndentGuide("  "),
    ]);

    await expect(
      callClickGuide(plugin, { line: 0, kind: "indent" }),
    ).rejects.toThrow(
      "Unable to click indent guide on line 0: prefix is required",
    );
  });

  test("rejects a missing outer guide on the resolved line", async () => {
    const targetLine = new FakeElement("cm-line");
    const otherLine = new FakeElement("cm-line");
    otherLine.append(new FakeElement("bullet-plugin-outer-list-guide"));
    const { plugin } = createPluginWithLineDom([targetLine, otherLine]);

    await expect(
      callClickGuide(plugin, { line: 0, kind: "outer" }),
    ).rejects.toThrow(
      "Unable to click outer guide on line 0: found 0 outer guide candidates",
    );
  });

  test("keeps cursor before checkbox in bullet-only selection adjustment fallback", () => {
    const plugin = Object.create(
      ObsidianBulletPluginWithTests.prototype,
    ) as ObsidianBulletPluginWithTests & {
      editor: {
        getLine(line: number): string;
        listSelections(): Array<{
          anchor: { line: number; ch: number };
          head: { line: number; ch: number };
        }>;
      };
      ensureCursorWithinListPrefix(
        stickCursor: "bullet-only",
        targetSelections: Array<{
          anchor: { line: number; ch: number };
          head: { line: number; ch: number };
        }> | null,
        originalSelections?: Array<{
          anchor: { line: number; ch: number };
          head: { line: number; ch: number };
        }>,
      ): Array<{
        anchor: { line: number; ch: number };
        head: { line: number; ch: number };
      }>;
    };
    plugin.editor = {
      getLine: () => "- [!] one",
      listSelections: () => [
        { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
      ],
    };

    expect(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- Accesses a private helper through a narrowed test-only object.
      plugin.ensureCursorWithinListPrefix("bullet-only", null),
    ).toStrictEqual([{ anchor: { line: 0, ch: 2 }, head: { line: 0, ch: 2 } }]);
    expect(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- Accesses a private helper through a narrowed test-only object.
      plugin.ensureCursorWithinListPrefix(
        "bullet-only",
        [{ anchor: { line: 0, ch: 6 }, head: { line: 0, ch: 6 } }],
        [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } }],
      ),
    ).toStrictEqual([{ anchor: { line: 0, ch: 2 }, head: { line: 0, ch: 2 } }]);
  });
});

function createLineWithIndentGuide(prefix: string) {
  const line = new FakeElement("cm-line");
  const indentContainer = new FakeElement("cm-hmd-list-indent");
  indentContainer.append(
    new FakeTextNode(prefix),
    new FakeElement("cm-indent"),
  );
  line.append(indentContainer);
  return line;
}

function createLineWithNativeListBullet(
  visibility?: ConstructorParameters<typeof FakeElement>[1],
) {
  const line = new FakeElement("cm-line");
  line.append(new FakeElement("list-bullet", visibility));
  return line;
}

function createPluginWithLineDom(lines: FakeElement[]) {
  const domAtPos = jest.fn((offset: number) => ({
    node: lines[offset],
    offset: 0,
  }));
  const plugin = Object.create(
    ObsidianBulletPluginWithTests.prototype,
  ) as ObsidianBulletPluginWithTests & {
    editor: {
      getCodeMirrorView(): { domAtPos: typeof domAtPos };
      getLine(line: number): string;
      getValue(): string;
      posToOffset(position: { line: number; ch: number }): number;
    };
  };
  plugin.editor = {
    getCodeMirrorView: () => ({ domAtPos }),
    getLine: () => "",
    getValue: () => lines.map(() => "").join("\n"),
    posToOffset: (position: { line: number; ch: number }) => position.line,
  };
  plugin.waitForIdle = jest.fn().mockResolvedValue(undefined);

  return { domAtPos, plugin };
}

async function callClickGuide(
  plugin: ObsidianBulletPluginWithTests,
  options: GuideClickOptions,
) {
  await (
    plugin as unknown as {
      clickGuide(options: GuideClickOptions): Promise<void>;
    }
  ).clickGuide(options);
}

function callAssertNativeListBullet(
  plugin: ObsidianBulletPluginWithTests,
  options: { line: number },
) {
  return (
    plugin as unknown as {
      assertNativeListBullet(options: { line: number }): void;
    }
  ).assertNativeListBullet(options);
}

interface TestMarkdownFile {
  path: string;
}

const TEST_MARKDOWN_FILE: TestMarkdownFile = { path: "test.md" };

function createPreparationPlugin(options: {
  createFile?: () => Promise<TestMarkdownFile>;
  existingFile?: boolean;
  getActiveViewOfType?: () => unknown;
  openFile: (file: TestMarkdownFile) => Promise<void>;
  wait: (time: number) => Promise<void>;
}) {
  const createFile = jest.fn(
    options.createFile ?? (() => Promise.resolve(TEST_MARKDOWN_FILE)),
  );
  const getActiveViewOfType = jest.fn(
    options.getActiveViewOfType ?? (() => ({ editor: {} })),
  );
  const plugin = Object.create(
    ObsidianBulletPluginWithTests.prototype,
  ) as ObsidianBulletPluginWithTests;
  const app = {
    vault: {
      create: createFile,
      getMarkdownFiles: () =>
        options.existingFile ? [TEST_MARKDOWN_FILE] : [],
    },
    workspace: {
      getActiveViewOfType,
      getLeaf: () => ({ openFile: options.openFile }),
    },
  };
  (plugin as unknown as { app: typeof app }).app = app;
  plugin.wait = options.wait;

  return { createFile, getActiveViewOfType, plugin };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function flushAsyncContinuation() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}
