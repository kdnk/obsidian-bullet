# Mobile Fold Control First-Line Alignment Implementation Plan

> **Superseded:** The 48px, `-35px`, and 13px geometry in this plan was replaced by the [heading-mirror implementation plan](./2026-07-17-mobile-fold-control-heading-mirror.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep mobile fold chevrons and their touch targets on the first visual line while preserving identical text wrapping for list rows with and without children.

**Architecture:** Keep the native `.collapse-indicator`, its 48px inline target, right-edge offset, fold transaction, and scroll anchoring. Override Obsidian's full-row `height: 100%` with one line height plus the row's block spacing, and move the 13px text reserve from foldable rows to every mobile Live Preview list row.

**Tech Stack:** CSS, TypeScript/Jest CSS contract tests, Obsidian 1.13.2, Obsidian CLI, Chrome DevTools Protocol, GitButler CLI.

## Global Constraints

- Use `but` for every version-control write.
- Work on `codex/mobile-fold-control-first-line`.
- Keep `width: 48px` and `inset-inline-end: -35px`.
- Set the right-side `.collapse-indicator` height to `calc(1lh + var(--list-spacing, 0px) + var(--list-spacing, 0px))`.
- Do not translate the chevron SVG independently from its touch target.
- Apply `padding-inline-end: 13px` to every mobile Live Preview list row.
- Do not change native fold transactions or the existing scroll snapshot correction.
- Run direct `src` Jest commands with `SKIP_OBSIDIAN=1`.
- Back up `vault/test.md` outside the vault before the full test suite.
- Use only the repository `vault` and plugin ID `bullet` for manual verification.
- Run mobile verification with `app.emulateMobile(true)`, a 390×844 viewport, DPR 3, touch emulation, and `pointerType="touch"`.

---

### Task 1: Lock the first-line geometry with a failing CSS contract

**Files:**

- Modify: `src/features/__tests__/MobileRightFoldControls.test.ts`

**Interfaces:**

- Consumes: the existing CSS contract test for `.bullet-plugin-mobile-right-fold-controls`.
- Produces: regression assertions for uniform row width and native target height.

- [x] **Step 1: Change the row selector contract**

Replace the current `rowDeclarations` lookup with:

```ts
const rowDeclarations = styles.match(
  /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-list-line\s*\{([^}]*)\}/,
)?.[1];
```

- [x] **Step 2: Add the non-foldable width assertion**

Keep the existing `padding-inline-end: 13px` assertion and add:

```ts
expect(styles).not.toMatch(
  /\.bullet-plugin-mobile-right-fold-controls[^{]*\.HyperMD-list-line:has\(\.cm-fold-indicator\)\s*\{[^}]*padding-inline-end/,
);
```

- [x] **Step 3: Replace the full-height expectation**

Replace:

```ts
expect(controlDeclarations).toContain("height: 100%;");
```

with:

```ts
expect(controlDeclarations).toMatch(
  /height:\s*calc\(\s*1lh\s*\+\s*var\(--list-spacing,\s*0px\)\s*\+\s*var\(--list-spacing,\s*0px\)\s*\);/,
);
expect(controlDeclarations).not.toContain("height: 100%;");
```

Keep:

```ts
expect(controlDeclarations).not.toContain("translate");
```

- [x] **Step 4: Run the focused test and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest src/features/__tests__/MobileRightFoldControls.test.ts --runInBand
```

Expected: FAIL because the stylesheet still limits the row reserve to `:has(.cm-fold-indicator)` and still contains `height: 100%`.

---

### Task 2: Limit the target to the first line and stabilize text width

**Files:**

- Modify: `styles.css`
- Modify: `docs/superpowers/specs/2026-07-16-mobile-right-fold-controls-design.md`
- Modify: `docs/superpowers/specs/2026-07-17-mobile-fold-control-edge-alignment-design.md`
- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: the failing CSS contract from Task 1.
- Produces: a 48px-wide first-line target and a stable 13px reserve on every list row.

- [x] **Step 1: Apply the reserve to every Live Preview list row**

Replace:

```css
.bullet-plugin-mobile-right-fold-controls
  .markdown-source-view.mod-cm6
  .HyperMD-list-line:has(.cm-fold-indicator) {
  box-sizing: border-box;
  padding-inline-end: 13px;
}
```

with:

```css
.bullet-plugin-mobile-right-fold-controls
  .markdown-source-view.mod-cm6.is-live-preview
  .cm-line.HyperMD-list-line {
  box-sizing: border-box;
  padding-inline-end: 13px;
}
```

- [x] **Step 2: Limit the target to the first-line box**

Replace this declaration in the right-side `.collapse-indicator` rule:

```css
height: 100%;
```

with:

```css
height: calc(1lh + var(--list-spacing, 0px) + var(--list-spacing, 0px));
```

Do not add another block-axis inset, margin, transform, or icon-specific offset.

- [x] **Step 3: Run the focused test and verify GREEN**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest src/features/__tests__/MobileRightFoldControls.test.ts --runInBand
```

Expected: 7 tests pass.

- [x] **Step 4: Update the durable design documents**

Record these requirements in both existing mobile control specifications:

- the 13px reserve applies to every Live Preview list row;
- fold indicator appearance must not change a parent row's text width;
- the plugin must override native `height: 100%` with one line height plus both list-spacing paddings;
- the chevron and touch target remain together on the first visual line;
- tapping below the first-line target must not fold the row.

- [x] **Step 5: Update the agent instruction**

Extend the first mobile-control bullet in `AGENTS.md` with:

```text
本文幅を子要素の有無で変えないため、13pxの`padding-inline-end`はfold indicatorのある行だけでなく、機能が有効なLive Previewの全リスト行へ適用してください。折り返し行ではnative controlの`height: 100%`を1行分のline heightと上下のlist spacingを足した高さで上書きし、シェブロンと操作領域を1行目へ揃えてください。
```

- [x] **Step 6: Run focused static verification**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest \
  src/features/__tests__/MobileRightFoldControls.test.ts \
  src/features/__tests__/GuideFolding.test.ts \
  --runInBand
npx prettier --check \
  styles.css \
  src/features/__tests__/MobileRightFoldControls.test.ts \
  docs/superpowers/specs/2026-07-16-mobile-right-fold-controls-design.md \
  docs/superpowers/specs/2026-07-17-mobile-fold-control-edge-alignment-design.md \
  docs/superpowers/specs/2026-07-17-mobile-fold-control-first-line-alignment-design.md \
  docs/superpowers/plans/2026-07-17-mobile-fold-control-first-line-alignment.md
npx prettier --check AGENTS.md --tab-width 4
npm run lint
npx tsc --noEmit
```

Expected: every command exits 0.

---

### Task 3: Verify the behavior in real Obsidian

**Files:**

- Test fixture: `vault/mobile-fold-control-first-line.md`
- Protected fixture: `vault/test.md`

**Interfaces:**

- Consumes: the CSS contract from Task 2.
- Produces: measured geometry, text wrapping, touch targeting, and scroll anchoring evidence.

- [x] **Step 1: Run the complete automated verification**

Run:

```bash
npm run test:unit -- --runInBand
npm run lint
npx tsc --noEmit
npm run build-with-tests
```

Expected: every command exits 0.

- [x] **Step 2: Back up the full-test fixture**

Run:

```bash
backup_dir=$(mktemp -d /tmp/obsidian-bullet-mobile-first-line.XXXXXX)
cp vault/test.md "$backup_dir/test.md"
shasum -a 256 "$backup_dir/test.md"
```

Record the directory and SHA-256.

- [x] **Step 3: Run the full suite and production build**

Run:

```bash
npm test -- --runInBand
npm run build
```

Expected: the full Jest suite and production build exit 0.

- [x] **Step 4: Restore the fixture safely**

Wait until no `vault=vault` test renderer remains, restore the backup, wait briefly, and verify that the restored SHA-256 matches Step 2.

- [x] **Step 5: Install the production plugin and create the manual fixture**

Copy `dist/main.js`, `manifest.json`, and `styles.css` to `vault/.obsidian/plugins/bullet/`.

Create `vault/mobile-fold-control-first-line.md` with two identical long parent items:

```markdown
- This deliberately long parent item wraps across multiple visual lines on a narrow mobile viewport so its fold control and text width can be measured.
  - child
- This deliberately long parent item wraps across multiple visual lines on a narrow mobile viewport so its fold control and text width can be measured.
```

- [x] **Step 6: Enable real mobile and touch emulation**

Open only the repository `vault`.
Before every UI action, confirm that the fresh title contains `vault` and does not contain `base`.

Apply:

- `app.emulateMobile(true)`
- viewport 390×844
- device scale factor 3
- touch emulation with five touch points

- [x] **Step 7: Measure first-line geometry and stable wrapping**

For the foldable and non-foldable parent rows, record:

- computed `padding-inline-end`;
- row width and height;
- text content rectangle width and height;
- line count or identical final text fragment position.

For the foldable row, record:

- control width and height;
- row height;
- control top minus row top;
- icon center minus row top;
- computed control height and `--list-spacing`.

Expected:

- both parent rows have `padding-inline-end: 13px`;
- both parent rows wrap identically;
- control width is 48px;
- control height equals `1lh + 2 × --list-spacing` and is smaller than a wrapped row's height;
- the control begins on the first visual line;
- the icon center matches the first-line text center within one physical pixel.

- [x] **Step 8: Verify the touch boundary**

Dispatch a real touch sequence inside the visible chevron:

```text
pointerdown → pointerup → click
```

Expected: the row folds.

Unfold it, then dispatch the same sequence at the same X coordinate but below the first-line control and still inside the wrapped row.

Expected: the row does not fold.

- [x] **Step 9: Re-run scroll anchoring checks**

At viewport-top offsets 100px, 160px, and 400px, fold and unfold through the visible chevron.

Expected for every operation:

- clicked row screen-Y delta is 0;
- editor `scrollTop` delta is 0;
- the event sequence uses `pointerType="touch"`.

- [x] **Step 10: Clean up manual state**

Delete `vault/mobile-fold-control-first-line.md`, call `app.emulateMobile(false)`, clear device metrics and touch emulation, and verify that `vault/test.md` still matches the backup hash.

---

### Task 4: Commit and land

**Files:**

- Commit all intended Task 1 and Task 2 changes.

**Interfaces:**

- Consumes: passing automated and manual verification.
- Produces: a landed GitButler branch on `origin/main`.

- [ ] **Step 1: Commit the implementation**

Inspect with:

```bash
but diff
```

Commit the intended files to `codex/mobile-fold-control-first-line` with an English Conventional Commit message containing Why and What sections.

- [ ] **Step 2: Synchronize upstream**

Run:

```bash
but pull --check
but pull
```

If upstream changes, rerun the affected verification before landing.

- [ ] **Step 3: Land the branch**

Read the current branch ID from:

```bash
but status
```

Then run:

```bash
but land <branch-id> --yes
```

- [ ] **Step 4: Confirm the final workspace state**

Run:

```bash
but status -fv
```

Expected: no uncommitted changes and the implementation commit is the common base.
