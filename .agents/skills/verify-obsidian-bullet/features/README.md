# Bullet verification map

Use this index with the [parent skill](../SKILL.md). The map records supported user entry points and the evidence available for each. A passing script verifies only the paths it actually drives.

## Shared preconditions

- Run all commands from the repository root. Use the parent skill's `start`, `doctor`, `capture`, and `cleanup` lifecycle: `n exec 22.23.1 node .agents/skills/verify-obsidian-bullet/scripts/control.cjs <action> <absolute-proof-directory>`.
- Set `PROOF_DIR` to that run's absolute proof directory. Script output directories below it must be fresh. The lifecycle deploys a production build; these standalone CDP scripts do not require the Jest test renderer.
- Drive only the repository's `vault` through `obsidian-cli vault=vault`. Require Bullet enabled, `useTab === true`, `tabSize === 4`, and the expected build from `doctor`. Keep one native driver active at a time.
- Before each manual input, focus the test renderer and recheck its title, vault path, and target. Resolve coordinates from fresh DOM bounds and require `document.elementFromPoint(x, y)` to hit the intended control. Wait for reload notices to clear.
- Start desktop recipes outside mobile emulation. Mobile recipes must toggle Obsidian mobile mode and use touch input; a narrow viewport alone does not cover mobile behavior. Let each script restore its state, then run `doctor` before the next recipe.
- Use Live Preview unless the recipe explicitly tests Source mode. Keep Shiki Highlighter installed when a recipe requires it; record whether it is disabled, enabled without line numbers, or enabled with line numbers.

## Coverage and evidence

- **Native input:** CDP `Input.dispatchMouseEvent`, `Input.dispatchTouchEvent`, `Input.dispatchKeyEvent`, or `Input.insertText` reaches the real renderer. API-created notes, cursor placement, and settings changes are setup, not proof of those UI entry points.
- **Command/API or synthetic coverage:** command execution, editor API changes, and DOM `dispatchEvent()` verify the resulting behavior but do not prove command-palette selection, a toolbar tap, or native hit testing.
- **Manual gap:** use the named user path, fresh selectors, and CDP input below; save the action, before/after screenshot, document text, cursor/selection, and relevant fold/viewport state. Report it as unverified until exercised.
- For native keyboard actions, send both `keyDown` and `keyUp` through `Input.dispatchKeyEvent`. For mouse actions, send `mouseMoved`, `mousePressed`, and `mouseReleased`; touch uses `touchStart` and `touchEnd`. Use the parent's guarded CLI/CDP procedure.
- For scroll or paint claims, begin frame capture from the event the renderer actually receives and assert post-event frames exist. A fixed recording window started before a CLI command is insufficient.
- Preserve each script's JSON, screenshots, stdout/stderr, and exit code. Inspect findings inside JSON as well as exit status. For mutations, compare saved Markdown after the editor saves; a screenshot or successful command alone is insufficient.
- Integration specs are complementary checks **after managed cleanup**, under `AGENTS.md`'s separate test procedure. Jest global setup kills Obsidian by name and overwrites `vault/test.md`; back up first, build with `npm run build-with-tests`, wait for the test renderer to exit, and restore. Do not run Jest during this lifecycle. Its `keydown` calls the editor handler, and its guide/drag helpers synthesize DOM events; these are not native input proof.

## Features

| Map                                                               | Scope                                                                                                           |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [Structural editing and navigation](structural-editing.md)        | Enter, continuation lines, indentation, movement, selection, marker protection, Vim, and command entry points.  |
| [Branch zoom](branch-zoom.md)                                     | Bullet clicks, commands, breadcrumbs, subtree editing, pane-local focus, Properties, and restoration.           |
| [Guides and folding](guides-and-folding.md)                       | Guide groups, native arrows, mobile controls, fold commands, clicked-parent position, and resize restoration.   |
| [Desktop drag and drop](desktop-drag-and-drop.md)                 | Same-note and cross-note branch movement, destination types, zoomed panes, and paired history.                  |
| [List, task, and code rendering](list-task-and-code-rendering.md) | Styled markers, independent task controls, nested code preview/editing, wrapping, code copy, and Vim code rows. |

The entry-point inventory comes from `README.md`, production command registrations and `SettingsTab.ts`. Recipes come from `scripts/verify-*.cjs`; complementary behavior cases live in `specs/features/`. This map does not certify unrun cases.
