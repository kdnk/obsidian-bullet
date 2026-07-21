# Desktop List Chevron Hover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show native desktop list chevrons only while their Live Preview row is hovered, with the icon centered between adjacent indentation guides.

**Architecture:** Replace the guide-action-specific hide rule with two desktop-only CSS rules: one hidden base state and one row-hover state.
Keep Obsidian's native fold indicator and transaction, but size its control to one `--list-indent` lane and center the SVG without changing the guide paint or stacking.

**Tech Stack:** Obsidian 1.13 Live Preview DOM, CSS, Jest 30, TypeScript 5.9, Rollup 4, GitButler CLI.

## Global Constraints

- The accepted design is `docs/superpowers/specs/2026-07-21-desktop-list-chevron-hover-design.md`.
- Apply the hover-only rule to desktop Live Preview list chevrons regardless of the vertical-line action setting.
- Do not reveal a chevron from editor selection, `.cm-active`, or keyboard focus.
- Do not change heading controls, Reading View, or mobile right fold controls.
- Reuse the native `.collapse-indicator`; do not add JavaScript state, DOM markers, overlays, timers, or coordinate caches.
- Do not change the native SVG transform, guide geometry, guide paint, or guide z-index.
- Use Node.js 22.23.1 for every local test, build, lint, and typecheck command.
- Use `but` for every version-control write and keep all work on `codex/desktop-list-chevron-hover`.
- Run `.spec.md` integration tests only after `npm run build-with-tests`.
- Back up and restore `vault/test.md` around the full suite, and use only the repository `vault` for manual Obsidian verification.
- Do not track `dist/main.js`.

---

## File Map

- Modify `src/features/__tests__/GuideFolding.test.ts`: replace the obsolete always-hidden CSS contract with the desktop hover and guide-lane contract.
- Modify `styles.css`: define the hidden desktop state, row-hover state, and centered guide-lane geometry.
- Modify `AGENTS.md`: record the verified Chrome DevTools Protocol fallback when the installed Obsidian CLI lists `eval` but cannot execute it.

### Task 1: Add desktop row-hover chevrons

**Files:**

- Modify: `src/features/__tests__/GuideFolding.test.ts`
- Modify: `styles.css`

**Interfaces:**

- Consumes: Obsidian's native `.cm-line.HyperMD-list-line`, `.cm-fold-indicator`, `.collapse-indicator`, `--list-indent`, and `body.is-mobile` state.
- Produces: desktop-only hidden and hovered presentation rules for the native list control.

- [ ] **Step 1: Replace the obsolete CSS contract with a failing hover contract**

Replace `hides list chevrons while vertical guides toggle folding` with:

```ts
test("shows desktop list chevrons only on row hover between guides", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
  const hiddenDeclarations = styles.match(
    /body:not\(\.is-mobile\)\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-list-line:has\(\.cm-fold-indicator\)\s+\.cm-fold-indicator\s+\.collapse-indicator\s*\{([^}]*)\}/,
  )?.[1];
  const hoveredDeclarations = styles.match(
    /body:not\(\.is-mobile\)\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-list-line:has\(\.cm-fold-indicator\):hover\s+\.cm-fold-indicator\s+\.collapse-indicator\s*\{([^}]*)\}/,
  )?.[1];
  const competingParentDeclarations = styles.match(
    /body:not\(\.is-mobile\)\.bullet-plugin-vertical-lines-action-toggle-folding\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-list-line:has\(\.cm-fold-indicator\):hover\s+\.cm-fold-indicator\s*\{([^}]*)\}/,
  )?.[1];
  const competingControlDeclarations = styles.match(
    /body:not\(\.is-mobile\)\.bullet-plugin-vertical-lines-action-toggle-folding\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-list-line:has\(\.cm-fold-indicator\):hover\s+\.cm-fold-indicator\s+\.collapse-indicator\s*\{([^}]*)\}/,
  )?.[1];
  const competingIconDeclarations = styles.match(
    /body:not\(\.is-mobile\)\.bullet-plugin-vertical-lines-action-toggle-folding\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-list-line:has\(\.cm-fold-indicator\):hover\s+\.cm-fold-indicator\s+\.collapse-indicator\s+svg\.svg-icon\s*\{([^}]*)\}/,
  )?.[1];

  expect(hiddenDeclarations).toContain("display: flex;");
  expect(hiddenDeclarations).toContain("box-sizing: border-box;");
  expect(hiddenDeclarations).toContain("align-items: center;");
  expect(hiddenDeclarations).toContain("justify-content: center;");
  expect(hiddenDeclarations).toContain(
    "inset-inline-start: calc(-1 * var(--list-indent, 18px));",
  );
  expect(hiddenDeclarations).toContain("inset-inline-end: auto;");
  expect(hiddenDeclarations).toContain("width: var(--list-indent, 18px);");
  expect(hiddenDeclarations).toContain("padding-inline: 0;");
  expect(hiddenDeclarations).toContain("opacity: 0;");
  expect(hiddenDeclarations).toContain("visibility: hidden;");
  expect(hiddenDeclarations).toContain("pointer-events: none;");
  expect(hoveredDeclarations?.replace(/\s+/g, " ").trim()).toBe(
    "opacity: 1; visibility: visible; pointer-events: auto;",
  );
  expect(competingParentDeclarations?.trim()).toBe("z-index: 3;");
  expect(competingControlDeclarations?.trim()).toBe("pointer-events: none;");
  expect(competingIconDeclarations?.trim()).toBe("pointer-events: auto;");
  expect(styles).not.toMatch(
    /\.bullet-plugin-vertical-lines-action-toggle-folding\s+\.markdown-source-view\.mod-cm6\s+\.HyperMD-list-line\s+\.cm-fold-indicator\s+\.collapse-indicator\s*\{/,
  );
  expect(styles).not.toMatch(
    /body:not\(\.is-mobile\)[^{]*\.HyperMD-header[^{]*\.collapse-indicator\s*\{/,
  );
});
```

