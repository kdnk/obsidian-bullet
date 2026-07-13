# Restore Vertical Guide Folding Design

## Problem

The native-guide refactor changed both the target and the meaning of a vertical-guide click. The legacy overlay kept the represented parent and its direct items visible while folding or unfolding the descendant branches rooted at the parent's direct non-empty children. The native implementation initially folded the represented parent itself and mapped the one native guide on a deeply nested line to the immediate parent.

Live verification in Obsidian 1.13.1 showed that the immediate-parent mapping does not match the rendered guide. The `branch one` row in the regression fixture has no `.cm-indent`; the single `.cm-indent` on the deeper `leaf one` row paints the outermost indentation boundary and therefore represents `parent`. Mapping that element to `branch one` produces a no-op because `branch one` has no direct non-empty children.

A later guarded Computer Use click proved that outermost mapping and selection-safe batch folding work, but exposed a second native-guide limitation: after both child branches fold, every visible `.cm-indent` for that parent disappears. The parent, folded branch roots, and direct leaf remain visible only with `.cm-indent-spacing`, so there is no guide target for reopening. A one-way fold does not satisfy the legacy toggle contract.

The later selection-safety fix made that new behavior stable, but it did not restore the legacy folding contract. As a result, clicking a guide hides a different set of list items than it did before the native-guide refactor.

## Goals

- Restore the legacy click behavior for the parent represented by a native guide.
- Map the single native guide to the outermost real list ancestor before the parser's synthetic root.
- Keep the represented parent and its direct leaves visible.
- Fold all direct child branches when any direct child branch is open.
- Unfold all direct child branches when every direct child branch is folded.
- Keep folds closed when the selection starts inside a branch being folded.
- Retain CodeMirror-owned native guide rendering and capture-phase event handling.
- Keep a native guide segment visible on folded branch roots and direct leaves so the same parent can be reopened.

## Non-goals

- Reintroduce the plugin-owned guide overlay, coordinate cache, or scroll synchronization.
- Recreate independent per-depth hit targets when Obsidian exposes only one native guide element.
- Copy or reimplement Obsidian's guide geometry, colors, or theme rules.
- Change folding commands outside vertical-guide interaction.
- Add delayed refolding or event-order workarounds.

## Approaches Considered

### Restore the legacy calls literally

The old implementation called `fold` for each direct non-empty child. This restores which items remain visible, but it also allows CodeMirror to reopen a branch when the selection remains inside its folded range.

### Restore legacy semantics with selection-safe child folds

Select the direct non-empty children exactly as the old implementation did, while using `foldEnsuringCursorVisible` for each child. This restores the user-visible folding contract and retains the fix for CodeMirror's selection invariant.

This is the chosen approach.

### Keep the immediate-parent mapping

This was the initial native-guide design, but it assumes that a guide exists on the immediate child's row or that the one guide on a deeper row represents the immediate parent. Obsidian 1.13.1 disproves both assumptions for the regression fixture, so this approach cannot restore the visible old interaction.

### Map the native guide to the outermost real ancestor

Walk from the list owning the pressed line toward the parser's synthetic root and select the last real ancestor. This matches the outermost boundary painted by the single native `.cm-indent` and lets the existing direct-child batch operation reproduce the old visible behavior without adding overlay geometry.

This is the chosen target-mapping approach.

### Restore the overlay implementation

The old overlay provides independent per-depth guide elements, but it also restores the second scrolling and geometry system that drifted during CodeMirror virtualization. The requested folding behavior does not require that rendering architecture.

### Duplicate the native guide with plugin CSS

The plugin could draw a pseudo-element on `.cm-indent-spacing`, but that would duplicate Obsidian's guide width, offset, color, and theme behavior. Those values are owned by Obsidian and may change across themes or versions.

### Promote visible spacing spans into native guide spans

