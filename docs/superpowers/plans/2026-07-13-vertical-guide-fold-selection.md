# Vertical Guide Fold Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a parent list folded after its native vertical guide is clicked while the cursor is inside the subtree.

**Architecture:** Add a focused `MyEditor` operation that relocates an inside selection and applies `foldEffect` in one CodeMirror transaction. Route only vertical-guide folding through that operation, leaving ordinary fold commands, guide mapping, event capture, and unfolding unchanged.

**Tech Stack:** TypeScript 5.9, Obsidian 1.13.1, CodeMirror 6, Jest 30, Rollup 4.

## Global Constraints

- Preserve the existing native `.cm-indent::before` rendering source and capture-phase `mousedown` listener.
- Do not change which list ancestor a native guide represents.
- Move the cursor only when its main selection head is strictly inside the fold range.
- Dispatch the safe selection and `foldEffect` in one CodeMirror transaction.
- Do not add delayed refolding, retries, overlay DOM, measurements, or geometry state.
- Build with `npm run build-with-tests` before the full `.spec.md` integration suite because it executes `dist/main.js`.
- Use normal `git` on `main`, English Conventional Commits, and commit bodies with explicit `Why` and `What` sections.

---

## File Structure

- `src/editor/index.ts`: owns CodeMirror fold transactions and will expose the selection-safe fold operation.
- `src/editor/__tests__/index.test.ts`: verifies the exact transaction shape for inside and outside selections.
- `src/features/VerticalLines.ts`: maps a guide press to the selection-safe editor operation.
- `src/features/__tests__/VerticalLines.test.ts`: verifies the represented parent's line and fallback cursor are passed through.
- `docs/superpowers/plans/2026-07-13-vertical-guide-fold-selection.md`: records and tracks this implementation.

### Task 1: Add an atomic selection-safe fold operation

**Files:**
- Modify: `src/editor/index.ts:161`
- Test: `src/editor/__tests__/index.test.ts`

**Interfaces:**
- Consumes: `foldable(state, lineFrom, lineTo)`, `foldEffect.of(range)`, and `MyEditorPosition`.
- Produces: `MyEditor.foldEnsuringCursorVisible(line: number, fallbackCursor: MyEditorPosition): void`.

- [x] **Step 1: Write failing transaction tests**

Add the CodeMirror imports and `MyEditor` import at the top of `src/editor/__tests__/index.test.ts`:

```ts
import { foldEffect, foldable } from "@codemirror/language";

import {
  MyEditor,
  getEditorFromState,
  getFoldedLinesFromState,
} from "..";
```

Add this test suite after the existing `getFoldedLinesFromState` suite:

```ts
describe("MyEditor.foldEnsuringCursorVisible", () => {
  const mockedFoldable = jest.mocked(foldable);
  const mockedFoldEffectOf = jest.mocked(foldEffect.of);

  function makeFoldingEditor(selectionHead: number) {
    const line = { from: 0, to: 8 };
    const view = {
      state: {
        doc: {
          line: jest.fn().mockReturnValue(line),
        },
        selection: {
          main: { head: selectionHead },
        },
      },
      lineBlockAt: jest.fn().mockReturnValue(line),
      dispatch: jest.fn(),
    };
    const editor = new MyEditor({ cm: view } as never);

    return { editor, view };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFoldable.mockReturnValue({ from: 8, to: 20 });
    mockedFoldEffectOf.mockReturnValue("fold-effect" as never);
  });

  test("moves an inside selection and folds in one transaction", () => {
    const { editor, view } = makeFoldingEditor(12);

    editor.foldEnsuringCursorVisible(0, { line: 0, ch: 2 });

    expect(view.dispatch).toHaveBeenCalledWith({
      selection: { anchor: 2, head: 2 },
      effects: ["fold-effect"],
    });
    expect(view.dispatch).toHaveBeenCalledTimes(1);
  });

  test("preserves a selection outside the fold range", () => {
    const { editor, view } = makeFoldingEditor(8);

    editor.foldEnsuringCursorVisible(0, { line: 0, ch: 2 });

    expect(view.dispatch).toHaveBeenCalledWith({
      effects: ["fold-effect"],
    });
    expect(view.dispatch).toHaveBeenCalledTimes(1);
  });

  test("does nothing when the line has no foldable range", () => {
    mockedFoldable.mockReturnValue(null);
    const { editor, view } = makeFoldingEditor(12);

    editor.foldEnsuringCursorVisible(0, { line: 0, ch: 2 });

    expect(view.dispatch).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run test:unit -- --runInBand src/editor/__tests__/index.test.ts
```

