# Outer Line Native Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep desktop Live Preview outer lines visible on the native guide grid without intersecting list chevrons.

**Architecture:** Preserve the outer widget and base inline-end fallback. Add Live Preview-only desktop offsets that mirror the native indentation guide, then center enhanced hover and selected paint on the same line.

**Tech Stack:** CSS, TypeScript, Jest 30, CodeMirror 6, Obsidian 1.13, GitButler

## Global Constraints

- Use Node.js 22.23.1 for local verification.
- Use `but` for version-control write operations on `codex/fix-outer-line-hover`.
- Preserve chevron and halo geometry, outer widget geometry, pointer targeting, active paint, endpoint radius, marker synchronization, folding, inner guides, Source mode, and mobile behavior.
- Use only the repository `vault` for real Obsidian verification.
- Back up and restore `vault/test.md` around integration tests.

---

### Task 1: Align desktop Live Preview outer paint to native guides

**Files:**

- Modify: `src/features/__tests__/GuideFolding.test.ts`
- Modify: `styles.css`

**Interfaces:**

- Consumes: `--indentation-guide-editing-indent`, the base outer pseudo-element, and the existing 3px enhanced paint.
- Produces: a desktop Live Preview outer line one native indent before the first inner guide, with shared normal, hover, and selected geometry.

- [x] **Step 1: Change the CSS contract to require native-grid offsets**

Rename `keeps the normal outer line at the widget inline end on desktop` to `keeps the fallback at the widget end and aligns desktop Live Preview to native guides`.
Keep the base and generic desktop lookups, and add:

```ts
const desktopLivePreviewDeclarations = styles.match(
  /body:not\(\.is-mobile\)\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.bullet-plugin-outer-list-guide::before\s*\{([^}]*)\}/,
)?.[1];

expect(baseDeclarations).toContain("inset-inline-end: 0;");
expect(desktopNormalDeclarations).toBeUndefined();
expect(
  desktopLivePreviewDeclarations?.replace(/\s+/g, " ").trim(),
).toBe(
  "inset-inline-start: var(--indentation-guide-editing-indent); inset-inline-end: auto;",
);
```

In the enhanced hover test, make `desktopEnhancedHovered` match `.markdown-source-view.mod-cm6.is-live-preview` and require:

```ts
expect(desktopEnhancedHovered?.replace(/\s+/g, " ").trim()).toBe(
  "inset-inline-start: calc(var(--indentation-guide-editing-indent) - 1px); inset-inline-end: auto;",
);
```

Apply the same Live Preview selector and expectation to `desktopEnhancedSelectedOuter` in the selected paint test.

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand -t "fallback at the widget end|draws normal, native-active, and enhanced segments|shares active paint with selected guides"
```

Expected: all three tests fail because no desktop Live Preview native-offset rules exist yet.

- [x] **Step 3: Add the normal desktop Live Preview offset**

After the base outer pseudo-element rule, add:

```css
body:not(.is-mobile)
  .markdown-source-view.mod-cm6.is-live-preview
  .bullet-plugin-outer-list-guide::before {
  inset-inline-start: var(--indentation-guide-editing-indent);
  inset-inline-end: auto;
}
```

- [x] **Step 4: Center enhanced selected and hovered paint on that line**

Add the selected state rule:

```css
body:not(.is-mobile).bullet-plugin-enhanced-vertical-line-hover
  .markdown-source-view.mod-cm6.is-live-preview
  .bullet-plugin-outer-list-guide.bullet-plugin-selected-outer-list-guide::before {
  inset-inline-start: calc(var(--indentation-guide-editing-indent) - 1px);
  inset-inline-end: auto;
}
```

Add the hovered state rule:

```css
body:not(
    .is-mobile
  ).bullet-plugin-vertical-lines-action-toggle-folding.bullet-plugin-enhanced-vertical-line-hover
  .markdown-source-view.mod-cm6.is-live-preview
  .bullet-plugin-outer-list-guide[data-actionable="true"].bullet-plugin-hovered-outer-list-guide::before {
  inset-inline-start: calc(var(--indentation-guide-editing-indent) - 1px);
  inset-inline-end: auto;
}
```

- [x] **Step 5: Run the focused tests and verify GREEN**

Run the Step 2 command again.

Expected: all three tests pass.

- [x] **Step 6: Run automated verification**

Run:

```bash
n exec 22.23.1 npm run test:unit
n exec 22.23.1 npm run lint
n exec 22.23.1 npm run build-with-tests
```

Expected: every command exits 0.

- [x] **Step 7: Verify integration and real Obsidian paint**

Inspect the LevelDB lock owner before the integration test.
Back up `vault/test.md` into a new `/tmp/obsidian-bullet-outer-grid.*` directory and record both SHA-256 hashes.

Run:

```bash
n exec 22.23.1 npm test -- specs/features/VerticalGuideInteraction.spec.md --runInBand -t "outer guide should isolate folding to its current document chunk"
```

After the test renderer exits, restore `vault/test.md`, verify its hash twice, and move only the verified temporary directory to Trash.

Open the repository test vault and reload plugin `bullet`.
Before each UI action, focus the `vault` renderer and verify the title contains `vault` but not `base`, `useTab` is `true`, and `tabSize` is `4`.
For an actionable outer guide in Live Preview, verify:

- the normal line uses `--indentation-guide-editing-indent` from the widget inline start;
- the first native inner guide is one widget width away;
- the hovered and selected 3px paint keeps the normal line center;
- the chevron SVG bounds do not intersect the outer paint;
- `mousedown` to `mouseup` to `click` folds and unfolds once;
- pointer leave and a click elsewhere clear hover and selection markers.

- [x] **Step 8: Commit the scoped fix**

Use `but diff` to copy the exact change IDs for the revised documents, test, and CSS files.
Commit only those IDs to `codex/fix-outer-line-hover` with:

```text
fix(vertical-lines): separate outer lines from chevrons

Why:
- The outer line fallback shared the fold indicator origin and intersected the desktop list chevron.
- Stale active-state offsets also moved hover paint away from the visible line.

What:
- align desktop Live Preview outer lines to the native indentation-guide offset
- keep normal, hovered, and selected paint on one center line
- preserve chevron, halo, widget, mobile, Source mode, and folding geometry
- lock the native-grid contract with focused regression assertions
```

## Verification Results

- RED: the three focused contracts failed because the desktop Live Preview normal, hovered, and selected offsets were undefined.
- GREEN: the same three focused contracts passed after adding the native-grid offsets.
- Unit: 55 suites and 665 tests passed with Node.js 22.23.1.
- Full test: 75 suites passed with 812 passed and 15 skipped tests.
- Lint: Prettier and ESLint passed after formatting the changed test.
- Build: `build-with-tests` completed successfully.
- Integration: the focused outer-guide interaction spec passed in Obsidian 1.13.3.
- Normal paint: the outer line occupied `x=53.6..54.6`, the first inner guide began at `x=89.6`, and the guide distance was 36px.
- Hover paint: the 3px line occupied `x=52.6..55.6`, kept a 0px center delta from the normal line, and left 15.4px before the chevron SVG at `x=71..81`.
- Selected paint: the 3px line kept the same center after folding.
- Interaction: the chunk changed from 31 visible segments to 1 and back to 31 through complete native pointer sequences.
- Cleanup: hover markers, selection markers, temporary probe styles, and captured Obsidian errors were all zero after verification.
- Fixture: `vault/test.md` was restored to SHA-256 `3b41a8cfcfc20a345fa3b2d33a909f1fb00bdd00d2302223bedefc0ed9c96f0b` and rechecked after renderer exit.
