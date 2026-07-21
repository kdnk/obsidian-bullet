# Theme and Settings Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. This repository executes approved plans inline unless the user explicitly requests subagents.

**Goal:** Apply Bullet's list styling with every Obsidian theme and make the typed-text and caret settings visibly distinct without changing their saved values or runtime responsibilities.

**Architecture:** Let `BetterListsStyles` depend only on Bullet's `styleLists` setting and use the existing document-aware body-class adapter for every editor window. Keep the two editing features independent, but rename, reorder, and describe their controls according to the state each one changes. Update current user documentation while preserving historical changelog and design records.

**Tech Stack:** TypeScript, Obsidian plugin API, Jest 30, Node.js 22.23.1, Markdown, GitButler CLI.

## Global Constraints

- Use `but` for version-control writes and create commits only on `codex/theme-and-settings-clarity`.
- Run Node commands through `n exec 22.23.1`.
- Prefix direct `src` Jest runs with `SKIP_OBSIDIAN=1`.
- Do not rename saved settings keys or change their defaults.
- Do not rewrite historical statements in `CHANGELOG.md` or existing design documents.
- Do not claim completion or commit implementation changes before fresh verification.

---

### Task 1: Remove the custom-theme gate from list styling

**Files:**

- Modify: `src/features/__tests__/BetterListsStyles.test.ts`
- Modify: `src/features/BetterListsStyles.ts`
- Modify: `src/ObsidianBulletPlugin.ts`
- Modify: `src/services/ObsidianSettings.ts`

**Interfaces:**

- Consumes: `Settings.betterListsStyles: boolean` and `DocumentBodyClass`.
- Produces: `new BetterListsStyles(plugin: Plugin, settings: Settings)` with theme-independent body-class management.

- [ ] **Step 1: Write the failing custom-theme test**

In `BetterListsStyles.test.ts`, construct the feature with an Obsidian settings double that reports a custom theme and assert that an enabled setting still adds `bullet-plugin-better-lists`:

```ts
test("applies list styling with a custom theme", async () => {
  const mainDocument = makeDocument();
  Object.defineProperty(global, "activeDocument", {
    configurable: true,
    value: mainDocument,
  });
  const { plugin } = makePlugin();
  const settings = {
    betterListsStyles: true,
    onChange: jest.fn(),
    removeCallback: jest.fn(),
  };
  const obsidianSettings = {
    isDefaultThemeEnabled: jest.fn().mockReturnValue(false),
  };

  const feature = new BetterListsStyles(
    plugin as never,
    settings as never,
    obsidianSettings as never,
  );
  await feature.load();

  expect(
    mainDocument.body.classList.contains("bullet-plugin-better-lists"),
  ).toBe(true);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/BetterListsStyles.test.ts --runInBand
```

Expected: FAIL because the current `isDefaultThemeEnabled()` condition leaves the body class absent.

- [ ] **Step 3: Make styling depend only on Bullet's setting**

Change the feature constructor and predicate to:

```ts
constructor(
  private plugin: Plugin,
  private settings: Settings,
) {
  this.bodyClass = new DocumentBodyClass(
    this.plugin,
    BETTER_LISTS_BODY_CLASS,
    () => this.settings.betterListsStyles,
  );
}
```

Remove the `ObsidianSettings` import, `css-change` registration, `shouldApplyBodyClass`, and its now-redundant update before `bodyClass.load()`.

Change plugin wiring to:

```ts
new BetterListsStyles(this, this.settings),
```

Remove `ObsidianSettings.isDefaultThemeEnabled()` because no remaining feature consumes it.

Update both tests to use the two-argument constructor, rename the CSS contract test from `default-theme` to `theme-aware`, and assert that `workspace.on` never receives `css-change`.

- [ ] **Step 4: Run focused tests and type-check**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/BetterListsStyles.test.ts src/__tests__/ObsidianBulletPlugin.test.ts --runInBand
n exec 22.23.1 npx tsc --noEmit
```

Expected: both Jest suites PASS and TypeScript exits 0.

---

### Task 2: Separate the editing settings in user-facing copy

**Files:**

- Modify: `src/features/__tests__/SettingsTab.test.ts`
- Modify: `src/features/SettingsTab.ts`

**Interfaces:**

- Consumes: unchanged `keepBodyTextInBullets` toggle and `keepCursorWithinContent` dropdown keys.
- Produces: reordered declarative and legacy settings rows with explicit document-versus-caret copy.

- [ ] **Step 1: Write failing settings-definition expectations**

Change the first two Editing names to this order:

```ts
[
  "Keep typed text in lists",
  "Keep cursor out of list markers",
]
```

Expect the first definition to be the `keepBodyTextInBullets` toggle with this description:

```ts
"Add a list marker when directly typed body text would otherwise sit outside a list. Markdown structures stay available; pasted and external changes are unchanged."
```

Expect the second definition to be the `keepCursorWithinContent` dropdown with this description:

```ts
"Move the caret out of bullet, number, and checkbox prefixes after navigation or a click. Hold Alt or Option to place it inside temporarily. This changes only the caret position."
```

Expect these option labels:

```ts
{
  never: "Allow cursor in markers",
  "bullet-only": "Keep out of bullets",
  "bullet-and-checkbox": "Keep out of bullets and checkboxes",
}
```

Update the legacy fallback order expectation and derive the cursor record from index 1.

- [ ] **Step 2: Run the settings test and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/SettingsTab.test.ts --runInBand
```

