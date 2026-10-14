# Desktop drag and drop

Dragging a list handle moves its whole branch within a note or between editable notes open side by side in the same desktop window.

## Sub-features

- `drag-branch`: move an item with descendants and continuation lines; choose its insertion order and indentation from the drop location.
- `drag-handles`: start from a bullet or fold indicator without also zooming/folding it. Task checkboxes and labels do not start branch dragging.
- `drag-cross-note`: remove the source branch, insert it once in the destination, and focus the destination.
- `drag-destinations`: support existing lists, empty notes, and ordinary text; place frontmatter drops after its closing delimiter and reject fenced-code interiors.
- `drag-history`: Undo/Redo from either participating editor coordinates both documents while their original views remain writable.
- `drag-zoom`: translate visible indentation correctly in source-only, target-only, or both-zoomed panes while preserving raw Markdown indentation.
- `drag-cancel`: Escape cancels an active drag and removes its drop marker without moving the branch.

## How to get to it (user POV)

- Enable **Settings → Bullet → Editing → Drag-and-Drop**. On desktop, drag a `.cm-formatting-list` / `.list-bullet` or `.cm-fold-indicator`. Styled tasks have a separate `.bullet-plugin-task-bullet .list-bullet` handle. Keep checkbox and label interactions native.
- Drop above, below, or indented into another item in the same pane. For another file, open two editable Markdown notes in side-by-side panes within one window and drag across.
- Use native Undo/Redo in either editor after the move. For zoomed variants, first enter branches by bullet or zoom command, then drag between their visible contents.

## Driving it with Obsidian CLI/CDP

Preconditions: use the parent lifecycle and index guards, desktop mode, writable notes, and Drag-and-Drop enabled. The task-bullet desktop helper and nested-code interaction recipes also require **Style list bullets** enabled. Only these recipes should own the temporary split panes. Shiki must be installed for the enabled variants.

- **Native desktop movement and paired history:** `n exec 22.23.1 node .agents/skills/verify-obsidian-bullet/scripts/verify-desktop-drag.cjs "$PROOF_DIR/desktop-drag"` creates two scratch notes and panes through APIs. It uses native input to reject checkbox dragging, cancel a task-bullet drag with Escape, and move the task with its child across notes. Require exact source/destination Markdown, immediate destination editor focus before API focus changes, paired native Undo/Redo, and matching saved files. The helper restores its panes, sidebar state, and fixtures. It does not cover code-block geometry or zoomed destinations.
- **Nested-code interaction harness drift:** `scripts/verify-nested-code-interactions.cjs` still measures the source-bearing marker span instead of translated bullet paint. On 5.20.2 it fails `marker shares first code line` even when cross-note documents, paired history, and saves match. Do not count that invocation as a passing geometry test. Use `verify-nested-code-positions.cjs` from the [rendering map](list-task-and-code-rendering.md) for current paint measurements and the skill-owned desktop helper for movement. The external script needs its marker measurement repaired before its code/zoom geometry assertions can certify those recipes.
- **Native zoomed destinations:** `n exec 22.23.1 node scripts/verify-nested-code-interactions.cjs "$PROOF_DIR/drag-both-zoomed" --zoomed-drag`. Repeat with fresh output paths and `--source-zoom-only`, `--target-zoom-only`, and `--zoomed-drag --last-child`. Require hidden siblings to stay unchanged, visible drop-marker indentation to match the pointer, retained zoom roots, and coordinated history. Run the default and both-zoomed recipes with Shiki disabled and enabled; the script uses the current plugin state rather than testing both automatically.
- **Native task-bullet handle:** `n exec 22.23.1 node scripts/verify-task-bullets.cjs "$PROOF_DIR/drag-task"` includes a desktop task-subtree drag. Require the task and child to move, checkbox Markdown to remain intact, and zoom to remain inactive after the drag. This does not prove chevron-started dragging or checkbox rejection.
- **Handle gaps:** from fresh coordinates on the source row, send `Input.dispatchMouseEvent` with `mousePressed`, several `mouseMoved` events crossing the drag threshold, and `mouseReleased` on a hit-tested destination. Repeat separately for a bullet and native fold indicator. Capture the visible drop marker and full documents before/after; task state and fold state must not change merely because the handle started the drag. Attempt the same gesture from a checkbox and require no Bullet drop marker or subtree movement; separately verify a native checkbox click still toggles the task. A move past six CSS pixels followed by release back at the bullet must not enter zoom.
- **Destination gaps:** in two scratch notes, move `- parent\n\t- child` plus an indented continuation into (1) an empty note, (2) ordinary prose, (3) an existing list at two indentation levels, and (4) the frontmatter area. Confirm one complete insertion and one complete source removal; case 4 inserts after the closing `---`. Attempt a drop inside a fenced code body and require both documents unchanged. These variations are not covered by the code-to-list script.
- **History and settings gaps:** after a cross-note move, edit elsewhere and verify Undo removes that later edit before reversing the move. Exercise Undo from the source and destination separately. Disable Drag-and-Drop and verify native handle gestures no longer move branches. Use actual UI settings and history shortcuts when claiming those entry points.
- **Complementary isolated spec:** after managed cleanup and `AGENTS.md`'s separate test preparation, run `n exec 22.23.1 npx jest specs/features/DragAndDrop.spec.md --runInBand`. It covers same-note ordering, nesting, descendants, caret, and frontmatter using synthetic MouseEvents; it does not prove native cross-note input.

## Gotchas

- Dragging is desktop-only. Unopened tabs, the file explorer, separate windows, and reading-only targets are not supported destinations.
- Keep both original editors open and writable while verifying paired history. Closing/replacing a view changes that precondition.
- A visible drop marker is not a successful move. Assert both documents, destination focus, saved Markdown, and Undo/Redo.
- In zoomed panes, hidden source positions may still return boundary coordinates. Locate a visible source row before any pointer measurement.
- Restore split panes and sidebar state before other keyboard/integration tests; width changes can alter wrapping and cursor movement.
