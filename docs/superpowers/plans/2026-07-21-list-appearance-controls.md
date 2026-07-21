# List Appearance Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independent default-on vertical-line hover appearance option and replace the built-in-theme bullet treatment with a centered Workflowy-style 7px dot and 18px actionable hover halo.

**Architecture:** Extend the existing `Settings` and declarative settings-tab contracts with one boolean, then let `VerticalLines` manage a second body class whose CSS is conjunctive with the existing folding-action class. Keep bullet behavior inside the existing `BetterListsStyles` body-class boundary and implement every visual change with native `.list-bullet` and guide pseudo-elements rather than new DOM or editor decorations.

**Tech Stack:** TypeScript, Obsidian plugin API, CodeMirror 6, CSS logical properties, Jest, GitButler CLI, Node.js 22.23.1.

## Global Constraints

- `styleLists` and `enhanceVerticalLineHover` default to `true`.
- Disabling enhanced guide hover must not disable guide folding, marker grouping, or scroll preservation.
- The 3px guide stays centered on the native guide, uses `border-radius: 2px`, the native active color, and no custom opacity or transition.
- The default guide fallback uses Obsidian's active width and active color without enhanced offsets or rounding.
- The bullet dot is 7px in every supported view; only foldable desktop Live Preview bullets receive an 18px hover halo.
- Bullet colors follow Obsidian theme variables, and custom themes remain untouched.
- Task checkboxes, leaf hover, Reading-view hover, and mobile hover remain native.
- Do not add overlays, screen-coordinate caches, independent guide paint layers, or new editor decorations.
- Run local tests with Node.js 22.23.1 or newer in the Node.js 22 line.
- Prefix direct Jest source tests with `SKIP_OBSIDIAN=1`.
- Use `but` for every version-control write; raw `git` is read-only.

---

### Task 1: Persist and expose the guide-hover appearance setting

**Files:**
- Modify: `src/services/Settings.ts`
- Modify: `src/services/__tests__/Settings.test.ts`
- Modify: `src/features/SettingsTab.ts`
- Modify: `src/features/__tests__/SettingsTab.test.ts`

**Interfaces:**
- Produces: `SettingsObject.enhanceVerticalLineHover: boolean`
- Produces: `Settings.enhancedVerticalLineHover: boolean` getter and setter
- Produces: settings control key `enhancedVerticalLineHover`

- [ ] **Step 1: Write failing Settings tests for defaulting, notification, and reset**

Add a migration test beside the existing vertical-line default tests:

```ts
test("enables enhanced vertical-line hover when saved data predates the setting", async () => {
  const settings = new Settings({
    loadData: jest.fn(async () => ({}) as SettingsObject),
    saveData: jest.fn(async () => undefined),
  });

  await settings.load();

  expect(settings.enhancedVerticalLineHover).toBe(true);
});
```

Add this notification test inside `describe("change notifications")`:

```ts
test("notifies subscribers when enhanced vertical-line hover changes", () => {
  const settings = createSettings();
  const callback = jest.fn<void, [SettingsChange]>();
  settings.onChange(["enhanceVerticalLineHover"], callback);

  settings.enhancedVerticalLineHover = false;

  expect(callback).toHaveBeenCalledTimes(1);
  expect(callback.mock.calls[0]?.[0].keys).toEqual(
    new Set(["enhanceVerticalLineHover"]),
  );
});
```

Extend the reset test's subscription, pre-reset mutation, and expected key set with `enhanceVerticalLineHover`.

- [ ] **Step 2: Run the Settings tests and verify the new contract fails**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/services/__tests__/Settings.test.ts --runInBand
```

Expected: FAIL because `enhancedVerticalLineHover` and `enhanceVerticalLineHover` do not exist.

- [ ] **Step 3: Implement the persisted setting**

Insert the new field immediately after `styleLists` in `SettingsObject`:

```ts
export interface SettingsObject {
  styleLists: boolean;
  enhanceVerticalLineHover: boolean;
  debug: boolean;
}
```

Insert the matching default immediately after `styleLists` in `DEFAULT_SETTINGS`:

```ts
const DEFAULT_SETTINGS: SettingsObject = {
  styleLists: true,
  enhanceVerticalLineHover: true,
  debug: false,
};
```

Add the public adapter beside the other appearance settings:

```ts
get enhancedVerticalLineHover() {
  return this.values.enhanceVerticalLineHover;
}

