import { SettingsTab } from "../SettingsTab";

const mockSettingsRecords: FakeSetting[] = [];

jest.mock(
  "obsidian",
  () => ({
    PluginSettingTab: class PluginSettingTab {
      containerEl: { empty: jest.Mock };

      constructor() {
        this.containerEl = { empty: jest.fn() };
      }
    },
    Setting: class Setting {
      name = "";
      desc = "";
      heading = false;
      dropdown?: FakeDropdownRecord;
      toggle?: FakeToggleRecord;

      constructor() {
        mockSettingsRecords.push(this);
      }

      setName(name: string) {
        this.name = name;
        return this;
      }

      setDesc(desc: string) {
        this.desc = desc;
        return this;
      }

      setHeading() {
        this.heading = true;
        return this;
      }

      addDropdown(configure: (dropdown: FakeDropdown) => void) {
        const record: FakeDropdownRecord = {
          options: {},
          value: "",
          callbacks: [],
        };
        const dropdown: FakeDropdown = {
          addOptions(options) {
            record.options = options;
            return this;
          },
          setValue(value) {
            record.value = value;
            return this;
          },
          onChange(callback) {
            record.callbacks.push(callback);
            return this;
          },
        };
        configure(dropdown);
        this.dropdown = record;
        return this;
      }

      addToggle(configure: (toggle: FakeToggle) => void) {
        const record: FakeToggleRecord = {
          value: false,
          callbacks: [],
        };
        const toggle: FakeToggle = {
          setValue(value) {
            record.value = value;
            return this;
          },
          onChange(callback) {
            record.callbacks.push(callback);
            return this;
          },
        };
        configure(toggle);
        this.toggle = record;
        return this;
      }
    },
  }),
  { virtual: true },
);

interface FakeSetting {
  name: string;
  desc: string;
  heading: boolean;
  dropdown?: FakeDropdownRecord;
  toggle?: FakeToggleRecord;
}

interface FakeDropdownRecord {
  options: Record<string, string>;
  value: string;
  callbacks: Array<(value: string) => Promise<void>>;
}

interface FakeDropdown {
  addOptions(options: Record<string, string>): FakeDropdown;
  setValue(value: string): FakeDropdown;
  onChange(callback: (value: string) => Promise<void>): FakeDropdown;
}

interface FakeToggleRecord {
  value: boolean;
  callbacks: Array<(value: boolean) => Promise<void>>;
}

interface FakeToggle {
  setValue(value: boolean): FakeToggle;
  onChange(callback: (value: boolean) => Promise<void>): FakeToggle;
}

type FakeControl =
  | {
      type: "dropdown";
      key: string;
      options: Record<string, string>;
    }
  | {
      type: "toggle";
      key: string;
    };

interface FakeSettingDefinition {
  name: string;
  desc?: string;
  control: FakeControl;
}

interface FakeSettingGroup {
  type: "group";
  heading: string;
  items: FakeSettingDefinition[];
}

interface TestableSettingsTab {
  display(): void;
  getSettingDefinitions(): FakeSettingGroup[];
  getControlValue(key: string): unknown;
  setControlValue(key: string, value: unknown): Promise<void>;
}

