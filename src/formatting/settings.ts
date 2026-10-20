import type { FormattingSettings, TimestampSettings } from "./types";

export function defaultFormattingSettings(): FormattingSettings {
  return {
    onSave: true,
    markdown: true,
    footnotes: true,
    listCleanup: true,
    spacing: true,
    cjkSpacing: true,
    joinHyphenatedWords: true,
    compactFrontmatter: true,
    correctClosingFences: true,
    timestamps: {
      kind: "enabled",
      created: true,
      modified: true,
      createdKey: "created",
      modifiedKey: "modified",
      format: "YYYY-MM-DD-HHmmss",
      createdSource: "filesystem",
      modifiedSource: "filesystem",
      utc: false,
    },
    ignoredFolders: [],
    ignoredFiles: [],
    linterIgnoredFolders: ["templates"],
    linterIgnoredFiles: [],
    pasteFootnoteCleanup: true,
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
function strings(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [...fallback];
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
    timestamps: timestamps(input.timestamps ?? defaults.timestamps),
    ignoredFolders: strings(input.ignoredFolders),
    ignoredFiles: strings(input.ignoredFiles),
    linterIgnoredFolders: strings(
      input.linterIgnoredFolders,
      defaults.linterIgnoredFolders,
    ),
    linterIgnoredFiles: strings(input.linterIgnoredFiles),
    pasteFootnoteCleanup: bool(
      input.pasteFootnoteCleanup,
      defaults.pasteFootnoteCleanup,
    ),
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
