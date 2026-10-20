# Formatting with Bullet

Bullet can format a note when you explicitly save it with Cmd/Ctrl+S. The **Bullet: Format current note** command runs the same formatting pipeline. Background autosaves do not trigger formatting.

Save formatting starts enabled. The default profile uses the enabled Prettier and Linter settings inspected for this integration. Saved Bullet preferences take precedence over these defaults.

## Configure formatting

Open **Settings → Bullet → Formatting** to adjust the default profile. No import step is needed. Bullet does not read another plugin's configuration at runtime.

**Integrate with Automatic Linker** starts enabled. When Automatic Linker is installed and enabled, Bullet calls its `formatText()` API before the other formatting stages. Bullet's integration setting applies to explicit saves and **Bullet: Format current note**, regardless of Automatic Linker's own **Format on save** setting.

Turn the integration off to run Bullet's other formatting stages without linking. While Bullet manages explicit saves, Automatic Linker's own save hook yields to Bullet, including when integration is off. If you disable Bullet's **Format on explicit save**, Automatic Linker resumes its standalone save behavior according to its own setting. Automatic Linker's commands remain available.

Enabling Bullet does not change another plugin's saved settings. Standalone Linter or Prettier save hooks must remain disabled when Bullet manages formatting.

## Supported Linter rules

The initial rule set follows the enabled Linter Plus configuration inspected for this migration. The settings page groups related rules instead of exposing Linter's full catalog.

| Setting                                   | Included Linter rules                                                                                                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compact frontmatter                       | `compact-yaml`                                                                                                                                                                                                                        |
| Normalize footnotes                       | `footnote-after-punctuation`, `move-footnotes-to-the-bottom`, `re-index-footnotes`                                                                                                                                                    |
| Clean up lists                            | `remove-consecutive-list-markers`, `remove-empty-list-markers`, `remove-empty-lines-between-list-markers-and-checklists`, `space-after-list-markers`                                                                                  |
| Normalize blank lines and trailing spaces | `consecutive-blank-lines`, `empty-line-around-code-fences`, `empty-line-around-math-blocks`, `empty-line-around-tables`, `empty-line-around-horizontal-rules`, `heading-blank-lines`, `line-break-at-document-end`, `trailing-spaces` |
| Repair closing fence indentation          | `correct-closing-fence-indentation`                                                                                                                                                                                                   |
| Space Japanese, Chinese, and Korean text  | `space-between-chinese-japanese-or-korean-and-english-or-numbers`                                                                                                                                                                     |
| Join hyphenated line breaks               | `remove-hyphenated-line-breaks`                                                                                                                                                                                                       |
| File timestamps                           | `yaml-timestamp`                                                                                                                                                                                                                      |
| Remove quotation footnotes on paste       | `remove-leftover-footnotes-from-quote-on-paste`, applied only to pasted text                                                                                                                                                          |

All 20 save rules and the paste rule start enabled. Per-note Linter `disabled rules` directives remain effective for the cleanup stage.

The inspected timestamp configuration uses `created` and `modified`, local time, `YYYY-MM-DD-HHmmss`, and filesystem timestamps. Bullet uses those values by default. Timestamp handling retains Linter's distinction between filesystem changes and changes made by formatting.

Prettier formats Markdown structure with the vault's **Indent using tabs** and **Tab size** preferences. Bullet does not add competing indentation settings. Embedded code-language formatting remains disabled, so code contents retain their literal indentation.

## Save order and editor behavior

Bullet runs these transformations in order:

1. Automatic Linker, when Bullet's **Integrate with Automatic Linker** setting is enabled and the plugin is available.
2. The selected JavaScript module, when configured.
3. Prettier Markdown formatting, with closing-fence indentation repaired first when that setting is enabled.
4. The enabled Linter rules in their required order.
5. Bullet's expansion of compact empty ancestors around fenced code.

The transformations produce text without editing the live document between stages. Bullet applies the final diff once and maps the current selection through it. One Undo returns to the text before formatting. A result computed before subsequent typing, a file switch, or plugin shutdown cannot replace the newer document.

Bullet retains empty list ancestors around fenced code during formatting. Ordinary empty leaf items still follow **Clean up lists**. Literal code content stays unchanged across repeated saves.

On a formatting error, Bullet shows a notice and leaves the original editor text available to the native save operation. Pending asynchronous work has a bounded wait. The selected script receives an `AbortSignal` so cooperative scripts can stop when the run is cancelled.

## Excluded paths

**Excluded folders** and **Excluded files** skip the entire pipeline. **Cleanup excluded folders** and **Cleanup excluded files** skip only the Linter stage. Enter vault-relative paths, one per line.

The inspected configuration excludes `templates` from Linter cleanup and independently from Automatic Linker. Prettier still formats templates. The default exclusions preserve that distinction.

Automatic Linker's frontmatter opt-outs control linking and URL-title fetching. They do not disable the rest of Bullet's formatting.

## Run custom JavaScript

Create a vault-relative `.mjs` or `.js` module and enter its path in **Trusted save script module**. Leave the setting empty to disable custom code.

For example, save the following as `scripts/format.mjs`:

```js
export default async function format(text, { file, app, signal }) {
  if (signal.aborted) return text;
  if (file.path.startsWith("drafts/")) return text;
  return text.replaceAll("TODO:", "TODO");
}
```

The default export receives the current text and a context containing the Obsidian file, app, and cancellation signal. Return a string or a Promise of a string. Return the input text when no change is needed. Bullet handles the editor write.

The module runs as trusted code with the same access as an Obsidian plugin. It is not sandboxed. Cancellation is cooperative and cannot interrupt a synchronous infinite loop. Module edits reload using the file's modification time. Standard relative module imports follow the platform's module loader.

Custom modules, including `.js` files and relative imports, have been verified on desktop Obsidian 1.14.4. Physical Android and iOS module loading has not been verified.

## Verify changes

Use the managed Obsidian lifecycle in the project verification skill, then run the following with Node.js 22.23.1 or later in the Node.js 22 series:

```sh
node scripts/verify-integrated-formatting.cjs /tmp/obsidian-bullet-formatting-proof
```

The output directory must be fresh. The script checks native Save, a real module import and reload, Undo, stale asynchronous results, zoom, following input, and saved Markdown. It restores its own settings and temporary files. Run the lifecycle cleanup after verification, including after failures.

Use `scripts/verify-formatting-linker.cjs <fresh-output-directory> <built-automatic-linker-directory>` for both plugin load orders, independent integration and standalone-save settings, and the existing Format file command. The command entry is invoked through Obsidian's command API; save and Undo use native keyboard input. The verifier temporarily installs the built Automatic Linker only in the test vault and removes that installation afterward.

Use `scripts/verify-formatting-settings.cjs <fresh-output-directory>` to check fresh default settings through native settings controls. The verifier checks the default profile, persisted integration toggle, timestamp options, save toggle, and absence of an import control, then restores the settings.
