# Nested Native Guide Targeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each pressed native vertical guide toggle only the direct non-empty branches of the real list ancestor represented by that guide's painted indentation boundary.

**Architecture:** Keep CodeMirror-owned `.cm-indent::before` rendering and the capture-phase event handler. Derive the raw indentation prefix before the pressed guide inside `.cm-hmd-list-indent`, match that exact prefix to a real parsed ancestor's `getFirstLineIndent()`, and reuse the existing selection-safe direct-child batch toggle. Unmatched boundaries are ignored instead of falling back to the outermost ancestor.

**Tech Stack:** TypeScript 5.9, Obsidian 1.13.1, CodeMirror 6, Jest 30, Rollup 4.

## Global Constraints

- Use normal `git` on `main`; do not use GitButler.
- Work from the current `5.6.2` baseline, but do not change package versions or create a release unless the user separately requests one.
- Use only `/Users/kodai/workspaces/github.com/kdnk/obsidian-bullet/vault` for manual Obsidian verification; never place test artifacts or notes in `/Users/kodai/base`.
- Prefix every Obsidian CLI command with `vault=vault`.
- Before every Computer Use action, focus the test renderer with `obsidian-cli vault=vault eval code='window.focus()'`, obtain fresh state, require a title containing `vault` and not `base`, and never reuse an element index or coordinate.
- Do not restore overlay DOM, measurements, coordinate caches, observers, animation-frame scheduling, or scroll synchronization.
- Keep `.cm-indent::before` as the only guide rendering source and do not change native guide geometry, width, color, or indentation layout.
- Preserve persistent-guide ownership, cleanup, layout reset, z-index stacking, capture-phase handling, direct-child batch semantics, and `foldEnsuringCursorVisible` selection safety.
- Build with `npm run build-with-tests` before the complete Jest suite because Markdown integration specs execute `dist/main.js`.
- Use English Conventional Commits with detailed `Why` and `What` sections.

---

## File Structure

- Modify: `src/features/VerticalLines.ts` — derive a pressed guide's raw indentation boundary and resolve the exact real ancestor.
- Modify: `src/features/__tests__/VerticalLines.test.ts` — model nested native guide segments and prove outer/inner target separation at helper and handler levels.
- Modify: `AGENTS.md` — replace the incorrect outermost-only mapping instruction with the durable boundary-prefix rule.
- Modify: `docs/superpowers/specs/2026-07-13-stable-vertical-guides-design.md` — mark historical target mapping as superseded.
- Modify: `docs/superpowers/specs/2026-07-13-restore-vertical-guide-folding-design.md` — mark outermost-only target mapping as superseded.
- Modify: `docs/superpowers/plans/2026-07-13-stable-vertical-guides.md` — point historical mapping guidance to the accepted nested-target design.
- Modify: `docs/superpowers/plans/2026-07-13-restore-vertical-guide-folding.md` — mark the completed outermost-only plan as historical.
- Modify: `docs/superpowers/plans/2026-07-13-nested-native-guide-targeting.md` — record completed steps and final evidence.
- Create temporarily, then delete: `vault/vertical-guide-level-regression-test.md` — verify outer and inner guide clicks in the repository test vault.

### Task 1: Resolve the Exact Ancestor Represented by the Pressed Guide

**Files:**
- Modify: `src/features/__tests__/VerticalLines.test.ts:203-269,422-679`
- Modify: `src/features/VerticalLines.ts:13-49,91-133`

**Interfaces:**
- Consumes: `Element.parentElement`, `Element.matches()`, `Node.childNodes`, `Node.textContent`, `List.getParent()`, and `List.getFirstLineIndent()`.
- Produces: `resolveVerticalGuideTarget(list: List, pressedGuide: Element): List | null`.
- Preserves: `toggleVerticalGuideTarget(editor, list): boolean` and its direct-child batch behavior.

- [ ] **Step 1: Add realistic guide-boundary test helpers**

Move the handler-local guide factory to the shared helper section after `makeFoldEditor`, and replace it with:

