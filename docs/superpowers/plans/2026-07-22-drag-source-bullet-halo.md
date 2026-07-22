# Drag Source Bullet Halo Implementation Plan

> **For agentic workers:** Execute each task in order. Follow the RED, GREEN, REFACTOR sequence and do not change production code before the corresponding test fails for the expected reason.

**Goal:** Keep the exact source bullet visually identifiable throughout a desktop drag, including leaf items, and render the insertion separator two pixels lower without changing drop selection.

**Architecture:** Extend the existing CodeMirror drag line state with one source-line class instead of holding a DOM element. Reuse the established 18px muted halo rule under the existing desktop Live Preview and styled-list gates. Apply the separator adjustment only when writing the selected variant to the document-local drop-zone element, leaving `DropVariant.top` unchanged.

**Tech Stack:** TypeScript 5.9, CodeMirror 6 state fields and line decorations, Obsidian 1.13 Live Preview DOM, CSS logical properties, Jest 30, Rollup 4, Node.js 22.23.1, GitButler CLI.

## Global Constraints

- The accepted design is `docs/superpowers/specs/2026-07-22-drag-source-bullet-halo-design.md`.
- Reuse the existing 18px muted halo declarations. Do not add a second halo color, size, pseudo-element, animation, transition, outline, or shadow.
- Show the drag halo only on the unordered bullet for the source item's first line. Do not halo child bullets in the moved branch.
- Keep the existing neutral background on every line in the moving branch.
- Keep ordered markers, task checkboxes, mobile, Reading View, and disabled `Style list bullets` behavior unchanged.
- Add no stored DOM element, independent decoration field, event listener, cleanup path, overlay, or coordinate cache.
- Lower only the rendered separator by 2px. Do not change `DropVariant.top`, nearest-variant calculation, semantic indent, width, height, color, or list movement.
- Use Node.js 22.23.1 through `n exec 22.23.1` for every local test, lint, typecheck, and build command.
- Run direct `src` Jest tests with `SKIP_OBSIDIAN=1`.
- Use `but` for every version-control write and keep all commits on `codex/drag-source-bullet-halo`.
- Use only the repository `vault` for real Obsidian verification. Confirm `useTab === true` and `tabSize === 4` before every UI action.
- Do not track `dist/main.js`, test-vault plugin artifacts, screenshots, or the temporary manual note.

---

## File Map

- Modify `src/features/DragAndDrop.ts`: distinguish the source line inside the existing drag decoration state and add the 2px display-only separator offset.
- Modify `src/features/__tests__/DragAndDrop.test.ts`: verify source-only decoration classes and the adjusted drop-zone style without changing semantic variant data.
- Modify `styles.css`: add the source line to the established hover and collapsed halo selector group.
- Modify `src/features/__tests__/BetterListsStyles.test.ts`: lock the shared halo declarations and their desktop Live Preview, styled-list, and source-only scope.
- Create and remove `vault/drag-source-halo-manual.md` during manual verification: isolate leaf, parent, sibling, and nested drag cases from the test fixture.

### Task 1: Distinguish the source line from its moved branch

**Files:**

- Modify: `src/features/__tests__/DragAndDrop.test.ts`
- Modify: `src/features/DragAndDrop.ts`

**Interfaces:**

- Consumes: `List.getFirstLineContentStart()`, `List.getContentEndIncludingChildren()`, `MyEditor.posToOffset()`, `dndStarted`, and the existing drag decoration state field.
- Produces: `bullet-plugin-dragging-line bullet-plugin-dragging-source-line` on the source line and `bullet-plugin-dragging-line` on every remaining branch line.
- Preserves: the body-level `bullet-plugin-dragging` class and the existing `dndEnded` cleanup.

- [ ] **Step 1: Write the failing source-decoration test**

In `src/features/__tests__/DragAndDrop.test.ts`, capture the state field registered by `load()`, create an `EditorState` containing a three-line parent branch, and call the private `highlightDraggingLines()` through the existing test cast pattern.

Iterate the resulting `DecorationSet` and assert the exact offsets and line classes:

```ts
expect(renderedDecorations).toEqual([
  {
    from: 0,
    className: "bullet-plugin-dragging-line bullet-plugin-dragging-source-line",
  },
  { from: 9, className: "bullet-plugin-dragging-line" },
  { from: 19, className: "bullet-plugin-dragging-line" },
]);
```

Derive offsets from the test `EditorState` instead of hard-coding them if the fixture text differs. Also assert that `bullet-plugin-dragging` is present on the owning document body.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/DragAndDrop.test.ts --runInBand
```

Expected: FAIL because the source line has only `bullet-plugin-dragging-line` and cannot be distinguished from its child lines.

- [ ] **Step 3: Carry the source offset through the existing state field**

In `src/features/DragAndDrop.ts`:

- Change `dndStarted` from `StateEffect<number[]>` to an object containing `lines: number[]` and `sourceLine: number`.
- Map both fields through document changes in the effect's `map` callback.
- Add one line decoration with class `bullet-plugin-dragging-line bullet-plugin-dragging-source-line`.
- In the state field update, choose that decoration only when the mapped line offset equals `sourceLine`.
- In `highlightDraggingLines()`, use the existing first-line offset as `sourceLine` and keep every branch offset in `lines`.

Do not add a second state field or cleanup effect.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/DragAndDrop.test.ts --runInBand
```

