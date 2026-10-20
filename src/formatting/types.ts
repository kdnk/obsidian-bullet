export interface FormattingFile {
  path: string;
  basename: string;
  ctime: number;
  mtime: number;
}

export type SaveScript =
  | { kind: "disabled" }
  | { kind: "module"; path: string };
export type EnabledTimestampSettings = {
  kind: "enabled";
  created: boolean;
  modified: boolean;
  createdKey: string;
  modifiedKey: string;
  format: string;
  createdSource: "filesystem" | "frontmatter";
  modifiedSource: "filesystem" | "frontmatter";
  utc: boolean;
};
export type TimestampSettings =
  | EnabledTimestampSettings
  | { kind: "disabled"; previous?: EnabledTimestampSettings };

export interface LinterProfile {
  disabledRules: string[];
  innerYamlBlankLines: boolean;
  blankLineBetweenFootnotes: boolean;
  blankLineBelowHeading: boolean;
  blankLineAfterYaml: boolean;
  preserveHardBreaks: boolean;
  cjkPunctuationBefore: string;
  cjkPunctuationAfter: string;
  minimumMathDelimiters: number;
}

export interface FormattingSettings {
  onSave: boolean;
  markdown: boolean;
  footnotes: boolean;
  listCleanup: boolean;
  spacing: boolean;
  cjkSpacing: boolean;
  joinHyphenatedWords: boolean;
  compactFrontmatter: boolean;
  correctClosingFences: boolean;
  timestamps: TimestampSettings;
  ignoredFolders: string[];
  ignoredFiles: string[];
  linterIgnoredFolders: string[];
  linterIgnoredFiles: string[];
  pasteFootnoteCleanup: boolean;
  script: SaveScript;
  profile: LinterProfile;
}

export interface SaveTransformContext {
  file: FormattingFile;
  signal: AbortSignal;
}
export type SaveTransform = (
  text: string,
  context: SaveTransformContext,
) => string | Promise<string>;

export interface FormatMarkdownRequest extends SaveTransformContext {
  text: string;
  indent: { useTabs: boolean; tabWidth: number };
  settings: FormattingSettings;
  linker?: SaveTransform;
  script?: SaveTransform;
  now?: number;
}