```ts
function makeGuideLine(indentSegments: string[] = ["  "]) {
  const line = {};
  const indentContainer = {
    matches: jest.fn(
      (selector: string) => selector === ".cm-hmd-list-indent",
    ),
    childNodes: [] as Array<{ textContent: string | null }>,
  };
  const guides = indentSegments.map((textContent) => ({
    textContent,
    parentElement: indentContainer,
    matches: jest.fn((selector: string) => selector === ".cm-indent"),
    closest: jest.fn((selector: string) =>
      selector === ".cm-line" ? line : null,
    ),
  }));
  indentContainer.childNodes.push(...guides);

  return { guides, indentContainer, line };
}

function resolveGuideTarget(
  list: Parameters<typeof resolveVerticalGuideTarget>[0],
  guide: unknown,
) {
  const resolver = resolveVerticalGuideTarget as unknown as (
    list: Parameters<typeof resolveVerticalGuideTarget>[0],
    guide: unknown,
  ) => ReturnType<typeof resolveVerticalGuideTarget>;
  return resolver(list, guide);
}
```

Delete the old `makeGuideLine(guideCount = 1)` inside `describe("VerticalLinesPluginValue.handleMouseDown")`.

- [ ] **Step 2: Replace outermost-only resolver tests with boundary-specific expectations**

Replace `describe("resolveVerticalGuideTarget")` with tests equivalent to:

```ts
describe("resolveVerticalGuideTarget", () => {
  test("maps each standard indent guide to its exact real ancestor", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: [
          "- parent",
          "    - child",
          "        - grandchild",
          "            - leaf",
        ].join("\n"),
        cursor: { line: 3, ch: 12 },
      }),
    });
    const leaf = root.getListUnderLine(3);
    if (!leaf) {
      throw new Error("Expected a leaf list");
    }
    const { guides } = makeGuideLine(["    ", "    ", "    "]);

    expect(
      resolveGuideTarget(leaf, guides[0])?.getFirstLineContentStart().line,
    ).toBe(0);
    expect(
      resolveGuideTarget(leaf, guides[1])?.getFirstLineContentStart().line,
    ).toBe(1);
    expect(
      resolveGuideTarget(leaf, guides[2])?.getFirstLineContentStart().line,
    ).toBe(2);
  });

  test("uses the painted boundary when native indentation is combined", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: [
          "- parent",
          "  - child",
          "    - grandchild",
          "      - leaf",
        ].join("\n"),
        cursor: { line: 3, ch: 6 },
      }),
    });
    const leaf = root.getListUnderLine(3);
    if (!leaf) {
      throw new Error("Expected a leaf list");
    }
    const { guides } = makeGuideLine(["    ", "  "]);

    expect(
      resolveGuideTarget(leaf, guides[0])?.getFirstLineContentStart().line,
    ).toBe(0);
    expect(
      resolveGuideTarget(leaf, guides[1])?.getFirstLineContentStart().line,
    ).toBe(2);
  });

  test("ignores guide boundaries that match only shared leading indentation", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "  - parent\n      - child",
        cursor: { line: 1, ch: 6 },
      }),
    });
    const child = root.getListUnderLine(1);
    if (!child) {
      throw new Error("Expected a child list");
    }
    const { guides } = makeGuideLine(["    ", "  "]);

    expect(resolveGuideTarget(child, guides[0])).toBeNull();
    expect(resolveGuideTarget(child, guides[1])).toBeNull();
  });

  test("ignores a guide outside a list-indent container", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n    - child",
        cursor: { line: 1, ch: 4 },
      }),
    });
    const child = root.getListUnderLine(1);
    if (!child) {
      throw new Error("Expected a child list");
    }
    const guide = {
      parentElement: { matches: jest.fn().mockReturnValue(false) },
    };

    expect(resolveGuideTarget(child, guide)).toBeNull();
  });
});
```

- [ ] **Step 3: Add a handler regression for an inner child guide**

Keep the existing outer-guide handler test and replace its factory call with `makeGuideLine(["    "])`. Then add:

```ts
test("folds only the child branch represented by an inner guide", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: [
        "- parent",
        "    - child",
        "        - branch alpha",
        "            - leaf alpha",
        "        - branch beta",
        "            - leaf beta",
        "    - outer sibling",
        "        - outer leaf",
      ].join("\n"),
      cursor: { line: 3, ch: 12 },
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
  const { guides, line } = makeGuideLine(["    ", "    ", "    "]);
  const { event, preventDefault } = makeEvent(guides[1]);
  const view = makeView(3);

  expect(pluginValue.handleMouseDown(event, view)).toBe(true);
  expect(view.posAtDOM).toHaveBeenCalledWith(line);
  expect(parser.parse).toHaveBeenCalledWith(editor, { line: 3, ch: 0 });
  expect(editor.foldEnsuringCursorVisible).toHaveBeenNthCalledWith(1, 2, {
    line: 2,
    ch: 10,
  });
  expect(editor.foldEnsuringCursorVisible).toHaveBeenNthCalledWith(2, 4, {
    line: 4,
    ch: 10,
  });
  expect(editor.foldEnsuringCursorVisible).toHaveBeenCalledTimes(2);
  expect(editor.foldEnsuringCursorVisible).not.toHaveBeenCalledWith(
    6,
    expect.anything(),
  );
  expect(editor.unfold).not.toHaveBeenCalled();
  expect(preventDefault).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 4: Run the focused test and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest --forceExit --runInBand src/features/__tests__/VerticalLines.test.ts
```

Expected: FAIL for the inner-guide, combined-boundary, leading-indentation, and handler regressions. The current resolver returns the outermost parent for every pressed guide, so the handler folds lines `1` and `6` instead of lines `2` and `4`.

- [ ] **Step 5: Implement exact boundary-prefix resolution**

Add the indent-container selector and replace `resolveVerticalGuideTarget` with:

```ts
const INDENT_CONTAINER_SELECTOR = ".cm-hmd-list-indent";

function getGuideIndentPrefix(pressedGuide: Element): string | null {
  const indentContainer = pressedGuide.parentElement;
  if (!indentContainer?.matches(INDENT_CONTAINER_SELECTOR)) {
    return null;
  }

  let prefix = "";
  for (const child of indentContainer.childNodes) {
    if (child === pressedGuide) {
      return prefix;
    }
    prefix += child.textContent ?? "";
  }

  return null;
}

export function resolveVerticalGuideTarget(
  list: List,
  pressedGuide: Element,
): List | null {
  const indentPrefix = getGuideIndentPrefix(pressedGuide);
  if (indentPrefix === null) {
    return null;
  }

  let ancestor = list.getParent();
  while (ancestor?.getParent()) {
    if (ancestor.getFirstLineIndent() === indentPrefix) {
      return ancestor;
    }
    ancestor = ancestor.getParent();
  }

  return null;
}
```

Pass the pressed element at the handler call site:

```ts
const target = resolveVerticalGuideTarget(list, pressedGuide);
```

Do not change `toggleVerticalGuideTarget`, persistent-guide synchronization, CSS, listener phase, or editor folding methods.

- [ ] **Step 6: Run focused GREEN tests and static checks**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest --forceExit --runInBand src/features/__tests__/VerticalLines.test.ts src/editor/__tests__/index.test.ts
npm run lint
npx tsc --noEmit --pretty false
git diff --check
```

Expected: both focused suites pass; Prettier, ESLint, TypeScript, and diff checks exit with status `0`.

- [ ] **Step 7: Commit the behavior correction**

Run:

```bash
git add src/features/VerticalLines.ts src/features/__tests__/VerticalLines.test.ts
git commit -m "fix(vertical-lines): target clicked guide level" \
  -m "Why:
- The native-guide resolver currently maps every nested guide to the outermost parent, so clicking a child guide closes unrelated parent branches.
- Guide indexes are insufficient because Obsidian can combine multiple indentation units into one native element.

