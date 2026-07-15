import ObsidianBulletPlugin from "../ObsidianBulletPlugin";
import ObsidianBulletPluginWithTests from "../ObsidianBulletPluginWithTests";

type TestWindow = Window & {
  ObsidianBulletPlugin?: ObsidianBulletPluginWithTests;
};

type GuideClickOptions = {
  line: number;
  kind: "indent" | "outer";
  prefix?: string;
};

class FakeTextNode {
  readonly nodeType = 3;
  parentElement: FakeElement | null = null;

  constructor(readonly textContent: string) {}
}

class FakeElement {
  readonly nodeType = 1;
  readonly childNodes: Array<FakeElement | FakeTextNode> = [];
  readonly dispatchedEvents: MouseEvent[] = [];
  parentElement: FakeElement | null = null;

  constructor(private readonly className: string) {}

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
  });

  test("connects from onload when running on the test platform", async () => {
    process.env.TEST_PLATFORM = "1";

    const parentOnload = jest
      .spyOn(ObsidianBulletPlugin.prototype, "onload")
      .mockResolvedValue(undefined);
    const plugin = Object.create(
      ObsidianBulletPluginWithTests.prototype,
    ) as ObsidianBulletPluginWithTests;
    const wait = jest.fn().mockResolvedValue(undefined);
    const connect = jest.fn();
    plugin.wait = wait;
    plugin.connect = connect;

    await plugin.onload();
    await jest.runAllTimersAsync();

    expect(parentOnload).toHaveBeenCalled();
    expect((window as TestWindow).ObsidianBulletPlugin).toBe(plugin);
    expect(wait).toHaveBeenCalledWith(1000);
    expect(connect).toHaveBeenCalled();
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