Expected: FAIL because `foldEnsuringCursorVisible` is not a function.

- [x] **Step 3: Implement the minimal atomic operation**

Add this method immediately after `MyEditor.fold` in `src/editor/index.ts`:

```ts
  foldEnsuringCursorVisible(
    n: number,
    fallbackCursor: MyEditorPosition,
  ): void {
    const { view } = this;
    const l = view.lineBlockAt(view.state.doc.line(n + 1).from);
    const range = foldable(view.state, l.from, l.to);

    if (!range || range.from === range.to) {
      return;
    }

    const effects = [foldEffect.of(range)];
    const { head } = view.state.selection.main;

    if (range.from < head && head < range.to) {
      const fallbackOffset = this.posToDocOffset(fallbackCursor);
      view.dispatch({
        selection: { anchor: fallbackOffset, head: fallbackOffset },
        effects,
      });
      return;
    }

    view.dispatch({ effects });
  }
```

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm run test:unit -- --runInBand src/editor/__tests__/index.test.ts
```

Expected: PASS with both new transaction tests green.

- [x] **Step 5: Commit Task 1**

```bash
git add src/editor/index.ts src/editor/__tests__/index.test.ts
git commit -m "fix(editor): keep selections visible while folding" \
  -m $'Why:\n- CodeMirror removes a folded range when a selection transaction points inside it.\n- Vertical guide folding needs an atomic way to preserve the fold invariant.' \
  -m $'What:\n- Add a fold operation that relocates an inside selection in the fold transaction.\n- Preserve selections that are already outside the folded range.'
```

### Task 2: Route vertical-guide folding through the safe operation

**Files:**
- Modify: `src/features/VerticalLines.ts:22-37`
- Test: `src/features/__tests__/VerticalLines.test.ts:217-490`

**Interfaces:**
- Consumes: `MyEditor.foldEnsuringCursorVisible(line: number, fallbackCursor: MyEditorPosition): void` from Task 1 and `List.getFirstLineContentStart()`.
- Produces: `toggleVerticalGuideTarget(editor, list)` that folds with a safe fallback cursor and unfolds unchanged.

- [x] **Step 1: Update vertical-guide tests to require safe folding**

Replace `makeFoldEditor` in `src/features/__tests__/VerticalLines.test.ts` with:

```ts
  function makeFoldEditor() {
    return {
      foldEnsuringCursorVisible: jest.fn(),
      unfold: jest.fn(),
    };
  }
```

Replace the open-parent test with:

```ts
  test("folds the represented list with a visible fallback cursor", () => {
    const root = makeRoot({
      editor: makeEditor({ text, cursor: { line: 0, ch: 0 } }),
    });
    const parent = root.getListUnderLine(0);
    if (!parent) {
      throw new Error("Expected a parent list");
    }
    const editor = makeFoldEditor();

    expect(toggleVerticalGuideTarget(editor, parent)).toBe(true);
    expect(editor.foldEnsuringCursorVisible).toHaveBeenCalledWith(0, {
      line: 0,
      ch: 2,
    });
    expect(editor.foldEnsuringCursorVisible).toHaveBeenCalledTimes(1);
    expect(editor.unfold).not.toHaveBeenCalled();
  });
```

In the folded-parent and empty-target tests, replace the old fold assertions with:

```ts
    expect(editor.foldEnsuringCursorVisible).not.toHaveBeenCalled();
```

Replace the `handleMouseDown` folding test with:

```ts
  test("folds the ancestor represented by a native indentation guide", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n  - branch\n    - leaf",
        cursor: { line: 1, ch: 2 },
      }),
    });
    const editor = makeFoldEditor();
    mockGetEditorFromState.mockReturnValue(editor);
    const parser = { parse: jest.fn().mockReturnValue(root) };
    const pluginValue = makePluginValue(
      {
        verticalLines: true,
        verticalLinesAction: "toggle-folding",
      },
      parser,
    );
    const { guides, line } = makeGuideLine();
    const { event, preventDefault } = makeEvent(guides[0]);
    const view = makeView(1);

    expect(pluginValue.handleMouseDown(event, view)).toBe(true);
    expect(view.posAtDOM).toHaveBeenCalledWith(line);
    expect(parser.parse).toHaveBeenCalledWith(editor, { line: 1, ch: 0 });
    expect(editor.foldEnsuringCursorVisible).toHaveBeenCalledWith(0, {
      line: 0,
      ch: 2,
    });
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
```

In the unparseable-line and no-ancestor tests, use the concrete helper:

```ts
    const editor = makeFoldEditor();
