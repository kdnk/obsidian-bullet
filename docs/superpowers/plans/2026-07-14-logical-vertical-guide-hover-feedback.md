# Logical Vertical Guide Hover Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight every rendered native guide segment owned by the same real list ancestor as the segment under the pointer.

**Architecture:** Preserve the existing action-state body class and exact pressed-boundary resolver. Add a pure semantic grouping helper, let each `VerticalLinesPluginValue` read the currently hovered native segment during CodeMirror measurement, and mark only rendered candidates resolving to the same target position. Replace the row-local `:hover` CSS with a plugin marker selector that still styles Obsidian's native `::before` border.

**Tech Stack:** TypeScript 5.9, CSS, Obsidian 1.13.1, CodeMirror 6, Jest 30, Rollup 4.

## Global Constraints

- Use normal `git` on `main`; do not use GitButler.
- Start from version `5.6.3`, but do not change package versions or create a release unless the user separately requests one.
- The accepted design is `docs/superpowers/specs/2026-07-14-vertical-guide-hover-feedback-design.md` at or after commit `4312275`.
- Keep the Task 1 action-state class `bullet-plugin-vertical-lines-action-toggle-folding` and its main/pop-out lifecycle behavior.
- Highlight all currently rendered native segments resolving to the same real list ancestor; do not stop at the hovered row fragment and do not group unrelated lists by X coordinate or indentation depth.
- Use the existing `resolveVerticalGuideTarget` exact raw-prefix mapping for both click targeting and hover grouping.
- Use only `--indentation-guide-width-active` and `--indentation-guide-color-active` for active appearance; do not add fixed colors, background highlights, transitions, custom geometry, overlays, coordinate caches, pointer-position caches, animation-frame loops, or scroll synchronization.
- Keep `.cm-indent::before` as the only guide-rendering source and preserve normal-state guide appearance, persistent-guide layout correction, and folded-indicator stacking.
- Preserve direct-child batch folding, selection-safe folding, capture-phase `mousedown`, unmatched-guide no-op behavior, and existing cleanup.
- Use only `/Users/kodai/workspaces/github.com/kdnk/obsidian-bullet/vault` for manual Obsidian verification; every vault-affecting CLI command must explicitly include `vault=vault`.
- Before every Computer Use action, focus with `obsidian-cli vault=vault eval code='window.focus()'`, get fresh full state, require the exact fixture-vault title and reject `base`, and never reuse element indices or coordinates.
- Build with `npm run build-with-tests` before the complete Jest suite because Markdown integration specs execute `dist/main.js`.
- End the test vault on the production bundle and require source/install artifact hashes to match.
- Use English Conventional Commits with detailed `Why` and `What` sections.
- Do not push until all task reviews and the fresh whole-branch review are approved.

---

## File Structure

- Modify: `src/features/VerticalLines.ts` — collect a logical guide group, synchronize marker classes, and manage pointer/view/settings lifecycle.
- Modify: `src/features/__tests__/VerticalLines.test.ts` — prove semantic grouping, unrelated-list isolation, persistent candidates, marker cleanup, listeners, and update resynchronization.
- Modify: `styles.css` — replace row-local `:hover` styling with the logical-group marker selector.
- Modify: `AGENTS.md` — record complete logical-guide ownership and lifecycle constraints.
- Modify: `docs/superpowers/plans/2026-07-14-logical-vertical-guide-hover-feedback.md` — record execution evidence.
- Create temporarily, then delete: `vault/logical-vertical-guide-hover-test.md` — verify full-guide hover in the repository test vault.

### Task 1: Group Rendered Guides by Their Exact List Target

**Files:**
- Modify: `src/features/VerticalLines.ts:13-22,40-77,101-210`
- Modify: `src/features/__tests__/VerticalLines.test.ts:20-153,282-372,480-758`

**Interfaces:**
- Consumes: `resolveVerticalGuideTarget(list: List, pressedGuide: Element): List | null`, `List.getFirstLineContentStart()`, `Root.getListUnderLine()`, and `EditorView.posAtDOM()`.
- Produces: `collectVerticalGuideGroup(hoveredGuide, guides, getListForGuide): Element[]`.
- Produces: `synchronizeHoveredIndentGuides(contentDOM, highlightedGuides): void`.
- Produces: marker class `bullet-plugin-hovered-indent-guide` on currently rendered native or promotable guide spans belonging to one logical target.