Expected: PASS with the source class on only the first line and no warning output.

- [ ] **Step 5: Commit the tested source state**

Run `but diff`, copy the two whole-file IDs, and commit only `DragAndDrop.ts` and `DragAndDrop.test.ts`:

```bash
but commit codex/drag-source-bullet-halo -m $'feat(drag-and-drop): identify the source line\n\nWhy:\n- A branch-wide background does not identify the exact bullet where a drag began.\n- Child bullets must remain distinct from the source item during a branch move.\n\nWhat:\n- carry the source offset through the existing drag state effect\n- add a source-only CodeMirror line class while preserving branch highlighting and cleanup\n- cover parent and child line decorations with a focused state-field test' --changes <DragAndDrop.ts-id>,<DragAndDrop.test.ts-id>
```

### Task 2: Reuse the muted halo for the drag source

**Files:**

- Modify: `src/features/__tests__/BetterListsStyles.test.ts`
- Modify: `styles.css`

**Interfaces:**

- Consumes: `body.bullet-plugin-better-lists`, `body.bullet-plugin-dnd`, `body.bullet-plugin-dragging`, `.bullet-plugin-dragging-source-line`, and Obsidian's `.list-bullet`.
- Produces: the same 18px muted `::before` halo for hovered foldable bullets, collapsed bullets, and the active drag source bullet.
- Preserves: source dot geometry, theme color, pointer routing, and existing desktop-only Live Preview scope.

- [ ] **Step 1: Write the failing shared-halo CSS contract**

Update `shares an immediate muted halo between hovered and collapsed desktop bullets` in `src/features/__tests__/BetterListsStyles.test.ts` so its selector match also requires:

```css
body:not(.is-mobile).bullet-plugin-better-lists.bullet-plugin-dnd.bullet-plugin-dragging
  .markdown-source-view.mod-cm6.is-live-preview
  .cm-line.bullet-plugin-dragging-source-line
  .list-bullet::before
```

Keep the exact existing declaration assertion. Add negative checks that no mobile or Reading View drag-source selector exists and that the new selector does not require `.cm-fold-indicator` or `.is-collapsed`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/BetterListsStyles.test.ts --runInBand
```

Expected: FAIL because the shared selector group has no drag-source selector.

- [ ] **Step 3: Add the source selector to the existing halo group**

Append the exact desktop styled-list drag-source selector to the current hover and collapsed selector group in `styles.css`.
Do not duplicate or modify the declaration block.

- [ ] **Step 4: Run focused style and drag regressions and verify GREEN**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/BetterListsStyles.test.ts src/features/__tests__/DragAndDrop.test.ts --runInBand
```

Expected: both suites pass. The existing hover, collapsed, bullet geometry, chevron spacing, and drag feedback contracts remain green.

- [ ] **Step 5: Commit the tested halo contract**

Run `but diff`, copy the two whole-file IDs, and commit only `styles.css` and `BetterListsStyles.test.ts`:

```bash
but commit codex/drag-source-bullet-halo -m $'feat(styles): halo the dragged source bullet\n\nWhy:\n- Leaf items have no folded-state halo, so the exact drag origin is hard to distinguish from the moved branch.\n- Reusing the existing muted halo keeps drag feedback consistent with bullet interaction feedback.\n\nWhat:\n- share the desktop Live Preview halo with the source-only drag line\n- keep child bullets, mobile, Reading View, ordered markers, and task checkboxes unchanged\n- extend the scoped CSS contract without duplicating halo geometry' --changes <styles.css-id>,<BetterListsStyles.test.ts-id>
```

### Task 3: Lower only the rendered separator

**Files:**

- Modify: `src/features/__tests__/DragAndDrop.test.ts`
- Modify: `src/features/DragAndDrop.ts`

**Interfaces:**

- Consumes: the selected `DropVariant.top` and the document-local `.bullet-plugin-drop-zone`.
- Produces: a CSS `top` value two pixels below the semantic candidate coordinate.
- Preserves: `DropVariant.top`, nearest candidate selection, left position, width, height, and DOM shape.

- [ ] **Step 1: Write the failing separator-position test**

In `draws the same single separator at the semantic indent for an inside drop`, keep `dropVariant.top` at `120` and change only the expected element style to:

```ts
expect(dropZone.style).toEqual({
  display: "block",
  top: "122px",
  left: "80px",
  width: "340px",
});
```

