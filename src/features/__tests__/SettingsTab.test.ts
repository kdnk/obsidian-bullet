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

      addToggle(
        configure: (toggle: {
          callbacks: Array<(value: boolean) => Promise<void>>;
          setValue: () => unknown;
          onChange: (callback: (value: boolean) => Promise<void>) => unknown;
        }) => void,
      ) {
        const toggle = {
          callbacks: [] as Array<(value: boolean) => Promise<void>>,
          setValue() {
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
  toggleCallbacks: Array<(value: boolean) => Promise<void>>;
}

describe("SettingsTab", () => {
  beforeEach(() => {
    mockSettingsRecords.length = 0;
  });

  test("should configure vertical indentation line action with a toggle", async () => {
    const addSettingTab = jest.fn();
    const settings = {
      keepCursorWithinContent: "bullet-and-checkbox",
      overrideTabBehaviour: true,
      overrideEnterBehaviour: true,
      overrideVimOBehaviour: true,
      overrideSelectAllBehaviour: true,
      betterListsStyles: true,
      verticalLines: true,
      verticalLinesAction: "toggle-folding",
      dragAndDrop: true,
      debug: false,
      save: jest.fn(),
    };

    await new SettingsTab(
      { app: {}, addSettingTab } as never,
      settings as never,
    ).load();

    const tab = addSettingTab.mock.calls[0][0];
    tab.display();

    const verticalLinesSetting = mockSettingsRecords.find(
      (setting) => setting.name === "Draw vertical indentation lines",
    );
    const actionSetting = mockSettingsRecords.find(
      (setting) =>
        setting.name === "Fold lists from vertical indentation lines",
    );

    expect(verticalLinesSetting?.desc).toBe(
      "Show guide lines that connect nested list items by indentation level.",
    );
    expect(actionSetting?.dropdownAdded).toBe(false);
    expect(actionSetting?.toggleCallbacks).toHaveLength(1);

    await actionSetting!.toggleCallbacks[0](false);
    expect(settings.verticalLinesAction).toBe("none");

    await actionSetting!.toggleCallbacks[0](true);
    expect(settings.verticalLinesAction).toBe("toggle-folding");
  });
});
