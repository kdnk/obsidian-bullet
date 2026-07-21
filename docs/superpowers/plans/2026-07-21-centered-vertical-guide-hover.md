# Centered Vertical Guide Hover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render every actionable hovered vertical guide as a three-pixel line whose center remains identical to the normal one-pixel guide.

**Architecture:** Keep Obsidian's native pseudo-elements and the existing semantic hover markers. Increase only the marked border to three pixels, then shift the pseudo-element one pixel toward its positioning edge so the added width expands equally on both sides of the original center.

**Tech Stack:** CSS logical properties, Jest stylesheet contract tests, Node.js 22.23.1, GitButler CLI

## Global Constraints

- Keep `.cm-indent::before` and `.bullet-plugin-outer-list-guide::before` as the only paint sources.
- Use `border-inline-end: 3px solid var(--indentation-guide-color-active)` for every actionable hovered guide.
- Keep the normal one-pixel guide width and color unchanged.
- Add no transition, fixed color, opacity override, overlay, shadow, gradient, or coordinate cache.
- Preserve semantic whole-guide marker grouping, folding, selection, scrolling, and hit targets.
- Use `n exec 22.23.1` for every local Node.js verification command.
- Use `but` for every version-control write operation.

---

### Task 1: Center the three-pixel hover line

**Files:**
- Modify: `src/features/__tests__/GuideFolding.test.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `.bullet-plugin-hovered-indent-guide` and `.bullet-plugin-hovered-outer-list-guide` marker classes maintained by `GuideFoldingPluginValue`.
- Produces: a three-pixel centered hover style for native indent guides, general outer guides, and desktop outer guides.

- [ ] **Step 1: Write the failing native and outer guide CSS contract assertions**

Change the native hover assertion to require the following normalized declarations:

```text
inset-inline-end: -1px; border-inline-end: 3px solid var(--indentation-guide-color-active);
```

Change the general outer hover assertion to require both declarations:

```typescript
expect(hovered).toContain("inset-inline-end: -1px;");
expect(hovered).toContain(
  "border-inline-end: 3px solid var(--indentation-guide-color-active);",
);
```

Add a desktop outer hover assertion for the existing actionable marker selector scoped by `body:not(.is-mobile)`:

```typescript
expect(desktopHovered?.replace(/\s+/g, " ").trim()).toBe(
  "inset-inline-start: -1px; inset-inline-end: auto;",
);
```

Assert that the hovered guide rules contain no `left`, `right`, `transition`, `box-shadow`, `background`, or `opacity` declaration.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand
```

Expected: the native and outer hover style assertions fail because the current rules still use `--indentation-guide-width-active` and provide no centering inset.

- [ ] **Step 3: Implement the centered hover geometry**

Update the native hover rule and general outer hover rule:

```css
inset-inline-end: -1px;
border-inline-end: 3px solid var(--indentation-guide-color-active);
```

After the general outer hover rule, add the desktop override:

```css
body:not(.is-mobile).bullet-plugin-vertical-lines-action-toggle-folding
  .markdown-source-view.mod-cm6
  .bullet-plugin-outer-list-guide[data-actionable="true"].bullet-plugin-hovered-outer-list-guide::before {
  inset-inline-start: -1px;
  inset-inline-end: auto;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand
```

Expected: all tests in `GuideFolding.test.ts` pass.

- [ ] **Step 5: Run static and build verification**

Run:

```bash
n exec 22.23.1 npm run lint
n exec 22.23.1 npx tsc --noEmit
n exec 22.23.1 npm run build-with-tests
SKIP_OBSIDIAN=1 n exec 22.23.1 npm run test:unit -- --runInBand
```

Expected: every command exits with status 0 and Jest reports no failed suites.

- [ ] **Step 6: Verify the rendered center in the repository test vault**

Install the test build and open the repository test note:

```bash
mkdir -p vault/.obsidian/plugins/bullet
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
obsidian-cli vault=vault open path=test.md
obsidian-cli vault=vault plugin:reload id=bullet
obsidian-cli vault=vault eval code='window.focus(); document.title'
```

If the last command reports `Command "eval" not found`, use this exact fallback before each UI action:

```bash
obsidian-cli vault=vault dev:cdp method=Runtime.evaluate params='{"expression":"window.focus(); document.title","returnByValue":true}'
```

Before each Computer Use action, focus the test-vault renderer and confirm the window title contains `vault` and does not contain `base`.
For one native inner guide and one outer guide, compare the normal and hovered painted bounds and confirm the center X difference is `0px`, while the widths are `1px` and `3px`.
Confirm the whole represented logical guide becomes three pixels wide and a separate list at the same X coordinate remains unchanged.

- [ ] **Step 7: Commit the implementation with GitButler**

Run `but diff`, copy the exact change IDs for `styles.css`, `src/features/__tests__/GuideFolding.test.ts`, and this plan, then commit them to `codex/centered-guide-hover` with an English Conventional Commit message containing separate `Why:` and `What:` sections.