After `drawDropZone()`, also assert that the state object's `dropVariant.top` remains `120`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/DragAndDrop.test.ts --runInBand
```

Expected: FAIL because the element still receives `top: "120px"`.

- [ ] **Step 3: Add a display-only two-pixel offset**

Add a named `DROP_ZONE_VERTICAL_OFFSET_PX = 2` constant near `DRAG_START_DISTANCE_PX`.
Use `dropVariant.top + DROP_ZONE_VERTICAL_OFFSET_PX` only in `drawDropZone()` when writing the inline `top` style.

Do not modify the existing `v.top -= 8` candidate alignment or any `DragAndDropState` calculation.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/DragAndDrop.test.ts --runInBand
```

Expected: PASS with `122px` rendered from an unchanged semantic `120` value.

- [ ] **Step 5: Commit the tested separator offset**

Run `but diff`, copy the two whole-file IDs, and commit the focused TypeScript change and test:

```bash
but commit codex/drag-source-bullet-halo -m $'fix(drag-and-drop): lower the insertion separator\n\nWhy:\n- The three-pixel insertion separator appears slightly high relative to the intended boundary.\n- Visual alignment must not shift pointer-based drop candidate selection.\n\nWhat:\n- add a two-pixel display-only vertical offset when drawing the separator\n- preserve semantic drop coordinates, indentation, width, and movement behavior\n- cover rendered and semantic top values with a focused unit test' --changes <DragAndDrop.ts-id>,<DragAndDrop.test.ts-id>
```

### Task 4: Automated and real-Obsidian verification

**Files:**

- Verify: `src/features/DragAndDrop.ts`
- Verify: `src/features/__tests__/DragAndDrop.test.ts`
- Verify: `src/features/__tests__/BetterListsStyles.test.ts`
- Verify: `styles.css`
- Verify: `specs/features/DragAndDrop.spec.md`
- Create and remove: `vault/drag-source-halo-manual.md`

- [ ] **Step 1: Run formatting, unit tests, lint, typecheck, and production build**

Run:

```bash
n exec 22.23.1 npx prettier --check styles.css src/features/DragAndDrop.ts src/features/__tests__/DragAndDrop.test.ts src/features/__tests__/BetterListsStyles.test.ts docs/superpowers/specs/2026-07-22-drag-source-bullet-halo-design.md docs/superpowers/plans/2026-07-22-drag-source-bullet-halo.md
n exec 22.23.1 npm run test:unit -- --runInBand
n exec 22.23.1 npm run lint
n exec 22.23.1 npx tsc --noEmit
n exec 22.23.1 npm run build
```

Expected: every command exits 0, all unit suites pass, Rollup completes, and `dist/main.js` remains ignored.

- [ ] **Step 2: Run the drag integration spec with a recoverable fixture backup**

Before the full spec, inspect the Obsidian LevelDB lock owner with `lsof` as required by `AGENTS.md`.
Back up `vault/test.md` into an exact `mktemp -d /tmp/obsidian-bullet-drag-halo-XXXXXX` directory and record both hashes.

Run:

```bash
n exec 22.23.1 npm run build-with-tests
n exec 22.23.1 npm test -- specs/features/DragAndDrop.spec.md --runInBand
```

After the command exits, wait until the `vault=vault` renderer is gone, restore `vault/test.md`, wait, and confirm its hash still matches the backup.
Validate the exact temporary directory path and move it to Trash with `/usr/bin/trash`; do not use `rm -rf`.

Expected: every drag scenario passes, the fixture is restored byte-for-byte, and no test renderer can overwrite it afterward.

- [ ] **Step 3: Verify the display in the repository test vault**

Read and use the `computer-use:computer-use` skill before controlling Obsidian.
Create `vault/drag-source-halo-manual.md` with an unordered leaf, a parent with two children, a sibling target, and an empty nested target.
Install the production build to `vault/.obsidian/plugins/bullet/`, open that note with `vault=vault`, and reload plugin id `bullet`.

Before every UI action:

- focus the `vault` renderer with `obsidian-cli vault=vault eval code='window.focus()'`, or the documented `dev:cdp` fallback;
- read the fresh title and stop if it contains `base` or does not contain `vault`;
- require `app.vault.config.useTab === true` and `tabSize === 4`;
- query fresh elements and coordinates instead of reusing an earlier element index.

For the leaf and then the parent, use the complete drag pointer sequence and pause before mouseup.
Inspect computed styles and a screenshot while the drag is active.

Require:

- the leaf source bullet has one centered 18px muted halo despite having no fold indicator;
- the parent source bullet has the same halo while both child bullets have no halo;
- the moved branch keeps its neutral line background;
- mouseup and Escape each remove the source class and halo;
- sibling and nested targets keep the same square-ended 3px muted separator, with nested placement changing only its inline start;
- the separator's rendered top is exactly the semantic variant top plus 2px;
- the actual list move remains correct after drop.

Remove the manual note and any untracked screenshots created by this task. Do not alter `vault/test.md`.

- [ ] **Step 4: Inspect final branch state**

Run `but diff` and require no uncommitted task changes.
Run `but status` only if commit order or branch placement must be checked; the expected branch is `codex/drag-source-bullet-halo` with documentation followed by the three tested implementation commits.