set enhancedVerticalLineHover(value: boolean) {
  this.update({ enhanceVerticalLineHover: value });
}
```

- [ ] **Step 4: Run the Settings tests and verify they pass**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Write failing Settings-tab tests for placement and persistence**

Add `enhancedVerticalLineHover: true` to `makeSettings()`.
Change the expected Appearance names to:

```ts
[
  "Improve the style of your lists",
  "Enhance vertical line hover",
  "Draw outer list lines",
]
```

Assert the new control definition:

```ts
expect(groups[1]?.items[1]?.control).toEqual({
  type: "toggle",
  key: "enhancedVerticalLineHover",
});
```

Extend the read-and-persist test:

```ts
expect(tab.getControlValue("enhancedVerticalLineHover")).toBe(true);
await tab.setControlValue("enhancedVerticalLineHover", false);
expect(settings.enhancedVerticalLineHover).toBe(false);
```

Update the expected save count to include this fourth setting change, and update the imperative fallback's order and indices to include the new Appearance toggle.

- [ ] **Step 6: Run the Settings-tab tests and verify they fail**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/SettingsTab.test.ts --runInBand
```

Expected: FAIL because the new declarative control is missing.

- [ ] **Step 7: Add the Appearance toggle and its adapter cases**

Add `"enhancedVerticalLineHover"` to `SettingsControlKey`.
Insert this definition after the list-style setting:

```ts
{
  name: "Enhance vertical line hover",
  desc: "Make foldable vertical indentation lines thicker and rounded on hover.",
  control: {
    type: "toggle",
    key: "enhancedVerticalLineHover",
  },
},
```

Add these cases:

```ts
case "enhancedVerticalLineHover":
  return this.settings.enhancedVerticalLineHover;
```

```ts
case "enhancedVerticalLineHover":
  this.settings.enhancedVerticalLineHover = decodeBooleanControl(key, value);
  break;
```

- [ ] **Step 8: Run focused tests and type-check**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/services/__tests__/Settings.test.ts src/features/__tests__/SettingsTab.test.ts --runInBand
n exec 22.23.1 npx tsc --noEmit
```

Expected: both Jest suites PASS and TypeScript exits 0.

- [ ] **Step 9: Commit the settings contract**

Run:

```bash
but commit codex/centered-guide-hover -m $'feat(settings): add guide hover appearance option\n\nWhy:\n- Guide folding and its enhanced feedback need independent user controls.\n- Existing installations need the approved appearance enabled without migration work.\n\nWhat:\n- Add a default-on persisted hover appearance setting.\n- Expose it in the Appearance group and preserve declarative and fallback settings rendering.\n- Cover migration, reset, notifications, validation, and persistence.'
```

Expected: GitButler creates one commit on `codex/centered-guide-hover` and reports no uncommitted changes.

---

### Task 2: Separate native and enhanced guide feedback

**Files:**
- Modify: `src/features/VerticalLines.ts`
- Modify: `src/features/__tests__/VerticalLines.test.ts`
- Modify: `styles.css`
- Modify: `src/features/__tests__/GuideFolding.test.ts`

**Interfaces:**
- Consumes: `Settings.enhancedVerticalLineHover`
- Produces: body class `bullet-plugin-enhanced-vertical-line-hover`
- Preserves: body class `bullet-plugin-vertical-lines-action-toggle-folding`

- [ ] **Step 1: Write a failing body-class independence test**

Extend the first `VerticalLines` test settings with `enhancedVerticalLineHover: true`.
Assert that load adds both classes, then invoke the callback registered for `enhanceVerticalLineHover` after changing the value to `false`.
Use these exact assertions:

```ts
expect(settings.onChange).toHaveBeenCalledWith(
  ["enhanceVerticalLineHover"],
  expect.any(Function),
);
expect(
  mainDocument.body.classList.contains(
    "bullet-plugin-enhanced-vertical-line-hover",
  ),
).toBe(true);

settings.enhancedVerticalLineHover = false;
hoverSettingsCallback();

expect(
  mainDocument.body.classList.contains(
    "bullet-plugin-enhanced-vertical-line-hover",
  ),
).toBe(false);
expect(
  mainDocument.body.classList.contains(
    "bullet-plugin-vertical-lines-action-toggle-folding",
  ),
).toBe(true);
```

Verify unload removes both classes from the main and pop-out documents.

- [ ] **Step 2: Run the VerticalLines test and verify it fails**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/VerticalLines.test.ts --runInBand
```

