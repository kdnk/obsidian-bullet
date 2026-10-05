# List, task, and code rendering

List styling keeps bullets, checkboxes, native guides, and nested code aligned while preserving editable Markdown and native controls.

## Sub-features

- `render-lists`: styled unordered/ordered markers, nesting, wrapping, and theme-derived appearance.
- `render-tasks`: an independent task bullet for zoom/drag beside the native checkbox; checked styling must not strike through the bullet.
- `render-code`: nested code in native preview, editing, and Shiki preview, with stable background bounds, spacing, guide alignment, and horizontal reach.
- `render-code-shapes`: empty/blank-first blocks, alternate fences, language labels, deep nesting, wrapping, and blocks whose opening fence is offscreen.
- `render-code-input`: native typing and Vim navigation/newlines stay inside source code; copy preserves code indentation without list prefixes.

## How to get to it (user POV)

- Enable **Settings → Bullet → Appearance → Style list bullets**. Open nested unordered/ordered/task lists in Live Preview; toggle the setting, switch to Source mode, and reload Bullet.
- Click or tap `.task-list-item-checkbox` to complete a task, the separate `.bullet-plugin-task-bullet` to zoom, or its bullet to drag on desktop. Use a task's native `.collapse-indicator` independently.
- Put a fenced block inside an item or a list continuation. Move the cursor into/out of code to switch between editing and preview; scroll through short repeated blocks or one long block.
- With the installed Shiki Highlighter plugin, test disabled, enabled without line numbers, and enabled with line numbers. Use the native code copy control; enable Vim and use `j`, `k`, `o`, and `O` for keyboard paths.

## Driving it with Obsidian CLI/CDP

Preconditions: use the parent lifecycle and index guards, list styling enabled, and an installed Shiki fixture for scripts that toggle it. Each output directory must be fresh. Geometry scripts generally place cursors and change settings through APIs; that setup does not prove clicks or typing.

- **Native task actions:** `n exec 22.23.1 node scripts/verify-task-bullets.cjs "$PROOF_DIR/task-bullets"` and separately `n exec 22.23.1 node scripts/verify-task-bullets.cjs "$PROOF_DIR/task-bullets-mobile" --mobile`. These hit-test and send real mouse/touch input. Require separate bullet/checkbox hit boxes, checkbox `[ ]`/`[x]` changes without zoom, bullet zoom without Markdown changes, wrapped alignment, native Undo/Redo, folded-task controls, and desktop-only task dragging. Source/style/reload transitions use APIs. Mobile mode is actually toggled.
- **Preview/editing geometry:** `n exec 22.23.1 node scripts/verify-nested-code-layout.cjs "$PROOF_DIR/code-layout" --long`. Repeat in native, Shiki, and numbered Shiki states using fresh paths. It moves the cursor and edits through editor APIs; require native marker/guide alignment, correct `.cm-preview-code-block` bounds, expected Markdown, and stable top/bottom viewport cases. It is not native typing proof.
- **Spacing and adjacent-block parity:** `n exec 22.23.1 npm run test:code-parity -- "$PROOF_DIR/code-parity"` and `n exec 22.23.1 node scripts/verify-nested-code-spacing.cjs "$PROOF_DIR/code-spacing"`. Both compare native, Shiki, and numbered modes; require preview/editing glyph positions and painted bounds to agree, not just total height.
- **Blank, alternate-marker, and live-setting shapes:** begin with Shiki installed but disabled, then run `n exec 22.23.1 node scripts/verify-nested-code-matrix.cjs "$PROOF_DIR/code-matrix"`. It toggles processors/settings on the same open note. Require unchanged Markdown and correctly aligned blank-first, ordered, tilde/four-backtick, deep, framed, and wrapped blocks.
- **One long offscreen block:** run `n exec 22.23.1 node scripts/verify-nested-code-long-block.cjs "$PROOF_DIR/code-long"`; repeat with fresh paths and `--blank-viewport`, `--blank-viewport --zoom-parent`, and `--blank-viewport --partial-zoom`. Use native/Shiki/numbered states as applicable. Require visible code backgrounds/guides when the opening fence is offscreen or only blank rows are visible. The many-short-block `--long` layout case is a different test.
- **Redraw and first appearance:** `n exec 22.23.1 node scripts/verify-nested-code-redraw.cjs "$PROOF_DIR/code-redraw"` and `n exec 22.23.1 node scripts/verify-nested-code-first-paint.cjs "$PROOF_DIR/code-first-paint"`. These use empty editor updates or programmatic scrolling and capture frames. Require persistent code backgrounds, stable glyph/scroll positions, horizontal reach, and complete layout at the first host-classified code frame. They do not send repeated native typing.
- **Width and indentation/copy data:** `n exec 22.23.1 node scripts/verify-nested-code-width.cjs "$PROOF_DIR/code-width"` and `n exec 22.23.1 node scripts/verify-nested-code-preview-indent.cjs "$PROOF_DIR/code-indent"`. Require fitted painted width and literal code indentation across tabs/partial tabs, empty/wrapped/offscreen rows, and editing/preview. The scripts inspect rendered/copy data; a native copy-button click plus clipboard/paste assertion remains a separate manual path.
- **Native code input/navigation:** `n exec 22.23.1 node scripts/verify-nested-code-interactions.cjs "$PROOF_DIR/code-input"` types code with CDP input before its drag/history checks. `n exec 22.23.1 node scripts/verify-vim-code-navigation.cjs "$PROOF_DIR/code-vim-nav"` sends native `j`/`k` across source/fence rows with Shiki off/on. `n exec 22.23.1 node scripts/verify-vim-code-newlines.cjs "$PROOF_DIR/code-vim-newlines"` sends `o`/`O` then text. Require exact source/cursor results and no skipped rows or invented bullet inside code.
- **Native gaps:** focus visible code through a real click, type repeatedly near a nested block with `Input.insertText`, and record caret screen Y, `scrollTop`, glyph/marker/background bounds, and Markdown after each received input. Locate the native copy control in `.code-block-flair`, or Shiki's `button[data-code]`; click after hit testing, then paste into a scratch note and compare code-only indentation. Test theme/list-style changes and ordinary ordered/unordered wrapping through their actual settings UI; API-renderer checks do not certify those entry points.

## Gotchas

- Task bullets apply to styled unordered tasks; use the native checkbox independently. Source mode intentionally exposes Markdown instead of the Live Preview task bullet.
- A physically blank code row still has a line box; an empty block still needs visible height. Equal block totals can hide wrong gaps or clipped first/last glyphs.
- Do not mistake a processor embed for native editable rows. Test native code and `.cm-preview-code-block` separately, including language-free and numbered cases.
- Shiki state/line-number setup varies by script. Record the actual mode, restore it, and report a missing plugin fixture as an unmet precondition, not a passing native case.
- These desktop code-layout scripts do not certify mobile code rendering, arbitrary themes, repeated native typing, or every copy-button hit target.
