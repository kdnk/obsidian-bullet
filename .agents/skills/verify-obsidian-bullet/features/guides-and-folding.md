# Guides and folding

Native arrows fold one item, while indentation guides fold or unfold a group's direct child branches together. Native folding keeps the clicked parent's screen position stable without extending editable content.

## Sub-features

- `fold-native`: toggle list or heading children with native chevrons while preserving the clicked parent and selection paint.
- `fold-guide`: toggle all direct child branches represented by an inner guide; keep the parent and child leaves visible.
- `fold-outer`: toggle branches in one contiguous root list chunk without affecting other chunks.
- `fold-hover`: highlight connected segments for the same ancestor, with rounded endpoints when enhanced guides are enabled.
- `fold-mobile`: use right-edge list/heading arrows and tap wrapped-line guide continuations.
- `fold-restore`: preserve folds and the visible document anchor through pane/viewport resize and zoom restoration.

## How to get to it (user POV)

- Click `.cm-fold-indicator .collapse-indicator` on a `.HyperMD-list-line` or `.HyperMD-header` in Live Preview.
- Click a native inner guide (`.cm-hmd-list-indent > .cm-indent`) or outer guide (`.bullet-plugin-outer-list-guide`). Any open direct child branch means fold all; when all are folded, unfold all. Hover any connected segment for group feedback.
- On mobile, tap right-edge arrows or a guide alongside a wrapped continuation row.
- Use **Bullet: Fold the list** / **Unfold the list** (`bullet:fold` / `bullet:unfold`) at the caret through the Command Palette, assigned hotkeys, or mobile toolbar. These commands have no default shortcut and require Obsidian's **Fold indent** setting.
- Under **Settings → Bullet**, toggle **Enhance vertical lines**, **Draw outer list lines**, **Fold lists from vertical indentation lines**, and **Show fold controls on the right on mobile** independently.

## Driving it with Obsidian CLI/CDP

Preconditions: use the parent lifecycle and index guards, Live Preview, native folding enabled, and default Bullet folding settings. Start each mobile script in desktop mode so it can own and restore the transition.

- **Native clicked-parent proof:** `n exec 22.23.1 node scripts/verify-fold-parent-position.cjs "$PROOF_DIR/fold-parent" --screenshots`. It sends actual CDP mouse input after hit testing and begins frame capture from the renderer's `click`. Require exact `delta: 0` across the initial sample, final states, and post-click frames, plus alternating folded state and unchanged Markdown. The external `.bullet-plugin-fold-scroll-reserve` stays noneditable, reuses its DOM node, returns to zero after unfolding, and never changes editable padding.
- **Native zoom/font/viewport matrix:** `n exec 22.23.1 node scripts/verify-fold-parent-position.cjs "$PROOF_DIR/fold-matrix" --full --screenshots`. Run additional fresh invocations with `--kind=ordered`, `--kind=task`, `--kind=nested`, `--kind=empty`, `--kind=heading`, and `--kind=wrapped`; default is `unordered`. Use `--selection=range`, `--selection=multiple`, or `--selection=vim` for cursor/selection-layer alignment, and `--new-pane` or `--collapsed-properties` for those contexts. Each option needs its own recorded invocation; one default run does not cover these variants.
- **Native mobile arrow proof:** `n exec 22.23.1 node scripts/verify-fold-parent-position.cjs "$PROOF_DIR/fold-mobile" --mobile --screenshots`; repeat with `--kind=heading`. The script toggles Obsidian mobile mode and sends touch input, not just viewport emulation. Require the same parent-position and Markdown assertions. This is right-control coverage, not guide tapping.
- **Resize after a fold, synthetic fold setup:** `n exec 22.23.1 node scripts/verify-fold-scroll-resize.cjs --frontmatter > "$PROOF_DIR/fold-resize.log" 2>&1`. It expands Properties, folds using DOM PointerEvents, and changes viewport width. Require the same visible source line within one physical pixel, retained fold and Properties, and reserve outside `.cm-content`. Omit `--frontmatter` for the plain-note case.
- **Pane reflow and navigation, synthetic fold setup:** `n exec 22.23.1 node scripts/verify-fold-scroll-stability.cjs --pane > "$PROOF_DIR/fold-pane.log" 2>&1` and `n exec 22.23.1 node scripts/verify-fold-scroll-stability.cjs --navigation > "$PROOF_DIR/fold-navigation.log" 2>&1`. These change pane width through setup APIs and verify stable anchors or intentional cursor navigation. They do not prove a native pane-divider drag or exact-zero clicked-parent frames.
- **Native guide/hover gap:** create a parent with two child branches, one already folded, and a child leaf. Match a rendered source row, then hit-test the exact inner raw-indent-prefix guide or the outer guide for its root chunk. Send native mouse down/up, let `click` complete, and verify both child branches fold, the parent/leaf remain, and a second click unfolds them. Repeat after reopening a saved fold and require native `.list-bullet` rendering. Hover each group, move to a different ancestor, and leave the editor; capture connected highlights and rounded endpoints. In actual mobile emulation, use touch on a wrapped continuation segment. Existing guide specs use synthetic MouseEvents, so these pointer/paint paths remain manual.
- **Command and settings gaps:** execute `bullet:fold` / `bullet:unfold` through each requested user entry point and verify fold offsets without document changes. With guide action disabled, native arrows still work and guide clicks do nothing. With outer guides disabled, those controls disappear. With mobile-right-controls disabled, native placement returns; do not claim Bullet's mobile arrow-position guarantee in that mode.
- **Complementary isolated specs:** after managed cleanup and `AGENTS.md`'s test preparation, run `n exec 22.23.1 npx jest specs/features/VerticalGuideInteraction.spec.md specs/features/ListsFoldingCommands.spec.md --runInBand`. They verify raw-prefix targeting, saved-fold reopening, selection relocation, and command behavior using synthetic events/command calls.

## Gotchas

- A native arrow anchors the clicked parent; a guide can fold several branches and must keep a surviving visible anchor. Do not substitute constant `scrollTop` or total document height for screen-position proof.
- Guide count does not equal nesting depth: Obsidian may combine indentation units. Resolve the intended ancestor from the actual prefix, not the guide index.
- One synthetic `click()` skips native pointer routing and can conceal covered controls. A `mousedown`-only guide test also misses the actual folding action.
- Resize scripts use a one-physical-pixel tolerance; native parent-position scripts require exact CSS Y equality. Report their results separately.
- Source mode, disabled settings, physical mobile devices, and real guide hover/touch are not certified by the default native-arrow script.
