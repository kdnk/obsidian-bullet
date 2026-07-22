# Logseq-Style Drag Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the layered accent drag UI with a neutral source highlight and one Logseq-style insertion separator without changing list movement behavior.

**Architecture:** Keep `DragAndDropState` as the semantic drop planner and keep the existing mouse lifecycle. Simplify each document context to one drop-zone element, remove the target-parent decoration state, and let the selected variant's horizontal position communicate nesting. Define the two remaining visual signals in `styles.css` and lock their declarations with a CSS contract test.

**Tech Stack:** TypeScript, CodeMirror 6 decorations, Obsidian DOM helpers, CSS, Jest, Node.js 22.23.1, GitButler CLI.

## Global Constraints

- Do not change list movement, drop candidate calculation, pointer handling, parser errors, or concurrent-edit protection.
- Use `getObsidianDomWindow(doc).createDiv()` for the detached drop-zone element.
- Keep one document-local drop-zone element for the main window and each pop-out window.
- Use Node.js 22.23.1 through `n exec 22.23.1` for every local verification command.
- Run direct `src` Jest tests with `SKIP_OBSIDIAN=1`.
- Use `but` for version-control writes and conventional English commits with Why and What sections.

---

### Task 1: One semantic insertion separator

**Files:**
- Modify: `src/features/__tests__/DragAndDrop.test.ts`
- Modify: `src/features/DragAndDrop.ts`

**Interfaces:**
- Consumes: `DropVariant.left`, `DropVariant.top`, `EditorView.contentDOM.offsetWidth`, and `DragAndDropState.leftPadding`.
- Produces: `DragAndDropDocumentContext` with `doc: Document` and `dropZone: HTMLDivElement`; `drawDropZone()` applies `display`, `top`, `left`, and `width` to that element.

- [ ] **Step 1: Write the failing DOM tests**

Change the pop-out lifecycle assertion so each document creates one div:

```ts
expect(popoutDocument.win.createDiv).toHaveBeenCalledTimes(1);
```

Replace the inside-drop class test with a geometry and DOM-shape test:

```ts
test("draws the same single separator at the semantic indent for an inside drop", () => {
  const feature = new DragAndDrop(
    {} as never,
    { dragAndDrop: true } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const doc = makeDocument();
  const dropZone = makeElement();

  (
    feature as unknown as {
      documents: Map<unknown, unknown>;
      state: unknown;
    }
  ).documents.set(doc, { doc, dropZone });
  (feature as unknown as { state: unknown }).state = {
    doc,
    view: { contentDOM: { offsetWidth: 400 } },
    dropVariant: {
      left: 80,
      top: 120,
      whereToMove: "inside",
    },
    leftPadding: 20,
  };

  (feature as unknown as { drawDropZone: () => void }).drawDropZone();

  expect(dropZone.style).toEqual({
    display: "block",
    top: "120px",
    left: "80px",
    width: "340px",
  });
  expect(dropZone.children).toEqual([]);
  expect(dropZone.classList.contains("bullet-plugin-drop-zone-inside")).toBe(
    false,
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/DragAndDrop.test.ts --runInBand
```

Expected: FAIL because two divs are created and inside drops still receive `bullet-plugin-drop-zone-inside`.

- [ ] **Step 3: Remove layered drop feedback from TypeScript**

Change the document context and creation path to one element:

```ts
interface DragAndDropDocumentContext {
  doc: Document;
  dropZone: HTMLDivElement;
}

const dropZone = domWindow.createDiv();
dropZone.classList.add("bullet-plugin-drop-zone");
dropZone.setCssStyles({ display: "none" });
doc.body.appendChild(dropZone);

this.documents.set(doc, { doc, dropZone });
```

Reduce `drawDropZone()` to the selected variant's geometry:

```ts
private drawDropZone() {
  const state = this.getState();
  const { view, dropVariant } = state;
  if (!dropVariant) {
    return;
  }

  const { dropZone } = this.getDocumentContext(state.doc);
  const width = Math.round(
    view.contentDOM.offsetWidth - (dropVariant.left - state.leftPadding),
  );

  dropZone.setCssStyles({
    display: "block",
    top: dropVariant.top + "px",
    left: dropVariant.left + "px",
    width: width + "px",
  });
}
```

Remove `dropZonePadding`, `dndMoved`, `droppingLineDecoration`, `droppingLinesStateField`, the second registered editor extension, and their dispatches.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/DragAndDrop.test.ts --runInBand
```

Expected: PASS with no warning or error output.

- [ ] **Step 5: Commit the semantic separator change**

Inspect `but diff` and confirm that only the two TypeScript files from this task are uncommitted, then run:

```bash
but commit codex/logseq-style-drag-feedback -m $'refactor(drag-and-drop): use one insertion separator\n\nWhy:\n- Logseq communicates nesting through separator position without layered parent highlights or connector graphics.\n- The extra document child and editor state exist only to support those removed cues.\n\nWhat:\n- Keep one drop-zone element per document and draw it at the semantic variant geometry.\n- Remove inside-drop classes, parent-row decorations, and dotted indent padding while retaining drag planning and cleanup.'
```

### Task 2: Neutral Logseq-style visual contract

**Files:**
- Modify: `src/features/__tests__/DragAndDrop.test.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `.bullet-plugin-dragging-line` on every line in the moving branch and `.bullet-plugin-drop-zone` on the single document-local separator.
- Produces: a theme-native source highlight and a square-ended 3px muted separator; no pseudo-element or variant-specific drop-zone rule.

- [ ] **Step 1: Write the failing CSS contract test**

Add `readFileSync` and `join` imports, then add:

```ts
test("uses neutral Logseq-style drag feedback", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
  const dragging = styles.match(
    /\.bullet-plugin-dragging-line\s*\{([^}]*)\}/,
  )?.[1];
  const dropZone = styles.match(
    /\.bullet-plugin-drop-zone\s*\{([^}]*)\}/,
  )?.[1];
  const normalize = (value: string | undefined) =>
    value?.replace(/\s+/g, " ").trim();

  expect(normalize(dragging)).toBe(
    "background-color: var(--background-modifier-hover);",
  );
  expect(normalize(dropZone)).toBe(
    "width: 300px; height: 3px; background: var(--text-muted); z-index: 999; position: absolute; pointer-events: none;",
  );
  expect(styles).not.toMatch(/\.bullet-plugin-drop-zone(?:::before|-inside|-padding)/);
  expect(styles).not.toContain(".bullet-plugin-dropping-line");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/DragAndDrop.test.ts --runInBand
```

Expected: FAIL because the existing CSS uses accent backgrounds, a 4px rounded separator, and auxiliary rules.

- [ ] **Step 3: Replace the drag CSS**

Use only these feedback declarations:

```css
.bullet-plugin-dragging-line {
  background-color: var(--background-modifier-hover);
}

.bullet-plugin-drop-zone {
  width: 300px;
  height: 3px;
  background: var(--text-muted);
  z-index: 999;
  position: absolute;
  pointer-events: none;
}
```

Keep the existing grab and grabbing cursor rules unchanged.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/DragAndDrop.test.ts --runInBand
```

Expected: PASS with no warning or error output.

- [ ] **Step 5: Commit the visual contract**

Inspect `but diff` and confirm that only the test and CSS files from this task are uncommitted, then run:

```bash
but commit codex/logseq-style-drag-feedback -m $'feat(drag-and-drop): match Logseq feedback\n\nWhy:\n- A neutral moving-branch highlight and one insertion separator make the active drop position easier to read.\n- Accent markers, halos, and target-row fills compete for attention without adding a distinct operation.\n\nWhat:\n- Style the moving branch with Obsidian hover color and the insertion point as a square-ended three-pixel muted line.\n- Add a CSS contract test that rejects auxiliary drop-zone layers.'
```

### Task 3: Regression and visual verification

**Files:**
- Verify: `src/features/DragAndDrop.ts`
- Verify: `src/features/__tests__/DragAndDrop.test.ts`
- Verify: `styles.css`
- Verify: `specs/features/DragAndDrop.spec.md`

**Interfaces:**
- Consumes: the completed TypeScript and CSS contracts from Tasks 1 and 2.
- Produces: evidence that list moves, code quality checks, the test bundle, and the two separator positions remain correct.

- [ ] **Step 1: Run unit tests, lint, and build**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/DragAndDrop.test.ts --runInBand
n exec 22.23.1 npm run lint
n exec 22.23.1 npm run build-with-tests
```

Expected: all commands exit 0 without warnings.

- [ ] **Step 2: Run the drag integration spec safely**

Prepare a recoverable fixture backup and inspect the Obsidian LevelDB lock owner:

```bash
drag_backup_dir=$(mktemp -d /tmp/obsidian-bullet-drag-test-XXXXXX)
cp vault/test.md "$drag_backup_dir/test.md"
shasum -a 256 "$drag_backup_dir/test.md"
lsof '/Users/kodai/Library/Application Support/obsidian/Local Storage/leveldb/LOCK'
```

If the lock owner is a lowercase `obsidian` CLI process, terminate that exact owner process and rerun `lsof` until the lock is free.

Run:

```bash
n exec 22.23.1 npm test -- specs/features/DragAndDrop.spec.md --runInBand
```

Expected: every drag scenario passes.

After the command exits, use `ps -axo pid,command | rg '[O]bsidian|[o]bsidian'` to confirm that the `vault=vault` test renderer has exited.

Restore and verify the fixture only after that renderer is gone:

```bash
cp "$drag_backup_dir/test.md" vault/test.md
sleep 2
test "$(shasum -a 256 vault/test.md | awk '{print $1}')" = "$(shasum -a 256 "$drag_backup_dir/test.md" | awk '{print $1}')"
case "$drag_backup_dir" in
  /tmp/obsidian-bullet-drag-test-??????) /usr/bin/trash "$drag_backup_dir" ;;
  *) exit 1 ;;
esac
```

Expected: the hash comparison exits 0 and only the exact temporary backup directory is moved to Trash.

- [ ] **Step 3: Verify sibling and nested feedback in the test vault**

Install the test build and reload it:

```bash
mkdir -p vault/.obsidian/plugins/bullet
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
obsidian-cli vault=vault open path=test.md
obsidian-cli vault=vault plugin:reload id=bullet
```

Before each UI action, focus the test renderer with `obsidian-cli vault=vault eval code='window.focus(); document.title'` and confirm the fresh title contains `vault` and not `base`.

If `eval` is unavailable, use this fallback and require `result.value` to contain `vault` and not `base`:

```bash
obsidian-cli vault=vault dev:cdp method=Runtime.evaluate params='{"expression":"window.focus(); document.title","returnByValue":true}'
```

Use a list with a root sibling and an empty potential parent.

Drag to a sibling location and then to a nested location without dropping.

Expected: the moving branch has one neutral background; both targets use the same 3px muted separator; the nested separator begins one indent farther right; no parent-row fill, endpoint marker, halo, or dotted connector appears.

- [ ] **Step 4: Review and commit any verification-only fixes**

If verification required a source or test correction, repeat the failing test first, implement the minimum fix, rerun Steps 1 through 3, and commit the selected changes to `codex/logseq-style-drag-feedback` with a conventional Why/What message.

If no correction is needed, leave the branch with the two implementation commits and the documentation commits.