What:
- Resolve each pressed guide by the exact raw indentation prefix at its painted boundary.
- Add helper and handler regressions that distinguish outer, child, and combined native guide segments.
- Ignore unmatched boundaries instead of falling back to the outermost ancestor."
```

Expected: the commit succeeds and the lint hook passes.

### Task 2: Correct Durable Target-Mapping Guidance

**Files:**
- Modify: `AGENTS.md:21-29`
- Modify: `docs/superpowers/specs/2026-07-13-stable-vertical-guides-design.md:1-4`
- Modify: `docs/superpowers/specs/2026-07-13-restore-vertical-guide-folding-design.md:1-4`
- Modify: `docs/superpowers/plans/2026-07-13-stable-vertical-guides.md:1-5`
- Modify: `docs/superpowers/plans/2026-07-13-restore-vertical-guide-folding.md:1-5`

**Interfaces:**
- Consumes: accepted design `docs/superpowers/specs/2026-07-13-nested-native-guide-targeting-design.md`.
- Produces: unambiguous future-agent rules consistent with the corrected implementation.

- [ ] **Step 1: Replace the incorrect outermost-only `AGENTS.md` rule**

Replace the bullet beginning `深い行にある 1 個の .cm-indent` with:

```md
    - 深い行では複数の `.cm-indent` が表示される場合があり、Obsidian が複数のインデント単位を 1 要素へまとめる場合もあります。クリックした guide より前にある同じ `.cm-hmd-list-indent` 内の text を raw indent prefix とし、`getFirstLineIndent()` がその prefix と完全一致する実リスト祖先へ対応付けてください。常に最外側へ対応付けたり、guide 数と祖先数を右寄せで対応付けたりしないでください。一致する祖先がなければ操作を無視してください。
```

Keep the existing direct-child batch, persistent-guide, layout, z-index, capture, selection-safe, and no-overlay bullets unchanged.

- [ ] **Step 2: Mark historical mapping documents as superseded**

Immediately after the H1 in `docs/superpowers/specs/2026-07-13-restore-vertical-guide-folding-design.md`, add:

```md
> **Superseded nested targeting:** The outermost-only mapping in this historical design is replaced by the exact pressed-boundary mapping in [`2026-07-13-nested-native-guide-targeting-design.md`](./2026-07-13-nested-native-guide-targeting-design.md). Direct-child batch folding, persistent native guides, and selection safety remain current.
```

Immediately after the H1 in `docs/superpowers/plans/2026-07-13-restore-vertical-guide-folding.md`, add:

```md
> **Superseded nested targeting:** The outermost-only mapping in this historical plan is replaced by the exact pressed-boundary mapping in [`2026-07-13-nested-native-guide-targeting-design.md`](../specs/2026-07-13-nested-native-guide-targeting-design.md). Direct-child batch folding, persistent native guides, and selection safety remain current.
```

Immediately after the H1 in `docs/superpowers/specs/2026-07-13-stable-vertical-guides-design.md`, add:

```md
> **Superseded nested targeting:** Immediate-parent and outermost-only mappings are historical. Each pressed native guide now resolves by its exact indentation boundary as specified in [`2026-07-13-nested-native-guide-targeting-design.md`](./2026-07-13-nested-native-guide-targeting-design.md).
```

Replace the existing mapping notice in `docs/superpowers/plans/2026-07-13-stable-vertical-guides.md` with:

```md
> **Superseded nested targeting:** Immediate-parent and outermost-only mappings are historical. Each pressed native guide now resolves by its exact indentation boundary as specified in [`2026-07-13-nested-native-guide-targeting-design.md`](../specs/2026-07-13-nested-native-guide-targeting-design.md).
```

- [ ] **Step 3: Validate the guidance diff**

Run:

```bash
rg -n "Superseded nested targeting|raw indent prefix|outermost-only" \
  AGENTS.md docs/superpowers/specs docs/superpowers/plans
