# README Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inherited README with an accurate, user-first guide to installing and using Bullet.

**Architecture:** Keep the user guide in the repository root `README.md` and derive every behavioral claim from the plugin source or package metadata. Reuse the two current GIFs that do not expose obsolete plugin branding; do not add generated assets or duplicate implementation documentation.

**Tech Stack:** GitHub-flavored Markdown, Obsidian plugin metadata, TypeScript source as the behavioral reference, GitButler CLI for version-control writes.

## Global Constraints

- Write the public README in English.
- Support claims must match Obsidian `1.12.7` or later and `isDesktopOnly: false` from `manifest.json`.
- Use only `demos/demo3.gif` and `demos/demo4.gif` from the existing visual assets.
- Treat only source-registered keymaps as default keyboard shortcuts.
- Match setting names and defaults in `src/features/SettingsTab.ts` and `src/services/Settings.ts`.
- Use `but` for every version-control write operation.

---

### Task 1: Replace the public README

**Files:**

- Modify: `README.md`
- Reference: `manifest.json`
- Reference: `src/features/SettingsTab.ts`
- Reference: `src/services/Settings.ts`
- Reference: `src/features/ListsMovementCommands.ts`
- Reference: `src/features/EnterBehaviourOverride.ts`
- Reference: `src/features/CtrlAAndCmdABehaviourOverride.ts`

**Interfaces:**

- Consumes: setting labels and defaults, command names, registered keymaps, existing GIF paths.
- Produces: a standalone GitHub README that directs new users from product value to installation, first use, feature details, configuration, and support.

- [x] **Step 1: Replace the inherited structure**

Write `README.md` with these top-level sections in this order:

```markdown
# Bullet

Short product description, release and issue links, and the Obsidian version requirement.

## What Bullet changes

## Install

## Start with these controls

## Features

## Commands

## Settings

## Compatibility

## Support and credits

## License
```

The feature section must cover list-owned body text, list-aware Enter and Shift-Enter, branch movement and indentation, scoped selection, cursor containment with the `Alt`/`Option` escape hatch, vertical and outer guides, guide folding, desktop drag and drop, Vim `o`/`O`, and right-side mobile fold controls.

- [x] **Step 2: Add visual evidence without obsolete branding**

Place the guide-folding demo beside its description and the drag-and-drop demo beside its description:

```markdown
![Fold nested lists from their indentation guides](demos/demo3.gif)

![Move a list branch by dragging it](demos/demo4.gif)
```

- [x] **Step 3: Separate keyboard defaults from commands**

Document the following registered keyboard behavior:

```text
Move branch up: Command+Shift+Up on macOS; Ctrl+Shift+Up on Windows/Linux
Move branch down: Command+Shift+Down on macOS; Ctrl+Shift+Down on Windows/Linux
Indent: Tab
Outdent: Shift+Tab
Insert sibling or child as appropriate: Enter
Insert a continuation line: Shift+Enter
Expand selection by list scope: Command+A on macOS; Ctrl+A on Windows/Linux
```

List `Fold the list`, `Unfold the list`, `Insert note line`, `Select list content`, and the four movement commands as Command Palette and mobile-toolbar actions without assigning undocumented default shortcuts.

- [x] **Step 4: Record settings from the source**

Use four compact tables matching the settings UI groups. Mark every toggle as enabled by default except `Debug mode`; record `Stick the cursor to the content` as `Stick cursor out of bullets and checkboxes`.

For `Keep body text in bullets`, state that direct typing and deletion are corrected while paste, drop, and external edits are left unchanged.

For `Improve the style of your lists`, state that the added styling is limited to Obsidian's default themes. Do not apply that limitation to the guide features.

### Task 2: Validate and commit the rewrite

**Files:**

- Verify: `README.md`
- Verify: `manifest.json`
- Verify: `src/features/SettingsTab.ts`
- Verify: `src/services/Settings.ts`

**Interfaces:**

- Consumes: the completed README from Task 1.
- Produces: a reviewed README commit on `codex/readme-rewrite`.

- [x] **Step 1: Check headings, assets, and stale claims**

Run:

```bash
rg -n '^#{1,6} ' README.md
rg -o 'demos/[^)]+' README.md | while read -r asset; do test -f "$asset"; done
if rg -n 'demo1|demo2|vslinko-zettelkasten|Ctrl.*ArrowUp|Command.*ArrowUp' README.md; then exit 1; fi
```

Expected: headings appear in a valid hierarchy; both referenced demo paths exist; the obsolete demo and undocumented fold-shortcut search returns no matches.

- [x] **Step 2: Check metadata and settings against the README**

Run:

```bash
rg -n 'minAppVersion|isDesktopOnly' manifest.json
rg -n 'name:|heading:' src/features/SettingsTab.ts
sed -n '/const DEFAULT_SETTINGS/,/^};/p' src/services/Settings.ts
```

Expected: `1.12.7`, mobile support, all thirteen setting names, and their defaults agree with the README.

- [x] **Step 3: Review the rendered Markdown structure**

Read the complete README and confirm that installation precedes the reference material, each table has consistent columns, the two GIF captions describe their actions, and no paragraph repeats the preceding list.

- [x] **Step 4: Commit the README and plan**

Use `but diff` to obtain the README and plan change IDs, then commit them to `codex/readme-rewrite` with this Conventional Commit subject and explicit Why/What description:

```text
docs(readme): rewrite the user guide

Why:
- The inherited README no longer reflects several current behaviors and settings.
- New users need a direct path from installation to the plugin's core list workflow.

What:
- Reorganize the README around installation, first-use controls, features, commands, and settings.
- Correct shortcut, compatibility, mobile, and theme-support claims against the current source.
```