Expected: FAIL because the enhanced appearance body class is not managed.

- [ ] **Step 3: Manage the appearance class independently**

Add the constant and member:

```ts
const ENHANCED_VERTICAL_LINE_HOVER_BODY_CLASS =
  "bullet-plugin-enhanced-vertical-line-hover";

private hoverBodyClass: DocumentBodyClass;
```

Construct it with a setting-only predicate:

```ts
this.hoverBodyClass = new DocumentBodyClass(
  this.plugin,
  ENHANCED_VERTICAL_LINE_HOVER_BODY_CLASS,
  this.shouldApplyHoverBodyClass,
);
```

Register, load, update, and unload it independently:

```ts
this.settings.onChange(
  ["enhanceVerticalLineHover"],
  this.updateHoverBodyClass,
);
this.actionBodyClass.load();
this.hoverBodyClass.load();
```

```ts
private updateHoverBodyClass = () => {
  this.hoverBodyClass.update();
};

private shouldApplyHoverBodyClass = () => {
  return this.settings.enhancedVerticalLineHover;
};
```

During unload, remove the new callback and unload the new body class before returning.

- [ ] **Step 4: Run the VerticalLines test and verify it passes**

Run the command from Step 2.

Expected: PASS, including the existing scroll-past-end assertions.

- [ ] **Step 5: Replace the current CSS-contract tests with fallback and enhanced assertions**

For native indent guides, require the action-only marker rule to normalize to:

```css
border-inline-end: var(--indentation-guide-width-active) solid
  var(--indentation-guide-color-active);
```

Require a second selector containing both body classes to normalize to:

```css
border-inline-end: 3px solid var(--indentation-guide-color-active);
border-radius: 2px;
```

Keep the Live Preview and Source mode `calc(... - 1px)` expectations, but require both body classes on those selectors.
For outer guides, require the action-only hover rule to contain the native active width and color without an inset, radius, or 3px literal.
Require the two-class enhanced outer rule to contain the existing `inset-inline-end: -1px`, 3px border, and 2px radius, and keep the desktop two-class `inset-inline-start: -1px` assertion.

- [ ] **Step 6: Run the CSS-contract tests and verify they fail**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand
```

Expected: FAIL because the existing action-only selectors still contain enhanced geometry.

- [ ] **Step 7: Split fallback and enhanced guide CSS**

Keep the existing action-only interaction rules.
Change the native marker paint to:

```css
.bullet-plugin-vertical-lines-action-toggle-folding
  .markdown-source-view.mod-cm6
  .cm-hmd-list-indent
  .cm-indent.bullet-plugin-hovered-indent-guide::before {
  border-inline-end: var(--indentation-guide-width-active) solid
    var(--indentation-guide-color-active);
}
```

Add the enhanced override:

```css
.bullet-plugin-vertical-lines-action-toggle-folding.bullet-plugin-enhanced-vertical-line-hover
  .markdown-source-view.mod-cm6
  .cm-hmd-list-indent
  .cm-indent.bullet-plugin-hovered-indent-guide::before {
  border-inline-end: 3px solid var(--indentation-guide-color-active);
  border-radius: 2px;
}
```

Add both body classes to the existing Live Preview and Source mode center-offset selectors.
For outer guides, make the action-only hover rule use the native active width and color, then move the negative logical inset, 3px border, radius, and desktop offset into selectors requiring both body classes.

- [ ] **Step 8: Run focused guide tests and type-check**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/VerticalLines.test.ts src/features/__tests__/GuideFolding.test.ts --runInBand
n exec 22.23.1 npx tsc --noEmit
```

Expected: both Jest suites PASS and TypeScript exits 0.

- [ ] **Step 9: Commit the separated guide feedback**

Run:

```bash
but commit codex/centered-guide-hover -m $'feat(editor): separate guide feedback from folding\n\nWhy:\n- Users should be able to keep guide folding while returning to Obsidian native-width feedback.\n- Enhanced geometry must never advertise an interaction that is disabled.\n\nWhat:\n- Manage a dedicated hover appearance body class.\n- Split native active paint from the centered three-pixel rounded override.\n- Preserve marker grouping, pointer behavior, fold transactions, and scroll extensions.'
```

