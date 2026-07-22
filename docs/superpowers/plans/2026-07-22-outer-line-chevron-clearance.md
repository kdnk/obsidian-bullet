# Outer Line Chevron Clearance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the desktop Live Preview outer line next to the native chevron without intersecting its SVG.

**Architecture:** Keep the outer widget and fallback geometry unchanged. Derive the desktop Live Preview paint position from the native `--icon-xs` size, then offset the 3px enhanced paint by one pixel so normal, hovered, and selected states share one center.

**Tech Stack:** CSS, TypeScript, Jest 30, CodeMirror 6, Obsidian 1.13, GitButler

## Global Constraints

- Use Node.js 22.23.1 for local verification.
- Use `but` for version-control write operations on `codex/fix-outer-line-clearance`.
- Keep the base inline-end fallback for mobile and Source mode.
- Preserve chevron, halo, outer widget, pointer targeting, marker synchronization, folding, and inner-guide behavior.
- Use only the repository `vault` for real Obsidian verification.
- Back up and restore `vault/test.md` around integration tests.

---

### Task 1: Anchor desktop outer paint to the native collapse icon

**Files:**

- Modify: `src/features/__tests__/GuideFolding.test.ts`
- Modify: `styles.css`
- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: native `--icon-xs`, the existing outer pseudo-element, and the existing 3px enhanced paint.
- Produces: a normal outer line at half an icon width from the widget inline end and enhanced paint centered on the same line.

- [ ] **Step 1: Change the CSS contracts to require icon-relative offsets**

Rename the normal-position test to `keeps the fallback at the widget end and clears the desktop chevron`.
Require the desktop Live Preview normal declaration to be:

```ts
expect(desktopLivePreviewDeclarations?.replace(/\s+/g, " ").trim()).toBe(
  "inset-inline-start: auto; inset-inline-end: calc(var(--icon-xs) / 2);",
);
```

Require both enhanced hover and enhanced selected declarations to be:

```ts
expect(desktopEnhancedHovered?.replace(/\s+/g, " ").trim()).toBe(
  "inset-inline-start: auto; inset-inline-end: calc(var(--icon-xs) / 2 - 1px);",
);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand -t "fallback at the widget end|draws normal, native-active, and enhanced segments|shares active paint with selected guides"
```

Expected: three tests fail because the current CSS still uses `--indentation-guide-editing-indent`.

- [ ] **Step 3: Move normal, selected, and hovered paint**

Replace the three desktop Live Preview offsets with:

```css
body:not(.is-mobile)
  .markdown-source-view.mod-cm6.is-live-preview
  .bullet-plugin-outer-list-guide::before {
  inset-inline-start: auto;
  inset-inline-end: calc(var(--icon-xs) / 2);
}
```

For the existing selected and hovered selectors, use:

```css
inset-inline-start: auto;
inset-inline-end: calc(var(--icon-xs) / 2 - 1px);
```

- [ ] **Step 4: Update the durable outer-guide instruction**

Replace the desktop Live Preview exception in `AGENTS.md` with the icon-relative geometry.
Record the real-Obsidian requirements: normal and enhanced centers match, the enhanced SVG gap is positive, and no first-inner-guide distance contract remains.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the Step 2 command again.

Expected: all three tests pass.

### Task 2: Verify the visual and interaction contract

**Files:**

- Verify: `src/features/__tests__/GuideFolding.test.ts`
- Verify: `styles.css`
- Verify: `vault/scroll-fold-regression-test.md`

**Interfaces:**

- Consumes: the icon-relative CSS contract from Task 1.
- Produces: automated and real-Obsidian evidence that the line is close, visible, centered, and non-intersecting.

- [ ] **Step 1: Run automated verification**

Run:

```bash
n exec 22.23.1 npm run test:unit
n exec 22.23.1 npm run lint
n exec 22.23.1 npm run build-with-tests
```

Expected: every command exits 0.

- [ ] **Step 2: Run the focused integration spec**

Inspect the LevelDB lock owner.
Back up `vault/test.md` into a new `/tmp/obsidian-bullet-outer-clearance.*` directory and record both SHA-256 hashes.

Run:

```bash
n exec 22.23.1 npm test -- specs/features/VerticalGuideInteraction.spec.md --runInBand -t "outer guide should isolate folding to its current document chunk"
```

After the renderer exits, restore `vault/test.md`, verify its hash immediately and after a delay, and move only the verified temporary directory to Trash.

- [ ] **Step 3: Verify real Obsidian geometry and interaction**

Open `vault/scroll-fold-regression-test.md` in the repository test vault and reload plugin `bullet`.
Before every UI action, focus the `vault` renderer and verify the title contains `vault` but not `base`, `useTab` is `true`, and `tabSize` is `4`.

Verify:

- normal paint is `x=68..69` and its center is `x=68.5`;
- enhanced hover and selected paint is `x=67..70` and its center is `x=68.5`;
- the chevron SVG begins at `x=71`, leaving a `1px` enhanced gap;
- a complete `mousedown` to `mouseup` to `click` sequence folds and unfolds exactly once;
- pointer leave and clicking elsewhere clear hover and selected markers;
- no temporary probe style or Obsidian error remains.

- [ ] **Step 4: Commit the scoped fix**

Use `but diff` to copy the exact change IDs for the spec, plan, test, CSS, and `AGENTS.md` changes.
Commit only those IDs to `codex/fix-outer-line-clearance` with an English Conventional Commit whose body explains Why and What.

