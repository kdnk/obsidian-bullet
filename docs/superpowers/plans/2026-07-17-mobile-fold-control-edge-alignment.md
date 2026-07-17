# Mobile Fold Control Edge Alignment Implementation Plan

> **Superseded:** The 48px, `-35px`, and 13px geometry in this plan was replaced by the [heading-mirror implementation plan](./2026-07-17-mobile-fold-control-heading-mirror.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the mobile list chevron and its 48px-wide native target outward so the icon mirrors the native left-side header chevron while preserving row-scoped hit testing.

**Architecture:** Keep the existing native `.collapse-indicator`, selector specificity, folding events, and scroll anchoring. Change only the inline geometry: move the 48px target 35px beyond the list line, reserve the 13px that remains inside the line, and update the behavioral documentation and regression checks.

**Tech Stack:** CSS, TypeScript 5.9, Jest 30, Obsidian 1.13 mobile emulation, GitButler CLI.

## Global Constraints

- The accepted design is `docs/superpowers/specs/2026-07-17-mobile-fold-control-edge-alignment-design.md`.
- Use GitButler for every version-control write.
- Commit implementation work to `codex/mobile-fold-control-edge-alignment`.
- Keep the native control width at `48px`.
- Keep the native control height at `100%` of its list row; do not create a 48px-square target.
- Set the native control to `inset-inline-end: -35px`.
- Set foldable list rows to `padding-inline-end: 13px`.
- Keep the native control's own `padding-inline-end: 0`.
- Keep the existing high-specificity Live Preview list selector.
- Do not translate only the SVG or add an icon-only positioning rule.
- Do not change native pointer events, fold transactions, scroll snapshots, collapsed rotation, desktop, Reading view, or heading controls.
- Run source Jest tests with `SKIP_OBSIDIAN=1` or `npm run test:unit`.
- Run `npm run build-with-tests` before the full Jest suite.
- Back up `vault/test.md` outside the vault before the full suite, wait for the `vault=vault` renderer to exit, restore the fixture, and verify its hash after a delay.
- Use only the repository `vault` for manual Obsidian verification.
- Run mobile verification with `app.emulateMobile(true)`, a 390×844 viewport, DPR 3, touch emulation, and `pointerType="touch"` input.
- Do not change version fields.

---

## File Map

- Modify `src/features/__tests__/MobileRightFoldControls.test.ts`: lock the 13px row reserve and -35px control offset.
- Modify `styles.css`: move the complete native target outward and return the unused row width to text.
- Modify `docs/superpowers/specs/2026-07-16-mobile-right-fold-controls-design.md`: make the original feature specification match the revised geometry.
- Modify `docs/superpowers/plans/2026-07-16-mobile-right-fold-controls.md`: mark its original geometry steps as superseded.
- Modify `AGENTS.md`: replace the obsolete zero-gap verification rule with the new measured geometry.

---

### Task 1: Change and document the CSS geometry

**Files:**

- Modify: `src/features/__tests__/MobileRightFoldControls.test.ts`
- Modify: `styles.css`
- Modify: `docs/superpowers/specs/2026-07-16-mobile-right-fold-controls-design.md`
- Modify: `docs/superpowers/plans/2026-07-16-mobile-right-fold-controls.md`
- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: the existing `.bullet-plugin-mobile-right-fold-controls` body class and native `.collapse-indicator`.
- Produces: a 48px-wide, row-height target whose center is 11px outside the list line.
- Produces: a 13px inline-end row reserve that ends exactly where the shifted target begins.

- [x] **Step 1: Write the failing CSS contract**

Replace the existing CSS contract test with:

```ts
test("mirrors native mobile list fold controls beyond the right edge", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
  const rowDeclarations = styles.match(
    /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\s+\.HyperMD-list-line:has\(\.cm-fold-indicator\)\s*\{([^}]*)\}/,
  )?.[1];
  const parentDeclarations = styles.match(
    /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\s+\.HyperMD-list-line\s+\.cm-fold-indicator\s*\{([^}]*)\}/,
  )?.[1];
  const controlDeclarations = styles.match(
    /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-list-line:has\(\.cm-fold-indicator\)\s+\.cm-fold-indicator\s+\.collapse-indicator\s*\{([^}]*)\}/,
  )?.[1];
  const collapsedDeclarations = styles.match(
    /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\s+\.HyperMD-list-line\s+\.cm-fold-indicator\.is-collapsed\s+\.collapse-indicator\s+svg\.svg-icon\s*\{([^}]*)\}/,
  )?.[1];

  expect(rowDeclarations).toContain("box-sizing: border-box;");
  expect(rowDeclarations).toContain("padding-inline-end: 13px;");
  expect(parentDeclarations).toContain("position: static;");
  expect(controlDeclarations).toContain("display: flex;");
  expect(controlDeclarations).toContain("align-items: center;");
  expect(controlDeclarations).toContain("justify-content: center;");
  expect(controlDeclarations).toContain("top: 0;");
  expect(controlDeclarations).toContain("inset-inline-end: -35px;");
  expect(controlDeclarations).toContain("width: 48px;");
  expect(controlDeclarations).toContain("height: 100%;");
  expect(controlDeclarations).toContain("padding-inline-end: 0;");
  expect(controlDeclarations).not.toContain("translate");
  expect(controlDeclarations).toContain("opacity: 1;");
  expect(controlDeclarations).toContain("visibility: visible;");
  expect(controlDeclarations).toContain("pointer-events: auto;");
  expect(controlDeclarations).toContain("z-index: 2;");
  expect(collapsedDeclarations).toContain("transform: rotate(90deg);");
  expect(styles).not.toMatch(
    /\.bullet-plugin-mobile-right-fold-controls[^{]*\.markdown-preview-view/,
  );
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest \
  src/features/__tests__/MobileRightFoldControls.test.ts \
  --runInBand
```

Expected: FAIL because the stylesheet still contains `padding-inline-end: 48px` and `inset-inline-end: 0`.

- [x] **Step 3: Implement the minimal CSS change**

Change only these declarations in `styles.css`:

```css
.bullet-plugin-mobile-right-fold-controls
  .markdown-source-view.mod-cm6
  .HyperMD-list-line:has(.cm-fold-indicator) {
  box-sizing: border-box;
  padding-inline-end: 13px;
}

.bullet-plugin-mobile-right-fold-controls
  .markdown-source-view.mod-cm6.is-live-preview
  .cm-line.HyperMD-list-line:has(.cm-fold-indicator)
  .cm-fold-indicator
  .collapse-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  top: 0;
  inset-inline-end: -35px;
  width: 48px;
  height: 100%;
  padding-inline-end: 0;
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  z-index: 2;
}
```

- [x] **Step 4: Update the durable documentation**

In `docs/superpowers/specs/2026-07-16-mobile-right-fold-controls-design.md`, replace the geometry paragraphs with:

```markdown
コントロールの横幅は48pxとし、行の高さ全体をタップ領域にする。

48px幅のコントロール全体をリスト行右端から35px外側へ出し、中心のシェブロンを右端から11px外側へ置く。

この位置は、内容領域左端から約11px外側にあるPropertiesなどのnativeシェブロンを左右反転した位置である。

コントロールのうち行内に残る13pxだけを本文の右側余白として確保し、長い本文と操作領域が重ならないようにする。
```

Replace its CSS implementation paragraph with:

```markdown
`.cm-line`はObsidianが`position: relative`にしているため、`.cm-fold-indicator`を`position: static`へ変更し、内側のnative `.collapse-indicator`を`inset-inline-end: -35px`で配置する。
```

Replace the CSS test wording with:

```markdown
CSS contract testでは、Live Previewのlist lineだけを対象にすること、native indicatorを行の右端から35px外側へ配置すること、48pxの操作領域と13pxの本文余白を確保すること、折りたたみ中を左向きにすること、縦線機能の非表示指定を上書きすることを確認する。
```

Add this note immediately below the title of `docs/superpowers/plans/2026-07-16-mobile-right-fold-controls.md`:

```markdown
> **Geometry revision:** The final positioning requirements are superseded by `docs/superpowers/specs/2026-07-17-mobile-fold-control-edge-alignment-design.md` and `docs/superpowers/plans/2026-07-17-mobile-fold-control-edge-alignment.md`. Historical 48px row padding and zero-inset snippets below describe the original implementation, not the current target geometry.
```

Replace the first mobile-control rule in `AGENTS.md` with:

```markdown
    - Obsidian 1.13 系の Live Preview は、非activeかつ非taskのリスト行に対して詳細度の高いselectorでnative `.collapse-indicator`へ `padding-inline-end: var(--list-bullet-end-padding)` と負の `inset-inline-end` を適用します。右側へ移動するときは `.markdown-source-view.mod-cm6.is-live-preview .cm-line.HyperMD-list-line` まで対象を限定し、同等以上の詳細度でnativeの`padding-inline-end`を0へ戻してください。48px幅の操作領域全体を`inset-inline-end: -35px`で移動し、行の`padding-inline-end`は行内に残る13pxにしてください。検証ではcontrol右端がlist行右端から35px外側、control左端が13px内側、シェブロン中心が約11px外側にあることを実座標で確認してください。
```

- [x] **Step 5: Run focused static verification**

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
  docs/superpowers/plans/2026-07-16-mobile-right-fold-controls.md \
  docs/superpowers/plans/2026-07-17-mobile-fold-control-edge-alignment.md
npx prettier --check AGENTS.md --tab-width 4
npm run lint
npx tsc --noEmit
```

Expected: every command exits 0.

---

### Task 2: Verify the real geometry and land the branch

**Files:**

- Verify: `styles.css`
- Verify: `src/features/__tests__/MobileRightFoldControls.test.ts`
- Verify: `vault/.obsidian/plugins/bullet/`
- Verify: `vault/mobile-fold-control-edge-alignment.md`

**Interfaces:**

- Consumes: the CSS contract from Task 1.
- Produces: measured native geometry, touch interaction evidence, and a landed GitButler branch.

- [x] **Step 1: Run the complete automated verification**

Run:

```bash
npm run test:unit -- --runInBand
npm run lint
npx tsc --noEmit
npm run build-with-tests
```

Expected: every command exits 0 and `dist/main.js` contains the test build.

- [x] **Step 2: Back up the full-test fixture**

Run:

```bash
backup_dir=$(mktemp -d /tmp/obsidian-bullet-mobile-edge.XXXXXX)
cp vault/test.md "$backup_dir/test.md"
backup_hash=$(shasum -a 256 "$backup_dir/test.md" | awk '{print $1}')
echo "$backup_dir"
echo "$backup_hash"
```

Expected: the command prints a backup directory outside the vault and one SHA-256 hash.

- [x] **Step 3: Run the full suite and production build**

Run:

```bash
npm test -- --runInBand
npm run build
```

Expected: the full Jest suite and production Rollup build exit 0.

- [x] **Step 4: Restore the fixture safely**

Run:

```bash
for i in {1..30}; do
  if ! obsidian-cli vault=vault eval code='document.title' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
cp "$backup_dir/test.md" vault/test.md
sleep 2
restored_hash=$(shasum -a 256 vault/test.md | awk '{print $1}')
test "$backup_hash" = "$restored_hash"
```

Expected: the command exits 0 after the renderer stops and the restored hash matches the backup.

- [x] **Step 5: Install the production plugin and create the fixture**

Run:

```bash
mkdir -p vault/.obsidian/plugins/bullet
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
obsidian-cli vault=vault create \
  path=mobile-fold-control-edge-alignment.md \
  content='---\nstatus: test\n---\n\n- parent\n  - child one\n  - child two\n\n- second parent with a long line that verifies text wrapping beside the shifted native fold control\n  - second child\n' \
  overwrite \
  open
obsidian-cli vault=vault eval code='window.focus(); document.title'
```

Expected: the title contains `mobile-fold-control-edge-alignment - vault` and does not contain `base`.

- [x] **Step 6: Enable real mobile emulation**

Run:

```bash
obsidian-cli vault=vault eval code='app.emulateMobile(true); window.focus(); document.title'
obsidian-cli vault=vault plugin:reload id=bullet
obsidian-cli vault=vault eval code='window.focus(); JSON.stringify({title:document.title, plugin:app.plugins.enabledPlugins.has("bullet"), mobile:document.body.classList.contains("is-mobile"), phone:document.body.classList.contains("is-phone"), feature:document.body.classList.contains("bullet-plugin-mobile-right-fold-controls")})'
```

Expected: the title contains `vault` and not `base`; `plugin`, `mobile`, `phone`, and `feature` are `true`.

Use the Obsidian DevTools Device Toolbar to set:

```text
Viewport: 390 × 844
Device pixel ratio: 3
Touch: enabled
Maximum touch points: 5
```

Before every UI action, run:

```bash
obsidian-cli vault=vault eval code='window.focus(); document.title'
```

Stop if the fresh title does not contain `vault` or contains `base`.

- [x] **Step 7: Measure the mirrored geometry**

Run:

```bash
obsidian-cli vault=vault eval code='(()=>{const control=document.querySelector(".HyperMD-list-line .cm-fold-indicator .collapse-indicator");const line=control?.closest(".HyperMD-list-line");const icon=control?.querySelector("svg");const header=document.querySelector(".metadata-properties-heading .collapse-indicator");const heading=header?.closest(".metadata-properties-heading");const headerIcon=header?.querySelector("svg");if(!control||!line||!icon||!header||!heading||!headerIcon)return JSON.stringify({title:document.title,error:"required-elements-not-found"});const cr=control.getBoundingClientRect();const lr=line.getBoundingClientRect();const ir=icon.getBoundingClientRect();const hr=heading.getBoundingClientRect();const hir=headerIcon.getBoundingClientRect();const listIconOutside=(ir.left+ir.right)/2-lr.right;const headerIconOutside=hr.left-(hir.left+hir.right)/2;return JSON.stringify({title:document.title,width:cr.width,height:cr.height,lineHeight:lr.height,rightOutside:cr.right-lr.right,leftInside:lr.right-cr.left,listIconOutside,headerIconOutside,symmetryError:Math.abs(listIconOutside-headerIconOutside),paddingInlineEnd:getComputedStyle(line).paddingInlineEnd,visibility:getComputedStyle(control).visibility,pointerEvents:getComputedStyle(control).pointerEvents})})()'
```

Expected:

- `width` is approximately `48`;
- `height` equals `lineHeight`;
- `rightOutside` is approximately `35`;
- `leftInside` is approximately `13`;
- `listIconOutside` is approximately `11`;
- `headerIconOutside` is approximately `11`;
- `symmetryError` is at most `1`;
- `paddingInlineEnd` is `13px`;
- `visibility` is `visible`;
- `pointerEvents` is `auto`.

- [x] **Step 8: Verify touch folding and scroll anchoring**

For each viewport-top offset below, position a foldable row at that screen Y coordinate, record its bounding-rect top and the editor `scrollTop`, then tap the visible chevron through touch emulation:

```text
100px
160px
400px
```

Use a complete touch tap sequence:

```text
pointerdown (pointerType="touch")
pointerup (pointerType="touch")
click
```

After each fold and unfold, measure the same row again.

Expected for all six interactions:

```text
deltaTop = 0
deltaScroll = 0
```

Also confirm that tapping the visible chevron toggles its own row and never an adjacent row.

- [ ] **Step 9: Commit the verified implementation**

Run:

```bash
but diff
but commit codex/mobile-fold-control-edge-alignment -m $'fix(mobile): align fold controls with the outer edge\n\nWhy:\n- The 48px right-side target left its chevron visibly inset from the mobile edge.\n- Moving only the icon would separate the visual control from its hit target.\n\nWhat:\n- Shift the complete native fold target 35px beyond the list line.\n- Reserve only the 13px of the target that remains inside the row.\n- Update the CSS contract and durable geometry documentation.'
```

Expected: GitButler creates the commit on `codex/mobile-fold-control-edge-alignment` and reports no uncommitted changes.

- [ ] **Step 10: Land the verified branch**

Run:

```bash
but pull --check
but pull
but status
but land od --yes
```

Expected: upstream is current, branch ID `od` identifies `codex/mobile-fold-control-edge-alignment`, and GitButler lands it onto the target branch without a pull request.
