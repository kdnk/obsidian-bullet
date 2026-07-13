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

Obsidian draws indentation guides with `.cm-indent::before`, but it removes every visible `.cm-indent` for a parent after all of that parent's non-empty child branches fold. CodeMirror still keeps `.cm-indent-spacing` spans on the visible branch roots and direct leaves. The plugin promotes those existing spans into the native `.cm-indent` class so the native guide remains available for reopening. The spans are still created, positioned, virtualized, and scrolled by CodeMirror and Obsidian.

The feature will contain two responsibilities:

1. `DocumentBodyClass` continues to apply `bullet-plugin-vertical-lines` to every participating document when the feature is enabled.
2. A small CodeMirror view plugin observes `mousedown` on `contentDOM` during the capture phase and handles `.cm-indent` elements when click-to-fold is enabled. Obsidian stops these events before CodeMirror's normal bubbling view-plugin handlers, so capture is required. The listener is removed when the view plugin is destroyed.

There will be no plugin-owned guide elements, overlay scroller, layout observer, animation-frame scheduler, coordinate cache, or geometry helper. A plugin marker class records only the spans promoted into native guides and is removed when the feature is disabled or the view is destroyed.

## Guide-to-list Mapping

When a `.cm-indent` element is pressed:

1. Resolve the containing `.cm-line` and its document position with `EditorView.posAtDOM`.
2. Parse the list block containing that line and find the list item that owns the line, including note lines.
3. Treat the native `.cm-indent` as the guide for the owning list item's outermost real ancestor. Obsidian renders the complete indentation text inside one `.cm-indent`; it does not create one element per nesting level, and the painted boundary is the outermost one.
4. Walk the ancestor chain and select the last real list before the parser's synthetic root.
5. Toggle the parent's direct non-empty children while keeping the parent and its direct leaves visible.
6. If every non-empty child is folded, unfold every child. Otherwise, fold every child with a selection-safe fold operation.

The handler does nothing when the feature is disabled, the configured action is `none`, the target is not an indentation guide, parsing fails, the indent belongs only to shared leading indentation, or the target ancestor has no children.

## Styling

The plugin will stop suppressing Obsidian's `.cm-indent::before` guide. While the feature is enabled it will promote visible `.cm-indent-spacing` spans into `.cm-indent`, allowing Obsidian to apply its own layout, theme, and guide pseudo-element. The event handler remains inactive when click-to-fold is disabled.

The old `.bullet-plugin-list-lines-scroller`, `.bullet-plugin-list-lines-content-container`, and `.bullet-plugin-list-line` styles will be removed.

## Testing

Tests will focus on behavior rather than mocked geometry:

- Map a direct-child guide to its parent.
- Map a deeply nested line's native guide to its outermost real ancestor.
- Ignore leading indentation on a root list item because it has no real ancestor.
- Resolve note lines to their owning list item.
- Toggle the represented parent's direct non-empty children between folded and unfolded states without folding the parent itself.
- Ignore events when either relevant setting is disabled.
- Ignore non-guide targets and unparseable lines.
- Register the capture listener once and remove the same listener on destroy.
- Preserve body classes across pop-out documents.
- Assert that the production implementation contains no overlay, observer, scheduler, or guide-coordinate cache.

The complete unit suite, build-with-tests, lint, and full integration suite are required before completion. Because the integration suite runs `dist/main.js`, `npm run build-with-tests` must run first.

## Migration

The replacement is internal. Existing settings and persisted values remain valid. The rendered DOM changes from plugin-owned overlay elements to Obsidian-owned indentation elements, so obsolete helper modules and their tests will be deleted in the same change.
