# Bullet

Turn Markdown lists into a fast, keyboard-driven outliner.

Bullet makes nested lists feel closer to Workflowy or Roam Research without giving up the plain-text structure of an Obsidian note. Zoom into a branch, move it between notes, or rearrange an entire outline while Bullet keeps its hierarchy intact.

[Latest release](https://github.com/kdnk/obsidian-bullet/releases/latest) · [Report an issue](https://github.com/kdnk/obsidian-bullet/issues)

Requires Obsidian 1.12.7 or later. Bullet supports desktop and mobile.

## What Bullet changes

- **List-aware editing:** `Enter`, `Shift`+`Enter`, `Tab`, `Shift`+`Tab`, and repeated `Command`+`A` or `Ctrl`+`A` operate on list structure instead of raw Markdown prefixes.
- **[Branch zoom](#zoom-into-a-branch):** click a bullet to focus on that item and its descendants, then navigate back with breadcrumbs.
- **[Drag-and-drop across files](#drag-and-drop-across-files):** move a complete branch between notes open side by side, including into an empty note or ordinary text.
- **Whole-branch movement:** move, indent, or outdent an item together with every nested child.
- **Focused navigation:** keep the caret in editable content and away from hidden bullet or checkbox markup.
- **[Guide folding](#fold-from-indentation-guides):** connect nested items with indentation guides and fold or unfold their child branches together with one click.
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

### Verify release artifacts

Releases built with the attestation-enabled workflow include GitHub artifact attestations for `main.js`, `manifest.json`, and `styles.css`. These let you verify that the downloaded files were produced by this repository's release workflow. Older releases do not have attestations.

With GitHub CLI installed and authenticated, run these commands from the directory containing the three downloaded files:

```sh
for artifact in main.js manifest.json styles.css; do
  gh attestation verify "$artifact" \
    --repo kdnk/obsidian-bullet \
    --signer-workflow kdnk/obsidian-bullet/.github/workflows/release.yml || exit 1
done
```

All three verifications must succeed. Attestations verify the files' origin and integrity; they do not guarantee that the plugin is free of bugs or vulnerabilities.

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

To try zoom, click a bullet and use **Whole note** above the editor to return. To try moving a branch between files, open two notes side by side and drag a bullet into the other editor.

## Features

### Zoom into a branch

Focus on one part of a long outline while editing the original note:

1. Click an item's bullet, or place the caret in the item and run **Bullet: Zoom into list** from the Command Palette.
2. Edit the focused item and its descendants. Their indentation shifts toward the left edge, and the rest of the note is hidden in that pane. Click a child bullet to zoom further in.
3. Use the breadcrumbs above the editor to return to an ancestor, or choose **Whole note** to show the full document. **Bullet: Zoom out one level** and **Bullet: Show whole note** provide the same navigation from the Command Palette.

Zoom is available on desktop and mobile. The zoom commands have no default shortcuts; assign your own under **Settings → Hotkeys**, or add them to the mobile toolbar. A bullet click zooms; dragging it on desktop moves the branch. Checkboxes and fold arrows keep their usual click actions.

Zoom applies only to the current editor pane, so another pane can show the whole note at the same time. Properties are hidden in the zoomed pane and return when you show the whole note. Zoom resets when you switch files or reload; no block IDs or additional notes are created.

Selections and direct edits stay within the visible branch. If Undo, Redo, or synchronization from another pane changes hidden content, Bullet reveals the whole note so you can see the change.

### Drag and drop across files

On desktop, drag a bullet, fold indicator, or checkbox to move its complete branch, including nested children and continuation lines. **Drag-and-Drop** is enabled by default under **Settings → Bullet**.

To move a branch to another note:

1. Open the source and destination notes in editor panes side by side in the same window.
2. Drag the source item's bullet into the destination editor. Drop into an existing list, an empty note, or before or after a line of ordinary text.
3. Follow the insertion line to choose the position and indentation, then release. Bullet moves the branch out of the source note and focuses it in the destination pane.

Drops onto frontmatter text are placed after its closing delimiter. Fenced code blocks do not accept drops. Both notes must be open in editable panes in the same window; drops onto unopened tabs or the file explorer, and drags between separate windows, are not supported.

Undo or Redo in either editor restores both sides of the move while both original editors remain open on those notes and writable. If you have since edited the other note, undo those later edits there first.

Drag-and-drop is a desktop feature. The keyboard and Command Palette movement actions remain available on mobile.

### Keep editing inside the outline

With **Keep typed text in lists** enabled, directly typed body text stays in a list item or one of its continuation lines. Headings, block quotes, horizontal rules, fenced code blocks, and frontmatter remain available as document-level Markdown structures.

On a completely empty line, press <kbd>Space</kbd> to create an empty list item immediately. Indented continuation lines remain plain note lines.

The rule applies to direct typing and deletion. Pasted text, dropped text, and changes made by other plugins are left unchanged.

Enhanced `Enter` creates a new item at the appropriate level and outdents an empty nested item. `Shift`+`Enter` adds a continuation line to the current item without creating another bullet.

### Move, indent, and select branches

Movement commands carry the complete branch, so rearranging a parent never separates it from its descendants. `Tab` and `Shift`+`Tab` apply the same rule when changing indentation.

Repeated `Command`+`A` or `Ctrl`+`A` expands selection from the current item's content to its subtree and then to the surrounding list scope. The **Select list content** command exposes the same behavior to the Command Palette and mobile toolbar.

### Keep the caret in editable content

Bullet can keep the caret outside the Markdown prefix for bullets, numbered items, and checkboxes. Choose one of three modes under **Keep cursor out of list markers**:

- **Allow cursor in markers:** allow the caret inside all Markdown prefixes.
- **Keep out of bullets:** protect bullet and number prefixes, but allow checkbox editing.
- **Keep out of bullets and checkboxes:** keep the caret in item content.

Hold <kbd>Alt</kbd> or <kbd>Option</kbd> while navigating or clicking to place the caret inside protected markup temporarily.

### Fold from indentation guides

Bullet can draw native-looking guides between nested items and beside each root-level list chunk. With **Fold lists from vertical indentation lines** enabled, click a guide to toggle its direct child branches together:

- If any child branch is open, fold all child branches.
- If all child branches are folded, unfold them together.
- Items without children stay visible, as does the parent represented by the guide.

Hovering highlights the connected guide segments so you can see which part of the outline the action affects. **Enhance vertical lines** strengthens the guides and gives the highlight rounded ends. On mobile, you can also tap the guide beside the continuation of a wrapped list line.

Bullet preserves the viewport position when folding from a guide or a native fold arrow in Live Preview. On mobile, native fold-arrow scroll preservation applies when **Show fold controls on the right on mobile** is enabled.

The separate **Fold the list** and **Unfold the list** commands operate on the item at the caret. These commands do not have default shortcuts, so you can assign your own under **Settings → Hotkeys**.

### Use Vim and mobile controls

When Obsidian's Vim mode is enabled, `o` and `O` create list items while the caret is inside a list and fall back to ordinary lines outside one.

On mobile, Bullet can move the native fold controls for list items and headings to the right edge of Live Preview. List editing commands can also be added to Obsidian's mobile toolbar.

## Commands

Bullet registers these actions in Obsidian's Command Palette. You can assign custom shortcuts under **Settings → Hotkeys**; editor commands can also be added to the mobile toolbar.

| Command                           | What it does                                                     |
| --------------------------------- | ---------------------------------------------------------------- |
| **Move list and sublists up**     | Move the current branch before its previous sibling.             |
| **Move list and sublists down**   | Move the current branch after its next sibling.                  |
| **Indent the list and sublists**  | Nest the current branch one level deeper.                        |
| **Outdent the list and sublists** | Move the current branch one level outward.                       |
| **Fold the list**                 | Fold the item at the caret.                                      |
| **Unfold the list**               | Unfold the item at the caret.                                    |
| **Insert note line**              | Add a continuation line without a bullet.                        |
| **Select list content**           | Expand selection through the current list scopes.                |
| **Zoom into list**                | Focus the editor on the current item and its descendants.        |
| **Zoom out one level**            | Show the parent branch, or the whole note from a top-level item. |
| **Show whole note**               | Leave zoom and show the full note in the current pane.           |
| **Show System Info**              | Display environment details for a bug report.                    |

## Settings

All settings are under **Settings → Bullet**.

### Editing

| Setting                                  |              Default               | Effect                                                                              |
| ---------------------------------------- | :--------------------------------: | ----------------------------------------------------------------------------------- |
| **Keep typed text in lists**             |                 On                 | Add list markers when directly typed body text would sit outside one.               |
| **Keep cursor out of list markers**      | Keep out of bullets and checkboxes | Move the caret outside bullet, number, and checkbox prefixes.                       |
| **Enhance the Tab key**                  |                 On                 | Indent and outdent complete branches.                                               |
| **Enhance the Enter key**                |                 On                 | Create and outdent items with outliner-style behavior.                              |
| **Vim-mode o/O inserts bullets**         |                 On                 | Create list items from Vim's `o` and `O` actions.                                   |
| **Enhance the Ctrl+A or Cmd+A behavior** |                 On                 | Expand selection through list scopes.                                               |
| **Drag-and-Drop**                        |                 On                 | Drag complete branches within a list or between notes open side by side on desktop. |

### Appearance

| Setting                    | Default | Effect                                                                                        |
| -------------------------- | :-----: | --------------------------------------------------------------------------------------------- |
| **Style list bullets**     |   On    | Use Bullet's marker spacing, larger dots, and parent hover feedback with active theme colors. |
| **Enhance vertical lines** |   On    | Strengthen indentation guides and use a continuous rounded hover.                             |

### Folding

| Setting                                        | Default | Effect                                                                                        |
| ---------------------------------------------- | :-----: | --------------------------------------------------------------------------------------------- |
| **Draw outer list lines**                      |   On    | Draw a guide beside each contiguous root list chunk.                                          |
| **Fold lists from vertical indentation lines** |   On    | Click a guide to fold its direct child branches together, or unfold them when all are folded. |
| **Show fold controls on the right on mobile**  |   On    | Move native list and heading controls to the right in mobile Live Preview.                    |

### Advanced

| Setting        | Default | Effect                                                      |
| -------------- | :-----: | ----------------------------------------------------------- |
| **Debug mode** |   Off   | Write detailed Bullet logs to Obsidian's developer console. |

## Compatibility

- Bullet requires Obsidian 1.12.7 or later and is available on desktop and mobile.
- The editing enhancements work in Obsidian's Markdown editor. Vertical-line folding, outer guides, and right-side mobile fold controls are designed for Live Preview.
- The fold and unfold commands require Obsidian's **Fold indent** editor setting to be enabled.

## Support and credits

If something behaves unexpectedly, run **Bullet: Show System Info** from the Command Palette and include the displayed details in a [bug report](https://github.com/kdnk/obsidian-bullet/issues). For deeper diagnostics, enable **Debug mode** and copy the Bullet logs from Obsidian's developer console.

Bullet is a fork of [vslinko/obsidian-outliner](https://github.com/vslinko/obsidian-outliner). The original project was created by Viacheslav Slinko.

## License

[MIT](LICENSE)
