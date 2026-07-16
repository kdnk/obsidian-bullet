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

interface TestableSettingsTab {
  display(): void;
  getSettingDefinitions(): FakeSettingDefinition[];
  getControlValue(key: string): unknown;
  setControlValue(key: string, value: unknown): Promise<void>;
}

function makeSettings() {
  return {
    keepCursorWithinContent: "bullet-and-checkbox",
    overrideTabBehaviour: true,
    overrideEnterBehaviour: true,
    overrideVimOBehaviour: true,
    overrideSelectAllBehaviour: true,
    betterListsStyles: true,
    verticalLines: true,
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

  test("exposes searchable declarative settings in the legacy display order", async () => {
    const tab = await loadTab(makeSettings());

    const definitions = tab.getSettingDefinitions();

    expect(definitions.map((definition) => definition.name)).toEqual([
      "Stick the cursor to the content",
      "Enhance the Tab key",
      "Enhance the Enter key",
      "Vim-mode o/O inserts bullets",
      "Enhance the Ctrl+A or Cmd+A behavior",
      "Improve the style of your lists",
      "Draw vertical indentation lines",
      "Draw outer list lines",
      "Fold lists from vertical indentation lines",
      "Show fold controls on the right on mobile",
      "Drag-and-Drop",
      "Debug mode",
    ]);
    expect(definitions[0]?.control).toEqual({
      type: "dropdown",
      key: "keepCursorWithinContent",
      options: {
        never: "Never",
        "bullet-only": "Stick cursor out of bullets",
        "bullet-and-checkbox": "Stick cursor out of bullets and checkboxes",
      },
    });
    expect(definitions[8]?.control).toEqual({
      type: "toggle",
      key: "verticalLinesActionEnabled",
    });
  });

  test("reads and persists declarative control values through Settings", async () => {
    const settings = makeSettings();
    const tab = await loadTab(settings);

    expect(tab.getControlValue("verticalLinesActionEnabled")).toBe(true);
    expect(tab.getControlValue("keepCursorWithinContent")).toBe(
      "bullet-and-checkbox",
    );

    await tab.setControlValue("verticalLinesActionEnabled", false);
    await tab.setControlValue("keepCursorWithinContent", "bullet-only");

    expect(settings.verticalLinesAction).toBe("none");
    expect(settings.keepCursorWithinContent).toBe("bullet-only");
    expect(settings.save).toHaveBeenCalledTimes(2);
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

    expect(mockSettingsRecords.map((setting) => setting.name)).toEqual(
      tab.getSettingDefinitions().map((definition) => definition.name),
    );

    const cursorSetting = mockSettingsRecords[0];
    const outerSetting = mockSettingsRecords[7];
    const actionSetting = mockSettingsRecords[8];
    const mobileSetting = mockSettingsRecords[9];

    expect(cursorSetting?.dropdown?.value).toBe("bullet-and-checkbox");
    expect(outerSetting?.toggle?.value).toBe(true);
    expect(actionSetting?.toggle?.value).toBe(true);
    expect(mobileSetting?.toggle?.value).toBe(true);

    if (
      !outerSetting.toggle ||
      !actionSetting.toggle ||
      !mobileSetting.toggle
    ) {
      throw new Error("Expected legacy toggle controls");
    }
    await outerSetting.toggle.callbacks[0](false);
    await actionSetting.toggle.callbacks[0](false);
    await mobileSetting.toggle.callbacks[0](false);

    expect(settings.outerVerticalLines).toBe(false);
    expect(settings.verticalLinesAction).toBe("none");
    expect(settings.mobileRightFoldControls).toBe(false);
    expect(settings.save).toHaveBeenCalledTimes(3);
  });
});