- [ ] **Step 1: Confirm the revised baseline and synchronize upstream**

Run:

```bash
git status --short --branch
git fetch origin
git pull --ff-only
git log -6 --oneline
```

Expected: `main` contains `6f94a6c`, `343d2c6`, and revised design `4312275`; the tracked worktree is clean; pull is already current or fast-forwards without conflict.

- [ ] **Step 2: Extend the guide test helper with real class state**

In `makeGuideLine`, add a real test class list to every guide:

```ts
const guides = indentSegments.map((textContent) => ({
  textContent,
  parentElement: indentContainer,
  classList: makeClassList(),
  matches: jest.fn((selector: string) => selector === ".cm-indent"),
  closest: jest.fn((selector: string) =>
    selector === ".cm-line" ? line : null,
  ),
}));
```

Add this mapping helper after `makeGuideLine`:

```ts
function mapGuideLine(
  root: ReturnType<typeof makeRoot>,
  lineNumber: number,
  indentSegments: string[],
  listsByGuide: Map<unknown, ReturnType<typeof root.getListUnderLine>>,
) {
  const guideLine = makeGuideLine(indentSegments);
  for (const guide of guideLine.guides) {
    listsByGuide.set(guide, root.getListUnderLine(lineNumber));
  }
  return guideLine;
}
```

- [ ] **Step 3: Add failing semantic-group tests**

Import the new helpers from `VerticalLines`:

```ts
import {
  collectVerticalGuideGroup,
  synchronizeHoveredIndentGuides,
} from "../VerticalLines";
```

Add this suite after `resolveVerticalGuideTarget`:

```ts
describe("collectVerticalGuideGroup", () => {
  test("groups only segments resolving to the same outer list", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: [
          "- parent A",
          "    - child A",
          "        - leaf A",
          "- parent B",
          "    - child B",
          "        - leaf B",
        ].join("\n"),
        cursor: { line: 2, ch: 8 },
      }),
    });
    const listsByGuide = new Map<
      unknown,
      ReturnType<typeof root.getListUnderLine>
    >();
    const childA = mapGuideLine(root, 1, ["    "], listsByGuide);
    const leafA = mapGuideLine(root, 2, ["    ", "    "], listsByGuide);
    const childB = mapGuideLine(root, 4, ["    "], listsByGuide);
    const leafB = mapGuideLine(root, 5, ["    ", "    "], listsByGuide);
    const guides = [
      ...childA.guides,
      ...leafA.guides,
      ...childB.guides,
      ...leafB.guides,
    ];

    expect(
      collectVerticalGuideGroup(
        leafA.guides[0],
        guides,
        (guide) => listsByGuide.get(guide) ?? null,
      ),
    ).toEqual([childA.guides[0], leafA.guides[0]]);
  });

  test("groups inner and persistent segments without adjacent outer guides", () => {
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
    const listsByGuide = new Map<
      unknown,
      ReturnType<typeof root.getListUnderLine>
    >();
    const branchAlpha = mapGuideLine(
      root,
      2,
      ["    ", "    "],
      listsByGuide,
    );
    const leafAlpha = mapGuideLine(
      root,
      3,
      ["    ", "    ", "    "],
      listsByGuide,
    );
    const branchBeta = mapGuideLine(
      root,
      4,
      ["    ", "    "],
      listsByGuide,
    );
    const leafBeta = mapGuideLine(
      root,
      5,
      ["    ", "    ", "    "],
      listsByGuide,
    );
    branchBeta.guides[1]?.classList.add(
      "bullet-plugin-persistent-indent-guide",
    );
    const guides = [
      ...branchAlpha.guides,
      ...leafAlpha.guides,
      ...branchBeta.guides,
      ...leafBeta.guides,
    ];

    expect(
      collectVerticalGuideGroup(
        leafAlpha.guides[1],
        guides,
        (guide) => listsByGuide.get(guide) ?? null,
      ),
    ).toEqual([
      branchAlpha.guides[1],
      leafAlpha.guides[1],
      branchBeta.guides[1],
      leafBeta.guides[1],
    ]);
  });

  test("returns no group for an unmatched guide", () => {
    const guide = makeGuideLine(["  "]).guides[0];

    expect(
      collectVerticalGuideGroup(guide, [guide], () => null),
    ).toEqual([]);
  });
});

describe("synchronizeHoveredIndentGuides", () => {
  test("replaces the previous logical group and clears it", () => {
    const stale = makeGuideElement([
      "cm-indent",
      "bullet-plugin-hovered-indent-guide",
    ]);
    const first = makeGuideElement(["cm-indent"]);
    const second = makeGuideElement([
      "cm-indent",
      "bullet-plugin-persistent-indent-guide",
    ]);
    const { contentDOM } = makeGuideDOM([stale, first, second]);

    synchronizeHoveredIndentGuides(contentDOM as never, [
      first as never,
      second as never,
    ]);

    expect(
      stale.classList.contains("bullet-plugin-hovered-indent-guide"),
    ).toBe(false);
    expect(
      first.classList.contains("bullet-plugin-hovered-indent-guide"),
    ).toBe(true);
    expect(
      second.classList.contains("bullet-plugin-hovered-indent-guide"),
    ).toBe(true);

    synchronizeHoveredIndentGuides(contentDOM as never, []);
    expect(
      first.classList.contains("bullet-plugin-hovered-indent-guide"),
    ).toBe(false);
    expect(
      second.classList.contains("bullet-plugin-hovered-indent-guide"),
    ).toBe(false);
  });
});
```

