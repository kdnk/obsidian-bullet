# Folding and zoom followups — 2026-09-08

The existing bottom-reserve design is retained. Pending native-fold scroll snapshots now expire when a document edit intervenes. Ordinary text edits inside list-item bodies map the zoom decorations without reparsing the surrounding list; structural edits still use the full parser. Hidden boundaries are rebuilt so text appended at the visible end stays visible. Breadcrumb buttons persist when their labels and destinations are unchanged. The settings descriptions now explain the actual selection cycle and direct-child folding behavior.

The zoom scroll verifier now requires a successful zoom into the intended parent and a real expanded-to-folded transition of the intended child before checking restoration. A no-UI harness accepted the valid sequence and rejected 10 invalid intermediate/restoration sequences.

Validation used Node.js 22.23.1 and Obsidian 1.14.0 in the repository vault:

- Full suite: 82 suites passed, 925 tests passed, 15 Linux-only keyboard tests skipped on macOS.
- Prettier/ESLint, TypeScript checking and the test build passed.
- Independent review compared 11,610 edit cases with fresh full parsing; all zoom ranges, ancestor labels and decoration boundaries matched.
- With 100, 1,000 and 10,000 hidden siblings, a one-character child edit now performs 0 parser-reader line accesses, down from 211, 2,011 and 20,011 respectively. This measures parser work, not end-to-end input latency.
- All six standalone layout scenarios passed: window reflow, pane reflow, zoom restoration, newer navigation, viewport-height resize, and height resize with Properties.
- Real-renderer typing, visible-end insertion, focused-item rename, cross-pane synchronization and plugin reload while zoomed passed. Unchanged breadcrumbs retained their actual DOM buttons during child edits.

One initial full-suite failure came from an 81px-wide content area that wrapped a short list row. Collapsing the test-vault sidebars increased it to 381px; the same build passed the affected spec and then the complete suite. AGENTS.md records the sidebar, document-snapshot and decoration-boundary precautions.

The Mac was locked, so native Computer Use mouse actions were unavailable. Renderer validation used vault-guarded Obsidian CLI/CDP, including text input and synthetic native pointer sequences. No renderer errors were captured. All eight saved test-vault files were restored after the renderer exited, with two matching SHA-256 checks.

See [measurements and verification results](results.json) and the [zoom editing screenshot](zoom-editing.png).