Expected: FAIL because the old names, order, descriptions, and dropdown labels remain.

- [ ] **Step 3: Reorder and rewrite the Editing definitions**

Set `KEEP_CURSOR_OPTIONS` to the labels from Step 1.

Put the `keepBodyTextInBullets` definition before `keepCursorWithinContent`, and use the exact tested names and descriptions.

Do not change `getControlValue()`, `setControlValue()`, saved keys, or defaults.

- [ ] **Step 4: Rewrite the Appearance definition under test**

In the same settings-definition test, expect:

```ts
{
  name: "Style list bullets",
  desc: "Use Bullet's list-marker spacing, larger dots, and parent-item hover feedback. Colors follow the active Obsidian theme.",
  control: { type: "toggle", key: "betterListsStyles" },
}
```

Run the settings test once to observe the expected failure, then update `SettingsTab.ts` with the exact copy.

- [ ] **Step 5: Run the focused editing and settings tests**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/SettingsTab.test.ts src/features/__tests__/BulletTypingGuard.test.ts src/operations/__tests__/KeepCursorWithinListContent.test.ts --runInBand
```

Expected: all three suites PASS, including the existing test that document correction is independent of cursor settings.

---

### Task 3: Align the README and verify the complete change

**Files:**

- Modify: `README.md`

**Interfaces:**

- Consumes: the setting names and behavior fixed by Tasks 1 and 2.
- Produces: current installation and settings documentation without a default-theme restriction.

- [ ] **Step 1: Update current user documentation**

Rename references as follows:

```text
Keep body text in bullets -> Keep typed text in lists
Stick the cursor to the content -> Keep cursor out of list markers
Improve the style of your lists -> Style list bullets
```

Use the new dropdown option labels from Task 2 in the caret feature section.

Describe `Style list bullets` as applying Bullet's marker spacing, larger dots, and parent hover feedback while following the active theme's colors.

Delete the Compatibility bullet that says list styling applies only with default themes.

- [ ] **Step 2: Check current copy and formatting**

Run:

```bash
rg -n -i "default theme|built-in Obsidian themes|Stick the cursor|Keep body text in bullets|Improve the style of your lists" README.md src/features/SettingsTab.ts
git diff --check
```

Expected: `rg` returns no matches and `git diff --check` exits 0.

- [ ] **Step 3: Run full local verification**

Confirm no process owns the Obsidian LevelDB lock unexpectedly, preserve `vault/test.md` outside the vault if needed, and run:

```bash
n exec 22.23.1 npx tsc --noEmit
n exec 22.23.1 npm run lint
n exec 22.23.1 npm run build-with-tests
n exec 22.23.1 npm test -- --runInBand
```

Expected: type-check, lint, build, and the full Jest suite all exit 0.

After the full test, wait for the `vault=vault` renderer to exit before restoring and hash-checking any preserved fixture.

- [ ] **Step 4: Review requirements and commit implementation**

Inspect `but diff` and confirm that current user-facing copy, theme-independent body-class behavior, setting order, saved keys, and defaults match the design.

Commit the implementation, tests, plan, and README to the existing branch after `but diff` confirms that no unrelated changes are present:

```bash
but commit codex/theme-and-settings-clarity -m $'refactor(settings): clarify theme and editing controls\n\nWhy:\n- List styling was unnecessarily disabled for custom themes despite using theme variables.\n- Typed-text ownership and caret placement appeared redundant because their labels did not expose their separate responsibilities.\n\nWhat:\n- Apply list styling in every theme and remove the obsolete theme dependency.\n- Rename and reorder the editing and appearance controls without changing persisted values.\n- Align current README guidance and cover both declarative and legacy settings UI.'
```

Expected: GitButler creates the implementation commit on `codex/theme-and-settings-clarity` and reports no task changes left uncommitted.
