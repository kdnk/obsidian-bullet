# Logseq Drag Cursors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Logseq-style pointer cursors on every desktop list drag handle and the arrow-plus copy cursor while a branch drag is active.

**Architecture:** Keep the existing `bullet-plugin-dnd` and `bullet-plugin-dragging` body classes as the only interaction state.
Replace the current grab/grabbing CSS with desktop editor-scoped pointer/copy rules; do not change TypeScript, drag calculations, or move semantics.

**Tech Stack:** Obsidian 1.13 Live Preview DOM, CSS, Jest 30, TypeScript 5.9, Rollup 4, GitButler CLI.

## Global Constraints

- The accepted design is `docs/superpowers/specs/2026-07-22-logseq-drag-cursors-design.md`.
- Apply `pointer` to unordered markers, ordered markers, task checkboxes, and native list chevrons while desktop drag-and-drop is enabled and idle.
- Apply `copy` throughout the desktop Markdown editor after the existing six-pixel drag threshold is crossed.
- Keep `copy` as visual feedback only; the dropped branch must still move rather than copy.
- Do not apply idle `pointer` styling to mobile, Reading View, heading chevrons, vertical guides, or normal editor content. During an active desktop drag, intentionally apply `copy` to the Markdown editor and all descendants; do not change drag calculations or drop feedback.
- Do not add JavaScript state, listeners, DOM markers, inline styles, or cleanup paths.
- Use Node.js 22.23.1 for every test, lint, typecheck, and build command.
- Use `but` for every version-control write and keep all work on `codex/logseq-drag-cursors`.
- Use only the repository `vault` for Obsidian verification, with `useTab: true` and `tabSize: 4` confirmed before every UI action.
- Do not track `dist/main.js` or the test-vault plugin artifacts.

---

## File Map

- Modify `src/features/__tests__/DragAndDrop.test.ts`: define the CSS contract for idle drag handles and the active editor drag cursor.
- Modify `styles.css`: replace grab/grabbing with pointer/copy rules scoped to desktop editor drag-and-drop state.
- Create and remove `vault/cursor-manual.md` during manual verification: provide isolated unordered, ordered, checkbox, and foldable list handles without changing user notes.

### Task 1: Replace grab feedback with Logseq cursors

**Files:**

- Modify: `src/features/__tests__/DragAndDrop.test.ts`
- Modify: `styles.css`

**Interfaces:**

- Consumes: `body.bullet-plugin-dnd`, `body.bullet-plugin-dragging`, `.cm-formatting-list`, `.task-list-item-checkbox`, `.collapse-indicator`, and `.markdown-source-view.mod-cm6`.
- Produces: an idle `pointer` contract for every drag handle and an active `copy` contract for the editor and all descendants.

- [ ] **Step 1: Write the failing CSS contract**

Add this test after `uses neutral Logseq-style drag feedback` in `src/features/__tests__/DragAndDrop.test.ts`:

```ts
test("uses Logseq-style cursors for drag handles and active drags", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
  const idleDeclarations = styles.match(
    /body:not\(\.is-mobile\)\.bullet-plugin-dnd:not\(\.bullet-plugin-dragging\)\s+\.markdown-source-view\.mod-cm6\s+\.cm-formatting-list,\s*body:not\(\.is-mobile\)\.bullet-plugin-dnd:not\(\.bullet-plugin-dragging\)\s+\.markdown-source-view\.mod-cm6\s+\.task-list-item-checkbox,\s*body:not\(\.is-mobile\)\.bullet-plugin-dnd:not\(\.bullet-plugin-dragging\)\s+\.markdown-source-view\.mod-cm6\s+\.HyperMD-list-line\s+\.cm-fold-indicator\s+\.collapse-indicator\s*\{([^}]*)\}/,
  )?.[1];
  const draggingDeclarations = styles.match(
    /html\s+body:not\(\.is-mobile\)\.bullet-plugin-dnd\.bullet-plugin-dragging\s+\.markdown-source-view\.mod-cm6,\s*html\s+body:not\(\.is-mobile\)\.bullet-plugin-dnd\.bullet-plugin-dragging\s+\.markdown-source-view\.mod-cm6\s+\*\s*\{([^}]*)\}/,
  )?.[1];
  const normalize = (value: string | undefined) =>
    value?.replace(/\s+/g, " ").trim();

  expect(normalize(idleDeclarations)).toBe("cursor: pointer;");
  expect(normalize(draggingDeclarations)).toBe("cursor: copy !important;");
  expect(styles).not.toMatch(
    /body:not\(\.is-mobile\)\.bullet-plugin-dnd:not\(\.bullet-plugin-dragging\)[^{}]*(?:\.HyperMD-header|\.cm-indent)[^{}]*\{[^{}]*cursor:\s*pointer\s*;[^{}]*\}/,
  );
  expect(styles).not.toMatch(/cursor:\s*(?:grab|grabbing)\s*;/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/DragAndDrop.test.ts --runInBand
```

