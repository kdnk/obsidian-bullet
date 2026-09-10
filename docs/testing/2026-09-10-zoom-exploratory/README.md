# Zoom exploratory test — 2026-09-10

Tested Bullet 5.18.2 (`7a0b8d1`) in Obsidian 1.14.1 desktop Live Preview, using the deployed test build and the repository vault only. Node 22.23.1; tabs enabled, tab size 4; synthetic notes, usually a 1100 × 850 viewport. No production changes or release are included.

## Findings

1. **Visible subtree replacement exits zoom (medium).** Zoom into `project`, select from its visible marker through its descendants, then replace with `- project\n\t\t- updated task`. The root still exists and the text is correct, but zoom clears. Reproduced with a CodeMirror selection and real `Input.insertText`, not an OS clipboard paste. The `removedRootLine` check treats any replacement spanning the root marker and newline as deletion, irrespective of replacement text. See `replace-visible-subtree.png` and the state case.
2. **Equivalent mixed indentation is displayed incorrectly (medium).** Under a tab-indented `project`, compare a two-tab `task` with an eight-space `task`. Both belong to the same parsed subtree. In zoom, the task bullet is at X=262.5 versus X=298.5: an extra 36px / four columns. The state test confirms that the space-indented child is missing its common-indent replacement; the renderer uses an exact raw-prefix check. See `mixed-indentation.png` and `mixed-indentation-positions` in the results. This is a display issue; source indentation remains intact.
3. **Renaming the note invalidates zoom on the next transaction (low).** Rename a zoomed note. The root breadcrumb initially retains the old name; moving the cursor/editing then clears zoom. The stored path is compared with the renamed file path on every transaction. Text changes remain intact. See `rename-edit-observation` and `note-rename-while-zoomed.png`.
4. **Whole-document `editor.setValue()` changes are rejected during zoom (medium, plugin interoperability).** Updating only `task` via `setValue(currentText.replace(...))` works outside zoom but is silently ignored inside zoom. The operation replaces the entire document and is rejected by the hidden-content filter. This is **not** a reproduced Linter/save failure, zoom reset, or data loss. A separate `filter:false` full-document replacement in the state tests does apply the text but clears zoom. See `save-whole-document-visible-change` (historical test name; the tested action is setValue, not save).

For finding 2, Linter's **Spacing → Convert Spaces to Tabs**, tab size **4**, provides a workaround after linting. Its installed rule was executed against the mixed-indent fixture and converted the eight-space child into two tabs. The inspected saved configuration has this rule disabled (tab size already 4), and `lintOnSave` disabled. No user settings were changed. Normalizing notes does not fix Bullet's handling of mixed text before linting.

## Passed coverage

- Nested zoom-in, parent navigation, and return to the whole note.
- Native bullet click; checkbox toggling without changing the zoom target.
- Native child folding/unfolding while zoomed (transport recheck).
- Text insertion, Undo, and Redo retaining zoom (transport recheck, Editor history API).
- Enter and insertion at the visible end without exposing or changing hidden siblings.
- Repeated Select All clamps exactly to the visible subtree; deletion preserves hidden frontmatter and siblings. Deleting the focused subtree exits zoom.
- Multiline continuation paragraphs remain visible.
- Another pane's visible edit synchronizes without resetting zoom.
- Switching to another note with identical text resets zoom.
- Plugin disable/re-enable clears zoom without changing text; zoom can be activated again.
- No captured renderer error/unhandled-rejection events in the exploratory runs.
- Installed Linter's actual diff application: timestamp, trailing whitespace, EOF edits, no-diff save, and another pane's hidden edit. Hidden synchronization applies the text and intentionally exits zoom.
- Existing zoom unit suites: **31 passed**.

The focused root's Shift-Tab is currently blocked at the zoom boundary; the document remains intact, but the cursor can move to a child. This was tested as an observed limitation, not proof that root outdenting works.

## Inconclusive / limitations

Some native input/history commands intermittently caused the CLI transport to time out despite the renderer remaining responsive. Fold and Undo/Redo passed in the isolated recheck. Backspace passed in a subsequent isolated run (`backspace-recheck/results.json`); earlier timeout snapshots are inconclusive, not product-defect evidence. One scroll-stability `--zoom` run also timed out before collecting assertions: its CLI output contained a complete successful CDP response, but the CLI process did not exit. Scroll restoration is not verified by this run. The exploratory harness now accepts only fully parsed JSON responses after this particular CLI-exit timeout, while retaining an observation record.

Mobile, Source mode, arbitrary themes, OS clipboard integration, and all third-party plugins were not exhaustively tested. This is exploratory evidence, not a claim that zoom has no other bugs. The full integration suite was not rerun because production source was unchanged.

## Reproduction and evidence

Run UI checks separately, with Obsidian open on the repository vault and Bullet enabled:

```sh
n exec 22.23.1 npm run build-with-tests
# Deploy dist/main.js, manifest.json, styles.css to vault/.obsidian/plugins/bullet/,
# then reload bullet with vault=vault before running.
n exec 22.23.1 node scripts/verify-zoom-exploratory.cjs
ZOOM_CASES='typing-undo-redo|native-fold-within-zoom|backspace-at-root-content-start' n exec 22.23.1 node scripts/verify-zoom-exploratory.cjs docs/testing/2026-09-10-zoom-exploratory/transport-recheck
n exec 22.23.1 node scripts/verify-zoom-save.cjs <installed-linter-main.js>
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest src/features/__tests__/ListZoom.test.ts src/features/__tests__/ListZoomInteraction.test.ts --runInBand
```

`results.json` contains the main run; `transport-recheck/results.json` supersedes its transport-limited fold/history results. Timeout statuses in the main run were normalized to `inconclusive-transport` after execution. Screenshots are synthetic test-vault content; temporary notes were trashed and the original active pane, sidebars, and viewport restored.

The exploratory state tests intentionally preserve failing desired-behavior assertions outside normal Jest discovery:

```sh
SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest --testRegex 'state-cases.test.ts$' --runTestsByPath docs/testing/2026-09-10-zoom-exploratory/state-cases.test.ts --runInBand
```

Observed: **10 passed, 3 failed (exit 1)**. The failures cover subtree replacement, full-document replacement, and mixed indentation; they are evidence, not a passing regression suite.
