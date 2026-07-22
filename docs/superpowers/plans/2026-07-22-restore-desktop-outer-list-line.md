# Desktop Outer List Line Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the visible desktop outer list line to its `5.12.0` inline-end position.

**Architecture:** Keep the existing CodeMirror widget decoration and base pseudo-element paint source. Remove only the desktop normal-line position override, while preserving mobile geometry and the existing desktop offsets for enhanced hover and selected states.

**Tech Stack:** TypeScript, Jest 30, CSS, CodeMirror 6, Obsidian 1.13, GitButler

## Global Constraints

- Use Node.js 22.23.1 for local verification.
- Use `but` for version-control write operations and create commits on `codex/restore-desktop-outer-line`.
- Preserve the outer guide widget position, width, pointer events, chunk decorations, folding behavior, enhanced hover, selected state, and mobile geometry.
- Use only the repository `vault` for real Obsidian verification.
- Back up and restore `vault/test.md` around integration tests.

---

### Task 1: Restore the desktop normal-line position

**Files:**
- Modify: `src/features/__tests__/GuideFolding.test.ts:1017`
- Modify: `styles.css:88`

**Interfaces:**
- Consumes: `.bullet-plugin-outer-list-guide::before` as the existing normal paint source.
- Produces: one base `inset-inline-end: 0` position shared by desktop and mobile, with no desktop-only normal-line override.

- [ ] **Step 1: Write the failing CSS contract test**

Replace the existing desktop normal-line test with:

```ts
test("keeps the normal outer line at the widget inline end on desktop", () => {
  const baseDeclarations = styles.match(
    /\.markdown-source-view\.mod-cm6\s+\.bullet-plugin-outer-list-guide::before\s*\{([^}]*)\}/,
  )?.[1];
  const desktopNormalDeclarations = styles.match(
    /body:not\(\.is-mobile\)\s+\.markdown-source-view\.mod-cm6\s+\.bullet-plugin-outer-list-guide::before\s*\{([^}]*)\}/,
  )?.[1];

  expect(baseDeclarations).toContain("inset-inline-end: 0;");
  expect(desktopNormalDeclarations).toBeUndefined();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand -t "keeps the normal outer line at the widget inline end on desktop"
```

Expected: FAIL because the current desktop selector still returns `inset-inline-start: 0; inset-inline-end: auto;`.

- [ ] **Step 3: Remove the desktop normal-line override**

Delete only this rule from `styles.css`:

```css
body:not(.is-mobile)
  .markdown-source-view.mod-cm6
  .bullet-plugin-outer-list-guide::before {
  inset-inline-start: 0;
  inset-inline-end: auto;
}
```

Do not change the later desktop rules that require `bullet-plugin-enhanced-vertical-line-hover` and apply only to selected or hovered guides.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand -t "keeps the normal outer line at the widget inline end on desktop"
```

Expected: PASS.

- [ ] **Step 5: Run automated verification**

Run:

```bash
n exec 22.23.1 npm run test:unit
n exec 22.23.1 npm run lint
n exec 22.23.1 npm run build-with-tests
```

Expected: all commands exit 0.

- [ ] **Step 6: Verify the real Obsidian paint and interaction**

Before the integration test, inspect the LevelDB lock owner with:

```bash
lsof "$HOME/Library/Application Support/obsidian/Local Storage/leveldb/LOCK"
```

Create a temporary backup directory, copy `vault/test.md`, and record its SHA-256 hash:

```bash
outer_lines_backup_dir="$(mktemp -d /tmp/obsidian-bullet-outer-lines.XXXXXX)"
cp vault/test.md "$outer_lines_backup_dir/test.md"
shasum -a 256 vault/test.md "$outer_lines_backup_dir/test.md"
```

Run:

```bash
n exec 22.23.1 npm test -- specs/features/VerticalGuideInteraction.spec.md --runInBand -t "outer guide should isolate folding to its current document chunk"
```

After the test renderer exits, restore the fixture and verify the hash twice before moving the exact temporary directory to Trash.

Open the repository test vault, reload plugin `bullet`, focus the `vault` renderer, and confirm the title does not contain `base` before inspecting the DOM.
For the first `.bullet-plugin-outer-list-guide`, verify that `getComputedStyle(guide, "::before").insetInlineEnd` is `0px`, the border is visible, and the line lies at the widget inline end.

Expected: the integration spec passes, the computed normal line uses the inline end, and `vault/test.md` matches the backup hash after restoration.

- [ ] **Step 7: Commit the scoped fix**

Inspect the real uncommitted hunks:

```bash
but diff
```

Copy the two hunk IDs printed for the changed test and normal-line CSS rule.
Pass those exact comma-separated IDs to `but commit codex/restore-desktop-outer-line -m`, using this message:

```text
fix(vertical-lines): restore desktop outer lines

Why:
- The 5.12.1 desktop position change moved outer lines away from their last visible location.
- Existing decorations and interaction remained active, leaving an invisible control in affected layouts.

What:
- keep normal desktop outer lines at the widget inline end used by 5.12.0
- preserve mobile geometry and active hover and selection offsets
- replace the regression contract with the restored desktop position
```

Do not include changes owned by another branch.
