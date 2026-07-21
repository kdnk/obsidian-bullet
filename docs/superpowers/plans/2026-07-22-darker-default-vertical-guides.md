# Darker Default Vertical Guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase the theme-aware normal vertical-guide color from 20% to 26% without adding settings or changing hover behavior.

**Architecture:** Keep the existing `Enhance vertical lines` body-class gate and override only its `--indentation-guide-color` value. Lock the new value in the existing CSS contract test so the native fallback, guide geometry, and active hover declarations remain untouched.

**Tech Stack:** CSS custom properties, Jest, TypeScript, Node.js 22.23.1, GitButler CLI

## Global Constraints

- Use `color-mix(in oklch, var(--text-normal) 26%, transparent)` for the enhanced normal guide color.
- Do not add a color or intensity setting.
- Preserve the existing `Enhance vertical lines` saved key, default value, and Obsidian-native fallback when disabled.
- Do not change guide width, position, segment structure, outer-guide rendering, hover active color, three-pixel hover width, endpoint radii, or selected-guide styling.
- Run local verification with Node.js 22.23.1 and set `SKIP_OBSIDIAN=1` for direct `src` Jest runs.
- Use GitButler for version-control writes and leave unrelated branch changes untouched.

---

### Task 1: Strengthen the enhanced normal guide color

**Files:**

- Modify: `src/features/__tests__/GuideFolding.test.ts:972`
- Modify: `styles.css:59`

**Interfaces:**

- Consumes: `.bullet-plugin-enhanced-vertical-line-hover` and Obsidian's `--text-normal` theme variable.
- Produces: `--indentation-guide-color: color-mix(in oklch, var(--text-normal) 26%, transparent)` while leaving all active-guide declarations unchanged.

- [ ] **Step 1: Change the CSS contract expectation first**

Replace the normal-color expectation with:

```typescript
expect(normalColor?.replace(/\s+/g, " ").trim()).toBe(
  "--indentation-guide-color: color-mix( in oklch, var(--text-normal) 26%, transparent );",
);
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand
```

Expected: FAIL because `styles.css` still contains `var(--text-normal) 20%` while the test requires 26%.

- [ ] **Step 3: Make the minimal CSS change**

Change only the percentage in the existing override:

```css
.bullet-plugin-enhanced-vertical-line-hover
  .markdown-source-view.mod-cm6 {
  --indentation-guide-color: color-mix(
    in oklch,
    var(--text-normal) 26%,
    transparent
  );
}
```

- [ ] **Step 4: Run focused and repository checks**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand
n exec 22.23.1 npm run lint
```

Expected: the focused Jest suite passes with zero failures, and lint exits with zero errors or warnings.

- [ ] **Step 5: Inspect and commit only this task's implementation changes**

Run `but diff`, select only the `styles.css` change and the 26% expectation hunk, and commit them to `codex/darker-vertical-guides` with an English Conventional Commit message containing `Why:` and `What:` sections.
