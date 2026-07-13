# Stable Vertical Guides Design

## Problem

Vertical indentation guides are currently drawn in a second scrollable overlay. The implementation measures CodeMirror DOM, copies scroll offsets into the overlay, caches coordinates when virtualized DOM disappears, and applies several fixed vertical offsets. Recent history contains repeated fixes for disappearing, drifting, and lagging guides, which shows that the overlay is competing with CodeMirror's rendering lifecycle instead of participating in it.

The existing unit suite verifies mocked measurements, but it does not prove that two independently scrolling DOM trees remain aligned while CodeMirror virtualizes lines.

## Goals

- Keep vertical guides attached to list indentation during vertical and horizontal scrolling.
- Avoid disappearing or shifting guides when CodeMirror recycles off-screen DOM.
- Preserve click-to-fold behavior for the list ancestor represented by a guide.
- Support bullets, ordered lists, checkboxes, note lines, mixed nesting depths, folded lists, and list blocks with shared leading indentation.
- Keep the setting and per-document body-class behavior unchanged.
- Remove obsolete rendering state and tests that only exercise the obsolete overlay.

## Non-goals

- Reimplement Obsidian's indentation-guide geometry.
- Add custom-theme compatibility beyond the existing built-in-theme support statement.
- Change list parsing, folding semantics, or settings persistence.
- Preserve the exact DOM structure of the old overlay.

## Root Cause

The old implementation has multiple unsynchronized sources of truth:

1. CodeMirror owns the document, viewport, line DOM, and primary scroller.
2. The plugin owns a second scroller and a pool of absolutely positioned guide elements.
3. Guide geometry combines document positions, viewport estimates, screen coordinates, CSS padding, scroll offsets, cached measurements, and fixed pixel/em corrections.
4. Measurements run from a plugin-managed animation frame instead of CodeMirror's coordinated measurement phase.
5. The cache key uses line number, indentation text, and checkbox state. It is never remapped or cleared after document edits, so a new list can inherit an unrelated old measurement.

No additional cache invalidation or scheduling rule can make these independent coordinate systems a single source of truth.

## Chosen Architecture

Obsidian already renders `.cm-indent` elements inside each visible CodeMirror list line and draws its indentation guides with `.cm-indent::before`. Those elements are created, positioned, virtualized, and scrolled by CodeMirror and Obsidian. The plugin will use them as the only guide-rendering source.

The feature will contain two responsibilities:

1. `DocumentBodyClass` continues to apply `bullet-plugin-vertical-lines` to every participating document when the feature is enabled.
2. A small CodeMirror view plugin handles `mousedown` events on `.cm-indent` elements when click-to-fold is enabled.

There will be no plugin-owned guide elements, overlay scroller, layout observer, animation-frame scheduler, coordinate cache, or geometry helper.

## Guide-to-list Mapping

When a `.cm-indent` element is pressed:

1. Resolve the containing `.cm-line` and its document position with `EditorView.posAtDOM`.
2. Parse the list block containing that line and find the list item that owns the line, including note lines.
3. Build its ancestor chain from outermost ancestor to immediate parent, excluding the parser's synthetic root.
4. Collect the line's `.cm-indent` elements in DOM order.
5. Align the ancestor chain to the rightmost indent elements. Any leading indent elements represent shared block indentation and do not map to a foldable ancestor.
6. Use the pressed indent element's aligned index to select the target ancestor.
7. Toggle the target's direct non-empty children using the existing `MyEditor.fold` and `MyEditor.unfold` operations.

The handler does nothing when the feature is disabled, the configured action is `none`, the target is not an indentation guide, parsing fails, the indent belongs only to shared leading indentation, or the target ancestor has no children.

## Styling

The plugin will stop suppressing Obsidian's `.cm-indent::before` guide. While the feature is enabled it will add pointer and hover affordances to `.cm-indent` without changing its layout. When click-to-fold is disabled, guides remain non-interactive.

The old `.bullet-plugin-list-lines-scroller`, `.bullet-plugin-list-lines-content-container`, and `.bullet-plugin-list-line` styles will be removed.

## Testing

Tests will focus on behavior rather than mocked geometry:

- Map a direct-child guide to its parent.
- Map each guide on a deeply nested line to the corresponding ancestor.
- Ignore leading indentation that does not represent an ancestor.
- Resolve note lines to their owning list item.
- Toggle all direct non-empty children between folded and unfolded states.
- Ignore events when either relevant setting is disabled.
- Ignore non-guide targets and unparseable lines.
- Preserve body classes across pop-out documents.
- Assert that the production implementation contains no overlay, observer, scheduler, or guide-coordinate cache.

The complete unit suite, build-with-tests, lint, and full integration suite are required before completion. Because the integration suite runs `dist/main.js`, `npm run build-with-tests` must run first.

## Migration

The replacement is internal. Existing settings and persisted values remain valid. The rendered DOM changes from plugin-owned overlay elements to Obsidian-owned indentation elements, so obsolete helper modules and their tests will be deleted in the same change.
