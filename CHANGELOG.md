## 5.3.2

### Release Notes

- Added consolidated release notes for the v5 release line.

## 5.3.1

### Reliability

- Strengthened TypeScript safety by enabling stricter null and property
  initialization checks.
- Replaced several implicit runtime assumptions with explicit guards around
  editor views, list parents, selections, and parsed list data.

## 5.3.0

### Release Notes

- Restored in-app release notes so users can see what changed after updating
  the plugin.

### Maintenance

- Aligned CI and plugin metadata around Obsidian `1.12.7` or later.
- Reduced production bundle noise by disabling inline source maps in release
  builds.
- Split lint checking from lint fixing so verification commands no longer
  rewrite files.

## 5.2.3

### Editor

- Improved editor selection handling so multiple selections can be dispatched
  through the CodeMirror view.

## 5.2.2

### Project Rename

- Finished renaming internal plugin references to Obsidian Bullet.

## 5.2.0

### Vertical Indentation Lines

- Improved guide placement and hit areas for vertical indentation lines.
- Reduced unnecessary overlay recalculation for smoother editing.

## 5.1.0

### Select All

- Updated <kbd>Ctrl</kbd><kbd>A</kbd> / <kbd>Cmd</kbd><kbd>A</kbd> behavior so
  repeated presses cycle through useful list-selection scopes.
- Selection expansion now stays scoped to the current parent list instead of
  jumping straight to the whole parsed root.

## 5.0.36

### Maintenance

- Replaced an extra directory-creation dependency with native Node.js
  recursive directory creation.

## 5.0.32

### Project Rename

- Continued the rename from the upstream Outliner project toward Bullet.
- Updated package and repository metadata to match the current plugin identity.

## 5.0.26

### Documentation

- Updated the README to describe the current Bullet plugin behavior.
- Added clearer notes about the upstream fork relationship.
- Removed obsolete legacy pricing text.

## 5.0.20

### Vertical Indentation Lines

- Made vertical indentation guides render on non-default themes.
- Improved guide alignment for bullets, checkboxes, line numbers, hover states,
  and mobile layouts.

## 5.0.13

### Mobile

- Added mobile-friendly editor commands for list movement and indentation.
- Fixed mobile toolbar indentation behavior.

### Cursor Behavior

- Added <kbd>Alt</kbd> / <kbd>Option</kbd> as a temporary override for sticking
  the cursor outside bullet and checkbox markup.
- Improved ArrowLeft behavior on the first list row.
- Preserved native document navigation shortcuts.
- Improved folded-list navigation for Vim `j` / `k`.

### Enter Behavior

- Shift-Enter now creates note lines without bullets.
- Enter can continue existing note lines instead of starting a new bullet.
- Enter preserves checkbox state when inserting above tasks.
- Ordered-list cursor alignment was fixed around item `10` and later.
- Enter behavior avoids fenced code blocks outside the parsed list root.
- Inline checkbox text is preserved when creating new list items.

### List Movement

- Improved list movement for irregular indentation and legacy list items.

### Drag-and-Drop

- Improved drag-and-drop alignment.
- Added support for drag-and-drop in pop-out windows.

## 5.0.1

### First v5 Release

- Started the v5 line with fixes for list parsing, indentation, cursor
  recovery, Enter behavior, Vim list insertion, drag-and-drop, and ordered
  lists.
- Added broader regression coverage for list movement, folded navigation,
  frontmatter, Vim fallback behavior, and checkbox cursor movement.

## 4.7.0

### Drag-and-Drop

Drag-and-drop got a few updates and it's now enabled by default for all Obsidian Desktop users!

You can still disable this feature in the plugin's settings.

If you find a bug, please report the [issue](https://github.com/vslinko/obsidian-outliner/issues). Leave your other feedback [here](https://github.com/vslinko/obsidian-outliner/discussions).

<img src="https://raw.githubusercontent.com/vslinko/obsidian-outliner/main/demos/demo4.gif" style="max-width: 100%" />

## 4.5.0

### Drag-and-Drop (Experimental)

Now you can drag and drop items using your mouse! 🎉

This feature is experimental and is disabled by default. To enable this feature, open the plugin settings and turn on the `Drag-and-Drop (Experimental)` setting.

If you find a bug, please report the [issue](https://github.com/vslinko/obsidian-outliner/issues). Leave your other feedback [here](https://github.com/vslinko/obsidian-outliner/discussions/190).

<img src="https://raw.githubusercontent.com/vslinko/obsidian-outliner/main/demos/demo3.gif" style="max-width: 100%" />