Update `makeGuideDOM` so its dynamic marker selector also recognizes `.bullet-plugin-hovered-indent-guide`:

```ts
if (selector === ".bullet-plugin-hovered-indent-guide") {
  return elements.filter((element) =>
    element.classList.contains("bullet-plugin-hovered-indent-guide"),
  );
}
```

- [ ] **Step 4: Run the focused suite and capture RED**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest --forceExit --runInBand \
  src/features/__tests__/VerticalLines.test.ts
```

Expected: FAIL because `collectVerticalGuideGroup` and `synchronizeHoveredIndentGuides` are not exported or implemented.

- [ ] **Step 5: Implement the pure semantic grouping and marker synchronizer**

Add constants in `VerticalLines.ts`:

```ts
const HOVERED_GUIDE_MARKER = "bullet-plugin-hovered-indent-guide";
const HOVERED_GUIDE_SELECTOR = `.${HOVERED_GUIDE_MARKER}`;
const RENDERED_GUIDE_CANDIDATE_SELECTOR =
  ".cm-hmd-list-indent > .cm-indent, " +
  ".cm-hmd-list-indent > .cm-indent-spacing";
```

Add after `resolveVerticalGuideTarget`:

```ts
function hasSameListStart(left: List, right: List) {
  const leftStart = left.getFirstLineContentStart();
  const rightStart = right.getFirstLineContentStart();
  return leftStart.line === rightStart.line && leftStart.ch === rightStart.ch;
}

export function collectVerticalGuideGroup(
  hoveredGuide: Element,
  guides: Iterable<Element>,
  getListForGuide: (guide: Element) => List | null,
): Element[] {
  const hoveredList = getListForGuide(hoveredGuide);
  const hoveredTarget = hoveredList
    ? resolveVerticalGuideTarget(hoveredList, hoveredGuide)
    : null;
  if (!hoveredTarget) {
    return [];
  }

  return Array.from(guides).filter((guide) => {
    const list = getListForGuide(guide);
    const target = list ? resolveVerticalGuideTarget(list, guide) : null;
    return target ? hasSameListStart(target, hoveredTarget) : false;
  });
}

