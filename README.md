# Bullet

Turn Markdown lists into a fast, keyboard-driven outliner.

Bullet makes nested lists feel closer to Workflowy or Roam Research without giving up the plain-text structure of an Obsidian note. Type, move, indent, select, fold, and drag entire branches while Bullet keeps their hierarchy intact.

[Latest release](https://github.com/kdnk/obsidian-bullet/releases/latest) · [Report an issue](https://github.com/kdnk/obsidian-bullet/issues)

Requires Obsidian 1.12.7 or later. Bullet supports desktop and mobile.

## What Bullet changes

- **List-aware editing:** `Enter`, `Shift`+`Enter`, `Tab`, `Shift`+`Tab`, and repeated `Command`+`A` or `Ctrl`+`A` operate on list structure instead of raw Markdown prefixes.
- **Whole-branch movement:** move or drag an item together with every nested child.
- **Focused navigation:** keep the caret in editable content and away from hidden bullet or checkbox markup.
- **Visible structure:** connect nested items with indentation guides, add guides beside root list chunks, and fold branches from the guides themselves.
- **Mobile-friendly folding:** move native list and heading fold controls to the right edge in Live Preview.

Automatic editing, appearance, folding, and drag-and-drop behavior can be adjusted from **Settings → Bullet**.

## Install

### Community Plugins

1. Open **Settings → Community plugins** in Obsidian.
2. Turn on community plugins if Obsidian asks you to leave Restricted Mode.
3. Select **Browse**, search for **Bullet**, and select **Install**.
4. Select **Enable** after installation.

Obsidian also documents this flow in [Community plugins](https://help.obsidian.md/community-plugins).

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/kdnk/obsidian-bullet/releases/latest).
2. Put the three files in `<vault>/.obsidian/plugins/bullet/`.
3. Reload Obsidian, then enable **Bullet** under **Settings → Community plugins**.

## Start with these controls

Create a nested list, place the caret in one of its items, and try the following controls. A branch means the current item and all of its nested children.

| Action                                   | macOS                                            | Windows / Linux                               |
| ---------------------------------------- | ------------------------------------------------ | --------------------------------------------- |
| Move a branch up                         | <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>↑</kbd> | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>↑</kbd> |
| Move a branch down                       | <kbd>Command</kbd>+<kbd>Shift</kbd>+<kbd>↓</kbd> | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>↓</kbd> |
| Indent a branch                          | <kbd>Tab</kbd>                                   | <kbd>Tab</kbd>                                |
| Outdent a branch                         | <kbd>Shift</kbd>+<kbd>Tab</kbd>                  | <kbd>Shift</kbd>+<kbd>Tab</kbd>               |
| Create the next list item                | <kbd>Enter</kbd>                                 | <kbd>Enter</kbd>                              |
| Add a continuation line without a bullet | <kbd>Shift</kbd>+<kbd>Enter</kbd>                | <kbd>Shift</kbd>+<kbd>Enter</kbd>             |
| Expand the selection by list scope       | <kbd>Command</kbd>+<kbd>A</kbd> repeatedly       | <kbd>Ctrl</kbd>+<kbd>A</kbd> repeatedly       |

The movement shortcuts are registered by Bullet. The other controls replace Obsidian's behavior only while their corresponding Bullet settings are enabled and the caret is in a list.

## Features

### Keep editing inside the outline

With **Keep body text in bullets** enabled, directly typed body text stays in a list item or one of its continuation lines. Headings, block quotes, horizontal rules, fenced code blocks, and frontmatter remain available as document-level Markdown structures.

The rule applies to direct typing and deletion. Pasted text, dropped text, and changes made by other plugins are left unchanged.

Enhanced `Enter` creates a new item at the appropriate level and outdents an empty nested item. `Shift`+`Enter` adds a continuation line to the current item without creating another bullet.

### Move, indent, and select branches

Movement commands carry the complete branch, so rearranging a parent never separates it from its descendants. `Tab` and `Shift`+`Tab` apply the same rule when changing indentation.

Repeated `Command`+`A` or `Ctrl`+`A` expands selection from the current item's content to its subtree and then to the surrounding list scope. The **Select list content** command exposes the same behavior to the Command Palette and mobile toolbar.

### Keep the caret in editable content

Bullet can keep the caret outside the Markdown prefix for bullets, numbered items, and checkboxes. Choose one of three modes under **Stick the cursor to the content**:

- **Never:** allow the caret inside all Markdown prefixes.
- **Stick cursor out of bullets:** protect bullet and number prefixes, but allow checkbox editing.
- **Stick cursor out of bullets and checkboxes:** keep the caret in item content.

Hold <kbd>Alt</kbd> or <kbd>Option</kbd> while navigating or clicking to place the caret inside protected markup temporarily.

### Fold from indentation guides

Bullet can draw native-looking guides between nested items and beside each root-level list chunk. With guide actions enabled, click a guide to fold or unfold the child branches it connects.

![Fold nested lists from their indentation guides](demos/demo3.gif)

The separate **Fold the list** and **Unfold the list** commands operate on the item at the caret. These commands do not have default shortcuts, so you can assign your own under **Settings → Hotkeys**.

### Drag branches on desktop

Drag a bullet, fold indicator, or checkbox to move its complete branch. Drag-and-drop is a desktop feature; the keyboard and Command Palette movement actions remain available on mobile.

![Move a list branch by dragging it](demos/demo4.gif)

### Use Vim and mobile controls

When Obsidian's Vim mode is enabled, `o` and `O` create list items while the caret is inside a list and fall back to ordinary lines outside one.

On mobile, Bullet can move the native fold controls for list items and headings to the right edge of Live Preview. List editing commands can also be added to Obsidian's mobile toolbar.

## Commands

Bullet registers these actions in Obsidian's Command Palette. You can assign custom shortcuts under **Settings → Hotkeys**; editor commands can also be added to the mobile toolbar.

| Command                           | What it does                                         |
| --------------------------------- | ---------------------------------------------------- |
| **Move list and sublists up**     | Move the current branch before its previous sibling. |
| **Move list and sublists down**   | Move the current branch after its next sibling.      |
| **Indent the list and sublists**  | Nest the current branch one level deeper.            |
| **Outdent the list and sublists** | Move the current branch one level outward.           |
| **Fold the list**                 | Fold the item at the caret.                          |
| **Unfold the list**               | Unfold the item at the caret.                        |
| **Insert note line**              | Add a continuation line without a bullet.            |
| **Select list content**           | Expand selection through the current list scopes.    |
| **Show System Info**              | Display environment details for a bug report.        |

## Settings

All settings are under **Settings → Bullet**.

### Editing

| Setting                                  |                  Default                   | Effect                                                 |
| ---------------------------------------- | :----------------------------------------: | ------------------------------------------------------ |
| **Stick the cursor to the content**      | Stick cursor out of bullets and checkboxes | Keep the caret outside bullet and checkbox prefixes.   |
| **Keep body text in bullets**            |                     On                     | Keep directly typed body text inside list items.       |
| **Enhance the Tab key**                  |                     On                     | Indent and outdent complete branches.                  |
| **Enhance the Enter key**                |                     On                     | Create and outdent items with outliner-style behavior. |
| **Vim-mode o/O inserts bullets**         |                     On                     | Create list items from Vim's `o` and `O` actions.      |
| **Enhance the Ctrl+A or Cmd+A behavior** |                     On                     | Expand selection through list scopes.                  |
| **Drag-and-Drop**                        |                     On                     | Move branches by dragging on desktop.                  |

### Appearance

| Setting                             | Default | Effect                                                                                    |
| ----------------------------------- | :-----: | ----------------------------------------------------------------------------------------- |
| **Improve the style of your lists** |   On    | Apply Bullet's additional list spacing and bullet styling with Obsidian's default themes. |
| **Draw vertical indentation lines** |   On    | Connect nested items with indentation guides.                                             |
| **Draw outer list lines**           |   On    | Draw a guide beside each contiguous root list chunk.                                      |

### Folding

| Setting                                        | Default | Effect                                                                     |
| ---------------------------------------------- | :-----: | -------------------------------------------------------------------------- |
| **Fold lists from vertical indentation lines** |   On    | Make visible guides clickable for folding.                                 |
| **Show fold controls on the right on mobile**  |   On    | Move native list and heading controls to the right in mobile Live Preview. |

### Advanced

| Setting        | Default | Effect                                                      |
| -------------- | :-----: | ----------------------------------------------------------- |
| **Debug mode** |   Off   | Write detailed Bullet logs to Obsidian's developer console. |

## Compatibility

- Bullet requires Obsidian 1.12.7 or later and is available on desktop and mobile.
- The editing enhancements work in Obsidian's Markdown editor. Indentation guides and right-side mobile fold controls are designed for Live Preview.
- **Improve the style of your lists** is applied only with Obsidian's default themes. Other themes may already define their own list appearance.
- The fold and unfold commands require Obsidian's **Fold indent** editor setting to be enabled.

## Support and credits

If something behaves unexpectedly, run **Bullet: Show System Info** from the Command Palette and include the displayed details in a [bug report](https://github.com/kdnk/obsidian-bullet/issues). For deeper diagnostics, enable **Debug mode** and copy the Bullet logs from Obsidian's developer console.

Bullet is a fork of [vslinko/obsidian-outliner](https://github.com/vslinko/obsidian-outliner). The original project was created by Viacheslav Slinko.

## License

[MIT](LICENSE)