```

For the no-ancestor assertion, use:

```ts
    expect(editor.foldEnsuringCursorVisible).not.toHaveBeenCalled();
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run test:unit -- --runInBand src/features/__tests__/VerticalLines.test.ts
```

Expected: FAIL because production code still calls `editor.fold` and does not pass the fallback cursor.

- [x] **Step 3: Use the safe operation in `toggleVerticalGuideTarget`**

Replace the function with:

```ts
export function toggleVerticalGuideTarget(
  editor: Pick<MyEditor, "foldEnsuringCursorVisible" | "unfold">,
  list: List,
) {
  if (list.isEmpty()) {
    return false;
  }

  const fallbackCursor = list.getFirstLineContentStart();
  if (list.isFoldRoot()) {
    editor.unfold(fallbackCursor.line);
  } else {
    editor.foldEnsuringCursorVisible(fallbackCursor.line, fallbackCursor);
  }

  return true;
}
```

- [x] **Step 4: Run both focused suites and verify GREEN**

Run:

```bash
npm run test:unit -- --runInBand \
  src/editor/__tests__/index.test.ts \
  src/features/__tests__/VerticalLines.test.ts
```

Expected: PASS with the editor transaction and guide behavior suites green.

- [x] **Step 5: Commit Task 2**

```bash
git add src/features/VerticalLines.ts src/features/__tests__/VerticalLines.test.ts
git commit -m "fix(vertical-lines): preserve guide-triggered folds" \
  -m $'Why:\n- A guide click can fold over the active cursor and CodeMirror then reopens the hidden selection.\n- The native guide interaction must use the atomic fold operation.' \
  -m $'What:\n- Pass the represented parent position as the safe fallback cursor.\n- Keep guide mapping, empty-target handling, and unfolding unchanged.'
```

### Task 3: Verify the fix and deploy it to the active Obsidian vault

**Files:**
- Modify: `docs/superpowers/plans/2026-07-13-vertical-guide-fold-selection.md` (mark completed steps)
- Verify: `dist/main.js`, `/Users/kodai/base/.obsidian/plugins/bullet/main.js`

**Interfaces:**
- Consumes: the editor operation and vertical-guide integration from Tasks 1 and 2.
- Produces: a tested production bundle loaded into the active `base` vault.

- [x] **Step 1: Run the complete unit suite**

```bash
npm run test:unit -- --runInBand
```

Expected: all unit suites and tests PASS without warnings.

- [x] **Step 2: Run lint**

```bash
npm run lint
```

Expected: Prettier and ESLint both exit 0 with no warnings.

- [x] **Step 3: Build the integration-test bundle**

```bash
npm run build-with-tests
```

Expected: Rollup creates `dist/main.js` and exits 0.

- [x] **Step 4: Run the full integration suite**

```bash
npm test -- --runInBand
```

Expected: all unit and `.spec.md` integration suites PASS. The Obsidian test vault is restored during global teardown.

- [x] **Step 5: Build and install the production bundle**

```bash
npm run build
cp dist/main.js manifest.json styles.css /Users/kodai/base/.obsidian/plugins/bullet/
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli \
  plugin:reload id=bullet vault=base
```

Expected: the production bundle builds, the three plugin artifacts are refreshed, and Obsidian reports a successful reload.

- [x] **Step 6: Verify the original interaction in Obsidian 1.13.1**

In the open `base` vault, use the existing three-level `hello` list in `journals/2026-07-13`:

1. Put the cursor in the second-level `hello` item.
2. Click its native indentation guide.
3. Confirm the represented parent remains folded after the click.
4. Click the visible fold placeholder and confirm the subtree unfolds normally.

Expected: no immediate reopening occurs, and unfolding remains functional.

- [x] **Step 7: Review final state**

```bash
git diff --check
git status --short
git log -3 --oneline
```

Expected: no whitespace errors; only this plan remains uncommitted; the two implementation commits are at the top of `main`.

- [x] **Step 8: Mark this plan complete and commit it**

Change each completed checkbox in this file from `[ ]` to `[x]`, then run:

```bash
git add docs/superpowers/plans/2026-07-13-vertical-guide-fold-selection.md
git commit -m "docs: record vertical guide fold implementation" \
  -m $'Why:\n- The cursor-safe folding change needs a durable execution and verification record.' \
  -m $'What:\n- Record the completed TDD cycles, full test results, production deployment, and Obsidian verification.'
```

- [x] **Step 9: Push verified `main`**

```bash
git pull --ff-only origin main
git push origin main
```

Expected: `main` is up to date with `origin/main`, and all three new commits are pushed successfully.