Expected: GitButler creates one commit on the active branch and reports no uncommitted changes.

---

### Task 3: Add the Workflowy-style bullet treatment

**Files:**
- Modify: `styles.css`
- Modify: `src/features/__tests__/BetterListsStyles.test.ts`

**Interfaces:**
- Consumes: existing body class `bullet-plugin-better-lists`
- Produces: 7px `.list-bullet::after` dot
- Produces: 18px foldable desktop Live Preview `.list-bullet:hover::before` halo

- [ ] **Step 1: Write a failing stylesheet contract test**

Import `readFileSync` and `join`, then add:

```ts
test("uses a centered Workflowy-style halo only for actionable desktop bullets", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
  const dot = styles.match(
    /\.bullet-plugin-better-lists\s+\.list-bullet::after\s*\{([^}]*)\}/,
  )?.[1];
  const halo = styles.match(
    /body:not\(\.is-mobile\)\.bullet-plugin-better-lists[^{]*\.markdown-source-view\.mod-cm6\.is-live-preview[^{]*\.cm-line\.HyperMD-list-line:has\(\.cm-fold-indicator\)[^{]*\.list-bullet:hover::before\s*\{([^}]*)\}/,
  )?.[1];
  const normalizedDot = dot?.replace(/\s+/g, " ").trim();
  const normalizedHalo = halo?.replace(/\s+/g, " ").trim();

  expect(normalizedDot).toContain("width: 7px;");
  expect(normalizedDot).toContain("height: 7px;");
  expect(normalizedDot).toContain("background-color: var(--text-muted);");
  expect(normalizedHalo).toContain("width: 18px;");
  expect(normalizedHalo).toContain("height: 18px;");
  expect(normalizedHalo).toContain("border-radius: 50%;");
  expect(normalizedHalo).toContain(
    "background-color: color-mix(in srgb, var(--text-muted) 38%, transparent);",
  );
  expect(normalizedHalo).toContain("inset-block-start: 50%;");
  expect(normalizedHalo).toContain("inset-inline-start: 50%;");
  expect(normalizedHalo).toContain("transform: translate(-50%, -50%);");
  expect(normalizedHalo).not.toMatch(/\b(?:transition|animation)\s*:/);
  expect(styles).not.toMatch(
    /\.bullet-plugin-better-lists\s+\.list-bullet:hover::before/,
  );
});
```

Add a second assertion that the halo selector contains `.cm-fold-indicator` and therefore excludes leaf lines, Reading view, and task checkboxes by construction.

- [ ] **Step 2: Run the BetterListsStyles test and verify it fails**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/BetterListsStyles.test.ts --runInBand
```

Expected: FAIL because the dot is still `0.4em` and the halo rule is absent.

- [ ] **Step 3: Implement the 7px dot and centered 18px halo**

Replace the existing dot dimensions with 7px and add stacking support:

```css
.bullet-plugin-better-lists .list-bullet {
  position: relative;
}

.bullet-plugin-better-lists .list-bullet::after {
  position: absolute;
  z-index: 1;
  width: 7px;
  height: 7px;
  background-color: var(--text-muted);
  transition: none;
}

body.bullet-plugin-better-lists
  .markdown-source-view.mod-cm6.is-live-preview
  .cm-line.HyperMD-list-line
  .is-collapsed
  ~ .cm-formatting-list
  .list-bullet::after {
  background-color: var(--text-muted);
  box-shadow: none;
  transition: none;
}
```

Keep the native absolute positioning explicit here. Overriding it with
`position: relative` adds the 7px dot to the inline-flex marker width in
Obsidian 1.13 and shifts the text spacing, violating the stable-layout
requirement.

Add the desktop actionable halo:

```css
body:not(.is-mobile).bullet-plugin-better-lists
  .markdown-source-view.mod-cm6.is-live-preview
  .cm-line.HyperMD-list-line:has(.cm-fold-indicator)
  .list-bullet:hover::before {
  content: "";
  position: absolute;
  inset-block-start: calc(50% - 9px);
  inset-inline-start: calc(50% - 9px);
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background-color: color-mix(
    in srgb,
    var(--text-muted) 38%,
    transparent
  );
  pointer-events: none;
}
```

Use logical inset calculations without a physical X translation so the halo
keeps the same center in both LTR and RTL layouts. The collapsed-marker rule
must outrank Obsidian 1.13's native collapsed ring and transition.

Do not add a global hover rule, a mobile rule, a Reading-view rule, a transition, or new DOM.

- [ ] **Step 4: Run the bullet test and type-check**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/BetterListsStyles.test.ts --runInBand
n exec 22.23.1 npx tsc --noEmit
```

