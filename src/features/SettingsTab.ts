import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  SettingDefinitionControl,
  SettingDefinitionGroup,
  SettingDefinitionItem,
} from "obsidian";

import { Feature } from "./Feature";

import { KeepCursorWithinContent, Settings } from "../services/Settings";

type SettingsControlKey =
  | "keepCursorWithinContent"
  | "keepBodyTextInBullets"
  | "overrideTabBehaviour"
  | "overrideEnterBehaviour"
  | "overrideVimOBehaviour"
  | "overrideSelectAllBehaviour"
  | "betterListsStyles"
  | "enhancedVerticalLineHover"
  | "outerVerticalLines"
  | "verticalLinesActionEnabled"
  | "mobileRightFoldControls"
  | "dragAndDrop"
  | "debug";

type BulletSettingDefinition = SettingDefinitionControl<SettingsControlKey> & {
  desc: string;
};

type BulletSettingGroup = SettingDefinitionGroup<SettingsControlKey> & {
  heading: string;
  items: BulletSettingDefinition[];
};

const KEEP_CURSOR_OPTIONS = {
  never: "Never",
  "bullet-only": "Stick cursor out of bullets",
  "bullet-and-checkbox": "Stick cursor out of bullets and checkboxes",
} satisfies Record<KeepCursorWithinContent, string>;

const SETTING_GROUPS = [
  {
    type: "group",
    heading: "Editing",
    items: [
      {
        name: "Stick the cursor to the content",
        desc: "Keep the caret in the editable text instead of the markdown prefix. Use Never to edit bullets and checkboxes directly, Bullets to stay out of `- ` or `1. `, or Bullets and checkboxes to also stay out of `[ ]` / `[x]` markup.",
        control: {
          type: "dropdown",
          key: "keepCursorWithinContent",
          options: KEEP_CURSOR_OPTIONS,
        },
      },
      {
        name: "Keep body text in bullets",
        desc: "Automatically keep directly typed body text in list items while allowing headings, quotes, horizontal rules, code fences, and frontmatter. Pasted and external changes are left unchanged.",
        control: {
          type: "toggle",
          key: "keepBodyTextInBullets",
        },
      },
      {
        name: "Enhance the Tab key",
        desc: "Make Tab and Shift-Tab behave the same as other outliners.",
        control: {
          type: "toggle",
          key: "overrideTabBehaviour",
        },
      },
      {
        name: "Enhance the Enter key",
        desc: "Make the Enter key behave the same as other outliners.",
        control: {
          type: "toggle",
          key: "overrideEnterBehaviour",
        },
      },
      {
        name: "Vim-mode o/O inserts bullets",
        desc: "Create a bullet when pressing o or O in Vim mode.",
        control: {
          type: "toggle",
          key: "overrideVimOBehaviour",
        },
      },
      {
        name: "Enhance the Ctrl+A or Cmd+A behavior",
        desc: "Press the hotkey once to select the current list item. Press the hotkey twice to select the entire list.",
        control: {
          type: "toggle",
          key: "overrideSelectAllBehaviour",
        },
      },
      {
        name: "Drag-and-Drop",
        desc: "Move list items on desktop by dragging a bullet, fold indicator, or checkbox.",
        control: {
          type: "toggle",
          key: "dragAndDrop",
        },
      },
    ],
  },
  {
    type: "group",
    heading: "Appearance",
    items: [
      {
        name: "Improve the style of your lists",
        desc: "Styles are only compatible with built-in Obsidian themes and may not be compatible with other themes.",
        control: {
          type: "toggle",
          key: "betterListsStyles",
        },
      },
      {
        name: "Enhance vertical lines",
        desc: "Strengthen indentation lines and use a continuous rounded hover.",
        control: {
          type: "toggle",
          key: "enhancedVerticalLineHover",
        },
      },
    ],
  },
  {
    type: "group",
    heading: "Folding",
    items: [
      {
        name: "Draw outer list lines",
        desc: "Show a root-level guide beside each contiguous list chunk.",
        control: {
          type: "toggle",
          key: "outerVerticalLines",
        },
      },
      {
        name: "Fold lists from vertical indentation lines",
        desc: "Click a vertical indentation line to fold or unfold that list.",
        control: {
          type: "toggle",
          key: "verticalLinesActionEnabled",
        },
      },
      {
        name: "Show fold controls on the right on mobile",
        desc: "Move fold controls to the right edge in Live Preview on mobile.",
        control: {
          type: "toggle",
          key: "mobileRightFoldControls",
        },
      },
    ],
  },
  {
    type: "group",
    heading: "Advanced",
    items: [
      {
        name: "Debug mode",
        desc: "Open DevTools (Command+Option+I or Control+Shift+I) to copy the debug logs.",
        control: {
          type: "toggle",
          key: "debug",
        },
      },
    ],
  },
] satisfies BulletSettingGroup[];

function decodeBooleanControl(key: string, value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`Expected ${key} to be a boolean`);
  }
  return value;
}