export function synchronizeHoveredIndentGuides(
  contentDOM: ParentNode,
  highlightedGuides: Iterable<Element>,
) {
  const highlighted = new Set(highlightedGuides);
  contentDOM.querySelectorAll(HOVERED_GUIDE_SELECTOR).forEach((element) => {
    if (!highlighted.has(element)) {
      element.classList.remove(HOVERED_GUIDE_MARKER);
    }
  });
  highlighted.forEach((element) => {
    element.classList.add(HOVERED_GUIDE_MARKER);
  });
}
```

- [ ] **Step 6: Verify the pure helper GREEN**

Run the same focused Jest command.

Expected: the new grouping and marker tests pass; lifecycle tests may still need the next RED cycle, but no pre-existing test fails.

- [ ] **Step 7: Add failing pointer, update, settings, and destroy tests**

Extend the existing listener test to require capture-phase `pointermove`, `pointerleave`, and symmetrical removal:

```ts
expect(contentDOM.addEventListener).toHaveBeenCalledWith(
  "pointermove",
  expect.any(Function),
  true,
);
expect(contentDOM.addEventListener).toHaveBeenCalledWith(
  "pointerleave",
  expect.any(Function),
  true,
);
```

After `destroy()` add matching `removeEventListener` assertions and assert no `.bullet-plugin-hovered-indent-guide` remains.

Add an integration test using a dynamic `querySelector(".cm-indent:hover")`, dynamic candidate list, a real `makeRoot`, `view.posAtDOM` line mapping, and captured measurement requests. The test must:

1. execute the first measurement read/write and assert all current outer-A segments are marked while outer-B is not;
2. replace the current hovered guide and candidate elements with newly created inner-guide DOM;
3. call `pluginValue.update({})`, execute the next read/write, and assert every new inner segment is marked;
4. set `verticalLinesAction = "none"`, invoke the settings callback, execute the queued read/write, and assert every current marker is removed;
5. restore action, mark a group, invoke captured `pointerleave`, execute the queued measurement, and assert markers clear;
6. call `destroy()` and assert listeners and markers are removed synchronously.

Use the exact fixture texts from the pure grouping tests and keep `getEditorFromState` pointed at the same editor used by `makeRoot`. Do not mock `resolveVerticalGuideTarget` or target positions.

- [ ] **Step 8: Run lifecycle RED**

Run the focused Jest command.

Expected: FAIL because production does not register pointer listeners, measurement reads do not compute a group, and destroy does not clear hover markers.

- [ ] **Step 9: Integrate semantic hover reads with the measurement lifecycle**

Update imports to include `Root`:

```ts
import { List, Root } from "../root";
```

In `VerticalLinesPluginValue`:

```ts
private lastPointerGuide: Element | null = null;
```

Register after `mousedown`:

```ts
this.view.contentDOM.addEventListener("pointermove", this.onPointerMove, true);
this.view.contentDOM.addEventListener("pointerleave", this.onPointerLeave, true);
```

Add these methods:

```ts
private interactionEnabled() {
  return (
    this.settings.verticalLines &&
    this.settings.verticalLinesAction === "toggle-folding"
  );
}

private getLineForGuide(guide: Element): number | null {
  const lineElement = guide.closest(LINE_SELECTOR);
  if (!lineElement) {
    return null;
  }
  try {
    const offset = this.view.posAtDOM(lineElement);
    return this.view.state.doc.lineAt(offset).number - 1;
  } catch {
    return null;
  }
}

private getListForGuide(root: Root, guide: Element) {
  const line = this.getLineForGuide(guide);
  return line === null ? null : root.getListUnderLine(line);
}

private readHoveredGuideGroup(): Element[] {
  if (!this.interactionEnabled()) {
    return [];
  }
  const hoveredGuide = this.view.contentDOM.querySelector(
    `${INDENT_GUIDE_SELECTOR}:hover`,
  );
  if (!hoveredGuide) {
    return [];
  }
  const hoveredLine = this.getLineForGuide(hoveredGuide);
  const editor = getEditorFromState(this.view.state);
  if (hoveredLine === null || !editor) {
    return [];
  }
  const root = this.parser.parse(editor, { line: hoveredLine, ch: 0 });
  if (!root) {
    return [];
  }
  return collectVerticalGuideGroup(
    hoveredGuide,
    this.view.contentDOM.querySelectorAll(RENDERED_GUIDE_CANDIDATE_SELECTOR),
    (guide) => this.getListForGuide(root, guide),
  );
}

