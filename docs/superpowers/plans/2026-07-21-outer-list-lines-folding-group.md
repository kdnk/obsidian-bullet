# Outer List Lines Folding Group Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `Draw outer list lines` from `Appearance` to the start of `Folding` without changing its value, copy, persistence, or runtime behavior.

**Architecture:** Keep `SETTING_GROUPS` as the single source for Obsidian 1.13 declarative settings and the pre-1.13 imperative fallback. Change only group membership and lock both display paths to the approved order with the existing SettingsTab unit test.

**Tech Stack:** TypeScript, Obsidian settings API, Jest, Node.js 22.23.1, GitButler

## Global Constraints

- `Folding` order is `Draw outer list lines`, `Fold lists from vertical indentation lines`, then `Show fold controls on the right on mobile`.
- `Enhance vertical line hover` remains in `Appearance`.
- Setting name, description, storage key, default value, and runtime behavior remain unchanged.
- Local verification uses `SKIP_OBSIDIAN=1 n exec 22.23.1`.
- Version-control writes use `but`; `git` remains read-only.

---

### Task 1: Move the outer-lines control

**Files:**
- Modify: `src/features/__tests__/SettingsTab.test.ts:190-308`
- Modify: `src/features/SettingsTab.ts:109-160`

**Interfaces:**
- Consumes: `ObsidianBulletPluginSettingTab.getSettingDefinitions(): SettingDefinitionItem<SettingsControlKey>[]` and `display(): void`.
- Produces: the unchanged `outerVerticalLines` toggle under the first position in the `Folding` group for declarative and fallback rendering.

- [ ] **Step 1: Write the failing group-order assertions**

Change the declarative group expectation to:

```ts
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
```

Update the folding control assertions so the first item is the outer-lines toggle and the second is the folding-action toggle:

```ts
expect(groups[2]?.items[0]?.control).toEqual({
  type: "toggle",
  key: "outerVerticalLines",
});
expect(groups[2]?.items[1]?.control).toEqual({
  type: "toggle",
  key: "verticalLinesActionEnabled",
});
```

Change the fallback display expectation around the group boundary to:

```ts
"heading:Appearance",
"setting:Improve the style of your lists",
"setting:Enhance vertical line hover",
"heading:Folding",
"setting:Draw outer list lines",
"setting:Fold lists from vertical indentation lines",
"setting:Show fold controls on the right on mobile",
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/SettingsTab.test.ts --runInBand
```

Expected: FAIL because `Draw outer list lines` is still returned under `Appearance` and is rendered before the `Folding` heading.

- [ ] **Step 3: Move the shared setting definition**

Remove this object from `Appearance`:

```ts
{
  name: "Draw outer list lines",
  desc: "Show a root-level guide beside each contiguous list chunk.",
  control: {
    type: "toggle",
    key: "outerVerticalLines",
  },
},
```

Insert the same object as the first item in `Folding`, before `Fold lists from vertical indentation lines`.
Do not change the object contents or any getter, setter, storage, or feature code.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/SettingsTab.test.ts --runInBand
```

Expected: PASS with all four SettingsTab tests passing.

- [ ] **Step 5: Run the settings regression suite**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/SettingsTab.test.ts src/services/__tests__/Settings.test.ts --runInBand
```

Expected: PASS with no failures, warnings, or setting persistence changes.

- [ ] **Step 6: Commit the implementation**

Inspect only uncommitted changes with `but diff`, then commit the two source files and this completed plan to `codex/move-outer-lines-setting` with:

```text
refactor(settings): group outer lines with folding

Why:
- Outer list guides participate in the vertical-line folding interaction.
- Their control was separated from the related folding settings.

What:
- Move the outer-list-lines toggle to the start of the Folding group.
- Lock the declarative and fallback setting order with regression tests.
```