function decodeKeepCursorWithinContent(
  value: unknown,
): KeepCursorWithinContent {
  if (
    value === "never" ||
    value === "bullet-only" ||
    value === "bullet-and-checkbox"
  ) {
    return value;
  }
  throw new TypeError("Expected keepCursorWithinContent to be a known option");
}

class ObsidianBulletPluginSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private settings: Settings,
  ) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem<SettingsControlKey>[] {
    return SETTING_GROUPS;
  }

  getControlValue(key: string): unknown {
    switch (key) {
      case "keepCursorWithinContent":
        return this.settings.keepCursorWithinContent;
      case "keepBodyTextInBullets":
        return this.settings.keepBodyTextInBullets;
      case "overrideTabBehaviour":
        return this.settings.overrideTabBehaviour;
      case "overrideEnterBehaviour":
        return this.settings.overrideEnterBehaviour;
      case "overrideVimOBehaviour":
        return this.settings.overrideVimOBehaviour;
      case "overrideSelectAllBehaviour":
        return this.settings.overrideSelectAllBehaviour;
      case "betterListsStyles":
        return this.settings.betterListsStyles;
      case "enhancedVerticalLineHover":
        return this.settings.enhancedVerticalLineHover;
      case "outerVerticalLines":
        return this.settings.outerVerticalLines;
      case "verticalLinesActionEnabled":
        return this.settings.verticalLinesAction === "toggle-folding";
      case "mobileRightFoldControls":
        return this.settings.mobileRightFoldControls;
      case "dragAndDrop":
        return this.settings.dragAndDrop;
      case "debug":
        return this.settings.debug;
      default:
        throw new Error(`Unknown settings control: ${key}`);
    }
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    switch (key) {
      case "keepCursorWithinContent":
        this.settings.keepCursorWithinContent =
          decodeKeepCursorWithinContent(value);
        break;
      case "keepBodyTextInBullets":
        this.settings.keepBodyTextInBullets = decodeBooleanControl(key, value);
        break;
      case "overrideTabBehaviour":
        this.settings.overrideTabBehaviour = decodeBooleanControl(key, value);
        break;
      case "overrideEnterBehaviour":
        this.settings.overrideEnterBehaviour = decodeBooleanControl(key, value);
        break;
      case "overrideVimOBehaviour":
        this.settings.overrideVimOBehaviour = decodeBooleanControl(key, value);
        break;
      case "overrideSelectAllBehaviour":
        this.settings.overrideSelectAllBehaviour = decodeBooleanControl(
          key,
          value,
        );
        break;
      case "betterListsStyles":
        this.settings.betterListsStyles = decodeBooleanControl(key, value);
        break;
      case "enhancedVerticalLineHover":
        this.settings.enhancedVerticalLineHover = decodeBooleanControl(
          key,
          value,
        );
        break;
      case "outerVerticalLines":
        this.settings.outerVerticalLines = decodeBooleanControl(key, value);
        break;
      case "verticalLinesActionEnabled":
        this.settings.verticalLinesAction = decodeBooleanControl(key, value)
          ? "toggle-folding"
          : "none";
        break;
      case "mobileRightFoldControls":
        this.settings.mobileRightFoldControls = decodeBooleanControl(
          key,
          value,
        );
        break;
      case "dragAndDrop":
        this.settings.dragAndDrop = decodeBooleanControl(key, value);
        break;
      case "debug":
        this.settings.debug = decodeBooleanControl(key, value);
        break;
      default:
        throw new Error(`Unknown settings control: ${key}`);
    }

    await this.settings.save();
  }

  display(): void {
    this.containerEl.empty();

    for (const group of SETTING_GROUPS) {
      new Setting(this.containerEl).setName(group.heading).setHeading();
      for (const definition of group.items) {
        this.renderSetting(definition);
      }
    }
  }

  private renderSetting(definition: BulletSettingDefinition): void {
    const setting = new Setting(this.containerEl)
      .setName(definition.name)
      .setDesc(definition.desc);
    const control = definition.control;
    const currentValue = this.getControlValue(control.key);

    if (control.type === "dropdown") {
      if (typeof currentValue !== "string") {
        throw new TypeError(`Expected ${control.key} to resolve to a string`);
      }
      setting.addDropdown((dropdown) => {
        dropdown
          .addOptions(control.options)
          .setValue(currentValue)
          .onChange(async (value) => {
            await this.setControlValue(control.key, value);
          });
      });
      return;
    }

    if (typeof currentValue !== "boolean") {
      throw new TypeError(`Expected ${control.key} to resolve to a boolean`);
    }
    setting.addToggle((toggle) => {
      toggle.setValue(currentValue).onChange(async (value) => {
        await this.setControlValue(control.key, value);
      });
    });
  }
}

export class SettingsTab implements Feature {
  constructor(
    private plugin: Plugin,
    private settings: Settings,
  ) {}

  async load() {
    this.plugin.addSettingTab(
      new ObsidianBulletPluginSettingTab(
        this.plugin.app,
        this.plugin,
        this.settings,
      ),
    );
  }

  async unload() {}
}
