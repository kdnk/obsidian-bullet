# Mobile Fold Control Heading Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the mobile list chevron at the current visual position without widening the viewport by mirroring Obsidian's 15px native heading fold control.

**Architecture:** Preserve the native list `.collapse-indicator` and its folding behavior, but replace the 48px geometry with a 15px border-box placed immediately outside the list line. Remove the compensating row padding and keep the SVG inside the control with the same 5px text-side gap as the mirrored heading control.

**Tech Stack:** CSS, Jest, TypeScript, Obsidian 1.13.2 Live Preview, GitButler CLI

## Global Constraints

- Use GitButler for every version-control write operation; do not use Git write commands.
- Run local verification with Node.js 22.23.1 or newer in the Node.js 22 line.
- Scope the geometry to `.bullet-plugin-mobile-right-fold-controls .markdown-source-view.mod-cm6.is-live-preview` list controls.
- Keep the control height at `calc(1lh + var(--list-spacing, 0px) + var(--list-spacing, 0px))` so wrapped controls remain on the first line.
- Do not add overflow clipping, scroll listeners, transforms, overlays, or manual `scrollLeft` restoration.
- Preserve native fold transactions and the existing scroll anchoring behavior.

---

### Task 1: Encode the heading-mirrored CSS contract

**Files:**
- Modify: `src/features/__tests__/MobileRightFoldControls.test.ts`
- Reference: `docs/superpowers/specs/2026-07-17-mobile-fold-control-overflow-containment-design.md`

**Interfaces:**
- Consumes: the plugin-root class and native `.collapse-indicator` selector already emitted by `MobileRightFoldControls`
- Produces: a static CSS contract for the 15px control and the absence of row padding or editor overflow overrides

- [ ] **Step 1: Replace the old 48px expectations with the approved geometry**

Update the existing CSS contract test to assert the following declarations:

```ts
expect(styles).not.toMatch(
  /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-list-line\s*\{[^}]*padding-inline-end/,
);
expect(controlDeclarations).toContain("box-sizing: border-box;");
expect(controlDeclarations).toContain("justify-content: flex-start;");
expect(controlDeclarations).toContain("inset-inline-end: -15px;");
expect(controlDeclarations).toContain("width: 15px;");
expect(controlDeclarations).toContain("padding-inline-start: 5px;");
expect(controlDeclarations).toContain("padding-inline-end: 0;");
expect(styles).not.toMatch(
  /\.bullet-plugin-mobile-right-fold-controls[^{]*(?:\.cm-scroller|\.cm-content)\s*\{[^}]*overflow/,
);
```

Retain the first-line height, pointer events, visibility, z-index, collapsed rotation, Live Preview scope, and no-transform assertions.

- [ ] **Step 2: Run the focused test and confirm the old CSS fails the new contract**

Run:

```bash
npx -y -p node@22.23.1 -c 'SKIP_OBSIDIAN=1 ./node_modules/.bin/jest src/features/__tests__/MobileRightFoldControls.test.ts --runInBand'
```

Expected: FAIL because the stylesheet still contains `padding-inline-end: 13px`, `justify-content: center`, `inset-inline-end: -35px`, and `width: 48px`.

---

### Task 2: Implement the fully contained control

**Files:**
- Modify: `styles.css`
- Modify: `AGENTS.md`
- Test: `src/features/__tests__/MobileRightFoldControls.test.ts`

**Interfaces:**
- Consumes: the CSS contract introduced in Task 1
- Produces: a 15px native control from the list line's right edge to 15px beyond it, with a 5px gap before the 10px SVG

- [ ] **Step 1: Remove the uniform list-row padding rule**

Delete this rule from `styles.css`:

```css
.bullet-plugin-mobile-right-fold-controls
  .markdown-source-view.mod-cm6.is-live-preview
  .cm-line.HyperMD-list-line {
  box-sizing: border-box;
  padding-inline-end: 13px;
}
```

- [ ] **Step 2: Replace the control geometry**

Change the existing control declarations to:

```css
display: flex;
box-sizing: border-box;
align-items: center;
justify-content: flex-start;
top: 0;
inset-inline-end: -15px;
width: 15px;
height: calc(1lh + var(--list-spacing, 0px) + var(--list-spacing, 0px));
padding-inline-start: 5px;
padding-inline-end: 0;
```