private onPointerMove = (event: PointerEvent) => {
  const guide =
    isElementLike(event.target) && event.target.matches(INDENT_GUIDE_SELECTOR)
      ? event.target
      : null;
  if (guide === this.lastPointerGuide) {
    return;
  }
  this.lastPointerGuide = guide;
  if (!guide) {
    synchronizeHoveredIndentGuides(this.view.contentDOM, []);
    return;
  }
  this.scheduleGuideSynchronization();
};

private onPointerLeave = () => {
  this.lastPointerGuide = null;
  synchronizeHoveredIndentGuides(this.view.contentDOM, []);
};
```

Change measurement requests to return the group from `read` and consume it in `write`:

```ts
this.view.requestMeasure({
  key: this.measureKey,
  read: () => this.readHoveredGuideGroup(),
  write: (highlightedGuides: Element[]) => {
    if (this.destroyed) {
      return;
    }
    synchronizePersistentIndentGuides(
      this.view.contentDOM,
      this.settings.verticalLines,
    );
    synchronizeHoveredIndentGuides(
      this.view.contentDOM,
      this.interactionEnabled() ? highlightedGuides : [],
    );
  },
});
```

On a disabling settings change, reset `lastPointerGuide` and call `synchronizeHoveredIndentGuides(contentDOM, [])` synchronously before scheduling persistent-guide synchronization. In `destroy()`, remove both pointer listeners and call `synchronizeHoveredIndentGuides(contentDOM, [])` before persistent cleanup.

- [ ] **Step 10: Run GREEN and static verification**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest --forceExit --runInBand \
  src/features/__tests__/VerticalLines.test.ts
npm run lint
npx tsc --noEmit
git diff --check
```

Expected: all focused tests pass; lint, TypeScript, and diff checks exit 0.

- [ ] **Step 11: Commit semantic grouping**

```bash
git add src/features/VerticalLines.ts src/features/__tests__/VerticalLines.test.ts
git commit \
  -m "feat(vertical-lines): group hovered guide segments" \
  -m $'Why:\n- Row-local hover feedback understates the list scope controlled by a guide click.\n- Unrelated lists can share the same indentation column, so grouping must use semantic target ownership.' \
  -m $'What:\n- Group rendered native guides by the exact list target returned by the click resolver.\n- Resynchronize marker classes across pointer movement, view updates, settings changes, and destroy.\n- Cover outer, inner, unrelated, persistent, replacement, and cleanup behavior.'
```

### Task 2: Style the Logical Guide Marker and Update Durable Guidance

**Files:**
- Modify: `src/features/__tests__/VerticalLines.test.ts:510-551`
- Modify: `styles.css:16-31`
- Modify: `AGENTS.md:25-27`

**Interfaces:**
- Consumes: `.bullet-plugin-hovered-indent-guide` from Task 1 and the existing action-state body class.
- Produces: active native border on every marked `.cm-indent::before` segment.
- Preserves: pointer cursor action gating, persistent-guide layout, and z-index rules.

- [ ] **Step 1: Replace the row-local CSS test with a failing marker contract**

Replace `"uses the native active guide style on only the hovered segment"` with:

```ts
test("uses the native active style on the complete marked logical guide", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
  const declarations = styles.match(
    /\.bullet-plugin-vertical-lines-action-toggle-folding\s+\.markdown-source-view\.mod-cm6\s+\.cm-hmd-list-indent\s+\.cm-indent\.bullet-plugin-hovered-indent-guide::before\s*\{([^}]*)\}/,
  )?.[1];

  expect(declarations?.replace(/\s+/g, " ").trim()).toBe(
    "border-inline-end: var(--indentation-guide-width-active) solid var(--indentation-guide-color-active);",
  );
  expect(styles).not.toMatch(/\.cm-indent:hover::before/);
});
```

- [ ] **Step 2: Run focused RED**

Run the focused VerticalLines Jest command.

Expected: FAIL because `styles.css` still uses `.cm-indent:hover::before` and has no logical marker selector.

- [ ] **Step 3: Replace row-local hover CSS with marker CSS**

Replace only the hover selector block with:

