# Branch zoom

Zoom shows one item and its descendants in the current pane, with breadcrumbs to return to ancestors or the whole note. It preserves plain Markdown.

## Sub-features

- `zoom-enter`: focus an unordered, ordered, or task branch through its bullet or command; an empty leaf gains an editable child.
- `zoom-navigate`: zoom deeper, select ancestor breadcrumbs, step out, or show the whole note.
- `zoom-edit`: constrain edits and selection to the visible branch; keep the next typed character inside it.
- `zoom-pane`: preserve pane-local focus across visible-subtree edits and same-note synchronization; reveal the note when hidden content changes.
- `zoom-restore`: hide Properties while zoomed, restore note context on exit, and clear zoom on note switch or plugin reload.

## How to get to it (user POV)

- Click a list bullet in Live Preview, then a child bullet to go deeper. Task items have a separate bullet when **Style list bullets** is enabled. Checkbox and fold-arrow clicks keep their own actions.
- Choose **Bullet: Zoom into list** (`bullet:zoom-in`), **Zoom out one level** (`bullet:zoom-out`), or **Show whole note** (`bullet:zoom-reset`) in the Command Palette. These have no default shortcuts; users may assign hotkeys or mobile toolbar buttons.
- Use the **List zoom** navigation region: `.bullet-zoom-breadcrumbs button`. The last button has `[aria-current="location"]`; ancestor buttons show their item text, and the note-name button returns to the full note.
- Edit normally while zoomed, open the same note in another pane, switch notes, or reload Bullet. Zoom commands and breadcrumbs can also be exercised in Source mode.

## Driving it with Obsidian CLI/CDP

Preconditions: use the parent lifecycle and index guards. Enable list styling for task-bullet entry tests; use separate output directories for desktop and mobile.

- **Native bullet and checkbox entry, plus command/API cases:** `n exec 22.23.1 node scripts/verify-zoom-exploratory.cjs "$PROOF_DIR/zoom-exploratory"`. Its `bullet-click-and-checkbox` case uses CDP clicks on `.list-bullet` and `.task-list-item-checkbox`; the checkbox changes `[ ]` to `[x]` without changing the zoom target, and the child bullet changes the breadcrumb to `branch`. `native-fold-within-zoom` clicks `.collapse-indicator` without changing that target. Other cases deliberately use commands/editor APIs for setup, history, synchronization, replacements, and reloads. Require every executed `results.json` entry to report `pass`; this script can record a finding without a failing process exit.
- **Native breadcrumb buttons:** `n exec 22.23.1 node scripts/verify-zoom-breadcrumbs.cjs "$PROOF_DIR/zoom-breadcrumbs"` and, in a separate run, `n exec 22.23.1 node scripts/verify-zoom-breadcrumbs.cjs "$PROOF_DIR/zoom-breadcrumbs-mobile" --mobile`. Zoom is entered by command; breadcrumb navigation uses actual mouse/touch input. Require clickable ancestor/note buttons, the correct current label, no breadcrumb after reset, and visible controls below static/floating mobile headers. The mobile recipe toggles Obsidian mobile mode and touch emulation.
- **Editing within a command-prepared zoom:** `n exec 22.23.1 node scripts/verify-zoom-subtree-editing.cjs "$PROOF_DIR/zoom-editing"`, `n exec 22.23.1 node scripts/verify-zoom-enter-splits.cjs "$PROOF_DIR/zoom-enter"`, and `n exec 22.23.1 node scripts/verify-zoom-marker-insertions.cjs "$PROOF_DIR/zoom-markers"`. Run serially. Enter, Shift+Tab, and following text use CDP input; subtree-editing paste uses a synthetic ClipboardEvent and root removal uses a transaction. Check exact Markdown, visible cursor, retained target, selection bounds, and subsequent typing. Hidden siblings must remain unchanged; these scripts do not prove native clipboard paste or root deletion.
- **Insertion and second-pane synchronization:** `n exec 22.23.1 node scripts/verify-zoom-insertions.cjs "$PROOF_DIR/zoom-insertions"` combines native Enter with API-prepared same-note pane edits. An insertion before `project` must keep focus on the original `project`; edits above its hidden region reveal the whole note. This does not prove typing in the second pane through native input.
- **Optional formatter change application:** set `LINTER_BUNDLE` to an existing, approved local Linter `main.js` absolute path, then run `n exec 22.23.1 node scripts/verify-zoom-save.cjs "$LINTER_BUNDLE" > "$PROOF_DIR/zoom-save.log" 2>&1`. If no bundle is available, report the unmet prerequisite; do not install into a personal vault. The script calls Linter's diff method with inert UI stubs, then saves through the editor API. Timestamp, whitespace, and EOF normalization preserve `project`; a second pane's hidden body edit from `work` to `office` clears zoom. It does not enable Linter or exercise its Save hook or native Save hotkey.
- **Viewport restoration:** `n exec 22.23.1 node scripts/verify-fold-scroll-stability.cjs --zoom > "$PROOF_DIR/zoom-scroll.log" 2>&1` verifies command-based zoom/reset, folded-child state, Properties, and restoration of the previous visible line within one physical pixel. Its fold events are synthetic; use the [folding map](guides-and-folding.md) for native click/frame proof.
- **Remaining user paths:** with fresh coordinates, send native mouse/touch input to `.cm-formatting-list` or `.list-bullet` on ordered and empty leaf fixtures and verify target/cursor/Markdown. Exercise each palette entry, user hotkey, and actual mobile toolbar button separately. For drag arbitration, move beyond six CSS pixels and back before releasing on the bullet; this must not zoom. No mapped script certifies every one of these paths.

## Gotchas

- A checkbox or native chevron is not a zoom handle. Match the requested source line before measuring a bullet; virtualized offscreen lines may not have DOM.
- Zoom is pane-local. A visible breadcrumb does not prove hidden content is uneditable or that another pane stayed unzoomed; inspect both documents and the next input.
- API `setValue`, same-note synchronization, formatter changes, and native Undo/Redo are distinct paths. Record which one produced the result.
- Mobile breadcrumb proof covers header hit testing, not physical-device keyboards or mobile toolbar commands. Task-bullet touch entry is covered separately in the [rendering map](list-task-and-code-rendering.md).
- Always pass an explicit fresh output path to the exploratory script; do not use its historical default output location.
