# Structural editing and navigation

Bullet edits an item together with its descendants while keeping Markdown and the caret at the intended list position.

## Sub-features

- `edit-enter`: create or split an item; outdent an empty nested item; carry checkbox state correctly into a new item.
- `edit-continuation`: insert or split a continuation line without a bullet.
- `edit-indent-move`: indent, outdent, or move a branch with children and continuation lines; preserve cursor position and ordered numbering.
- `edit-select`: cycle through item content, subtree, and enclosing list scope.
- `edit-guards`: keep directly typed body text in lists; protect marker positions during navigation/clicks, with an Alt/Option bypass.
- `edit-delete`: Backspace/Delete join or remove items without losing descendants; an empty child returns the cursor to its parent.
- `edit-vim`: normal-mode `o`/`O` creates list items inside a list and ordinary lines outside one.

## How to get to it (user POV)

- In a Markdown editor, use Enter, Shift+Enter, Tab, Shift+Tab, Backspace, Delete, arrow keys, and repeated Cmd+A on macOS or Ctrl+A elsewhere. Move branches with Cmd/Ctrl+Shift+Up/Down.
- Run these Command Palette entries, assign them under **Settings → Hotkeys**, or add editor commands to Obsidian's mobile toolbar:

| Palette label after `Bullet:`          | Command ID                                                |
| -------------------------------------- | --------------------------------------------------------- |
| Move list and sublists up / down       | `bullet:move-list-item-up` / `bullet:move-list-item-down` |
| Indent / Outdent the list and sublists | `bullet:indent-list` / `bullet:outdent-list`              |
| Insert note line                       | `bullet:insert-note-line`                                 |
| Select list content                    | `bullet:select-list-content`                              |

- Under **Settings → Bullet → Editing**, change **Keep typed text in lists**, **Keep cursor out of list markers**, **Enhance the Tab key**, **Enhance the Enter key**, **Vim-mode o/O inserts bullets**, and **Enhance the Ctrl+A or Cmd+A behavior**. Cursor options are **Allow cursor in markers**, **Keep out of bullets**, and **Keep out of bullets and checkboxes**.
- Enable Obsidian Vim mode, press Escape, then `o` or `O`. The diagnostic palette entry **Bullet: Show System Info** (`bullet:system-info`) opens an environment-information modal.

## Driving it with Obsidian CLI/CDP

Preconditions: use the parent lifecycle and index guards. Start with default Bullet editing settings; use actual tabs with width four. Enable Vim only for its recipe.

- **Native Enter and following input:** `n exec 22.23.1 node scripts/verify-zoom-enter-splits.cjs "$PROOF_DIR/enter-splits"` tests ordinary and zoomed ordered/task roots through CDP keys, subsequent text, and Undo/Redo. Require the expected source document, visible cursor, and breadcrumb state in `results.json`; zoom is prepared by command.
- **Native Vim code boundary cases:** `n exec 22.23.1 node scripts/verify-vim-code-newlines.cjs "$PROOF_DIR/vim-newlines"` sends Escape and `o`/`O`, then inserts `x`. Check literal code indentation and exact document/cursor results. This code-focused fixture does not cover every ordinary-list Vim entry.
- **Command movement with fenced descendants:** `n exec 22.23.1 node scripts/verify-fenced-code-movement.cjs "$PROOF_DIR/fenced-movement"` invokes movement/indent command IDs directly. Require the entire fenced branch to move, correct tab/space indentation and ordered-marker width, then the inverse operation to restore it. This does not exercise the palette or default movement hotkey.
- **Native keyboard gap:** focus `.cm-content` on a disposable note containing `- first\n- second\n\t- child`. Place the caret in `second` as setup, then send Tab (`code: Tab`, key code 9), Shift+Tab (`modifiers: 8`), and Cmd/Ctrl+Shift+Up/Down (`ArrowUp`/`ArrowDown`, key codes 38/40; macOS modifiers 12, other desktop modifiers 10). The branch and child move together; the caret stays at the same body character. Test Enter (13), Shift+Enter, Backspace (8), Delete (46), and Cmd/Ctrl+A (65) separately from fresh fixtures. Save literal before/after Markdown and selection, not just screen position.
- **Native guard gap:** type body text and Space on a wholly empty line, then paste equivalent text. Direct typing creates a list item; paste remains unchanged. Navigate and click bullet/checkbox prefixes in each cursor mode, then repeat holding Alt/Option (`modifiers: 1`). Verify caret offsets and unchanged Markdown. Exercise heading, quote, horizontal-rule, fence, and frontmatter input so the guard does not consume Markdown structures.
- **UI entry gaps:** open the Command Palette and choose each named command; separately assign a hotkey or add/tap an actual mobile toolbar button when that entry point is in scope. Calling `app.commands.executeCommandById(id)` only proves the command callback. `MobileToolbarCommands.spec.md` also invokes IDs directly and does not tap a toolbar. Open `bullet:system-info` through the palette and verify the modal can be closed.
- **Complementary isolated specs:** after lifecycle cleanup and the separate `AGENTS.md` test preparation, run `n exec 22.23.1 npx jest specs/features/ListsMovementCommands.spec.md specs/features/ListsMovementHotkeys.spec.md specs/features/ListsMovementMultilineSelection.spec.md specs/features/MobileToolbarCommands.spec.md --runInBand`. Enter/Tab/ShiftTab, selection, deletion, and typing-guard cases are in their matching `specs/features/*BehaviourOverride.spec.md` and `BulletTypingGuard.spec.md`. These use handler/API simulation, not CDP input.

## Gotchas

- A retained selection or breadcrumb is not enough after a structural edit: send the next character and verify where it was inserted.
- Narrow panes and sidebars can wrap list text and change ArrowUp/Down behavior. Start from the parent's single-pane baseline unless testing wrapping.
- `Keep typed text in lists` applies to direct typing/deletion, not paste, drop, or other plugins' edits. A physical blank line inside fenced code must stay literal.
- Settings toggled through plugin APIs are setup; UI settings controls and persistence after reload require a separate manual path.
- No current standalone script covers all ordinary-list keyboard shortcuts, three cursor modes, OS-specific modifier mappings, or mobile toolbar taps. Do not infer those from the narrower native recipes.