```css
.bullet-plugin-vertical-lines-action-toggle-folding
  .markdown-source-view.mod-cm6
  .cm-hmd-list-indent
  .cm-indent.bullet-plugin-hovered-indent-guide::before {
  border-inline-end: var(--indentation-guide-width-active) solid
    var(--indentation-guide-color-active);
}
```

Keep the action-scoped pointer rule and persistent-guide rules unchanged.

- [ ] **Step 4: Replace the hover guidance with logical ownership guidance**

Replace the current hover bullet in `AGENTS.md` with:

```md
- クリック可能な guide の hover feedback は、その行の fragment や同じ X 座標の全 guide ではなく、クリック時の exact raw-prefix resolver が同じ実リスト祖先へ対応付ける表示中の native segment 全体へ適用してください。toggle folding action が有効なときだけ plugin marker を付け、既存の native `.cm-indent::before` へ Obsidian の `--indentation-guide-width-active` と `--indentation-guide-color-active` を適用してください。CodeMirror の DOM 更新後は現在の `:hover` 要素から再同期し、pointer leave・action 無効化・ViewPlugin destroy 時に marker を除去してください。固定色、独自 geometry、overlay、座標 cache、背景 highlight、通常時の見た目変更は追加しないでください。
```

- [ ] **Step 5: Run GREEN and static checks**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest --forceExit --runInBand \
  src/features/__tests__/VerticalLines.test.ts
npm run lint
npx tsc --noEmit
git diff --check
```

Expected: focused tests and all static checks pass.

- [ ] **Step 6: Commit marker styling and guidance**

```bash
git add styles.css src/features/__tests__/VerticalLines.test.ts AGENTS.md
git commit \
  -m "feat(vertical-lines): style complete hovered guides" \
  -m $'Why:\n- Active feedback must represent the complete logical list scope rather than one rendered row fragment.\n- Durable guidance must prevent future X-coordinate grouping or overlay regressions.' \
  -m $'What:\n- Style the semantic hover marker with Obsidian active guide variables.\n- Remove the row-local hover selector and update its stylesheet contract.\n- Record logical ownership, resynchronization, and cleanup constraints.'
```

### Task 3: Verify Complete Logical Hover in Automation and Test Vault

**Files:**
- Create temporarily, then delete: `vault/logical-vertical-guide-hover-test.md`
- Modify: `docs/superpowers/plans/2026-07-14-logical-vertical-guide-hover-feedback.md`

**Interfaces:**
- Consumes: Task 1 semantic markers and Task 2 native active styling.
- Produces: automated evidence, guarded Obsidian evidence, clean production artifacts, and an execution record ready for final review.

- [ ] **Step 1: Run the full automated pipeline**

```bash
npm run lint
npx tsc --noEmit
npm run build-with-tests
npm test -- --runInBand
npm run build
```

Expected: every command exits 0 and no Jest suite or test fails.

- [ ] **Step 2: Install production artifacts only into the repository test vault**

```bash
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
shasum -a 256 \
  dist/main.js manifest.json styles.css \
  vault/.obsidian/plugins/bullet/main.js \
  vault/.obsidian/plugins/bullet/manifest.json \
  vault/.obsidian/plugins/bullet/styles.css
```

Expected: each source/install pair matches exactly.

- [ ] **Step 3: Create the isolated two-tree fixture**

Use `apply_patch` to create `vault/logical-vertical-guide-hover-test.md`:

```md
- parent A
    - child A
        - branch alpha
            - leaf alpha
        - branch beta
            - leaf beta
    - outer sibling A
        - outer leaf A
- parent B
    - child B
        - branch gamma
            - leaf gamma
        - branch delta
            - leaf delta
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
```

- [ ] **Step 4: Open and reload only `vault`**

If needed, bootstrap only:

```bash
open 'obsidian://open?vault=vault&file=logical-vertical-guide-hover-test'
```

Then:

```bash
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli \
  vault=vault open path=logical-vertical-guide-hover-test.md
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli \
  vault=vault plugin:reload id=bullet
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli \
  vault=vault eval code='document.title'
