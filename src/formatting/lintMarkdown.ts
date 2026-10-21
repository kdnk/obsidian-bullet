import { isScalar, isSeq, parseDocument } from "yaml";

import { moment } from "./moment";
import type { FormattingFile, FormattingSettings } from "./types";
import {
  IgnoreTypes,
  ignoreListOfTypes,
  yamlRegex,
} from "./vendor/linterHelpers";
import type { IgnoreType } from "./vendor/linterHelpers";
import * as Rules from "./vendor/linterRules";

type Group = keyof Pick<
  FormattingSettings,
  | "compactFrontmatter"
  | "joinHyphenatedWords"
  | "correctClosingFences"
  | "cjkSpacing"
  | "footnotes"
  | "listCleanup"
  | "spacing"
>;
interface Rule {
  alias: string;
  group: Group;
  ignores: IgnoreType[];
  apply: (text: string, settings: FormattingSettings) => string;
}
const rules: Rule[] = [
  {
    alias: "correct-closing-fence-indentation",
    group: "correctClosingFences",
    ignores: [],
    apply: (value) => new Rules.CorrectClosingFenceIndentation().apply(value),
  },
  {
    alias: "footnote-after-punctuation",
    group: "footnotes",
    ignores: [
      IgnoreTypes.code,
      IgnoreTypes.inlineCode,
      IgnoreTypes.math,
      IgnoreTypes.yaml,
      IgnoreTypes.link,
      IgnoreTypes.wikiLink,
      IgnoreTypes.tag,
      IgnoreTypes.footnoteAtStartOfLine,
      IgnoreTypes.footnoteAfterATask,
    ],
    apply: (value) => new Rules.FootnoteAfterPunctuation().apply(value),
  },
  {
    alias: "move-footnotes-to-the-bottom",
    group: "footnotes",
    ignores: [
      IgnoreTypes.code,
      IgnoreTypes.inlineCode,
      IgnoreTypes.math,
      IgnoreTypes.yaml,
    ],
    apply: (value, settings) =>
      new Rules.MoveFootnotesToTheBottom().apply(value, {
        includeBlankLineBetweenFootnotes:
          settings.profile.blankLineBetweenFootnotes,
      }),
  },
  {
    alias: "re-index-footnotes",
    group: "footnotes",
    ignores: [
      IgnoreTypes.code,
      IgnoreTypes.inlineCode,
      IgnoreTypes.math,
      IgnoreTypes.yaml,
      IgnoreTypes.tag,
    ],
    apply: (value) => new Rules.ReIndexFootnotes().apply(value),
  },
  {
    alias: "remove-consecutive-list-markers",
    group: "listCleanup",
    ignores: [
      IgnoreTypes.code,
      IgnoreTypes.math,
      IgnoreTypes.yaml,
      IgnoreTypes.link,
      IgnoreTypes.wikiLink,
      IgnoreTypes.tag,
    ],
    apply: (value) => new Rules.RemoveConsecutiveListMarkers().apply(value),
  },
  {
    alias: "remove-empty-list-markers",
    group: "listCleanup",
    ignores: [
      IgnoreTypes.code,
      IgnoreTypes.math,
      IgnoreTypes.yaml,
      IgnoreTypes.link,
      IgnoreTypes.wikiLink,
      IgnoreTypes.tag,
    ],
    apply: (value) => new Rules.RemoveEmptyListMarkers().apply(value),
  },
  {
    alias: "remove-hyphenated-line-breaks",
    group: "joinHyphenatedWords",
    ignores: [
      IgnoreTypes.code,
      IgnoreTypes.math,
      IgnoreTypes.yaml,
      IgnoreTypes.link,
      IgnoreTypes.wikiLink,
      IgnoreTypes.tag,
    ],
    apply: (value) => new Rules.RemoveHyphenatedLineBreaks().apply(value),
  },
  {
    alias: "compact-yaml",
    group: "compactFrontmatter",
    ignores: [],
    apply: (value, settings) =>
      new Rules.CompactYaml().apply(value, {
        innerNewLines: settings.profile.innerYamlBlankLines,
      }),
  },
  {
    alias: "empty-line-around-code-fences",
    group: "spacing",
    ignores: [],
    apply: (value) => new Rules.EmptyLineAroundCodeFences().apply(value),
  },
  {
    alias: "empty-line-around-horizontal-rules",
    group: "spacing",
    ignores: [],
    apply: (value) => new Rules.EmptyLineAroundHorizontalRules().apply(value),
  },
  {
    alias: "empty-line-around-math-blocks",
    group: "spacing",
    ignores: [IgnoreTypes.yaml, IgnoreTypes.code],
    apply: (value, settings) =>
      new Rules.EmptyLineAroundMathBlock().apply(value, {
        minimumNumberOfDollarSignsToBeAMathBlock:
          settings.profile.minimumMathDelimiters,
      }),
  },
  {
    alias: "empty-line-around-tables",
    group: "spacing",
    ignores: [
      IgnoreTypes.yaml,
      IgnoreTypes.code,
      IgnoreTypes.math,
      IgnoreTypes.inlineMath,
      IgnoreTypes.wikiLink,
      IgnoreTypes.link,
    ],
    apply: (value) => new Rules.EmptyLineAroundTables().apply(value),
  },
  {
    alias: "heading-blank-lines",
    group: "spacing",
    ignores: [
      IgnoreTypes.code,
      IgnoreTypes.math,
      IgnoreTypes.yaml,
      IgnoreTypes.link,
      IgnoreTypes.wikiLink,
    ],
    apply: (value, settings) =>
      new Rules.HeadingBlankLines().apply(value, {
        bottom: settings.profile.blankLineBelowHeading,
        emptyLineAfterYaml: settings.profile.blankLineAfterYaml,
      }),
  },
  {
    alias: "line-break-at-document-end",
    group: "spacing",
    ignores: [],
    apply: (value) => new Rules.LineBreakAtDocumentEnd().apply(value),
  },
  {
    alias: "remove-empty-lines-between-list-markers-and-checklists",
    group: "listCleanup",
    ignores: [
      IgnoreTypes.code,
      IgnoreTypes.math,
      IgnoreTypes.yaml,
      IgnoreTypes.link,
      IgnoreTypes.wikiLink,
      IgnoreTypes.tag,
      IgnoreTypes.thematicBreak,
    ],
    apply: (value) =>
      new Rules.RemoveEmptyLinesBetweenListMarkersAndChecklists().apply(value),
  },
  {
    alias: "space-after-list-markers",
    group: "listCleanup",
    ignores: [
      IgnoreTypes.code,
      IgnoreTypes.math,
      IgnoreTypes.yaml,
      IgnoreTypes.link,
      IgnoreTypes.wikiLink,
      IgnoreTypes.tag,
    ],
    apply: (value) => new Rules.SpaceAfterListMarkers().apply(value),
  },
  {
    alias: "space-between-chinese-japanese-or-korean-and-english-or-numbers",
    group: "cjkSpacing",
    ignores: [
      IgnoreTypes.code,
      IgnoreTypes.inlineCode,
      IgnoreTypes.yaml,
      IgnoreTypes.image,
      IgnoreTypes.link,
      IgnoreTypes.wikiLink,
      IgnoreTypes.tag,
      IgnoreTypes.math,
      IgnoreTypes.inlineMath,
      IgnoreTypes.html,
    ],
    apply: (value, settings) =>
      new Rules.SpaceBetweenChineseJapaneseOrKoreanAndEnglishOrNumbers().apply(
        value,
        {
          englishNonLetterCharactersAfterCJKCharacters:
            settings.profile.cjkPunctuationAfter,
          englishNonLetterCharactersBeforeCJKCharacters:
            settings.profile.cjkPunctuationBefore,
        },
      ),
  },
  {
    alias: "trailing-spaces",
    group: "spacing",
    ignores: [
      IgnoreTypes.code,
      IgnoreTypes.math,
      IgnoreTypes.yaml,
      IgnoreTypes.link,
      IgnoreTypes.wikiLink,
      IgnoreTypes.tag,
    ],
    apply: (value, settings) =>
      new Rules.TrailingSpaces().apply(value, {
        twoSpaceLineBreak: settings.profile.preserveHardBreaks,
      }),
  },
  {
    alias: "consecutive-blank-lines",
    group: "spacing",
    ignores: [
      IgnoreTypes.code,
      IgnoreTypes.math,
      IgnoreTypes.yaml,
      IgnoreTypes.link,
      IgnoreTypes.wikiLink,
      IgnoreTypes.tag,
    ],
    apply: (value) => new Rules.ConsecutiveBlankLines().apply(value),
  },
];