function makeSettings() {
  return {
    keepCursorWithinContent: "bullet-and-checkbox",
    keepBodyTextInBullets: false,
    overrideTabBehaviour: true,
    overrideEnterBehaviour: true,
    overrideVimOBehaviour: true,
    overrideSelectAllBehaviour: true,
    betterListsStyles: true,
    enhancedVerticalLineHover: true,
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
    mockSettingsRecords.length = 0;
  });

  test("groups searchable declarative settings by purpose", async () => {
    const tab = await loadTab(makeSettings());

    const groups = tab.getSettingDefinitions();

    expect(groups.map((group) => group.heading)).toEqual([
      "Editing",
      "Appearance",
      "Folding",
      "Advanced",
    ]);
    expect(
      groups.map((group) => group.items.map((definition) => definition.name)),
    ).toEqual([
      [
        "Stick the cursor to the content",
        "Keep body text in bullets",
        "Enhance the Tab key",
        "Enhance the Enter key",
        "Vim-mode o/O inserts bullets",
        "Enhance the Ctrl+A or Cmd+A behavior",
        "Drag-and-Drop",
      ],
      ["Improve the style of your lists", "Enhance vertical line hover"],
      [
        "Draw outer list lines",
        "Fold lists from vertical indentation lines",
        "Show fold controls on the right on mobile",
      ],
      ["Debug mode"],
    ]);
    expect(groups[0]?.items[0]?.control).toEqual({
      type: "dropdown",
      key: "keepCursorWithinContent",
      options: {
        never: "Never",
        "bullet-only": "Stick cursor out of bullets",
        "bullet-and-checkbox": "Stick cursor out of bullets and checkboxes",
      },
    });
    expect(groups[0]?.items[1]).toMatchObject({
      name: "Keep body text in bullets",
      control: { type: "toggle", key: "keepBodyTextInBullets" },
    });
    expect(groups[2]?.items[0]?.control).toEqual({
      type: "toggle",
      key: "outerVerticalLines",
    });
    expect(groups[2]?.items[1]?.control).toEqual({
      type: "toggle",
      key: "verticalLinesActionEnabled",
    });
    expect(groups[1]?.items[1]?.control).toEqual({
      type: "toggle",
      key: "enhancedVerticalLineHover",
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

    await tab.setControlValue("verticalLinesActionEnabled", false);
    await tab.setControlValue("keepCursorWithinContent", "bullet-only");
    await tab.setControlValue("keepBodyTextInBullets", true);
    await tab.setControlValue("enhancedVerticalLineHover", false);

    expect(settings.verticalLinesAction).toBe("none");
    expect(settings.keepCursorWithinContent).toBe("bullet-only");
    expect(settings.keepBodyTextInBullets).toBe(true);
    expect(settings.enhancedVerticalLineHover).toBe(false);
    expect(settings.save).toHaveBeenCalledTimes(4);
  });

  test("rejects invalid declarative control values", async () => {
    const tab = await loadTab(makeSettings());

    await expect(
      tab.setControlValue("keepCursorWithinContent", "invalid"),
    ).rejects.toThrow("keepCursorWithinContent");
    await expect(tab.setControlValue("debug", "true")).rejects.toThrow("debug");
  });

  test("keeps the imperative display fallback for pre-1.13 Obsidian", async () => {
    const settings = makeSettings();
    const tab = await loadTab(settings);

    tab.display();

    expect(
      mockSettingsRecords.map(
        (setting) =>
          `${setting.heading ? "heading" : "setting"}:${setting.name}`,
      ),
    ).toEqual([
      "heading:Editing",
      "setting:Stick the cursor to the content",
      "setting:Keep body text in bullets",
      "setting:Enhance the Tab key",
      "setting:Enhance the Enter key",
      "setting:Vim-mode o/O inserts bullets",
      "setting:Enhance the Ctrl+A or Cmd+A behavior",
      "setting:Drag-and-Drop",
      "heading:Appearance",
      "setting:Improve the style of your lists",
      "setting:Enhance vertical line hover",
      "heading:Folding",
      "setting:Draw outer list lines",
      "setting:Fold lists from vertical indentation lines",
      "setting:Show fold controls on the right on mobile",
      "heading:Advanced",
      "setting:Debug mode",
    ]);

    const settingRecords = mockSettingsRecords.filter(
      (setting) => !setting.heading,
    );
    const cursorSetting = settingRecords[0];
    const hoverSetting = settingRecords[8];
    const outerSetting = settingRecords[9];
    const actionSetting = settingRecords[10];
    const mobileSetting = settingRecords[11];

    expect(cursorSetting?.dropdown?.value).toBe("bullet-and-checkbox");
    expect(hoverSetting?.toggle?.value).toBe(true);
    expect(outerSetting?.toggle?.value).toBe(true);
    expect(actionSetting?.toggle?.value).toBe(true);
    expect(mobileSetting?.toggle?.value).toBe(true);

    if (
      !hoverSetting.toggle ||
      !outerSetting.toggle ||
      !actionSetting.toggle ||
      !mobileSetting.toggle
    ) {
      throw new Error("Expected legacy toggle controls");
    }
    await hoverSetting.toggle.callbacks[0](false);
    await outerSetting.toggle.callbacks[0](false);
    await actionSetting.toggle.callbacks[0](false);
    await mobileSetting.toggle.callbacks[0](false);

    expect(settings.enhancedVerticalLineHover).toBe(false);
    expect(settings.outerVerticalLines).toBe(false);
    expect(settings.verticalLinesAction).toBe("none");
    expect(settings.mobileRightFoldControls).toBe(false);
    expect(settings.save).toHaveBeenCalledTimes(4);
  });
});
