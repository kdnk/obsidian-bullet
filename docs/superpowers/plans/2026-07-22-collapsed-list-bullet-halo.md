# Collapsed List Bullet Halo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the existing muted list-bullet halo visible while a desktop Live Preview parent item is collapsed.

**Architecture:** Extend the existing desktop hover selector with Obsidian's native collapsed-state selector and share one `::before` declaration block between both states.
Keep the current `::after` rule responsible for the muted center dot and native accent-shadow suppression, without adding TypeScript state or DOM.

**Tech Stack:** Obsidian 1.13 Live Preview DOM, CSS, Jest 30, TypeScript 5.9, Rollup 4, GitButler CLI.

## Global Constraints

- The accepted design is `docs/superpowers/specs/2026-07-22-collapsed-list-bullet-halo-design.md`.
- Apply the persistent halo only when `Style list bullets` is enabled in desktop Live Preview.
- Use the existing 18px circle and `color-mix(in srgb, var(--text-muted) 38%, transparent)`.
- Preserve the 7px `var(--text-muted)` center dot and `box-shadow: none` while collapsed.
- Do not change mobile, Reading View, leaf bullets, folding behavior, or hit targets.
- Do not add animation, transition, opacity switching, outline, box-shadow, TypeScript state, or plugin-owned DOM for the halo.
- Use Node.js 22.23.1 for every local test, build, and formatting command.
- Use `but` for every version-control write and keep all work on `codex/collapsed-list-bullet-gray-halo`.
- Use only the repository `vault` for real Obsidian verification and do not track `dist/main.js`.

---

## File Map

- Modify `src/features/__tests__/BetterListsStyles.test.ts`: require hover and collapsed selectors to share the same muted halo declaration block.
- Modify `styles.css`: group the existing hover selector with the native collapsed-state selector.

### Task 1: Share the muted halo across hover and collapsed states

**Files:**

- Modify: `src/features/__tests__/BetterListsStyles.test.ts`
- Modify: `styles.css`

**Interfaces:**

- Consumes: Obsidian's `.is-collapsed`, `.cm-formatting-list`, `.list-bullet`, and desktop Live Preview body state.
- Produces: one desktop-only `::before` halo rule shared by hovered foldable bullets and collapsed bullets.

- [ ] **Step 1: Write the failing shared-halo CSS contract**

Replace `adds an immediate eighteen-pixel halo only to foldable desktop bullets` with:

```ts
test("shares an immediate muted halo between hovered and collapsed desktop bullets", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
  const bullet = styles.match(
    /\.bullet-plugin-better-lists\s+\.list-bullet\s*\{([^}]*)\}/,
  )?.[1];
  const sharedHalo = styles.match(
    /body:not\(\.is-mobile\)\.bullet-plugin-better-lists\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-list-line:has\(\.cm-fold-indicator\)\s+\.list-bullet:hover::before,\s*body:not\(\.is-mobile\)\.bullet-plugin-better-lists\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-list-line\s+\.is-collapsed\s*~\s*\.cm-formatting-list\s+\.list-bullet::before\s*\{([^}]*)\}/,
  )?.[1];
  const normalizedHalo = sharedHalo?.replace(/\s+/g, " ").trim();

  expect(bullet?.replace(/\s+/g, " ").trim()).toBe("position: relative;");
  expect(normalizedHalo).toBe(
    'content: ""; position: absolute; inset-block-start: calc(50% - 9px); inset-inline-start: calc(50% - 9px); width: 18px; height: 18px; border-radius: 50%; background-color: color-mix(in srgb, var(--text-muted) 38%, transparent); pointer-events: none;',
  );
  expect(normalizedHalo).not.toMatch(
    /\b(?:transition|animation|opacity|outline|box-shadow)\s*:/,
  );
  expect(styles).not.toMatch(
    /\.bullet-plugin-better-lists\s+\.markdown-preview-view[^{}]*\.list-bullet(?::hover)?::before/,
  );
  expect(styles).not.toMatch(
    /body\.is-mobile\.bullet-plugin-better-lists[^{}]*\.list-bullet(?::hover)?::before/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/BetterListsStyles.test.ts --runInBand
```

Expected: FAIL because `sharedHalo` is `undefined` and `normalizedHalo` does not equal the expected declarations.

- [ ] **Step 3: Group the hover and collapsed selectors**

Replace the existing hover halo rule in `styles.css` with:

```css
body:not(.is-mobile).bullet-plugin-better-lists
  .markdown-source-view.mod-cm6.is-live-preview
  .cm-line.HyperMD-list-line:has(.cm-fold-indicator)
  .list-bullet:hover::before,
body:not(.is-mobile).bullet-plugin-better-lists
  .markdown-source-view.mod-cm6.is-live-preview
  .cm-line.HyperMD-list-line
  .is-collapsed
  ~ .cm-formatting-list
  .list-bullet::before {
  content: "";
  position: absolute;
  inset-block-start: calc(50% - 9px);
  inset-inline-start: calc(50% - 9px);
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background-color: color-mix(in srgb, var(--text-muted) 38%, transparent);
  pointer-events: none;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/BetterListsStyles.test.ts --runInBand
```

Expected: `BetterListsStyles.test.ts` passes with no warnings.

- [ ] **Step 5: Run broader automated verification**

Run:

```bash
n exec 22.23.1 npx prettier --check styles.css src/features/__tests__/BetterListsStyles.test.ts docs/superpowers/specs/2026-07-22-collapsed-list-bullet-halo-design.md docs/superpowers/plans/2026-07-22-collapsed-list-bullet-halo.md
n exec 22.23.1 npm run test:unit -- --runInBand
n exec 22.23.1 npm run build
```

Expected: every command exits 0, and the build does not add tracked output.

- [ ] **Step 6: Verify the state transition in the repository test vault**

Install the production build and open an existing note containing a foldable parent:

```bash
mkdir -p vault/.obsidian/plugins/bullet
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
obsidian-cli vault=vault open path=test.md
obsidian-cli vault=vault plugin:reload id=bullet
```

Before each UI action, focus the test renderer and confirm the returned title contains `vault` and does not contain `base`.
Confirm `app.vault.config.useTab === true` and `app.vault.config.tabSize === 4` before interacting with the list.

On one foldable desktop Live Preview row, verify these states with fresh DOM and coordinate reads:

- Before hover, the expanded bullet has no visible `::before` halo.
- During hover, `::before` is an 18px circle using the muted 38% color mix.
- After the native `pointerdown` → `pointerup` → `click` fold sequence and pointer leave, the same halo remains visible without an accent shadow.
- After the native unfold sequence and pointer leave, the halo disappears.
- A leaf bullet, Reading View, and mobile emulation do not gain the persistent halo.

- [ ] **Step 7: Commit the tested feature change**

Run `but diff` and require the uncommitted diff to contain only `styles.css` and `src/features/__tests__/BetterListsStyles.test.ts` before running:

```bash
but commit codex/collapsed-list-bullet-gray-halo -m $'fix(styles): keep collapsed bullet halo muted\n\nWhy:\n- Collapsed parent bullets switch from the muted hover feedback to an accent-colored state.\n- A persistent fold state should use the same visual language as the hover affordance.\n\nWhat:\n- share the existing eighteen-pixel muted halo between hover and collapsed states\n- preserve the muted center dot and exclude mobile and Reading View\n- add a focused CSS contract for both states'
```

Expected: GitButler creates the feature commit on `codex/collapsed-list-bullet-gray-halo` and reports no remaining task changes.
