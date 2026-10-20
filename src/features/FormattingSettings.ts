import { Setting } from "obsidian";

import { formattingRuleGroups } from "../formatting/settings";
import { FormattingSettings } from "../formatting/types";
import { validateScriptPath } from "../formatting/userScript";
import { Settings } from "../services/Settings";

type ToggleKey = {
  [K in keyof FormattingSettings]: FormattingSettings[K] extends boolean
    ? K
    : never;
}[keyof FormattingSettings];

const TOGGLES: { key: ToggleKey; name: string; desc: string }[] = [
  {
    key: "onSave",
    name: "Format on explicit save",
    desc: "Run linking, the selected script, Prettier, and enabled cleanup when pressing Cmd/Ctrl+S. Automatic background saves do not run formatting.",
  },
  {
    key: "markdown",
    name: "Format Markdown",
    desc: "Use Prettier with the vault's tab and indentation settings.",
  },
  {
    key: "compactFrontmatter",
    name: "Compact frontmatter",
    desc: "Remove blank lines inside YAML frontmatter.",
  },
  {
    key: "footnotes",
    name: "Normalize footnotes",
    desc: "Move references after punctuation, renumber footnotes, and move definitions to the end.",
  },
  {
    key: "listCleanup",
    name: "Clean up lists",
    desc: "Normalize marker spacing, duplicate markers, empty items, and gaps between list items.",
  },
  {
    key: "spacing",
    name: "Normalize blank lines and trailing spaces",
    desc: "Space headings, fences, math, tables, and horizontal rules. Preserve Markdown hard breaks.",
  },
  {
    key: "correctClosingFences",
    name: "Repair closing fence indentation",
    desc: "Align closing code fences with their opening fences.",
  },
  {
    key: "cjkSpacing",
    name: "Space Japanese, Chinese, and Korean text",
    desc: "Add spacing around English words and numbers outside protected Markdown regions.",
  },
  {
    key: "joinHyphenatedWords",
    name: "Join hyphenated line breaks",
    desc: "Join prose words split by a hyphen at a line break.",
  },
  {
    key: "pasteFootnoteCleanup",
    name: "Remove quotation footnotes on paste",
    desc: "Remove numeric quotation footnotes from pasted text. This rule never runs on save.",
  },
];

export function formattingSettingDefinitions(
  settings: Settings,
  refresh: () => void = () => undefined,
): {
  type: "group";
  heading: string;
  items: {
    name: string;
    desc: string;
    visible?: () => boolean;
    render(setting: Setting): void;
  }[];
} {
  const save = async (patch: Partial<FormattingSettings>) => {
    settings.formatting = { ...settings.formatting, ...patch };
    await settings.save();
  };
  const lines = (value: string) =>
    value
      .split("\n")
      .map((part) => part.trim())
      .filter(Boolean);
  const items = TOGGLES.map(({ key, name, desc }) => ({
    name,
    desc,
    render: (setting: Setting) => {
      setting.addToggle((toggle) =>
        toggle.setValue(settings.formatting[key]).onChange(async (value) => {
          const group =
            key in formattingRuleGroups
              ? formattingRuleGroups[key as keyof typeof formattingRuleGroups]
              : [];
          const profile = settings.formatting.profile;
          await save({
            [key]: value,
            profile: value
              ? {
                  ...profile,
                  disabledRules: profile.disabledRules.filter(
                    (rule) => !group.includes(rule),
                  ),
                }
              : profile,
          });
        }),
      );
    },
  }));
  return {
    type: "group",
    heading: "Formatting",
    items: [
      ...items,
      {
        name: "File timestamps",
        desc: "Maintain created and modified frontmatter values using filesystem timestamps by default.",
        render: (setting: Setting) => {
          setting.addToggle((toggle) =>
            toggle
              .setValue(settings.formatting.timestamps.kind === "enabled")
              .onChange(async (enabled) => {
                const current = settings.formatting.timestamps;
                const timestamps: FormattingSettings["timestamps"] = enabled
                  ? ((current.kind === "disabled"
                      ? current.previous
                      : current) ?? {
                      kind: "enabled",
                      created: true,
                      modified: true,
                      createdKey: "created",
                      modifiedKey: "modified",
                      createdSource: "filesystem",
                      modifiedSource: "filesystem",
                      format: "YYYY-MM-DD-HHmmss",
                      utc: false,
                    })
                  : {
                      kind: "disabled",
                      previous:
                        current.kind === "enabled" ? current : current.previous,
                    };
                await save({
                  timestamps,
                  profile: enabled
                    ? {
                        ...settings.formatting.profile,
                        disabledRules:
                          settings.formatting.profile.disabledRules.filter(
                            (rule) => rule !== "yaml-timestamp",
                          ),
                      }
                    : settings.formatting.profile,
                });
                refresh();
              }),
          );
        },
      },
      ...(["createdKey", "modifiedKey", "format"] as const).map((key) => ({
        name: {
          createdKey: "Created timestamp field",
          modifiedKey: "Modified timestamp field",
          format: "Timestamp date format",
        }[key],
        desc:
          key === "format"
            ? "Moment date format, such as YYYY-MM-DD-HHmmss."
            : "Frontmatter field name for this timestamp.",
        visible: () => settings.formatting.timestamps.kind === "enabled",
        render: (setting: Setting) => {
          const timestamps = settings.formatting.timestamps;
          setting.addText((text) =>
            text
              .setValue(timestamps.kind === "enabled" ? timestamps[key] : "")
              .onChange(async (value) => {
                const current = settings.formatting.timestamps;
                if (current.kind === "enabled" && value.trim()) {
                  await save({
                    timestamps: { ...current, [key]: value.trim() },
                  });
                }
              }),
          );
        },
      })),
      ...(
        [
          "ignoredFolders",
          "ignoredFiles",
          "linterIgnoredFolders",
          "linterIgnoredFiles",
        ] as const
      ).map((key) => ({
        name: {
          ignoredFolders: "Excluded folders",
          ignoredFiles: "Excluded files",
          linterIgnoredFolders: "Cleanup excluded folders",
          linterIgnoredFiles: "Cleanup excluded files",
        }[key],
        desc: key.startsWith("linter")
          ? "Skip Linter cleanup only. Prettier can still format these paths. One vault-relative path per line."
          : "Skip the entire formatting pipeline for these paths. One vault-relative path per line.",
        render: (setting: Setting) => {
          setting.addTextArea((text) =>
            text
              .setValue(settings.formatting[key].join("\n"))
              .onChange((value) => save({ [key]: lines(value) })),
          );
        },
      })),
      {
        name: "Trusted save script module",
        desc: "Optional vault-relative .js or .mjs file. Its default export receives (text, { file, app, signal }) and returns text or a Promise of text. The module runs with plugin privileges. Leave empty to disable.",
        render: (setting: Setting) => {
          const script = settings.formatting.script;
          setting.addText((text) =>
            text
              .setPlaceholder("scripts/format.mjs")
              .setValue(script.kind === "module" ? script.path : "")
              .onChange(async (value) => {
                if (!value.trim()) {
                  text.inputEl.setCustomValidity("");
                  return save({ script: { kind: "disabled" } });
                }
                try {
                  await save({
                    script: { kind: "module", path: validateScriptPath(value) },
                  });
                  text.inputEl.setCustomValidity("");
                } catch (error) {
                  text.inputEl.setCustomValidity(
                    error instanceof Error ? error.message : String(error),
                  );
                }
              }),
          );
        },
      },
    ],
  };
}
