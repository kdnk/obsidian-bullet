import {
  defaultFormattingSettings,
  parseFormattingSettings,
} from "../settings";

test("fresh formatting uses the active Prettier and Linter profile", () => {
  expect(parseFormattingSettings(undefined)).toEqual({
    onSave: true,
    automaticLinker: true,
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
  });
});

test("stored opt-outs and explicitly empty exclusions survive new defaults", () => {
  const saved = {
    ...defaultFormattingSettings(),
    onSave: false,
    automaticLinker: false,
    cjkSpacing: false,
    joinHyphenatedWords: false,
    pasteFootnoteCleanup: false,
    linterIgnoredFolders: [],
    timestamps: { kind: "disabled" },
  };
  expect(parseFormattingSettings(JSON.parse(JSON.stringify(saved)))).toEqual(
    saved,
  );
});

test.each([{}, { automaticLinker: null }, { automaticLinker: "false" }])(
  "settings without a valid Automatic Linker toggle enable integration",
  (saved) => {
    expect(parseFormattingSettings(saved).automaticLinker).toBe(true);
  },
);

test("independent settings loads do not share the default exclusion list", () => {
  const first = parseFormattingSettings({});
  first.linterIgnoredFolders.push("drafts");
  expect(parseFormattingSettings({}).linterIgnoredFolders).toEqual([
    "templates",
  ]);
});
