# Mobile Heading Right Fold Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move native heading fold controls to the same right edge as list fold controls in mobile Live Preview.

**Architecture:** Reuse the existing mobile-only body class and preserve Obsidian's native heading control and fold transaction. Add heading-specific CSS that makes the fold-indicator parent static, places the 15px control outside the heading line's right edge, limits its height to the first line, and mirrors the collapsed direction toward the heading text.

**Tech Stack:** CSS, Jest, TypeScript 5.9, Obsidian 1.13.2 Live Preview, GitButler CLI

## Global Constraints

- Use GitButler for every version-control write; do not use Git write commands.
- Run Node.js commands with Node 22.23.1.
- Scope the change to `.bullet-plugin-mobile-right-fold-controls .markdown-source-view.mod-cm6.is-live-preview .cm-line.HyperMD-header`.
- Reuse the native `.cm-fold-indicator .collapse-indicator`; do not add DOM, overlays, click handlers, or fold transactions.
- Keep the control width at 15px with a 10px SVG and a 5px text-side gap.
- Keep wrapped heading controls on the first line with `height: 1lh`.
- Do not add heading padding, editor overflow clipping, transforms on the control box, or manual scroll correction.
- Preserve the existing list-control geometry and behavior.
- Run source Jest tests with `SKIP_OBSIDIAN=1` or `npm run test:unit`.
- Back up `vault/test.md` outside the vault before full tests, wait for the `vault=vault` renderer to exit, restore the fixture, and verify its hash after a delay.
- Use only the repository `vault` for real Obsidian verification.

---

### Task 1: Encode and implement the heading control geometry

**Files:**

- Modify: `src/features/__tests__/MobileRightFoldControls.test.ts`
- Modify: `styles.css`
- Modify: `docs/superpowers/specs/2026-07-16-mobile-right-fold-controls-design.md`
- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: the `bullet-plugin-mobile-right-fold-controls` body class managed by `MobileRightFoldControls` and Obsidian's native `.cm-fold-indicator .collapse-indicator` DOM.
- Produces: a CSS-only 15px heading control at the mobile Live Preview right edge with a first-line-height pointer target.

- [ ] **Step 1: Write the failing CSS contract**

Add this test after the existing mobile list CSS contract in `src/features/__tests__/MobileRightFoldControls.test.ts`:

```ts
test("moves native mobile heading fold controls to the right edge", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
  const parentDeclarations = styles.match(
    /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\s+\.HyperMD-header\s+\.cm-fold-indicator\s*\{([^}]*)\}/,
  )?.[1];
  const controlDeclarations = styles.match(
    /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-header:has\(\.cm-fold-indicator\)\s+\.cm-fold-indicator\s+\.collapse-indicator\s*\{([^}]*)\}/,
  )?.[1];
  const collapsedDeclarations = styles.match(
    /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\s+\.HyperMD-header\s+\.cm-fold-indicator\.is-collapsed\s+\.collapse-indicator\s+svg\.svg-icon\s*\{([^}]*)\}/,
  )?.[1];

  expect(parentDeclarations).toContain("position: static;");
  expect(controlDeclarations).toContain("display: flex;");
  expect(controlDeclarations).toContain("box-sizing: border-box;");
  expect(controlDeclarations).toContain("align-items: center;");
  expect(controlDeclarations).toContain("justify-content: flex-start;");
  expect(controlDeclarations).toContain("top: 0;");
  expect(controlDeclarations).toContain("inset-inline-end: -15px;");
  expect(controlDeclarations).toContain("width: 15px;");
  expect(controlDeclarations).toContain("height: 1lh;");
  expect(controlDeclarations).not.toContain("height: 100%;");
  expect(controlDeclarations).toContain("padding-inline-start: 5px;");
  expect(controlDeclarations).toContain("padding-inline-end: 0;");
  expect(controlDeclarations).toContain("opacity: 1;");
  expect(controlDeclarations).toContain("visibility: visible;");
  expect(controlDeclarations).toContain("pointer-events: auto;");
  expect(controlDeclarations).toContain("z-index: 2;");
  expect(collapsedDeclarations).toContain("transform: rotate(90deg);");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx --yes --package=node@22.23.1 -c 'SKIP_OBSIDIAN=1 ./node_modules/.bin/jest src/features/__tests__/MobileRightFoldControls.test.ts --runInBand'
```

Expected: FAIL because no heading-specific parent, control, or collapsed declarations exist.

- [ ] **Step 3: Add the minimal heading CSS**

Add these rules immediately after the existing mobile list rules in `styles.css`:

```css
.bullet-plugin-mobile-right-fold-controls
  .markdown-source-view.mod-cm6
  .HyperMD-header
  .cm-fold-indicator {
  position: static;
}

.bullet-plugin-mobile-right-fold-controls
  .markdown-source-view.mod-cm6.is-live-preview
  .cm-line.HyperMD-header:has(.cm-fold-indicator)
  .cm-fold-indicator
  .collapse-indicator {
  display: flex;
  box-sizing: border-box;
  align-items: center;
  justify-content: flex-start;
  top: 0;
  inset-inline-end: -15px;
  width: 15px;
  height: 1lh;
  padding-inline-start: 5px;
  padding-inline-end: 0;
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  z-index: 2;
}

.bullet-plugin-mobile-right-fold-controls
  .markdown-source-view.mod-cm6
  .HyperMD-header
  .cm-fold-indicator.is-collapsed
  .collapse-indicator
  svg.svg-icon {
  transform: rotate(90deg);
}
```

- [ ] **Step 4: Update the durable behavior documentation**