```

Expected exact title: `logical-vertical-guide-hover-test - vault - Obsidian 1.13.1`. Stop all UI actions on any title containing `base` or not identifying this fixture and `vault`.

- [ ] **Step 5: Verify outer full-guide grouping and unrelated-tree isolation**

Before every Computer Use action, run the mandatory focus command and acquire fresh full state. Use vault-scoped read-only DOM evaluation to rediscover current guide rectangles and marker state.

Hover an outer guide segment belonging to `parent A`. Confirm:

- at least two visible segments receive `.bullet-plugin-hovered-indent-guide`;
- every marked segment resolves to `parent A` through its raw boundary;
- the corresponding outer guide segments under `parent B`, despite the same indentation column, remain unmarked;
- marked pseudo-elements use the active computed border and unmarked parent-B segments retain the normal computed border.

Move away with a newly guarded action and confirm marker count returns to 0.

- [ ] **Step 6: Verify inner full-guide grouping, click behavior, and update resynchronization**

Hover the child-A inner guide. Confirm all visible segments resolving to `child A` are marked while adjacent parent-A outer segments are unmarked.

With fresh guards:

1. click the highlighted inner guide and confirm only `leaf alpha` / `leaf beta` hide while `outer sibling A` and all of parent B remain visible;
2. keep or return the pointer over the surviving child-A guide and confirm the current rendered group is marked after the fold DOM update;
3. click again and confirm both leaves reopen;
4. scroll down and back up with fresh guards and confirm newly rendered child-A segments rejoin the group without overlay elements or alignment drift.

- [ ] **Step 7: Verify action gating and cleanup behavior**

Use the in-memory plugin setting only:

```bash
/Applications/Obsidian.app/Contents/MacOS/obsidian-cli vault=vault eval code='(() => { const plugin = app.plugins.plugins.bullet; if (!plugin) return { error: "plugin-not-found" }; plugin.settings.verticalLinesAction = "none"; return { displayClass: document.body.classList.contains("bullet-plugin-vertical-lines"), actionClass: document.body.classList.contains("bullet-plugin-vertical-lines-action-toggle-folding"), markerCount: document.querySelectorAll(".bullet-plugin-hovered-indent-guide").length }; })()'
```

Expected: display class true, action class false, marker count 0. Restore `toggle-folding` with the same vault-scoped plugin object and confirm the action class returns.

Confirm no legacy overlay selector exists.

- [ ] **Step 8: Remove temporary state and restore production artifacts**

Restore the action setting, remove test-only DOM metadata, delete the fixture with `apply_patch`, rebuild production, reinstall, and verify:

```bash
npm run build
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
test ! -e vault/logical-vertical-guide-hover-test.md
shasum -a 256 \
  dist/main.js manifest.json styles.css \
  vault/.obsidian/plugins/bullet/main.js \
  vault/.obsidian/plugins/bullet/manifest.json \
  vault/.obsidian/plugins/bullet/styles.css
git diff --check
git status --short --branch
```

Expected: fixture and markers are absent, action is restored, source/install pairs match, and only the execution-record edit remains uncommitted.

- [ ] **Step 9: Record evidence and commit without pushing**

Record exact test counts, hashes, title guards, outer/inner marker counts, target identities, normal/active computed borders, fold/reopen results, scroll resynchronization, action gating, overlay absence, and cleanup in this plan. Mark completed steps accurately.

Run fresh focused verification:

```bash
SKIP_OBSIDIAN=1 npx jest --forceExit --runInBand \
  src/features/__tests__/VerticalLines.test.ts
npm run lint
npx tsc --noEmit
git diff --check
```

Commit:

```bash
git add docs/superpowers/plans/2026-07-14-logical-vertical-guide-hover-feedback.md
git commit \
  -m "docs: record logical guide hover verification" \
  -m $'Why:\n- Full logical-guide feedback requires reproducible semantic and live rendering evidence.\n- Test-vault isolation, DOM-update synchronization, and final artifact state must remain auditable.' \
  -m $'What:\n- Record automated counts, target-specific marker groups, computed styles, fold behavior, and scrolling.\n- Record action gating, overlay absence, cleanup, production hashes, and final checks.'
```

Do not push. The controller must run task review, a fresh whole-branch review, final verification, `git fetch`, `git pull --ff-only`, and only then `git push origin main`.
