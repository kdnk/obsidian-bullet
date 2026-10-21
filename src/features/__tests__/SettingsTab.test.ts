import { defaultFormattingSettings } from "../../formatting/settings";
import { SettingsTab } from "../SettingsTab";

const mockUpdate = jest.fn();

jest.mock(
  "obsidian",
  () => ({
    PluginSettingTab: class PluginSettingTab {
      update = mockUpdate;
    },
  }),
  { virtual: true },
);

type FakeControl =
  | {
      type: "dropdown";
      key: string;
      options: Record<string, string>;
    }
  | {
      type: "toggle" | "color";
      key: string;
    };

interface FakeSettingDefinition {
  name: string;
  desc?: string;
  control?: FakeControl;
  render?(setting: unknown): void;
}

interface FakeSettingGroup {
  type: "group";
  heading: string;
  items: FakeSettingDefinition[];
}

interface TestableSettingsTab {
  getSettingDefinitions(): FakeSettingGroup[];
  getControlValue(key: string): unknown;
  setControlValue(key: string, value: unknown): Promise<void>;
}

function makeSettings() {
  return {
    formatting: defaultFormattingSettings(),
    keepCursorWithinContent: "bullet-and-checkbox",
    keepBodyTextInBullets: false,
    overrideTabBehaviour: true,
    overrideEnterBehaviour: true,
    overrideVimOBehaviour: true,
    overrideSelectAllBehaviour: true,
    betterListsStyles: true,
    enhancedVerticalLineHover: true,
    bulletThreading: false,
    bulletThreadingColor: "#8b5cf6",
    outerVerticalLines: true,
    verticalLinesAction: "toggle-folding",
    mobileRightFoldControls: true,
    dragAndDrop: true,
    debug: false,
    save: jest.fn(async () => undefined),
  };
}

async function loadTab(
  settings: ReturnType<typeof makeSettings>,
): Promise<TestableSettingsTab> {
  const addSettingTab = jest.fn<void, [TestableSettingsTab]>();
  await new SettingsTab(
    { app: {}, addSettingTab } as never,
    settings as never,
  ).load();

  const tab = addSettingTab.mock.calls[0]?.[0];
  if (!tab) {
    throw new Error("Expected settings tab to be registered");
  }
  return tab;
}

