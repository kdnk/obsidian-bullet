# Desktop drag and drop

Dragging a list handle moves its whole branch within a note or between editable notes open side by side in the same desktop window.

## Sub-features

- `drag-branch`: move an item with descendants and continuation lines; choose its insertion order and indentation from the drop location.
- `drag-handles`: start from a bullet, fold indicator, or checkbox without also zooming/toggling it.
- `drag-cross-note`: remove the source branch, insert it once in the destination, and focus the destination.
- `drag-destinations`: support existing lists, empty notes, and ordinary text; place frontmatter drops after its closing delimiter and reject fenced-code interiors.
- `drag-history`: Undo/Redo from either participating editor coordinates both documents while their original views remain writable.
- `drag-zoom`: translate visible indentation correctly in source-only, target-only, or both-zoomed panes while preserving raw Markdown indentation.

## How to get to it (user POV)

- Enable **Settings → Bullet → Editing → Drag-and-Drop**. On desktop, drag a `.cm-formatting-list` / `.list-bullet`, `.cm-fold-indicator`, or `.task-list-item-checkbox` / `.task-list-label`.
- Drop above, below, or indented into another item in the same pane. For another file, open two editable Markdown notes in side-by-side panes within one window and drag across.
- Use native Undo/Redo in either editor after the move. For zoomed variants, first enter branches by bullet or zoom command, then drag between their visible contents.

## Driving it with Obsidian CLI/CDP

Preconditions: use the parent lifecycle and index guards, desktop mode, writable notes, and Drag-and-Drop enabled. Only these recipes should own the temporary split panes. Shiki must be installed for the enabled variants.

- **Native cross-note movement and paired history:** `n exec 22.23.1 node scripts/verify-nested-code-interactions.cjs "$PROOF_DIR/drag-code"`. The script prepares two notes/panes through APIs, types into code with CDP input, then sends real mouse movement/down/up across the panes. Require `.bullet-plugin-drop-zone` at the intended destination indent, exact source/destination Markdown after the drop, destination state, native Undo restoring both documents, Redo moving them again, and matching saved files. Zoom entry within the script uses commands.
- **Native zoomed destinations:** `n exec 22.23.1 node scripts/verify-nested-code-interactions.cjs "$PROOF_DIR/drag-both-zoomed" --zoomed-drag`. Repeat with fresh output paths and `--source-zoom-only`, `--target-zoom-only`, and `--zoomed-drag --last-child`. Require hidden siblings to stay unchanged, visible drop-marker indentation to match the pointer, retained zoom roots, and coordinated history. Run the default and both-zoomed recipes with Shiki disabled and enabled; the script uses the current plugin state rather than testing both automatically.
- **Native task-bullet handle:** `n exec 22.23.1 node scripts/verify-task-bullets.cjs "$PROOF_DIR/drag-task"` includes a desktop task-subtree drag. Require the task and child to move, checkbox Markdown to remain intact, and zoom to remain inactive after the drag. This does not prove checkbox-started or chevron-started dragging.
- **Handle gaps:** from fresh coordinates on the source row, send `Input.dispatchMouseEvent` with `mousePressed`, several `mouseMoved` events crossing the drag threshold, and `mouseReleased` on a hit-tested destination. Repeat separately for a bullet, native fold indicator, and checkbox. Capture the visible drop marker and full documents before/after; checkbox state and fold state must not change merely because the handle started the drag. A move past six CSS pixels followed by release back at the bullet must not enter zoom.
- **Destination gaps:** in two scratch notes, move `- parent\n\t- child` plus an indented continuation into (1) an empty note, (2) ordinary prose, (3) an existing list at two indentation levels, and (4) the frontmatter area. Confirm one complete insertion and one complete source removal; case 4 inserts after the closing `---`. Attempt a drop inside a fenced code body and require both documents unchanged. These variations are not covered by the code-to-list script.
- **History and settings gaps:** after a cross-note move, edit elsewhere and verify Undo removes that later edit before reversing the move. Exercise Undo from the source and destination separately. Disable Drag-and-Drop and verify native handle gestures no longer move branches. Use actual UI settings and history shortcuts when claiming those entry points.
- **Complementary isolated spec:** after managed cleanup and `AGENTS.md`'s separate test preparation, run `n exec 22.23.1 npx jest specs/features/DragAndDrop.spec.md --runInBand`. It covers same-note ordering, nesting, descendants, caret, and frontmatter using synthetic MouseEvents; it does not prove native cross-note input.

## Gotchas

- Dragging is desktop-only. Unopened tabs, the file explorer, separate windows, and reading-only targets are not supported destinations.
- Keep both original editors open and writable while verifying paired history. Closing/replacing a view changes that precondition.
- A visible drop marker is not a successful move. Assert both documents, destination focus, saved Markdown, and Undo/Redo.
- In zoomed panes, hidden source positions may still return boundary coordinates. Locate a visible source row before any pointer measurement.
- Restore split panes and sidebar state before other keyboard/integration tests; width changes can alter wrapping and cursor movement.
