# Zoom edge-case verification

## Changes

- Coarse replacements use their differing prefix/suffix boundaries to track the focused item. Replacing a visible subtree with the same root keeps zoom; deleting the root still exits, including beside an identical sibling.
- File identity survives rename, and the breadcrumb observes rename immediately. Its event reference is removed when the panel is destroyed.
- Zoom subtracts visual indentation rather than an exact raw prefix. Partially retained tabs stay in native indentation marks; scoped tab-width constraints preserve native guide wrappers and their minimum width.
- Whole-document updates are applied instead of silently rejected. Filtered replacements remap/clamp selection. An unfiltered replacement with a visible selection preserves zoom; an unfiltered cursor reset into hidden text reveals the document so subsequent typing works. This last case intentionally supersedes the earlier exploratory expectation that every unfiltered `setValue()` should preserve zoom.

## Verified environment and results

- Node 22.23.1, Obsidian 1.14.1, desktop Live Preview, repository test vault, tabs enabled with width four.
- `npm run test:unit -- --runInBand`: 804 tests passed in 62 suites.
- `npm test -- --runInBand`: 952 passed, 15 skipped, 82 suites passed. Test renderer exit was confirmed before restoring the fixture and workspace backups; the restored fixture SHA-256 matched `3b41a8cfcfc20a345fa3b2d33a909f1fb00bdd00d2302223bedefc0ed9c96f0b`.
- `npx tsc --noEmit`, `npm run lint`, and `npm run build-with-tests`: passed.
- `node scripts/verify-zoom-exploratory.cjs docs/testing/2026-09-10-zoom-fixes-verified`: 19 checks passed, no findings or renderer errors. Exact states, coordinates and observations are in `results.json`.
- `node scripts/verify-zoom-save.cjs <installed-linter-main.js>`: actual Linter diff application preserved zoom/cursor through timestamp, whitespace and EOF changes; no-diff save preserved zoom; another pane's hidden edit synchronized and exited zoom.
- Independent source review: no remaining Critical or Important findings after adding selection-recovery and unfiltered safe-exit tests.

The CLI twice returned complete JSON but timed out while exiting. The harness accepted only the fully parsed responses and recorded both occurrences; missing/partial output would remain inconclusive.

## Indentation checks and boundaries

The six-space parent cases include valid intermediate list ancestors, so Obsidian itself recognizes the list. A two-tab child matches the equivalent eight-space child; a three-tab descendant beneath an intermediate eight-space branch matches twelve spaces. Bullet X positions, native guide X positions and direct `.cm-hmd-list-indent` ancestry match. Screenshots show the retained native bullets and guides.

For the prefix tab–space–tab under a six-space parent, Obsidian does not render a native list bullet even before zoom. This native parsing limitation is recorded separately; the plugin does not invent a bullet or rewrite the Markdown to conceal it. Parser-wide indentation semantics were not changed.

These checks do not constitute a fresh mobile or Source-mode certification, nor an OS clipboard-paste test. No personal-vault settings, plugin installation, or notes were changed. Temporary test notes were moved to system trash by the harness.