In `docs/superpowers/specs/2026-07-16-mobile-right-fold-controls-design.md`, replace:

```markdown
デスクトップ、閲覧モード、見出しの折りたたみコントロールは変更しない。
```

with:

```markdown
見出しのnative折りたたみコントロールも、同じ右端へ移動する。

デスクトップ、閲覧モード、Propertiesの折りたたみコントロールは変更しない。
```

Add this paragraph after the existing list-control placement paragraph:

```markdown
見出しではnative `.cm-fold-indicator`を`position: static`へ変更し、内側の`.collapse-indicator`を15px幅、`inset-inline-end: -15px`、`height: 1lh`で右端へ配置する。

折りたたみ中の見出しシェブロンは`rotate(90deg)`で左を向き、展開中は下を向く。
```

Add this completion criterion:

```markdown
- モバイルのLive Previewで、見出しとリストのnative controlが同じ右端に並ぶ。
```

Add this durable rule under `モバイルの右端折りたたみコントロールについて` in `AGENTS.md`:

```markdown
    - mobile right fold controlsが有効なLive Previewでは、native見出しcontrolも右端へ移してください。`.cm-line.HyperMD-header`へ対象を限定し、parent `.cm-fold-indicator`を`position: static`、controlを15px幅、`inset-inline-end: -15px`、`padding-inline-start: 5px`、`height: 1lh`にして1行目へ揃えます。折りたたみ中は`rotate(90deg)`で本文側を向け、見出し行のpadding、editorのoverflow clip、独自DOM、独自click handlerは追加しないでください。実Obsidianでは見出しとリストのcontrolが同じ右端に並ぶこと、長い見出しの1行目より下がtargetにならないこと、横スクロールが増えないことを確認してください。
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
npx --yes --package=node@22.23.1 -c 'SKIP_OBSIDIAN=1 ./node_modules/.bin/jest src/features/__tests__/MobileRightFoldControls.test.ts --runInBand'
```

Expected: PASS with all tests in `MobileRightFoldControls.test.ts` passing.

---

### Task 2: Verify the native behavior and integrate the branch

**Files:**

- Verify: `styles.css`
- Verify: `src/features/__tests__/MobileRightFoldControls.test.ts`
- Verify: `vault/test.md`
- Verify: `vault/.obsidian/plugins/bullet/`

**Interfaces:**

- Consumes: the heading CSS contract from Task 1 and the existing native heading fold DOM.
- Produces: automated and real-Obsidian evidence that headings fold from the right edge without editor overflow or desktop changes.

- [ ] **Step 1: Run static and unit verification**

Run:

```bash
npx --yes --package=node@22.23.1 -c 'npm run lint'
npx --yes --package=node@22.23.1 -c 'npx tsc --noEmit'
npx --yes --package=node@22.23.1 -c 'npm run test:unit -- --runInBand'
npx --yes --package=node@22.23.1 -c 'npm run build-with-tests'
```

Expected: every command exits 0.

- [ ] **Step 2: Protect the fixture and run the full suite**

Run:

```bash
cp vault/test.md /tmp/obsidian-bullet-mobile-heading-test.md
shasum -a 256 vault/test.md /tmp/obsidian-bullet-mobile-heading-test.md
npx --yes --package=node@22.23.1 -c 'npm test -- --runInBand'
```

Poll `ps -axo pid=,command=` until no Obsidian test renderer for `vault=vault` remains. Then run:

```bash
cp /tmp/obsidian-bullet-mobile-heading-test.md vault/test.md
sleep 2
shasum -a 256 vault/test.md /tmp/obsidian-bullet-mobile-heading-test.md
```

Expected: all Jest suites pass and the restored fixture hash matches.

- [ ] **Step 3: Build and install the plugin in the test vault**

Run:

```bash
npx --yes --package=node@22.23.1 -c 'npm run build-with-tests'
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
obsidian-cli vault=vault eval code='window.focus(); document.title'
obsidian-cli vault=vault eval code='app.plugins.disablePlugin("bullet").then(()=>app.plugins.enablePlugin("bullet"))'
```

Stop if the focused title does not identify the `vault` test vault.

- [ ] **Step 4: Verify heading geometry and touch behavior**

Use `app.emulateMobile(true)` with a 390×844 viewport, DPR 3, and touch emulation. Before every UI action, focus `vault=vault` and recheck the title. Open `test.md`, then confirm:

```text
heading control width = 15px
heading SVG width = 10px
heading control right edge = list control right edge
heading control height = first heading line height
.cm-scroller clientWidth = .cm-scroller scrollWidth = 390px
```

Tap the heading control with `pointerType="touch"` using the full `pointerdown` → `pointerup` → `click` sequence. Confirm fold and unfold both work, the target is the native `.collapse-indicator`, the collapsed arrow points left, and a point below the first line does not target the control.

- [ ] **Step 5: Commit and land with GitButler**

Inspect changes with `but diff`, take the file IDs for `styles.css`, `MobileRightFoldControls.test.ts`, the original mobile-control design, and `AGENTS.md`, then commit those IDs to `codex/mobile-heading-right-fold-controls` with:

```text
fix(mobile): move heading fold controls to the right

Why:
- Mobile list controls moved to the right while heading controls remained on the left.

What:
- Place native heading controls at the mobile Live Preview right edge.
- Keep wrapped heading targets on the first line and mirror the collapsed direction.
- Document and test the shared heading and list placement.
```

Run `but pull --check`, `but pull`, and:

```bash
but land codex/mobile-heading-right-fold-controls --yes
```

Expected: GitButler reports that only this branch was landed on `origin/main`, while unrelated applied branches remain unlanded.
