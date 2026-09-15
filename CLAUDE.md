# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

For code-card spacing or padding changes, run the real-renderer parity check described in [docs/testing/code-block-parity.md](docs/testing/code-block-parity.md) and follow the corresponding rule in [AGENTS.md](AGENTS.md).

For fitted code-block width changes, follow the width verification rule under “リスト内のコードブロックについて” in [AGENTS.md](AGENTS.md).

For processor preview changes, follow the code text and copy payload verification rule under “リスト内のコードブロックについて” in [AGENTS.md](AGENTS.md).

For fenced-code editing guard changes, follow the typing and deletion verification rule under “リスト内のコードブロックについて” in [AGENTS.md](AGENTS.md).

For Vim newline changes, follow the real-key verification rule under “リスト内のコードブロックについて” in [AGENTS.md](AGENTS.md).

For code-preview fence layout changes, follow the native fence height and Vim navigation verification rule under “リスト内のコードブロックについて” in [AGENTS.md](AGENTS.md).

For code-row spacing changes, follow the preview/editing geometry verification rule under “リスト内のコードブロックについて” in [AGENTS.md](AGENTS.md).

For release publication or community review failures, follow the Community directory review rules in [AGENTS.md](AGENTS.md), including branch scans and browser-compatible source checks.

Obsidian Bullet is an Obsidian plugin that provides outliner functionality (like Workflowy or RoamResearch) with bullet/list operations, drag-and-drop, and more.

## Commands

```bash
# Build
npm run build              # Production build to dist/main.js
npm run build-with-tests   # Build including test server entry point
npm run dev                # Watch mode build

# Lint & Format
npm run lint               # Run prettier check + eslint on src/
npm run lint:fix           # Run prettier --write + eslint --fix on src/ (not defined but use: prettier --write src && eslint src --fix)

# Test
npm test                   # Run all tests (requires a running Obsidian instance for integration tests)
npm run test:unit          # Run only unit tests, skipping Obsidian integration tests
```

To run a single test file:
```bash
npx jest path/to/test.ts --forceExit
npx jest specs/features/EnterBehaviourOverride.spec.md --forceExit
```

Integration tests (`.spec.md` files) require a running Obsidian instance with the plugin loaded via `npm run build-with-tests`. The test environment connects via WebSocket on `ws://127.0.0.1:8080`.

Unit tests (`__tests__/*.test.ts`) can run standalone with `SKIP_OBSIDIAN=1`.

## Directory Structure

```
src/
├── editor/               # CodeMirror editor utilities
│   ├── index.ts          # Editor extension registration
│   ├── checkboxRe.ts     # Checkbox regex patterns
│   ├── createEditorCallback.ts
│   ├── createKeymapRunCallback.ts
│   └── isEmptyLineOrEmptyCheckbox.ts
├── features/             # Feature implementations (keyboard handlers, UI)
├── operations/           # List operations (indent, move, outdent, etc.)
├── root/                 # Core data model (Root, List classes)
├── services/             # Core services (Parser, ChangesApplicator, etc.)
├── utils/                # Utility functions
├── __mocks__.ts          # Test mock helpers
├── ObsidianBulletPlugin.ts           # Main plugin entry
└── ObsidianBulletPluginWithTests.ts  # Test variant with WebSocket server
```

## Architecture

The plugin follows a layered architecture:

### Core Data Model (`src/root/`)
`Root` and `List` classes represent the parsed list structure. `Root` holds the entire list block (start/end positions, selections). `List` is a tree node with parent/children, bullet, indent, optional checkbox, and multi-line content (notes). The `Parser` service builds this tree from editor text; `ChangesApplicator` diffs old vs new `Root` and writes minimal editor changes.

### Operations (`src/operations/`)
Each operation (e.g. `IndentList`, `MoveListUp`, `OutdentListIfItsEmpty`) implements the `Operation` interface with three methods: `perform()`, `shouldUpdate()`, `shouldStopPropagation()`. Operations mutate a `Root` in place. `OperationPerformer` orchestrates: parse → clone root → run operation → apply diff.

### Features (`src/features/`)
Each feature implements the `Feature` interface (`load()`/`unload()`). Features are behaviour overrides (key handlers, editor extensions) or UI features (settings tab, vertical lines, drag-and-drop). They receive services via constructor injection and register Obsidian event handlers/commands in `load()`.

### Services (`src/services/`)
- `Parser` — converts raw editor text into `Root`/`List` trees
- `ChangesApplicator` — applies Root diffs back to the editor
- `OperationPerformer` — ties Parser + ChangesApplicator together for feature use
- `Settings` — persists plugin settings via Obsidian's data API
- `ObsidianSettings` — reads Obsidian-level configuration (indent chars, vim mode, etc.)
- `IMEDetector` — detects active IME composition to skip key overrides
- `Logger` — debug logging gated by the debug setting