Keep the existing opacity, visibility, pointer-events, and z-index declarations unchanged.

- [ ] **Step 3: Update the durable mobile-control instruction**

Replace the obsolete 48px, `-35px`, and 13px geometry in `AGENTS.md` with these requirements:

```text
Mirror the native mobile heading control: use a 15px border-box, inset it 15px beyond the list line, and place the 10px SVG after 5px of text-side padding. Do not add list-row end padding or editor overflow clipping. Verify that the control spans x=366..381 and the SVG spans x=371..381 in a 390px viewport whose list line ends at x=366.
```

Retain the first-line alignment and foldable versus non-foldable wrapping requirements.

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```bash
npx -y -p node@22.23.1 -c 'SKIP_OBSIDIAN=1 ./node_modules/.bin/jest src/features/__tests__/MobileRightFoldControls.test.ts --runInBand'
```

Expected: PASS.

---

### Task 3: Verify behavior and integrate the branch

**Files:**
- Verify: `styles.css`
- Verify: `src/features/__tests__/MobileRightFoldControls.test.ts`
- Verify: `vault/mobile-overflow.md`

**Interfaces:**
- Consumes: the compiled plugin and the test-vault fixture
- Produces: automated and real-Obsidian evidence that the viewport no longer widens and native folding still works

- [ ] **Step 1: Run static and unit verification**

Run:

```bash
npx -y -p node@22.23.1 -c 'npm run lint'
npx -y -p node@22.23.1 -c 'npx tsc --noEmit'
npx -y -p node@22.23.1 -c 'npm run test:unit -- --runInBand'
npx -y -p node@22.23.1 -c 'npm run build-with-tests'
```

Expected: all commands exit 0.

- [ ] **Step 2: Protect the manual fixture and run the full suite**

Run:

```bash
cp vault/test.md /tmp/obsidian-bullet-test.md.backup
shasum -a 256 /tmp/obsidian-bullet-test.md.backup
npx -y -p node@22.23.1 -c 'npm test -- --runInBand'
pgrep -fl Obsidian
cp /tmp/obsidian-bullet-test.md.backup vault/test.md
sleep 2
shasum -a 256 /tmp/obsidian-bullet-test.md.backup vault/test.md
```

Do not restore while `pgrep -fl Obsidian` still shows the test renderer. If it does, poll the process again before copying the backup; the full-suite teardown should terminate it.

Expected: all Jest suites pass and the restored fixture hash matches.

- [ ] **Step 3: Install the test build and reload the plugin**

Run:

```bash
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
obsidian-cli vault=vault eval code='window.focus(); document.title'
obsidian-cli vault=vault eval code='app.plugins.disablePlugin("bullet").then(()=>app.plugins.enablePlugin("bullet"))'
```

Before every later UI action, repeat the focus command and stop if its result does not contain `vault`.

- [ ] **Step 4: Verify geometry and overflow in real Obsidian**

Use `app.emulateMobile(true)` with a 390×844 viewport, DPR 3, and touch emulation. Confirm:

```text
viewport width = 390
.cm-scroller clientWidth = 390
.cm-scroller scrollWidth = 390
list line right = 366
control left/right/width = 366/381/15
SVG left/right/width = 371/381/10
scrollLeft after attempting horizontal scroll = 0
```

- [ ] **Step 5: Verify touch and wrapping behavior**

Dispatch `pointerType="touch"` taps inside the first-line control to fold and unfold. Confirm that `elementFromPoint` does not return the control outside its 15px box, while Chromium's native touch adjustment behaves symmetrically with the 15px heading control. Confirm that taps below the first line do not fold, foldable and non-foldable rows have the same width and end padding, and the clicked row's screen Y position and `scrollTop` remain unchanged.

- [ ] **Step 6: Commit and land with GitButler**

Inspect the final changes with `but diff`, commit them to branch `od` with an English Conventional Commit containing Why and What sections, run `but pull --check` followed by `but pull`, and land with:

```bash
but land od --yes
```

Expected: GitButler reports that `codex/mobile-fold-control-overflow` was landed on the default branch.
