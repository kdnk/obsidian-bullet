# Settings Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the twelve plugin settings under Editing, Appearance, Folding, and Advanced headings in both modern and legacy Obsidian settings UIs.

**Architecture:** Replace the flat settings definition array with a typed array of shared group definitions. The declarative Obsidian 1.13 API returns those groups directly, while the legacy renderer walks the same groups, renders a native heading, and delegates each item to one setting-row helper.

**Tech Stack:** TypeScript 5.9, Obsidian 1.13 settings definitions, Jest 30, GitButler CLI.

## Global Constraints

- Keep all four groups on the same settings page in this order: Editing, Appearance, Folding, Advanced.
- Preserve every setting name, description, control type, saved key, default value, validation path, and persistence callback.
- Do not add custom CSS, collapsible sections, sub-pages, or saved-data migration.
- Use the same group definitions for the declarative and legacy renderers.
- Run local verification with Node.js 22.23.1 or newer in the Node.js 22 series.
- Run direct `src` unit tests with `SKIP_OBSIDIAN=1`.
- Use `but` for branch and commit writes; use `git` only for read-only inspection.

---

## File Structure

- Modify `src/features/SettingsTab.ts` to own the shared group definitions and render both settings APIs from them.
- Modify `src/features/__tests__/SettingsTab.test.ts` to describe group membership, heading order, legacy rendering, and unchanged control persistence.

No new runtime module is needed because the group model belongs to the existing settings-tab feature and has no consumer outside it.

### Task 1: Shared grouped settings definitions

**Files:**

- Modify: `src/features/__tests__/SettingsTab.test.ts`
- Modify: `src/features/SettingsTab.ts`

**Interfaces:**

- Consumes: `SettingDefinitionControl<SettingsControlKey>`, `SettingDefinitionGroup<SettingsControlKey>`, `SettingDefinitionItem<SettingsControlKey>`, `Setting`, and the existing `Settings` getters and setters.
- Produces: `BulletSettingGroup`, `SETTING_GROUPS`, and `ObsidianBulletPluginSettingTab.renderSetting(definition: BulletSettingDefinition): void`.
- Preserves: `getSettingDefinitions()`, `getControlValue(key)`, and `setControlValue(key, value)` behavior.

- [ ] **Step 1: Extend the test mock and declare the expected group shape**

Add heading state to the mocked `Setting` and expose `setHeading()`:

```ts
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
```

Extend the fake interfaces so the test can distinguish groups from controls:

```ts
interface FakeSetting {
  name: string;
  desc: string;
  heading: boolean;
  dropdown?: FakeDropdownRecord;
  toggle?: FakeToggleRecord;
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
```

- [ ] **Step 2: Replace the flat declarative-order assertion with a failing group-membership assertion**

Replace the first test with the exact approved structure:

```ts
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
    groups.map((group) =>
      group.items.map((definition) => definition.name),
    ),
  ).toEqual([
    [
      "Stick the cursor to the content",
      "Enhance the Tab key",
      "Enhance the Enter key",
      "Vim-mode o/O inserts bullets",
      "Enhance the Ctrl+A or Cmd+A behavior",
      "Drag-and-Drop",
    ],
    [
      "Improve the style of your lists",
      "Draw vertical indentation lines",
      "Draw outer list lines",
    ],
    [
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
  expect(groups[2]?.items[0]?.control).toEqual({
    type: "toggle",
    key: "verticalLinesActionEnabled",
  });
});
```

- [ ] **Step 3: Make the legacy-renderer test fail on missing headings and old item order**

After `tab.display()`, assert the full sequence so group boundaries cannot drift:

```ts
expect(
  mockSettingsRecords.map(
    (setting) =>
      `${setting.heading ? "heading" : "setting"}:${setting.name}`,
  ),
).toEqual([
  "heading:Editing",
  "setting:Stick the cursor to the content",
  "setting:Enhance the Tab key",
  "setting:Enhance the Enter key",
  "setting:Vim-mode o/O inserts bullets",
  "setting:Enhance the Ctrl+A or Cmd+A behavior",
  "setting:Drag-and-Drop",
  "heading:Appearance",
  "setting:Improve the style of your lists",
  "setting:Draw vertical indentation lines",
  "setting:Draw outer list lines",
  "heading:Folding",
  "setting:Fold lists from vertical indentation lines",
  "setting:Show fold controls on the right on mobile",
  "heading:Advanced",
  "setting:Debug mode",
]);

const settingRecords = mockSettingsRecords.filter(
  (setting) => !setting.heading,
);
const cursorSetting = settingRecords[0];
const outerSetting = settingRecords[8];
const actionSetting = settingRecords[9];
const mobileSetting = settingRecords[10];

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
```

- [ ] **Step 4: Run the focused test and confirm RED**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest src/features/__tests__/SettingsTab.test.ts --runInBand
```

Expected: FAIL because `getSettingDefinitions()` still returns flat controls and the legacy mock records no headings.

- [ ] **Step 5: Introduce a typed shared group model**

Import `SettingDefinitionGroup` and define a non-optional heading and item list:

```ts
import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  SettingDefinitionControl,
  SettingDefinitionGroup,
  SettingDefinitionItem,
} from "obsidian";

type BulletSettingDefinition = SettingDefinitionControl<SettingsControlKey> & {
  desc: string;
};

type BulletSettingGroup = SettingDefinitionGroup<SettingsControlKey> & {
  heading: string;
  items: BulletSettingDefinition[];
};
```

Replace `SETTING_DEFINITIONS` with `SETTING_GROUPS` and move each unchanged item object into its approved group:

```ts
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
        name: "Draw vertical indentation lines",
        desc: "Show guide lines that connect nested list items by indentation level.",
        control: {
          type: "toggle",
          key: "verticalLines",
        },
      },
      {
        name: "Draw outer list lines",
        desc: "Show a root-level guide beside each contiguous list chunk.",
        control: {
          type: "toggle",
          key: "outerVerticalLines",
        },
      },
    ],
  },
  {
    type: "group",
    heading: "Folding",
    items: [
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
```

- [ ] **Step 6: Return groups to modern Obsidian and render the same groups for legacy Obsidian**

Return the shared definitions:

```ts
getSettingDefinitions(): SettingDefinitionItem<SettingsControlKey>[] {
  return SETTING_GROUPS;
}
```

Replace the flat `display()` loop and move its existing row body into a helper:

```ts
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
```

- [ ] **Step 7: Run the focused test and confirm GREEN**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest src/features/__tests__/SettingsTab.test.ts --runInBand
```

Expected: PASS with four tests passing.

- [ ] **Step 8: Run static and build verification**

Run:

```bash
node --version
npx tsc --noEmit
npm run lint
npm run build
```

Expected: Node reports `v22.23.1` or a newer Node.js 22 release, and all three verification commands exit with status 0.

- [ ] **Step 9: Commit the tested implementation**

Inspect the exact dirty files, then commit them to the existing GitButler branch:

```bash
but diff
but commit codex/settings-grouping -m 'feat(settings): group related controls

Why:
- Twelve flat controls make related settings harder to scan.
- Modern and legacy settings views need the same information hierarchy.

What:
- Group settings under Editing, Appearance, Folding, and Advanced headings.
- Render both Obsidian settings APIs from one shared group definition.
- Cover group membership, heading order, and unchanged persistence behavior.'
```

Expected: GitButler creates one implementation commit on `codex/settings-grouping` and reports no remaining task changes.