Expected: the suite PASSes and TypeScript exits 0.

- [ ] **Step 5: Commit the bullet treatment**

Run:

```bash
but commit codex/centered-guide-hover -m $'feat(styles): add Workflowy-style bullet feedback\n\nWhy:\n- The existing fixed bullet has weak interaction feedback and does not match the approved outliner treatment.\n- Only genuinely actionable bullets should advertise an interaction.\n\nWhat:\n- Render a theme-aware seven-pixel dot for built-in themes.\n- Add a centered eighteen-pixel halo to foldable desktop Live Preview bullets.\n- Keep leaf, Reading-view, mobile, task, and custom-theme behavior native.'
```

Expected: GitButler creates one commit on the active branch and reports no uncommitted changes.

---

### Task 4: Verify settings, styling, and live interaction together

**Files:**
- Modify only if verification exposes a defect: files owned by Tasks 1 through 3

**Interfaces:**
- Consumes: all settings and CSS contracts from Tasks 1 through 3
- Produces: verified production bundle in `vault/.obsidian/plugins/bullet/`

- [ ] **Step 1: Run lint, type-check, build, and all unit tests**

Run:

```bash
n exec 22.23.1 npm run lint
n exec 22.23.1 npx tsc --noEmit
n exec 22.23.1 npm run build-with-tests
SKIP_OBSIDIAN=1 n exec 22.23.1 npm run test:unit -- --runInBand
```

Expected: every command exits 0.

- [ ] **Step 2: Install the production bundle into the repository test vault**

Run:

```bash
n exec 22.23.1 npm run build
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
```

Do not create another plugin directory and do not write to `/Users/kodai/base`.

Expected: `manifest.json`, `main.js`, and `styles.css` in the `bullet` plugin directory reflect the current source.

- [ ] **Step 3: Verify the Appearance settings in real Obsidian**

Open `vault` explicitly and reload plugin id `bullet`.
Confirm the Appearance group contains, in order:

```text
Improve the style of your lists
Enhance vertical line hover
Draw outer list lines
```

Confirm both list styling and enhanced vertical-line hover are enabled after reset.

- [ ] **Step 4: Verify Workflowy-style bullet geometry in built-in light and dark themes**

Use a note containing a foldable unordered item, a leaf unordered item, and a task item.
For the foldable item, measure `.list-bullet::after` and `.list-bullet::before` before and during hover.
Expected:

```text
dot width = 7px
dot height = 7px
halo width = 18px on hover
halo height = 18px on hover
dot center delta = 0px
transition duration = 0s
```

Confirm the leaf item and task item have no halo, mobile emulation has no halo, and a custom theme removes `bullet-plugin-better-lists`.

- [ ] **Step 5: Verify guide appearance does not control folding**

With guide folding enabled, turn enhanced guide hover off.
Hover an inner guide and an outer guide, and confirm both use the native active width and active color without a 2px radius.
Send the full native pointer sequence `mousedown` → `mouseup` → `click` and confirm folding changes exactly once.

Turn enhanced guide hover on.
Confirm the same guides become 3px with a 2px radius, their center X coordinate does not change from the normal 1px guide, and the same pointer sequence still changes folding exactly once.

- [ ] **Step 6: Re-run affected tests after any live-verification correction**

If source or tests changed during Steps 3 through 5, repeat Step 1 before continuing.

Expected: all verification commands exit 0 after the final source state.

- [ ] **Step 7: Commit any verification correction**

If Step 6 produced changes, run:

```bash
but commit codex/centered-guide-hover -m $'fix(styles): align live list feedback\n\nWhy:\n- Real Obsidian geometry exposed a mismatch not represented by isolated CSS contracts.\n\nWhat:\n- Correct the affected native pseudo-element geometry or selector scope.\n- Add the regression assertion that reproduces the live mismatch.'
```

If Step 6 produced no changes, do not create an empty commit.

- [ ] **Step 8: Inspect the final branch diff**

Run:

```bash
but diff
but status
```

Expected: no uncommitted changes; `codex/centered-guide-hover` contains the design, plan, settings, guide, bullet, and test commits.