git diff --check
git diff -- AGENTS.md docs/superpowers/specs docs/superpowers/plans
```

Expected: the accepted design is the active mapping source; historical claims are explicitly labeled; no unrelated instructions change; diff check passes.

- [ ] **Step 4: Commit the durable guidance correction**

Run:

```bash
git add AGENTS.md \
  docs/superpowers/specs/2026-07-13-stable-vertical-guides-design.md \
  docs/superpowers/specs/2026-07-13-restore-vertical-guide-folding-design.md \
  docs/superpowers/plans/2026-07-13-stable-vertical-guides.md \
  docs/superpowers/plans/2026-07-13-restore-vertical-guide-folding.md
git commit -m "docs: correct nested guide targeting rules" \
  -m "Why:
- Existing agent guidance incorrectly requires every native guide to target the outermost ancestor.
- Historical designs would otherwise direct future changes back toward the reported regression.

What:
- Document exact raw-indent-boundary matching and unmatched-guide handling.
- Mark immediate-parent and outermost-only mapping documents as superseded while preserving their valid native-guide constraints."
```

Expected: the commit succeeds and the lint hook passes.

### Task 3: Complete Automated and Test-Vault Verification

**Files:**
- Create temporarily: `vault/vertical-guide-level-regression-test.md`
- Delete after verification: `vault/vertical-guide-level-regression-test.md`

**Interfaces:**
- Consumes: production `dist/main.js`, `manifest.json`, and `styles.css` from the verified source commit.
- Produces: automated and guarded Obsidian 1.13.1 evidence for exact outer/inner target separation.

- [ ] **Step 1: Build the test-enabled bundle and run the complete suite**

Run:

```bash
npm run build-with-tests
npm test -- --runInBand
```

Expected: Rollup succeeds; every Jest suite and test passes. The repository's existing `--forceExit` advisory may appear, but no suite or test may fail.

- [ ] **Step 2: Build and install production artifacts into the repository test vault**

Run:

```bash
npm run build
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
shasum -a 256 \
  dist/main.js manifest.json styles.css \
  vault/.obsidian/plugins/bullet/main.js \
  vault/.obsidian/plugins/bullet/manifest.json \
  vault/.obsidian/plugins/bullet/styles.css
```

Expected: the production build succeeds and each source artifact hash matches its installed test-vault counterpart.

- [ ] **Step 3: Create the isolated nested-guide fixture**

Use `apply_patch` to create `vault/vertical-guide-level-regression-test.md` with:

```md
- parent
    - child
        - branch alpha
            - leaf alpha
        - branch beta
            - leaf beta
    - outer sibling
        - outer leaf
