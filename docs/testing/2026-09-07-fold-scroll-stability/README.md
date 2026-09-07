# Fold scroll stability verification

The fixed CodeMirror end reserve remains in use. The captured minimum-height prototype was not adopted.

| Regression                                                   | Before                                                                                 | Verified after the fix                                                                                                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native fold with guide action disabled, then resize          | Visible line 45 became 41; protected padding reset to 100px                            | Same visible line and screen Y in all four guide/Properties combinations; computed reserve stayed at 797.5px despite Obsidian's inline 100px write |
| Fold a child while zoomed, then return to the whole note     | Visible line 71 became 67, about 105px away                                            | Original line 71 restored with 0px screen-Y difference                                                                                             |
| Narrow and widen a long wrapped document near its folded end | Browser clamped at 8096 instead of 7692; visible line disappeared into the end reserve | Line 72 retained at the same Y through both width cycles; after ordinary scrolling, line 68 also stayed fixed                                      |

The reserve now has one owner shared by native controls and guide folding. Desktop native folding keeps protection when the guide action is disabled. On mobile, the reserve is present only when right controls or guide folding need it. The four setting combinations and transitions were checked in the test vault.

Whole-note zoom uses the existing viewport-corrected snapshot. Width changes keep a per-editor CodeMirror snapshot, including pane changes without a window resize event. Navigation and document edits invalidate older checkpoints; a coalesced capture after layout re-arms protection even when a background effect produces no geometry update. Resize restoration uses a standard scroll effect in the current layout turn. No manual scrollTop correction, timer-based correction, larger arbitrary padding, or new overlay was added.

## Reproduction commands

Run against the deployed test build in the repository vault, separately from full tests and other UI checks:

```sh
n exec 22.23.1 node scripts/verify-fold-scroll-resize.cjs
n exec 22.23.1 node scripts/verify-fold-scroll-resize.cjs --frontmatter
n exec 22.23.1 node scripts/verify-fold-scroll-stability.cjs
n exec 22.23.1 node scripts/verify-fold-scroll-stability.cjs --pane
n exec 22.23.1 node scripts/verify-fold-scroll-stability.cjs --zoom
n exec 22.23.1 node scripts/verify-fold-scroll-stability.cjs --navigation
```

The first two checks are run with the guide action enabled and disabled. Each script guards the vault path, desktop mode, and tab settings, creates its own fixture, asserts document-line/screen-coordinate behavior, and restores the previous note and viewport.

The resize unit regressions use CodeMirror's actual state, scroll effects, transaction update, and measurement lifecycle with controlled DOM geometry. They cover stale snapshots before and after pending navigation, automatic anchoring after an edit above the viewport, background effects, independent editors, ordinary scrolling, and destruction.

## Method and limits

Real-renderer checks use Obsidian 1.14.0 through the vault-scoped Obsidian CLI/CDP and synthetic native pointerdown → pointerup → click sequences. Computer Use was unavailable because the Mac was locked. These results establish actual editor layout and transaction behavior; they are not a claim of successful physical pointer testing while locked.

An independent code review reproduced the pending-navigation and queued-measurement cases, and cleared the final implementation after their fixes. The full suite passed all 82 suites: 769 unit tests and 148 integration tests passed, with 15 existing integration skips. Lint, TypeScript, the test build, and all eight standalone real-renderer replays passed. The first full run found an obsolete source-order assertion; it was updated for the shared reserve feature and the entire suite passed on the second run.

The secondary scrolling check deliberately anchors a short visible row. Using the offscreen top of a partially visible long wrapped row would confuse the row's legitimate change in height with movement of the visible content.

Eight original test-vault files were restored after the renderer exited, with matching backup hashes checked twice. The original 337 × 1242 window size was restored. Measurements, mobile setting transitions, and verification details are recorded in [results.json](results.json).