### Editor (`src/editor/`)
CodeMirror extensions and editor utilities. Registers keymaps, handles checkbox rendering, and provides editor callbacks for operations.

### Entry Point
`ObsidianBulletPlugin.ts` instantiates all services and features, then calls `load()` on each. The test variant `ObsidianBulletPluginWithTests.ts` adds a WebSocket server for the integration test harness.

## Tests

- For task bullet changes, follow the widget placement and desktop/mobile verification procedure in `AGENTS.md` (Task bullets).

- For mixed-indent zoom or whole-document replacement changes, follow the native-guide, unzoomed-baseline, and next-input checks in `AGENTS.md` (zoom and multi-pane synchronization).
- For phone zoom breadcrumbs, follow the native-header spacing and touch verification procedure in `AGENTS.md` (zoom and multi-pane synchronization).

- For zoom/save changes, follow the Linter diff and cross-pane verification procedure in `AGENTS.md` (zoom and multi-pane synchronization).

- For Computer Use tests in Live Preview, follow the caret-position verification procedure in `AGENTS.md` before entering test input.

- For fold-scroll reserve changes, follow the real-Obsidian resize verification procedure in `AGENTS.md` (native chevron scroll retention).

- **Unit tests** (`src/operations/__tests__/*.test.ts`, `src/services/__tests__/`) — use mock helpers from `src/__mocks__.ts` (`makeEditor`, `makeRoot`, `makeSettings`).
- **Integration tests** (`specs/features/*.spec.md`, `jest/DefaultObsidianBehaviour.spec.md`) — Markdown files parsed by `jest/md-spec-transformer.js`. Each `# heading` is a test case; actions (`applyState`, `keydown`, `assertState`, etc.) drive a real Obsidian instance via WebSocket.

### Writing Integration Tests

Test files are markdown (`.spec.md`) with test cases as `# headings`. Available actions:

- `applyState` - Set editor content and cursor position
- `keydown` - Simulate key press
- `assertState` - Assert editor content and cursor position
- `assertSelection` - Assert selection range


      # Test case name
      
      applyState:
      ```
      - Item 1|
      - Item 2
      ```
      
      keydown: Enter
      
      assertState:
      ```
      - Item 1
      - |
      - Item 2
      ```


### Debugging Tests

To debug integration tests, add `console.log` statements in the code. For unit tests:
```bash
SKIP_OBSIDIAN=1 npx jest path/to/test.ts --forceExit --verbose
```

## Build

Rollup bundles to a single CJS `dist/main.js`. `PLUGIN_VERSION` and `CHANGELOG_MD` globals are injected at build time. Obsidian, CodeMirror packages are externalized.

- List marker spacing
    - When changing deletion guards, allow surplus spaces or tabs after a list marker to be deleted while preserving its indentation, marker, and at least one separator. Verify the resulting document and cursor through `BulletTypingGuard` transactions; classifier prefixes include editable spacing as well as required syntax.

- Structural editing regression checks
    - For zoom heading spacing and panel styling, follow AGENTS.md's `scripts/verify-zoom-code-scroll.cjs` verification, including repeated source/preview transitions and restoration after zoom.
    - Standalone CDP checks that assert layout must enable `Emulation.setFocusEmulationEnabled` and confirm `document.visibilityState === "visible"`, then disable the override in `finally`. A hidden Electron renderer can reflow measured DOM without running resize or animation-frame callbacks; `window.focus()` alone is insufficient.
    - When changing list insertion, zoom edit guards, or document replacement, run `n exec 22.23.1 node scripts/verify-zoom-enter-splits.cjs <fresh-output-directory>` against the deployed test build. Verify both document and cursor after Enter, following input, Undo, and Redo, with and without zoom; a visible breadcrumb alone does not establish correct editing.
    - Obsidian may bundle a different CodeMirror history implementation from the unit-test dependency. For cursor/history changes, verify Enter and following input through native Undo/Redo in the real editor, and preserve the selection accepted by transaction filters when recording the history destination.
    - When changing fenced-list parsing or numbering, run `n exec 22.23.1 node scripts/verify-fenced-code-movement.cjs <fresh-output-directory>`. Preserve raw tab continuations and literal code indentation through movement and its inverse, including marker-width changes at 9/10 and 99/100 in unit tests. Bound `parseRange` even when its final line is a physical blank inside a fence.

- Formatter compatibility for empty list ancestors
    - Follow AGENTS.md's empty-parent save verification using `scripts/verify-empty-parent-code-save.cjs` and the actual installed formatter. Preserve formatter whitespace, atomic history, and literal code/HTML; verify repeated saves as well as the first save.
- Zoom editing
    - When changing zoom editing, run `scripts/verify-zoom-subtree-editing.cjs` against the deployed test build. Preserve leaf child creation, subtree boundaries, descendant fold behavior, and cursor placement across numbered-marker width changes.
