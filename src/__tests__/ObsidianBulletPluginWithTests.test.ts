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
    plugin.wait = jest.fn().mockResolvedValue(undefined);
    plugin.connect = jest.fn();

    await plugin.onload();
    await jest.runAllTimersAsync();

    expect(parentOnload).toHaveBeenCalled();
    expect((window as TestWindow).ObsidianBulletPlugin).toBe(plugin);
    expect(plugin.wait).toHaveBeenCalledWith(1000);
    expect(plugin.connect).toHaveBeenCalled();
  });
});