- scroll filler 01
- scroll filler 02
- scroll filler 03
- scroll filler 04
- scroll filler 05
- scroll filler 06
- scroll filler 07
- scroll filler 08
- scroll filler 09
- scroll filler 10
- scroll filler 11
- scroll filler 12
- scroll filler 13
- scroll filler 14
- scroll filler 15
- scroll filler 16
- scroll filler 17
- scroll filler 18
- scroll filler 19
- scroll filler 20
```

- [ ] **Step 4: Open and reload only the test vault**

Run:

```bash
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli vault=vault open path=vertical-guide-level-regression-test.md
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli vault=vault plugin:reload id=bullet
```

Expected: the note opens in the repository test vault and the installed `bullet` plugin reloads there.

- [ ] **Step 5: Verify the outer guide**

Before every Computer Use action, run:

```bash
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli vault=vault eval code='window.focus()'
```

Use fresh state and require the exact active title to identify `vertical-guide-level-regression-test - vault` and not `base`. If a guide needs accessibility metadata, use read-only inspection plus `vault=vault eval` only to add a unique `aria-label`, `role="button"`, and `tabindex="-1"`; dispatch no mouse event through eval.

Click the outer guide on a deeply nested visible row. Confirm `child` and `outer sibling` remain visible while their descendant branches hide. Click a surviving outer guide and confirm both outer branches reopen.

Expected: the outer guide still batch-toggles only `parent`'s direct non-empty children.

- [ ] **Step 6: Verify the inner child guide and selection safety**

Place the cursor inside `leaf alpha`, refresh the title guard, and click the inner guide whose raw boundary prefix is four spaces.

Confirm:

- `parent`, `child`, `branch alpha`, `branch beta`, `outer sibling`, and `outer leaf` remain visible;
- `leaf alpha` and `leaf beta` hide and stay hidden;
- the cursor relocates atomically to visible `branch alpha` content;
- no fold call affects `outer sibling`;
- a surviving inner guide on `branch alpha` or `branch beta` reopens both leaves.

Expected: the inner guide toggles only `child`'s direct branches and does not close the outer parent's sibling branch.

- [ ] **Step 7: Verify scroll attachment and no overlay**

With a fresh title guard before each action, scroll down into the filler rows and back up. Confirm native guides remain attached to their CodeMirror rows and that no `.bullet-plugin-list-lines-scroller`, `.bullet-plugin-list-lines-content-container`, or `.bullet-plugin-list-line` exists.

Expected: no drift or overlay is present.

- [ ] **Step 8: Remove temporary metadata and fixture**

Remove any temporary `aria-label`, `role`, and `tabindex` from instrumented guides. Use `apply_patch` to delete `vault/vertical-guide-level-regression-test.md`, then run:

```bash
test ! -e vault/vertical-guide-level-regression-test.md
git status --short
git diff --check
```

Expected: the temporary fixture is absent; only this plan's execution-record edit is tracked; diff check passes.

### Task 4: Review, Record, and Push `main`

**Files:**
- Modify: `docs/superpowers/plans/2026-07-13-nested-native-guide-targeting.md`

**Interfaces:**
- Consumes: Task 1 implementation commits, Task 2 guidance commit, and Task 3 verification evidence.
- Produces: a reviewed execution record and an updated `origin/main` without a pull request or release.

- [ ] **Step 1: Review the complete implementation range**

Review from the design commit `b9d6eb9` through the final implementation/guidance commit. Confirm exact guide-level targeting, failure-safe unmatched handling, unchanged persistent-guide lifecycle, unchanged direct-child batch semantics, no overlay, focused regression coverage, and test-vault isolation.

Run independently:

```bash
SKIP_OBSIDIAN=1 npx jest --forceExit --runInBand \
  src/features/__tests__/VerticalLines.test.ts \
  src/editor/__tests__/index.test.ts
npm run lint
npx tsc --noEmit --pretty false
git diff --check b9d6eb9..HEAD
```

Expected: no blocking, important, or minor findings; focused checks pass.

- [ ] **Step 2: Record exact verification results**

Mark every completed checkbox in this plan as `[x]` and append a `## Verification Results` section containing the observed focused-test count, complete-suite count, build results, installed artifact hashes, outer-guide result, inner-guide isolation result, cursor-safety result, scroll/no-overlay result, fixture cleanup, and final review verdict.

Do not copy expected counts when actual Jest output differs; record the observed values.

- [ ] **Step 3: Commit the execution record**

Run:

```bash
git add docs/superpowers/plans/2026-07-13-nested-native-guide-targeting.md
git commit -m "docs: record nested guide targeting verification" \
  -m "Why:
- The nested-guide regression needs a durable record of both automated and real Obsidian behavior.
- Future maintenance must distinguish verified inner-guide isolation from the superseded outermost-only mapping.

What:
- Mark the implementation and documentation tasks complete.
- Record test, build, artifact, guarded test-vault, scroll, cleanup, and review evidence."
```

Expected: the commit succeeds and the lint hook passes.

- [ ] **Step 4: Recheck upstream and push verified `main`**

Run:

```bash
git fetch origin
git pull --ff-only origin main
git push origin main
```

Expected: upstream is already current or fast-forwards cleanly, then `origin/main` advances without a pull request.

- [ ] **Step 5: Confirm final repository state**

Run:

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse main
git rev-parse origin/main
git tag --points-at HEAD
node -p "require('./package.json').version"
```

Expected: the worktree is clean; `HEAD`, `main`, and `origin/main` match; version remains `5.6.2`; no new release tag exists at the implementation HEAD.
