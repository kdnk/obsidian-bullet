# Vertical Guide Hover Feedback Design

## Context

Vertical indentation guides are clickable when the vertical-lines feature and its toggle-folding action are enabled. A pointer cursor alone makes that action easy to miss, especially when the normal guide color is faint.

The first implementation highlighted only the `.cm-indent` segment directly under the pointer. Live verification showed that this changes one row fragment while clicking operates on the list ancestor represented by the complete logical guide. That visual scope is misleading: the hover affordance should identify the same logical parent scope as the click action.

Obsidian renders a logical vertical guide as multiple native `.cm-indent::before` segments across visible CodeMirror rows. Segments at the same horizontal position can belong to unrelated lists, so geometry or indentation depth alone cannot identify the correct group. The plugin already resolves each native segment to the exact real list ancestor represented by its raw indentation boundary; hover grouping should reuse that semantic mapping.

Obsidian 1.13.1 exposes native indentation-guide variables for normal and active states:

- `--indentation-guide-color`
- `--indentation-guide-width`
- `--indentation-guide-color-active`
- `--indentation-guide-width-active`

The plugin should reuse the active-state variables instead of inventing fixed colors or geometry.

## Goals

- Make an actionable vertical guide visibly react when the pointer is over any of its rendered segments.
- Highlight every currently rendered native segment that resolves to the same real list ancestor as the hovered segment.
- Keep unrelated lists at the same indentation depth in their normal style.
- Use Obsidian's active indentation-guide color and width so themes remain in control.
- Cover both ordinary native guides and plugin-promoted persistent native guides.
- Show the pointer cursor and hover feedback only while toggle folding is enabled.
- Preserve exact guide targeting, folding behavior, layout, virtualization, scrolling, and cleanup.

## Non-goals

- Do not highlight unrelated guides merely because they share an X coordinate or indentation depth.
- Do not create a single overlay element or restore the legacy overlay architecture.
- Do not add guide geometry measurements, coordinate caches, scroll-position caches, animation-frame loops, or pointer-position caches.
- Do not use a fixed plugin accent color, background highlight, transition, or normal-state style override.
- Do not change touch, keyboard, folding, target-resolution, or selection-safety behavior.
- Do not render off-viewport segments that CodeMirror has virtualized away; synchronize the currently rendered native segments instead.
- Do not change package versions or create a release unless separately requested.

## Considered Approaches

### Semantically group existing native segments

Resolve the hovered segment with the existing exact indentation-boundary algorithm. Resolve every currently rendered candidate segment against the same parsed root and mark only candidates whose target ancestor has the same first-line content position.

This is the selected approach. It makes hover scope match click scope, distinguishes unrelated lists at the same indentation depth, and keeps native rendering and virtualization in control.

### Group segments by horizontal position

Measure or compare the segments' X coordinates and highlight every segment at the hovered X position.

This is simpler than semantic resolution, but separate list trees commonly reuse the same indentation column. It would highlight unrelated guides and visually claim that one click affects content it does not affect.

### Restore a plugin-owned full-height overlay

Render one continuous plugin element per logical list guide.

This can draw a visibly continuous line, but it restores duplicate DOM, geometry measurement, scroll synchronization, and drift risks that the native-guide design removed. It is not selected.

## Action-State Body Class

Keep the separate `.bullet-plugin-vertical-lines-action-toggle-folding` document body class from the first implementation. `VerticalLines` applies it to the main document and Obsidian pop-out documents only when both conditions are true:

- `settings.verticalLines` is enabled;
- `settings.verticalLinesAction` is `"toggle-folding"`.

The existing `.bullet-plugin-vertical-lines` class continues to represent guide display and own persistent-guide layout rules. The action-state class scopes the pointer cursor and active hover border so the plugin does not advertise an unavailable action.

## Semantic Hover Grouping

`VerticalLinesPluginValue` will manage one marker class, `.bullet-plugin-hovered-indent-guide`, on native `.cm-indent` elements inside its own `contentDOM`.

When the pointer moves onto a native guide:

1. Require vertical lines and `toggle-folding` to be enabled.
2. Find the hovered guide's `.cm-line`, translate it to a document line with `view.posAtDOM`, and parse the editor once.
3. Obtain the list under that line and call the existing `resolveVerticalGuideTarget(list, hoveredGuide)`.
4. Identify the resolved target by its `getFirstLineContentStart()` line and character position within that parsed root.
5. Enumerate currently rendered `.cm-indent` candidates in this view.
6. For each candidate, find its row, obtain the corresponding list from the same parsed root, and call `resolveVerticalGuideTarget(candidateList, candidateGuide)`.
7. Add the marker only when the candidate target's first-line content position exactly equals the hovered target's position. Remove the marker from every other segment.

Using the same root and target resolver makes hover grouping and click targeting share one ownership rule. It handles outer and inner guides independently, works with combined native indentation spans, and avoids comparing transient `List` object IDs across separate parses.

If the hovered guide, row, editor, parsed root, list, or target cannot be resolved, clear every hover marker and leave the native guide appearance unchanged.

## Pointer and View Lifecycle

Use delegated pointer listeners on `contentDOM`; do not add listeners to individual virtualized guide spans.