Obsidian leaves `.cm-hmd-list-indent > .cm-indent-spacing` on every visible indented branch root and direct leaf. Adding the existing `.cm-indent` class to those spans makes Obsidian apply its own guide width, offset, color, pointer area, and theme rules. A plugin-owned marker class identifies only promoted spans so the added class can be removed when the feature is disabled or the view is destroyed.

The promotion runs in a CodeMirror measurement write after construction, view updates, and setting changes. It does not create elements, measure coordinates, or manage scrolling. Folding triggers a view update; the newly visible spacing spans are promoted before the next interaction, leaving a valid guide target for reopening.

This is the chosen persistent-guide approach.

## Chosen Behavior

After resolving the parent represented by the pressed native guide:

1. Walk the pressed line's owning list toward the synthetic root and select its outermost real ancestor. If no real ancestor exists, allow normal mouse interaction to continue.
2. Collect the target ancestor's direct children whose `isEmpty()` value is false. These are the branch roots that can hide descendants.
3. If there are no such children, do nothing and allow the normal mouse interaction to continue.
4. If every collected child is folded, unfold every collected child.
5. Otherwise, fold every collected child with `foldEnsuringCursorVisible`, using that child's first-line content start as its fallback cursor.
6. Report the guide press as handled only after the batch action is selected.

After a batch fold, the visible branch roots and direct leaves retain promoted native guide segments. Clicking any of those segments resolves to the same outermost real ancestor and unfolds all direct non-empty children when every one is folded.

The parent itself is never passed to `fold`, `foldEnsuringCursorVisible`, or `unfold`. Direct leaves are never passed to those methods, so they remain visible in both states.

## Selection Safety

Each child fold uses its own fold range and fallback cursor. If the current selection head is inside that range, `MyEditor` moves the selection to the child root and applies the `foldEffect` in the same transaction. Selections outside the range are preserved.

Sequential child operations are safe because only one branch can contain the main selection. Once that branch is folded, the selection remains on its visible branch root while the remaining sibling branches are folded.

## Unchanged Architecture

- Obsidian's `.cm-indent::before` remains the only guide-rendering source. The plugin promotes existing spacing spans into that native class instead of drawing its own line.
- `contentDOM` continues to observe `mousedown` in the capture phase.
- The pressed line is parsed and mapped to its outermost real list ancestor before the parser's synthetic root.
- The handler continues to ignore disabled settings, non-guide targets, unavailable editor state, parse failures, and synthetic-root targets.
- No overlay DOM, layout observer, animation-frame scheduler, or coordinate cache is added.
- Promotion is scoped to visible CodeMirror DOM and is removed on disable and destroy.

## Testing

Unit tests will verify that:

- A deeply nested line's single native guide resolves to the outermost real ancestor, not its immediate parent.
- A root item, including one with leading indentation, has no real ancestor target.
- Visible `.cm-indent-spacing` spans are promoted without replacing existing native guides.
- Disabling the feature and destroying the view remove only plugin-owned promotions.
- Construction, view updates, and setting changes schedule promotion in a measurement write.
- Any open direct child causes all direct non-empty children to receive selection-safe folds.
- Every folded direct child causes all direct non-empty children to unfold.
- Each child fold receives that child's own line and content-start fallback cursor.
- The represented parent is never folded or unfolded.
- Direct leaves remain untouched.
- A parent with no direct non-empty children is a no-op.
- The capture-phase handler invokes the restored batch behavior.
- Existing editor tests continue to prove atomic selection relocation and folding.

After focused tests pass, verification will run lint, `build-with-tests`, the complete test suite, and the production build. The built plugin will then be checked in Obsidian 1.13.1 with the cursor both inside and outside a branch, mixed folded children, fully folded children, reopening from a surviving guide segment, direct leaves, and a long list during scrolling.

## Documentation Corrections

The stable native-guide design and agent guidance must state both the outermost-ancestor mapping and the legacy batch-child contract. The earlier selection design remains valid at the `MyEditor` boundary but must describe child-branch folds instead of folding the represented parent itself. Historical plans that specify immediate-parent mapping are superseded by this design.
