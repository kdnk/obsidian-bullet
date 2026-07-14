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
      dropdownAdded = false;
      toggleValue?: boolean;
      toggleCallbacks: Array<(value: boolean) => Promise<void>> = [];

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

      addDropdown() {
        this.dropdownAdded = true;
        return this;
      }

      addToggle(configure: (toggle: FakeToggle) => void) {
        const record = this;
        const toggle: FakeToggle = {
          callbacks: [] as Array<(value: boolean) => Promise<void>>,
          setValue(value: boolean) {
            record.toggleValue = value;
            return this;
          },
          onChange(callback: (value: boolean) => Promise<void>) {
            this.callbacks.push(callback);
            return this;
          },
        };
        configure(toggle);
        this.toggleCallbacks = toggle.callbacks;
        return this;
      }
    },
  }),
  { virtual: true },
);

interface FakeSetting {
  name: string;
  desc: string;
  dropdownAdded: boolean;
  toggleValue?: boolean;
  toggleCallbacks: Array<(value: boolean) => Promise<void>>;
}

interface FakeToggle {
  callbacks: Array<(value: boolean) => Promise<void>>;
  setValue(value: boolean): FakeToggle;
  onChange(callback: (value: boolean) => Promise<void>): FakeToggle;
}

interface DisplayableSettingsTab {
  display(): void;
}

describe("SettingsTab", () => {
  beforeEach(() => {
    mockSettingsRecords.length = 0;
  });

  test("should configure vertical indentation line action with a toggle", async () => {
    const addSettingTab = jest.fn<void, [DisplayableSettingsTab]>();
    const settings = {
      keepCursorWithinContent: "bullet-and-checkbox",
      overrideTabBehaviour: true,
      overrideEnterBehaviour: true,
      overrideVimOBehaviour: true,
      overrideSelectAllBehaviour: true,
      betterListsStyles: true,
      verticalLines: true,
      outerVerticalLines: true,
      verticalLinesAction: "toggle-folding",
      dragAndDrop: true,
      debug: false,
      save: jest.fn(),
    };

    await new SettingsTab(
      { app: {}, addSettingTab } as never,
      settings as never,
    ).load();

    const tab = addSettingTab.mock.calls[0]?.[0];
    if (!tab) {
      throw new Error("Expected settings tab to be registered");
    }
    tab.display();

    const verticalLinesSetting = mockSettingsRecords.find(
      (setting) => setting.name === "Draw vertical indentation lines",
    );
    const actionSetting = mockSettingsRecords.find(
      (setting) =>
        setting.name === "Fold lists from vertical indentation lines",
    );
    const verticalLinesSettingIndex = mockSettingsRecords.findIndex(
      (setting) => setting.name === "Draw vertical indentation lines",
    );
    const outerSettingIndex = mockSettingsRecords.findIndex(
      (setting) => setting.name === "Draw outer list lines",
    );
    const actionSettingIndex = mockSettingsRecords.findIndex(
      (setting) =>
        setting.name === "Fold lists from vertical indentation lines",
    );

    expect(verticalLinesSetting?.desc).toBe(
      "Show guide lines that connect nested list items by indentation level.",
    );
    expect(actionSetting?.dropdownAdded).toBe(false);
    expect(actionSetting?.toggleCallbacks).toHaveLength(1);
    expect(outerSettingIndex).toBe(verticalLinesSettingIndex + 1);
    expect(actionSettingIndex).toBe(outerSettingIndex + 1);
    expect(mockSettingsRecords[outerSettingIndex]?.toggleValue).toBe(true);

    await mockSettingsRecords[outerSettingIndex].toggleCallbacks[0](false);
    expect(settings.outerVerticalLines).toBe(false);
    expect(settings.save).toHaveBeenCalled();

    await actionSetting!.toggleCallbacks[0](false);
    expect(settings.verticalLinesAction).toBe("none");

    await actionSetting!.toggleCallbacks[0](true);
    expect(settings.verticalLinesAction).toBe("toggle-folding");
  });
});