export function isIgnoredPath(
  path: string,
  folders: string[],
  files: string[],
): boolean {
  return (
    files.includes(path) ||
    folders.some((folder) => {
      const normalized = folder.replace(/^\/+|\/+$/g, "");
      return (
        normalized !== "" &&
        (path === normalized || path.startsWith(normalized + "/"))
      );
    })
  );
}
export function disabledLinterRules(
  text: string,
  settings: FormattingSettings,
): Set<string> {
  const disabled = new Set(settings.profile.disabledRules);
  const match = yamlRegex.exec(text);
  if (!match) return disabled;
  const doc = parseDocument(match[1]);
  if (doc.errors.length)
    throw new Error("Cannot format malformed YAML frontmatter");
  const node = doc.get("disabled rules", true);
  const value: unknown = isScalar(node)
    ? node.value
    : isSeq(node)
      ? node.toJSON()
      : undefined;
  if (typeof value === "string") disabled.add(value);
  else if (Array.isArray(value)) {
    for (const alias of value)
      if (typeof alias === "string") disabled.add(alias);
  }
  return disabled;
}
function applyRule(
  text: string,
  rule: Rule,
  settings: FormattingSettings,
): string {
  return ignoreListOfTypes(
    [IgnoreTypes.customIgnore, ...rule.ignores],
    text,
    (value) => rule.apply(value, settings),
  );
}
export function repairClosingFences(
  text: string,
  settings: FormattingSettings,
): string {
  const rule = rules[0];
  const disabled = disabledLinterRules(text, settings);
  return settings.correctClosingFences &&
    !disabled.has("all") &&
    !disabled.has(rule.alias)
    ? applyRule(text, rule, settings)
    : text;
}
export function lintMarkdown(
  text: string,
  file: FormattingFile,
  settings: FormattingSettings,
  now = Date.now(),
): string {
  if (
    isIgnoredPath(
      file.path,
      settings.linterIgnoredFolders,
      settings.linterIgnoredFiles,
    )
  )
    return text;
  const original = text;
  const disabled = disabledLinterRules(text, settings);
  if (disabled.has("all")) return text;
  for (const rule of rules)
    if (settings[rule.group] && !disabled.has(rule.alias))
      text = applyRule(text, rule, settings);
  const stamp = settings.timestamps;
  if (stamp.kind === "enabled" && !disabled.has("yaml-timestamp")) {
    text = ignoreListOfTypes([IgnoreTypes.customIgnore], text, (value) =>
      new Rules.YamlTimestamp().apply(value, {
        alreadyModified: original !== text,
        dateCreated: stamp.created,
        dateModified: stamp.modified,
        dateCreatedKey: stamp.createdKey,
        dateModifiedKey: stamp.modifiedKey,
        format: stamp.format,
        dateCreatedSourceOfTruth:
          stamp.createdSource === "filesystem" ? "file system" : "frontmatter",
        dateModifiedSourceOfTruth:
          stamp.modifiedSource === "filesystem"
            ? "file system"
            : "user or Linter edits",
        convertToUTC: stamp.utc,
        fileCreatedTime: new Date(file.ctime).toISOString(),
        fileModifiedTime: new Date(file.mtime).toISOString(),
        locale: moment.locale(),
        currentTime: moment(now),
        fileName: file.basename,
        timestampUpdateOnFileContentUpdated: "never",
      }),
    );
  }
  return text;
}
export function formatPastedText(
  text: string,
  settings: FormattingSettings,
): string {
  if (
    !settings.pasteFootnoteCleanup ||
    settings.profile.disabledRules.includes(
      "remove-leftover-footnotes-from-quote-on-paste",
    )
  )
    return text;
  return ignoreListOfTypes(
    [
      IgnoreTypes.customIgnore,
      ...[IgnoreTypes.wikiLink, IgnoreTypes.link, IgnoreTypes.image],
    ],
    text,
    (value) => new Rules.RemoveLeftoverFootnotesFromQuoteOnPaste().apply(value),
  );
}