- A capture-phase `pointermove` inspects the current event target. If it is a different native guide, recompute the semantic group. If it is not a guide, clear the group.
- A `pointerleave` clears every marker when the pointer leaves the editor content.
- Repeated movement over the same unchanged guide may return early to avoid reparsing on every pixel.
- View updates and persistent-guide synchronization must re-read the currently hovered native element with the CSS `:hover` state and resynchronize rendered markers. This handles CodeMirror replacing DOM after edits, folds, scrolling, or viewport changes without retaining pointer coordinates.
- A settings change clears markers immediately when either vertical lines or toggle folding becomes disabled.
- `destroy()` removes both delegated listeners and every plugin-owned hover marker in addition to the existing persistent-guide cleanup.

When a fold replaces the segment under a stationary pointer, the next CodeMirror update resolves the replacement native element under `:hover` and applies the group again. Only rendered segments are marked; newly rendered segments join the group during subsequent updates.

## Styling

Keep the pointer selector scoped to `.bullet-plugin-vertical-lines-action-toggle-folding`.

Replace the row-local `.cm-indent:hover::before` rule with a marker rule scoped by:

- `.bullet-plugin-vertical-lines-action-toggle-folding`;
- `.markdown-source-view.mod-cm6`;
- `.cm-hmd-list-indent`;
- `.cm-indent.bullet-plugin-hovered-indent-guide::before`.

Apply only:

```css
border-inline-end: var(--indentation-guide-width-active) solid
  var(--indentation-guide-color-active);
```

The pseudo-element remains Obsidian's native rendering source. The logical border property preserves right-to-left compatibility, and changing the pseudo-element border does not alter indentation layout. Persistent promoted guides already carry `.cm-indent`, so they use the same marker and style without duplication.

## Behavior and Failure Handling

Hovering an outer guide marks all visible segments that clicking would resolve to that outer parent. Hovering an inner guide marks only the visible segments that resolve to that child parent. Another list tree at the same horizontal position remains normal because its resolved target starts on a different line.

Moving from one segment of the same logical guide to another keeps the same semantic group. Moving to a different guide replaces the group. Moving away from guides clears it.

An unmatched native guide receives no marker and its click remains ignored by the existing handler. If a theme gives active and normal variables identical values, the plugin accepts that theme choice rather than substituting a fixed fallback.

No event path may prevent default or stop propagation for hover. Existing capture-phase `mousedown` handling remains solely responsible for the folding action.

## Automated Verification

Tests must be changed before production behavior and must first fail against the row-local implementation. Coverage will require:

- the action-state body class lifecycle from the first implementation to remain green;
- a hovered outer segment to mark all rendered segments resolving to the same outer parent;
- a hovered inner segment to mark all rendered segments resolving to the same child parent while leaving adjacent outer segments unmarked;
- a separate list at the same indentation depth to remain unmarked;
- unmatched guides and non-guide pointer targets to clear markers;
- marker resynchronization after rendered guide elements are replaced during a view update;
- action disablement, pointer leave, and `destroy()` to remove all markers and listeners;
- persistent promoted `.cm-indent` segments to participate in the same semantic group;
- the stylesheet contract to use the marker selector and both active indentation-guide variables;
- the old row-local `.cm-indent:hover::before` selector to be absent;
- existing target-resolution, click handling, persistent-guide layout, stacking, and selection-safety tests to remain green.

Focused tests, lint, TypeScript checks, `build-with-tests`, the complete Jest suite, and the production build must pass before live verification.

## Obsidian Verification

Manual verification must use only `/Users/kodai/workspaces/github.com/kdnk/obsidian-bullet/vault`. Every vault-affecting Obsidian CLI command must explicitly include `vault=vault`, and every Computer Use action must follow the existing fresh-window-title guard.

The fixture will contain two separate outer list trees at the same indentation depth and nested child branches. Verification will confirm:

1. Hovering one outer segment changes every visible segment belonging to that outer parent.
2. The second outer list at the same X coordinate remains in its normal style.
3. Hovering an inner segment changes the complete visible child guide while adjacent outer segments remain normal.
4. Moving away restores every segment to the normal guide style.
5. Scrolling or folding while the pointer remains over a guide resynchronizes newly rendered native segments without an overlay or drift.
6. Clicking the highlighted outer or inner guide preserves the existing level-specific toggle behavior.
7. A surviving ordinary or promoted persistent guide receives the complete-group feedback and can reopen the same branches.
8. Setting the vertical-line action to `none` removes the pointer and all hover markers without hiding guides.

Temporary fixtures, markers, and diagnostic metadata must be removed afterward. The installed test-vault artifacts must end on the production build and match source artifact hashes.

## Durable Agent Guidance

Agent guidance must state that hover feedback represents the complete logical guide, not the single row fragment and not every segment at the same X coordinate. Group rendered native segments by the same exact target ancestor used for click handling, style only a plugin-owned marker with Obsidian's active guide variables, resynchronize after CodeMirror view updates, and remove markers on pointer leave, disabled action, and destroy. Normal guide rendering, native geometry, and the no-overlay rule remain unchanged.