describe("SettingsTab", () => {
  beforeEach(() => {
    mockUpdate.mockClear();
  });

  test("refreshes native formatting controls after persisting timestamps", async () => {
    const settings = makeSettings();
    const savedFormatting: ReturnType<typeof defaultFormattingSettings>[] = [];
    settings.save.mockImplementation(async () => {
      savedFormatting.push(structuredClone(settings.formatting));
    });
    const tab = await loadTab(settings);
    const timestamp = tab
      .getSettingDefinitions()
      .find((group) => group.heading === "Formatting")
      ?.items.find((definition) => definition.name === "File timestamps");
    if (!timestamp?.render) throw new Error("Expected timestamp renderer");
    let change: (value: boolean) => Promise<void> = async () => {
      throw new Error("Expected timestamp change callback");
    };
    const toggle = {
      setValue: () => toggle,
      onChange(callback: typeof change) {
        change = callback;
        return toggle;
      },
    };
    timestamp.render({
      addToggle(configure: (component: typeof toggle) => void) {
        configure(toggle);
      },
    });

    await change(true);

    expect(savedFormatting).toEqual([
      expect.objectContaining({
        timestamps: {
          kind: "enabled",
          created: true,
          modified: true,
          createdKey: "created",
          modifiedKey: "modified",
          createdSource: "filesystem",
          modifiedSource: "filesystem",
          format: "YYYY-MM-DD-HHmmss",
          utc: false,
        },
      }),
    ]);
    expect(settings.formatting.timestamps).toEqual(
      savedFormatting[0].timestamps,
    );
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  test("groups searchable declarative settings by purpose", async () => {
    const tab = await loadTab(makeSettings());

    const groups = tab.getSettingDefinitions();

    expect(groups.map((group) => group.heading)).toEqual([
      "Editing",
      "Appearance",
      "Folding",
      "Advanced",
      "Formatting",
    ]);
    expect(
      groups
        .slice(0, 4)
        .map((group) => group.items.map((definition) => definition.name)),
    ).toEqual([
      [
        "Keep typed text in lists",
        "Keep cursor out of list markers",
        "Enhance the Tab key",
        "Enhance the Enter key",
        "Vim-mode o/O inserts bullets",
        "Enhance the Ctrl+A or Cmd+A behavior",
        "Drag-and-Drop",
      ],
      [
        "Style list bullets",
        "Enhance vertical lines",
        "Bullet threading",
        "Thread color",
      ],
      [
        "Draw outer list lines",
        "Fold lists from vertical indentation lines",
        "Show fold controls on the right on mobile",
      ],
      ["Debug mode"],
    ]);
    expect(groups[0]?.items[0]).toEqual({
      name: "Keep typed text in lists",
      desc: "Add a list marker when directly typed body text would otherwise sit outside a list. Markdown structures stay available; pasted and external changes are unchanged.",
      control: { type: "toggle", key: "keepBodyTextInBullets" },
    });
    expect(groups[0]?.items[1]).toEqual({
      name: "Keep cursor out of list markers",
      desc: "Move the caret out of bullet, number, and checkbox prefixes after navigation or a click. Hold Alt or Option to place it inside temporarily. This changes only the caret position.",
      control: {
        type: "dropdown",
        key: "keepCursorWithinContent",
        options: {
          never: "Allow cursor in markers",
          "bullet-only": "Keep out of bullets",
          "bullet-and-checkbox": "Keep out of bullets and checkboxes",
        },
      },
    });
    expect(groups[1]?.items[0]).toEqual({
      name: "Style list bullets",
      desc: "Use Bullet's list-marker spacing, larger dots, and parent-item hover feedback. Colors follow the active Obsidian theme.",
      control: { type: "toggle", key: "betterListsStyles" },
    });
    expect(groups[2]?.items[0]?.control).toEqual({
      type: "toggle",
      key: "outerVerticalLines",
    });
    expect(groups[2]?.items[1]?.control).toEqual({
      type: "toggle",
      key: "verticalLinesActionEnabled",
    });
    expect(groups[1]?.items[1]).toMatchObject({
      name: "Enhance vertical lines",
      desc: "Strengthen indentation lines and use a continuous rounded hover.",
      control: {
        type: "toggle",
        key: "enhancedVerticalLineHover",
      },
    });
    expect(groups[1]?.items[2]?.control).toEqual({
      type: "toggle",
      key: "bulletThreading",
    });
    expect(groups[1]?.items[3]?.control).toEqual({
      type: "color",
      key: "bulletThreadingColor",
    });
  });

  test("reads and persists declarative control values through Settings", async () => {
    const settings = makeSettings();
    const tab = await loadTab(settings);

    expect(tab.getControlValue("verticalLinesActionEnabled")).toBe(true);
    expect(tab.getControlValue("keepCursorWithinContent")).toBe(
      "bullet-and-checkbox",
    );
    expect(tab.getControlValue("keepBodyTextInBullets")).toBe(false);
    expect(tab.getControlValue("enhancedVerticalLineHover")).toBe(true);
    expect(tab.getControlValue("bulletThreading")).toBe(false);
    expect(tab.getControlValue("bulletThreadingColor")).toBe("#8b5cf6");

    await tab.setControlValue("verticalLinesActionEnabled", false);
    await tab.setControlValue("keepCursorWithinContent", "bullet-only");
    await tab.setControlValue("keepBodyTextInBullets", true);
    await tab.setControlValue("enhancedVerticalLineHover", false);
    await tab.setControlValue("bulletThreading", true);
    await tab.setControlValue("bulletThreadingColor", "#123456");

    expect(settings.verticalLinesAction).toBe("none");
    expect(settings.keepCursorWithinContent).toBe("bullet-only");
    expect(settings.keepBodyTextInBullets).toBe(true);
    expect(settings.enhancedVerticalLineHover).toBe(false);
    expect(settings.bulletThreading).toBe(true);
    expect(settings.bulletThreadingColor).toBe("#123456");
    expect(settings.save).toHaveBeenCalledTimes(6);
  });

  test("rejects invalid declarative control values", async () => {
    const tab = await loadTab(makeSettings());

    await expect(
      tab.setControlValue("keepCursorWithinContent", "invalid"),
    ).rejects.toThrow("keepCursorWithinContent");
    await expect(tab.setControlValue("debug", "true")).rejects.toThrow("debug");
    await expect(
      tab.setControlValue("bulletThreading", "true"),
    ).rejects.toThrow("bulletThreading");
    for (const color of ["red", "#abc", "#12345678", "#12345g", 42, null]) {
      await expect(
        tab.setControlValue("bulletThreadingColor", color),
      ).rejects.toThrow("bulletThreadingColor");
    }
  });
});
