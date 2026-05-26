import ObsidianOutlinerPlugin from "../ObsidianOutlinerPlugin";
import ObsidianOutlinerPluginWithTests from "../ObsidianOutlinerPluginWithTests";

type TestWindow = Window & {
  ObsidianOutlinerPlugin?: ObsidianOutlinerPluginWithTests;
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

jest.mock("../ObsidianOutlinerPlugin", () => ({
  __esModule: true,
  default: class ObsidianOutlinerPlugin {
    async onload() {}

    async onunload() {}

    async prepareSettings() {}
  },
}));

describe("ObsidianOutlinerPluginWithTests", () => {
  const originalTestPlatform = process.env.TEST_PLATFORM;

  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(global, "window", {
      configurable: true,
      value: {},
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
      .spyOn(ObsidianOutlinerPlugin.prototype, "onload")
      .mockResolvedValue(undefined);
    const plugin = Object.create(
      ObsidianOutlinerPluginWithTests.prototype,
    ) as ObsidianOutlinerPluginWithTests;
    plugin.wait = jest.fn().mockResolvedValue(undefined);
    plugin.connect = jest.fn();

    await plugin.onload();
    await jest.runAllTimersAsync();

    expect(parentOnload).toHaveBeenCalled();
    expect((window as TestWindow).ObsidianOutlinerPlugin).toBe(plugin);
    expect(plugin.wait).toHaveBeenCalledWith(1000);
    expect(plugin.connect).toHaveBeenCalled();
  });
});
