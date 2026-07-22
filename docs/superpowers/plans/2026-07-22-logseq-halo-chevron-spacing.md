# Logseq Halo Chevron Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep about two pixels of visible clearance between the styled desktop list-bullet halo and its native chevron.

**Architecture:** Preserve the existing desktop chevron base rule and add one higher-specificity CSS override gated by `bullet-plugin-better-lists`.
The override changes only `inset-inline-start`, so native folding, hit-area size, halo geometry, unstyled bullets, headings, Reading View, and mobile controls retain their current contracts.

**Tech Stack:** Obsidian 1.13 Live Preview DOM, CSS logical properties, Jest 30, TypeScript 5.9, Rollup 4, Node.js 22.23.1, GitButler CLI.

## Global Constraints

- The accepted design is `docs/superpowers/specs/2026-07-22-logseq-halo-chevron-spacing-design.md`.
- Apply the spacing override only when `Style list bullets` is enabled in desktop Live Preview.
- Keep the 18px halo, 7px bullet, 14px native control, and 10px SVG unchanged.
- Use `inset-inline-start: -7px` for the styled desktop override and preserve `-5px` in the setting-independent base rule.
- Do not change mobile, Reading View, headings, leaf rows, native folding transactions, or vertical-guide folding semantics.
- Do not add TypeScript state, plugin-owned DOM, SVG transforms, overlays, coordinate caches, animations, or transitions.
- Use Node.js 22.23.1 for every local test, build, typecheck, and formatting command.
- Use `but` for every version-control write and keep all work on `codex/logseq-halo-chevron-spacing`.
- Use only the repository `vault` for real Obsidian verification and do not track `dist/main.js`.

---

## File Map

- Modify `src/features/__tests__/BetterListsStyles.test.ts`: require a desktop-only, styled-bullet chevron offset without widening its scope.
- Modify `styles.css`: add the one-property override after the setting-independent desktop chevron geometry.

### Task 1: Styled desktop chevron clearance

**Files:**

- Modify: `src/features/__tests__/BetterListsStyles.test.ts:179-203`
- Modify: `styles.css:278-304`

**Interfaces:**

- Consumes: `body.bullet-plugin-better-lists`, Obsidian's `.cm-fold-indicator`, native `.collapse-indicator`, and desktop Live Preview state.
- Produces: `inset-inline-start: -7px` only for foldable styled desktop list rows.
- Preserves: the base `-5px` offset, 14px control, 10px SVG, 18px halo, native fold transaction, and guide pointer routing.

- [ ] **Step 1: Write the failing scoped-spacing CSS contract**

Add this test after `shares an immediate muted halo between hovered and collapsed desktop bullets` in `src/features/__tests__/BetterListsStyles.test.ts`:

```ts
test("keeps styled desktop chevrons clear of the halo", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
  const spacingDeclarations = styles.match(
    /body:not\(\.is-mobile\)\.bullet-plugin-better-lists\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-list-line:has\(\.cm-fold-indicator\)\s+\.cm-fold-indicator\s+\.collapse-indicator\s*\{([^}]*)\}/,
  )?.[1];

  expect(spacingDeclarations?.replace(/\s+/g, " ").trim()).toBe(
    "inset-inline-start: -7px;",
  );
  expect(styles).not.toMatch(
    /body\.is-mobile\.bullet-plugin-better-lists[^{}]*\.collapse-indicator\s*\{/,
  );
  expect(styles).not.toMatch(
    /\.bullet-plugin-better-lists[^{}]*\.HyperMD-header[^{}]*\.collapse-indicator\s*\{/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/BetterListsStyles.test.ts --runInBand
```

Expected: FAIL because `spacingDeclarations` is `undefined` and does not equal `inset-inline-start: -7px;`.

- [ ] **Step 3: Add the minimal styled-bullet override**

Insert this rule immediately after the setting-independent desktop chevron base rule in `styles.css`:

```css
body:not(.is-mobile).bullet-plugin-better-lists
  .markdown-source-view.mod-cm6.is-live-preview
  .cm-line.HyperMD-list-line:has(.cm-fold-indicator)
  .cm-fold-indicator
  .collapse-indicator {
  inset-inline-start: -7px;
}
```

Do not modify the preceding `inset-inline-start: -5px`, `width: 14px`, or the existing row-hover and vertical-guide pointer rules.

- [ ] **Step 4: Run focused regressions and verify GREEN**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/BetterListsStyles.test.ts src/features/__tests__/GuideFolding.test.ts --runInBand
```

Expected: both suites pass, including the new `-7px` scoped contract and the existing `-5px` base contract.

- [ ] **Step 5: Run broader automated verification**

Run:

```bash
n exec 22.23.1 npx prettier --check styles.css src/features/__tests__/BetterListsStyles.test.ts docs/superpowers/specs/2026-07-22-logseq-halo-chevron-spacing-design.md docs/superpowers/plans/2026-07-22-logseq-halo-chevron-spacing.md
n exec 22.23.1 npm run test:unit -- --runInBand
n exec 22.23.1 npm run build
```

Expected: every command exits 0, all unit suites pass, Rollup completes, and `dist/main.js` remains ignored.

- [ ] **Step 6: Measure and operate the result in the repository test vault**

Install the production build and open the existing nested list in the test vault:

```bash
mkdir -p vault/.obsidian/plugins/bullet
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
obsidian-cli vault=vault open path=test.md
obsidian-cli vault=vault plugin:reload id=bullet
```

If Obsidian is not running, launch it with Computer Use first, then repeat the two `obsidian-cli` commands.
Before every pointer action, focus the test renderer and read the title with:

```bash
obsidian-cli vault=vault dev:cdp method=Runtime.evaluate params='{"expression":"window.focus(); document.title","returnByValue":true}'
```

Proceed only when the returned title contains `vault` and does not contain `base`.
Before every pointer action, also evaluate `({useTab: app.vault.config.useTab, tabSize: app.vault.config.tabSize})` and require `useTab === true` and `tabSize === 4`.

Use fresh DOM queries and rectangles for one root foldable row and one nested foldable row.
For each row, measure expanded hover, collapsed pointer leave, and collapsed hover.
Require the horizontal clearance between the 10px SVG and 18px halo to be at least 1.5px and at most 2.5px, and require the 7px dot and halo centers to match.

With vertical-guide folding enabled, use a complete `mousedown` → `mouseup` → `click` sequence and fresh coordinates for every action.
Require `elementFromPoint()` at the SVG center to return the native SVG, both control side clearances to return their corresponding guides, and each chevron or guide action to reverse the fold state exactly once.

Disable `Style list bullets` and confirm the base chevron offset computes to `-5px`.
Confirm a leaf row has no chevron, headings retain their existing control placement, and real mobile emulation retains the right-edge controls.

- [ ] **Step 7: Commit the tested implementation**

Run `but diff` and require the uncommitted implementation diff to contain only `styles.css` and `src/features/__tests__/BetterListsStyles.test.ts`.
Copy the two file IDs printed by `but diff` into `--changes`, then run:

```bash
but commit codex/logseq-halo-chevron-spacing -m $'fix(styles): separate halo and chevron\n\nWhy:\n- The persistent eighteen-pixel halo overlaps the existing desktop chevron geometry.\n- Logseq leaves visible clearance between its fold control and bullet container.\n\nWhat:\n- shift styled desktop list chevrons two pixels toward inline-start\n- preserve unstyled, mobile, heading, halo, hit-area, and guide geometry\n- add a scoped CSS regression contract' --changes <styles.css-id>,<BetterListsStyles.test.ts-id>
```

Expected: GitButler creates the implementation commit on `codex/logseq-halo-chevron-spacing` and reports no remaining task changes.
