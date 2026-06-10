import ObsidianBulletPlugin from "../ObsidianBulletPlugin";
import ObsidianBulletPluginWithTests from "../ObsidianBulletPluginWithTests";

type TestWindow = Window & {
  ObsidianBulletPlugin?: ObsidianBulletPluginWithTests;
};

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

  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(global, "window", {
      configurable: true,
      value: {
        setTimeout: global.setTimeout,
        clearTimeout: global.clearTimeout,
      },
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
