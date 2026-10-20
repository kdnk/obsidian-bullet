import type { FormattingSettings, TimestampSettings } from "./types";

export function defaultFormattingSettings(): FormattingSettings {
  return {
    onSave: false,
    markdown: true,
    footnotes: true,
    listCleanup: true,
    spacing: true,
    cjkSpacing: false,
    joinHyphenatedWords: false,
    compactFrontmatter: true,
    correctClosingFences: true,
    timestamps: { kind: "disabled" },
    ignoredFolders: [],
    ignoredFiles: [],
    linterIgnoredFolders: [],
    linterIgnoredFiles: [],
    pasteFootnoteCleanup: false,
    script: { kind: "disabled" },
    profile: {
      disabledRules: [],
      innerYamlBlankLines: true,
      blankLineBetweenFootnotes: false,
      blankLineBelowHeading: true,
      blankLineAfterYaml: true,
      preserveHardBreaks: true,
      cjkPunctuationBefore: "-+;:°%$)]",
      cjkPunctuationAfter: "-+([¥$",
      minimumMathDelimiters: 2,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
function timestamps(value: unknown): TimestampSettings {
  const saved = record(value);
  if (saved.kind !== "enabled") {
    const previous: TimestampSettings =
      record(saved.previous).kind === "enabled"
        ? timestamps(saved.previous)
        : { kind: "disabled" };
    return previous.kind === "enabled"
      ? { kind: "disabled", previous }
      : { kind: "disabled" };
  }
  return {
    kind: "enabled",
    created: bool(saved.created, true),
    modified: bool(saved.modified, true),
    createdKey: str(saved.createdKey, "created"),
    modifiedKey: str(saved.modifiedKey, "modified"),
    format: str(saved.format, "YYYY-MM-DD-HHmmss"),
    createdSource:
      saved.createdSource === "frontmatter" ? "frontmatter" : "filesystem",
    modifiedSource:
      saved.modifiedSource === "frontmatter" ? "frontmatter" : "filesystem",
    utc: bool(saved.utc, false),
  };
}

export function parseFormattingSettings(value: unknown): FormattingSettings {
  const input = record(value);
  const defaults = defaultFormattingSettings();
  const profile = record(input.profile);
  const script = record(input.script);
  return {
    onSave: bool(input.onSave, defaults.onSave),
    markdown: bool(input.markdown, defaults.markdown),
    footnotes: bool(input.footnotes, defaults.footnotes),
    listCleanup: bool(input.listCleanup, defaults.listCleanup),
    spacing: bool(input.spacing, defaults.spacing),
    cjkSpacing: bool(input.cjkSpacing, defaults.cjkSpacing),
    joinHyphenatedWords: bool(
      input.joinHyphenatedWords,
      defaults.joinHyphenatedWords,
    ),
    compactFrontmatter: bool(
      input.compactFrontmatter,
      defaults.compactFrontmatter,
    ),
    correctClosingFences: bool(
      input.correctClosingFences,
      defaults.correctClosingFences,
    ),
    timestamps: timestamps(input.timestamps),
    ignoredFolders: strings(input.ignoredFolders),
    ignoredFiles: strings(input.ignoredFiles),
    linterIgnoredFolders: strings(input.linterIgnoredFolders),
    linterIgnoredFiles: strings(input.linterIgnoredFiles),
    pasteFootnoteCleanup: bool(input.pasteFootnoteCleanup, false),
    script:
      script.kind === "module" &&
      typeof script.path === "string" &&
      script.path.trim()
        ? { kind: "module", path: script.path.trim() }
        : { kind: "disabled" },
    profile: {
      disabledRules: strings(profile.disabledRules),
      innerYamlBlankLines: bool(
        profile.innerYamlBlankLines,
        defaults.profile.innerYamlBlankLines,
      ),
      blankLineBetweenFootnotes: bool(
        profile.blankLineBetweenFootnotes,
        defaults.profile.blankLineBetweenFootnotes,
      ),
      blankLineBelowHeading: bool(
        profile.blankLineBelowHeading,
        defaults.profile.blankLineBelowHeading,
      ),
      blankLineAfterYaml: bool(
        profile.blankLineAfterYaml,
        defaults.profile.blankLineAfterYaml,
      ),
      preserveHardBreaks: bool(
        profile.preserveHardBreaks,
        defaults.profile.preserveHardBreaks,
      ),
      cjkPunctuationBefore: str(
        profile.cjkPunctuationBefore,
        defaults.profile.cjkPunctuationBefore,
      ),
      cjkPunctuationAfter: str(
        profile.cjkPunctuationAfter,
        defaults.profile.cjkPunctuationAfter,
      ),
      minimumMathDelimiters:
        typeof profile.minimumMathDelimiters === "number" &&
        Number.isInteger(profile.minimumMathDelimiters) &&
        profile.minimumMathDelimiters > 0
          ? profile.minimumMathDelimiters
          : 2,
    },
  };
}

export const selectedLinterRules = [
  "compact-yaml",
  "footnote-after-punctuation",
  "move-footnotes-to-the-bottom",
  "re-index-footnotes",
  "remove-consecutive-list-markers",
  "remove-empty-list-markers",
  "remove-empty-lines-between-list-markers-and-checklists",
  "space-after-list-markers",
  "remove-hyphenated-line-breaks",
  "correct-closing-fence-indentation",
  "consecutive-blank-lines",
  "empty-line-around-code-fences",
  "empty-line-around-math-blocks",
  "empty-line-around-tables",
  "empty-line-around-horizontal-rules",
  "heading-blank-lines",
  "line-break-at-document-end",
  "trailing-spaces",
  "space-between-chinese-japanese-or-korean-and-english-or-numbers",
  "yaml-timestamp",
  "remove-leftover-footnotes-from-quote-on-paste",
];

export function importLegacyFormattingSettings(
  linter: unknown,
  linker: unknown,
): { settings: FormattingSettings; unsupported: string[] } {
  const saved = record(linter),
    links = record(linker),
    rules = record(saved.ruleConfigs);
  const rule = (name: string) => record(rules[name]);
  const enabled = (name: string) => rule(name).enabled === true;
  const settings = defaultFormattingSettings();
  settings.onSave = links.formatOnSave === true;
  settings.markdown = bool(links.runPrettierAfterFormatting, true);
  settings.footnotes = [
    "footnote-after-punctuation",
    "move-footnotes-to-the-bottom",
    "re-index-footnotes",
  ].some(enabled);
  settings.listCleanup = [
    "remove-consecutive-list-markers",
    "remove-empty-list-markers",
    "remove-empty-lines-between-list-markers-and-checklists",
    "space-after-list-markers",
  ].some(enabled);
  settings.spacing = [
    "consecutive-blank-lines",
    "empty-line-around-code-fences",
    "empty-line-around-math-blocks",
    "empty-line-around-tables",
    "empty-line-around-horizontal-rules",
    "heading-blank-lines",
    "line-break-at-document-end",
    "trailing-spaces",
  ].some(enabled);
  settings.cjkSpacing = enabled(
    "space-between-chinese-japanese-or-korean-and-english-or-numbers",
  );
  settings.joinHyphenatedWords = enabled("remove-hyphenated-line-breaks");
  settings.compactFrontmatter = enabled("compact-yaml");
  settings.correctClosingFences = enabled("correct-closing-fence-indentation");
  settings.pasteFootnoteCleanup = enabled(
    "remove-leftover-footnotes-from-quote-on-paste",
  );
  settings.linterIgnoredFolders = strings(saved.foldersToIgnore);
  settings.linterIgnoredFiles = strings(saved.filesToIgnore);
  settings.profile.disabledRules = selectedLinterRules.filter(
    (name) => !enabled(name),
  );
  settings.profile.innerYamlBlankLines = bool(
    rule("compact-yaml")["inner-new-lines"],
    true,
  );
  settings.profile.blankLineBetweenFootnotes = bool(
    rule("move-footnotes-to-the-bottom")[
      "include-blank-line-between-footnotes"
    ],
    false,
  );
  settings.profile.blankLineBelowHeading = bool(
    rule("heading-blank-lines").bottom,
    true,
  );
  settings.profile.blankLineAfterYaml = bool(
    rule("heading-blank-lines")["empty-line-after-yaml"],
    true,
  );
  settings.profile.preserveHardBreaks = bool(
    rule("trailing-spaces")["two-space-line-break"],
    true,
  );
  const cjk = rule(
    "space-between-chinese-japanese-or-korean-and-english-or-numbers",
  );
  settings.profile.cjkPunctuationBefore = str(
    cjk["english-symbols-punctuation-before"],
    settings.profile.cjkPunctuationBefore,
  );
  settings.profile.cjkPunctuationAfter = str(
    cjk["english-symbols-punctuation-after"],
    settings.profile.cjkPunctuationAfter,
  );
  const common = record(saved.commonStyles);
  if (
    typeof common.minimumNumberOfDollarSignsToBeAMathBlock === "number" &&
    common.minimumNumberOfDollarSignsToBeAMathBlock > 0
  )
    settings.profile.minimumMathDelimiters =
      common.minimumNumberOfDollarSignsToBeAMathBlock;
  const stamp = rule("yaml-timestamp");
  if (enabled("yaml-timestamp"))
    settings.timestamps = {
      kind: "enabled",
      created: bool(stamp["date-created"], true),
      modified: bool(stamp["date-modified"], true),
      createdKey: str(stamp["date-created-key"], "created"),
      modifiedKey: str(stamp["date-modified-key"], "modified"),
      format: str(stamp.format, "YYYY-MM-DD-HHmmss"),
      createdSource:
        stamp["date-created-source-of-truth"] === "frontmatter"
          ? "frontmatter"
          : "filesystem",
      modifiedSource:
        stamp["date-modified-source-of-truth"] === "user or Linter edits"
          ? "frontmatter"
          : "filesystem",
      utc: bool(stamp["convert-to-utc"], false),
    };
  const unsupported = Object.keys(rules).filter(
    (name) => enabled(name) && !selectedLinterRules.includes(name),
  );
  if (
    Array.isArray(saved.customRegexes) &&
    saved.customRegexes.some((value) => record(value).enabled === true)
  )
    unsupported.push("custom-regexes");
  if (Array.isArray(saved.lintCommands) && saved.lintCommands.length)
    unsupported.push("lint-commands");
  return { settings, unsupported };
}

export const formattingRuleGroups = {
  footnotes: [
    "footnote-after-punctuation",
    "move-footnotes-to-the-bottom",
    "re-index-footnotes",
  ],
  listCleanup: [
    "remove-consecutive-list-markers",
    "remove-empty-list-markers",
    "remove-empty-lines-between-list-markers-and-checklists",
    "space-after-list-markers",
  ],
  spacing: [
    "consecutive-blank-lines",
    "empty-line-around-code-fences",
    "empty-line-around-math-blocks",
    "empty-line-around-tables",
    "empty-line-around-horizontal-rules",
    "heading-blank-lines",
    "line-break-at-document-end",
    "trailing-spaces",
  ],
  cjkSpacing: [
    "space-between-chinese-japanese-or-korean-and-english-or-numbers",
  ],
  joinHyphenatedWords: ["remove-hyphenated-line-breaks"],
  compactFrontmatter: ["compact-yaml"],
  correctClosingFences: ["correct-closing-fence-indentation"],
  pasteFootnoteCleanup: ["remove-leftover-footnotes-from-quote-on-paste"],
} satisfies Partial<Record<keyof FormattingSettings, string[]>>;