Also add a mobile cross-feature contract in `MobileRightFoldControls.test.ts` that collects the three guide-hover rules and requires every selector to start with `body:not(.is-mobile).bullet-plugin-vertical-lines-action-toggle-folding`. This prevents the desktop hit-target override from shrinking the mobile control when both feature body classes are present.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts --runInBand
```

Expected: FAIL because `hiddenDeclarations` and `hoveredDeclarations` are `undefined`, while the obsolete guide-action-specific rule still exists.

- [ ] **Step 3: Replace the obsolete CSS rule with the minimal desktop rules**

Replace the `.bullet-plugin-vertical-lines-action-toggle-folding ... .collapse-indicator` rule in `styles.css` with:

```css
body:not(.is-mobile)
  .markdown-source-view.mod-cm6.is-live-preview
  .cm-line.HyperMD-list-line:has(.cm-fold-indicator)
  .cm-fold-indicator
  .collapse-indicator {
  display: flex;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  inset-inline-start: calc(-1 * var(--list-indent, 18px));
  inset-inline-end: auto;
  width: var(--list-indent, 18px);
  padding-inline: 0;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

body:not(.is-mobile)
  .markdown-source-view.mod-cm6.is-live-preview
  .cm-line.HyperMD-list-line:has(.cm-fold-indicator):hover
  .cm-fold-indicator
  .collapse-indicator {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}

body:not(.is-mobile).bullet-plugin-vertical-lines-action-toggle-folding
  .markdown-source-view.mod-cm6.is-live-preview
  .cm-line.HyperMD-list-line:has(.cm-fold-indicator):hover
  .cm-fold-indicator {
  z-index: 3;
}

body:not(.is-mobile).bullet-plugin-vertical-lines-action-toggle-folding
  .markdown-source-view.mod-cm6.is-live-preview
  .cm-line.HyperMD-list-line:has(.cm-fold-indicator):hover
  .cm-fold-indicator
  .collapse-indicator {
  pointer-events: none;
}

body:not(.is-mobile).bullet-plugin-vertical-lines-action-toggle-folding
  .markdown-source-view.mod-cm6.is-live-preview
  .cm-line.HyperMD-list-line:has(.cm-fold-indicator):hover
  .cm-fold-indicator
  .collapse-indicator
  svg.svg-icon {
  pointer-events: auto;
}
```

- [ ] **Step 4: Run the focused desktop and mobile regression tests**

Run:

```bash
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/GuideFolding.test.ts src/features/__tests__/MobileRightFoldControls.test.ts --runInBand
```

Expected: both suites PASS.

- [ ] **Step 5: Run formatting, lint, and type checks**

Run:

```bash
n exec 22.23.1 npx prettier --check styles.css src/features/__tests__/GuideFolding.test.ts
n exec 22.23.1 npm run lint
n exec 22.23.1 npx tsc --noEmit
```

Expected: every command exits 0.

- [ ] **Step 6: Commit the tested feature change**

Confirm `but diff` contains only `styles.css` and `src/features/__tests__/GuideFolding.test.ts`, then run:

```bash
but commit codex/desktop-list-chevron-hover -m $'feat(ui): reveal list chevrons on row hover\n\nWhy:\n- Persistent desktop chevrons add visual noise when the pointer is elsewhere.\n- Native chevron placement touches the current indentation guide.\n\nWhat:\n- Hide desktop list chevrons until their row is hovered.\n- Center the native control within one indentation lane.\n- Preserve mobile, heading, native folding, and guide behavior.'
```

Expected: GitButler creates a feature commit on `codex/desktop-list-chevron-hover` and reports no remaining uncommitted feature files.

### Task 2: Verify the interaction in Obsidian

**Files:**

- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: Obsidian CLI developer commands, the built plugin files, and the repository test vault.
- Produces: durable CLI fallback guidance and evidence that hover, geometry, native folding, guide folding, and mobile isolation still work.

- [ ] **Step 1: Record the verified `eval` fallback**

After the existing Computer Use focus rule in `AGENTS.md`, add:

```markdown
    - `obsidian-cli vault=vault eval ...`が`Command "eval" not found`を返す一方でDeveloper commandが利用できる場合は、`obsidian-cli vault=vault dev:cdp method=Runtime.evaluate params='{"expression":"window.focus(); document.title","returnByValue":true}'`をfocusとtitle確認のfallbackとして使ってください。返値に`vault`が含まれ、`base`が含まれないことを各UI action直前に確認し、この確認ができない場合はactionを実行しないでください。
    - `app.emulateMobile(true)`と`app.emulateMobile(false)`はworkspaceを再構成し、対象noteを`New tab`へ戻したりDeveloper commandを一時的に切断したりします。mode切替後はDeveloper commandの再接続を待ち、`obsidian-cli vault=vault open path=<test-note>`で対象noteを開き直して`obsidian-cli vault=vault plugin:reload id=bullet`を実行してからDOM検査や入力を再開してください。切替前のelementや座標は再利用しないでください。
```

- [ ] **Step 2: Back up the full-test fixture and inspect the LevelDB lock owner**

Run:

```bash
chevron_backup_dir=$(mktemp -d /tmp/obsidian-bullet-chevron.XXXXXX)
cp vault/test.md "$chevron_backup_dir/test.md"
shasum -a 256 "$chevron_backup_dir/test.md"
lsof '/Users/kodai/Library/Application Support/obsidian/Local Storage/leveldb/LOCK' || true
```

If `lsof` reports a lowercase `obsidian` process, inspect its exact PID and command with `ps`, terminate only that owner process, and rerun `lsof` until the lock has no owner.

- [ ] **Step 3: Build the test bundle and run the complete automated suite**

Run:

```bash
n exec 22.23.1 npm run build-with-tests
n exec 22.23.1 npm test -- --runInBand
n exec 22.23.1 npm run build
```

Expected: every command exits 0.

- [ ] **Step 4: Restore and verify the fixture before manual testing**

Wait until the `vault=vault` test renderer has exited, then run:

```bash
cp "$chevron_backup_dir/test.md" vault/test.md
expected_fixture_hash=$(shasum -a 256 "$chevron_backup_dir/test.md" | awk '{print $1}')
actual_fixture_hash=$(shasum -a 256 vault/test.md | awk '{print $1}')
test "$expected_fixture_hash" = "$actual_fixture_hash"
sleep 2
test "$expected_fixture_hash" = "$(shasum -a 256 vault/test.md | awk '{print $1}')"
```

Expected: both hash comparisons exit 0.

- [ ] **Step 5: Install the production build into the repository test vault**

Run:

```bash
mkdir -p vault/.obsidian/plugins/bullet
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
obsidian-cli vault=vault open path=test.md
obsidian-cli vault=vault plugin:reload id=bullet
```

Expected: `test.md` opens in the `vault` window and plugin `bullet` reloads.

- [ ] **Step 6: Verify desktop hidden and hovered states with fresh coordinates**

Before each pointer action, focus the renderer through `Runtime.evaluate` and confirm the returned title contains `vault` and not `base`.
Use a fresh DOM query to locate one root foldable row and one nested foldable row, scroll the target into view, and read the line, control, SVG, outer-guide, and native-indent rectangles.

For each row, verify:

- With the pointer outside the row, computed `opacity` is `0`, `visibility` is `hidden`, and `pointer-events` is `none` even when the editor selection is on that row.
- Moving the pointer over the row text changes the control to `opacity: 1` and `visibility: visible`.
- The control spans one `--list-indent` lane and touches the row edge, so the hover state remains active while moving from the text to the control.
- The 10px SVG has positive horizontal clearance from both adjacent guides.
- While guide folding is enabled, the SVG has `pointer-events: auto`, its 18px parent control has `pointer-events: none`, and `elementFromPoint()` resolves the 4px side clearances to the corresponding guide.
- A leaf row contains no native `.collapse-indicator` and gains no plugin-owned replacement.

- [ ] **Step 7: Verify both folding paths and mobile isolation**

With fresh element coordinates before every action, execute a complete `mousedown` → `mouseup` → `click` sequence on the visible native chevron and confirm fold then unfold both work.
Repeat on the relevant vertical guide and confirm its existing child-branch toggle behavior still works without the chevron icon covering the guide.

Then enable real mobile emulation with `app.emulateMobile(true)`, Device Toolbar viewport and DPR settings, and touch emulation.
Confirm the existing mobile list control remains visible at the right edge without requiring row hover, then restore desktop emulation.

- [ ] **Step 8: Remove the verified temporary backup safely**

Run only after the restored fixture hash remains equal:

```bash
test -d "$chevron_backup_dir"
case "$chevron_backup_dir" in
  /tmp/obsidian-bullet-chevron.*) /usr/bin/trash "$chevron_backup_dir" ;;
  *) exit 1 ;;
esac
```

Expected: only the agent-created `/tmp/obsidian-bullet-chevron.*` directory moves to Trash.

- [ ] **Step 9: Commit the agent guidance**

Confirm `but diff` contains only `AGENTS.md`, then run:

```bash
but commit codex/desktop-list-chevron-hover -m $'docs(agent): document Obsidian CDP fallback\n\nWhy:\n- The installed CLI can list eval while rejecting it at execution time.\n- UI verification still requires a fresh focus and vault-title check before every action.\n\nWhat:\n- Document Runtime.evaluate as the guarded fallback.\n- Preserve the existing requirement to stop when the test vault cannot be proven.'
```

Expected: GitButler creates a documentation commit and leaves no uncommitted task changes.
