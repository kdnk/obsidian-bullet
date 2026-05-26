# Obsidian Bullet

**Work with your lists like in Workflowy or RoamResearch**

This plugin is forked from [vslinko/obsidian-outliner](https://github.com/vslinko/obsidian-outliner).

📦 [Latest release](https://github.com/kdnk/obsidian-outliner/releases/latest)<br>
🐛 [Report issues](https://github.com/kdnk/obsidian-outliner/issues)

Compatible with [Obsidian Zoom plugin](https://github.com/vslinko/obsidian-zoom).

Requires Obsidian `1.12.7` or later.

## How to install

### From within Obsidian

You can activate this plugin within Obsidian by doing the following:

- Open Settings > Third-party plugin
- Make sure Safe mode is off
- Click Browse community plugins
- Search for "Outliner Plus"
- Click Install
- Once installed, close the community plugins window and activate the newly installed plugin

### Manual installation

Download `main.js`, `manifest.json`, `styles.css` from the [latest release](https://github.com/kdnk/obsidian-outliner/releases/latest) and put them into `<vault>/.obsidian/plugins/bullet` folder.

## How to use

Try to create a deeply structured list and move items by pressing the hotkeys described below.

## Features

### Improve the style of your lists

If you liked the styles from the demo above, you can enable them in the plugin settings tab.

> **Disclaimer:** Styles are only compatible with built-in Obsidian theme.

| Setting                         | Default value |
|---------------------------------|:-------------:|
| Improve the style of your lists |    `true`     |

### Move lists back and forth

Move lists with children wherever you want without breaking the structure. This also works for a single multiline selection and is available from mobile commands and toolbar actions.

| Command                       |       Default hotkey (Windows/Linux)        |             Default hotkey (MacOS)             |
|-------------------------------|:-------------------------------------------:|:----------------------------------------------:|
| Move list and sublists up     | <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>↑</kbd> | <kbd>Command</kbd><kbd>Shift</kbd><kbd>↑</kbd> |
| Move list and sublists down   | <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>↓</kbd> | <kbd>Command</kbd><kbd>Shift</kbd><kbd>↓</kbd> |
| Indent the list and sublists  |               <kbd>Tab</kbd>                |                 <kbd>Tab</kbd>                 |
| Outdent the list and sublists |       <kbd>Shift</kbd><kbd>Tab</kbd>        |         <kbd>Shift</kbd><kbd>Tab</kbd>         |

| Setting             | Default value |
|---------------------|:-------------:|
| Enhance the Tab key |    `true`     |

### Draw vertical indentation lines

> **Disclaimer:** vertical indentation lines are only compatible with built-in Obsidian theme.

| Setting                                |  Default value   |
|----------------------------------------|:----------------:|
| Draw vertical indentation lines        |      `true`      |
| Vertical indentation line click action | `Toggle Folding` |

### Stick the cursor to the content

Keep the caret inside the editable text instead of letting it drift into the
hidden markdown prefix. This affects arrow-key navigation, deletion, and text
selection in Live Preview.

- `Never`: let the caret move anywhere, including the bullet and checkbox
  markup.
- `Stick cursor out of bullets`: keep the caret out of the bullet marker such
  as `- ` or `1. `, but allow it inside checkbox markup.
- `Stick cursor out of bullets and checkboxes`: keep the caret out of both the
  bullet marker and checkbox markup such as `- [ ] ` or `- [x] `.

This is useful if you want list editing to feel closer to an outliner or block
editor, where the caret stays on the content and keyboard actions operate on
the text instead of the markdown syntax.

Hold <kbd>Alt</kbd> or <kbd>Option</kbd> while navigating or clicking to temporarily place the caret inside the hidden bullet or checkbox markup without changing the setting.

| Setting                         | Default value |
|---------------------------------|:-------------:|
| Stick the cursor to the content | `Bullets and checkboxes` |

### Enhance the Enter key

Make the Enter key behave the same as other outliners:

- Enter outdents list item if it's empty.
- Enter creates new line on children level if there are any children.
- Enter on an existing note line continues that note line.
- Shift-Enter creates a new note line.
- Ordered lists defer to Obsidian when Smart lists is disabled.

| Setting               | Default value |
|-----------------------|:-------------:|
| Enhance the Enter key |    `true`     |

Additional command:

| Command          | Default hotkey |
|------------------|:--------------:|
| Insert note line |       -        |

### Fold and unfold your lists

| Command         | Default hotkey (Windows/Linux) |     Default hotkey (MacOS)     |
|-----------------|:------------------------------:|:------------------------------:|
| Fold the list   |  <kbd>Ctrl</kbd><kbd>↑</kbd>   | <kbd>Command</kbd><kbd>↑</kbd> |
| Unfold the list |  <kbd>Ctrl</kbd><kbd>↓</kbd>   | <kbd>Command</kbd><kbd>↓</kbd> |

### Enhance the <kbd>Ctrl</kbd><kbd>A</kbd> or <kbd>Cmd</kbd><kbd>A</kbd> behavior

Press the hotkey once to select the current list item. Press the hotkey twice to select the entire list.

| Setting                              | Default value |
|--------------------------------------|:-------------:|
| Enhance the Ctrl+A or Cmd+A behavior |    `true`     |

### Vim-mode `o` and `O`

When Obsidian Vim mode is enabled, pressing `o` or `O` inside a list creates a proper sibling bullet instead of a plain line. Outside lists, the plugin falls back to plain-line insertion.

| Setting                        | Default value |
|--------------------------------|:-------------:|
| Vim-mode o/O inserts bullets   |    `true`     |

### Drag-and-Drop

| Setting       | Default value |
|---------------|:-------------:|
| Drag-and-Drop |    `true`     |

### Debug mode

Open DevTools (Command+Option+I or Control+Shift+I) to copy the debug logs.

| Setting    | Default value |
|------------|:-------------:|
| Debug mode |    `false`    |