Expected: FAIL because both new declaration matches are `undefined`, while `styles.css` still contains `cursor: grab` and `cursor: grabbing`.

- [ ] **Step 3: Implement the minimal CSS state mapping**

Replace the existing idle grab rule and dragging body rule at the end of `styles.css` with:

```css
body:not(.is-mobile).bullet-plugin-dnd:not(.bullet-plugin-dragging)
  .markdown-source-view.mod-cm6
  .cm-formatting-list,
body:not(.is-mobile).bullet-plugin-dnd:not(.bullet-plugin-dragging)
  .markdown-source-view.mod-cm6
  .task-list-item-checkbox,
body:not(.is-mobile).bullet-plugin-dnd:not(.bullet-plugin-dragging)
  .markdown-source-view.mod-cm6
  .HyperMD-list-line
  .cm-fold-indicator
  .collapse-indicator {
  cursor: pointer;
}

html
  body:not(.is-mobile).bullet-plugin-dnd.bullet-plugin-dragging
  .markdown-source-view.mod-cm6,
html
  body:not(.is-mobile).bullet-plugin-dnd.bullet-plugin-dragging
  .markdown-source-view.mod-cm6
  * {
  cursor: copy !important;
}
```

The descendant rule uses `!important` so Obsidian's `text`, `pointer`, and resize cursors cannot remove the plus badge while the pointer crosses editor children.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/DragAndDrop.test.ts --runInBand
```

Expected: PASS with no warning or error output.

- [ ] **Step 5: Run formatting, lint, and type checks**

Run:

```bash
n exec 22.23.1 npx prettier --check styles.css src/features/__tests__/DragAndDrop.test.ts
n exec 22.23.1 npm run lint
n exec 22.23.1 npx tsc --noEmit
```

Expected: every command exits 0.

- [ ] **Step 6: Commit the tested cursor contract**

Run `but diff` and confirm only `styles.css` and `src/features/__tests__/DragAndDrop.test.ts` are uncommitted, then run:

```bash
but commit codex/logseq-drag-cursors -m $'feat(drag-and-drop): match Logseq cursors\n\nWhy:\n- Grab and grabbing cursors differ from Logseq interaction feedback.\n- A stable plus badge makes the active drag state visible across editor content.\n\nWhat:\n- Show pointer cursors on list markers, task checkboxes, and list chevrons.\n- Show the copy cursor throughout active desktop editor drags without changing move semantics.'
```

Expected: GitButler adds one feature commit to `codex/logseq-drag-cursors` and reports no remaining implementation changes.

### Task 2: Verify cursor lifecycle and move isolation

**Files:**

- Verify: `src/features/DragAndDrop.ts`
- Verify: `src/features/__tests__/DragAndDrop.test.ts`
- Verify: `styles.css`
- Create temporarily: `vault/cursor-manual.md`

**Interfaces:**

- Consumes: the CSS state mapping from Task 1 and the existing six-pixel drag lifecycle in `DragAndDrop`.
- Produces: automated and real-Obsidian evidence that idle, active, cancel, and cleanup states use the intended cursor without changing branch moves.

- [ ] **Step 1: Run the complete unit suite and production build**

Run:

```bash
n exec 22.23.1 npm run test:unit -- --runInBand
n exec 22.23.1 npm run build
```

Expected: the unit suite has zero failures and Rollup exits 0.

- [ ] **Step 2: Create an isolated manual note**

Create `vault/cursor-manual.md` with this exact patch, including the literal tab before each child:

```diff
*** Begin Patch
*** Add File: vault/cursor-manual.md
+- parent
+	- child
+- [ ] task
+1. ordered parent
+	1. ordered child
*** End Patch
```

Do not edit `vault/test.md` or any personal vault.

- [ ] **Step 3: Install the production build into the repository test vault**

Run:

```bash
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli vault=vault open path=cursor-manual.md
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli vault=vault plugin:reload id=bullet
```

Expected: the note opens in the `vault` window and plugin reload succeeds.

- [ ] **Step 4: Verify the test-vault window and indentation runtime before interaction**

Run:

```bash
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli vault=vault dev:cdp method=Runtime.evaluate params='{"expression":"window.focus(); ({ title: document.title, useTab: app.vault.config.useTab, tabSize: app.vault.config.tabSize, path: app.workspace.getActiveFile()?.path })","returnByValue":true}'
```

Expected: the returned object contains a title with `vault` and without `base`, `useTab: true`, `tabSize: 4`, and `path: "cursor-manual.md"`.

- [ ] **Step 5: Verify idle cursors for all drag handles**

Run:

```bash
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli vault=vault dev:cdp method=Runtime.evaluate params='{"expression":"(() => { const cursor = (element) => element ? getComputedStyle(element).cursor : null; const markers = [...document.querySelectorAll(\".markdown-source-view.mod-cm6 .cm-formatting-list\")].map((element) => ({ text: element.textContent, cursor: cursor(element) })); return { title: document.title, useTab: app.vault.config.useTab, tabSize: app.vault.config.tabSize, dnd: document.body.classList.contains(\"bullet-plugin-dnd\"), markers, checkbox: cursor(document.querySelector(\".markdown-source-view.mod-cm6 .task-list-item-checkbox\")), chevron: cursor(document.querySelector(\".markdown-source-view.mod-cm6 .HyperMD-list-line .collapse-indicator\")) }; })()","returnByValue":true}'
```

Expected: `dnd` is `true`; both `-` and `1.` marker entries report `pointer`; `checkbox` and `chevron` also report `pointer`.

- [ ] **Step 6: Cross the real drag threshold and verify the plus cursor**

Run:

```bash
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli vault=vault dev:cdp method=Runtime.evaluate params='{"expression":"(() => { window.focus(); if (document.title.includes(\"base\") || !document.title.includes(\"vault\") || app.vault.config.useTab !== true || app.vault.config.tabSize !== 4) throw new Error(\"unsafe vault state\"); const target = document.querySelector(\".markdown-source-view.mod-cm6 .cm-formatting-list\"); const rect = target.getBoundingClientRect(); const x = rect.left + rect.width / 2; const y = rect.top + rect.height / 2; target.dispatchEvent(new MouseEvent(\"mousedown\", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, view: window })); document.dispatchEvent(new MouseEvent(\"mousemove\", { bubbles: true, cancelable: true, clientX: x + 8, clientY: y, button: 0, buttons: 1, view: window })); const editor = document.querySelector(\".markdown-source-view.mod-cm6\"); const content = editor.querySelector(\".cm-content\"); return { dragging: document.body.classList.contains(\"bullet-plugin-dragging\"), editorCursor: getComputedStyle(editor).cursor, contentCursor: getComputedStyle(content).cursor }; })()","returnByValue":true}'
```

Expected: `dragging` is `true`, and both cursor values are `copy`.

- [ ] **Step 7: Cancel the drag and verify cleanup**

Run:

```bash
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli vault=vault dev:cdp method=Runtime.evaluate params='{"expression":"(() => { document.dispatchEvent(new KeyboardEvent(\"keydown\", { bubbles: true, cancelable: true, code: \"Escape\", key: \"Escape\" })); const marker = document.querySelector(\".markdown-source-view.mod-cm6 .cm-formatting-list\"); return { dragging: document.body.classList.contains(\"bullet-plugin-dragging\"), markerCursor: getComputedStyle(marker).cursor, text: app.workspace.activeEditor?.editor?.getValue() }; })()","returnByValue":true}'
```

Expected: `dragging` is `false`, `markerCursor` is `pointer`, and the note text is unchanged.

- [ ] **Step 8: Remove the temporary note through Trash**

Run:

```bash
test -f /Users/kodai/workspaces/github.com/kdnk/obsidian-bullet/vault/cursor-manual.md
/usr/bin/trash /Users/kodai/workspaces/github.com/kdnk/obsidian-bullet/vault/cursor-manual.md
```

Expected: only the agent-created `cursor-manual.md` moves to Trash and can be recovered there.

- [ ] **Step 9: Run fresh final verification**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/DragAndDrop.test.ts --runInBand
n exec 22.23.1 npx prettier --check styles.css src/features/__tests__/DragAndDrop.test.ts docs/superpowers/specs/2026-07-22-logseq-drag-cursors-design.md docs/superpowers/plans/2026-07-22-logseq-drag-cursors.md
n exec 22.23.1 npm run lint
n exec 22.23.1 npx tsc --noEmit
n exec 22.23.1 npm run build
```

Expected: every command exits 0 with zero test failures, lint errors, type errors, formatting differences, or build errors.
