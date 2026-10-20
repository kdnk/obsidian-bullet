import { moment } from "obsidian";

import parseFormat from "moment-parseformat";
import { isScalar, parseDocument, visit } from "yaml";

import {
  IgnoreTypes,
  checklistBoxIndicator,
  correctClosingFenceIndentation,
  ensureEmptyLinesAroundFencedCodeBlocks,
  ensureEmptyLinesAroundHorizontalRule,
  ensureEmptyLinesAroundMathBlock,
  ensureEmptyLinesAroundTables,
  escapeDollarSigns,
  escapeRegExp,
  formatYAML,
  ignoreListOfTypes,
  initYAML,
  insert,
  lineStartingWithWhitespaceOrBlockquoteTemplate,
  moveFootnotesToEnd,
  multipleBlankLinesRegex,
  reIndexFootnotes,
  updateBoldText,
  updateItalicsText,
  updateListItemText,
  yamlRegex,
} from "./linterHelpers";

type DateCreatedSourceOfTruth = "file system" | "frontmatter";
type DateModifiedSourceOfTruth = "file system" | "user or Linter edits";
type AfterFileChangeLintTimes = string;

export interface YamlTimestampOptions {
  alreadyModified: boolean;
  dateCreatedKey: string;
  dateCreated: boolean;
  dateCreatedSourceOfTruth: DateCreatedSourceOfTruth;
  dateModifiedSourceOfTruth: DateModifiedSourceOfTruth;
  fileCreatedTime: string;
  format: string;
  dateModified: boolean;
  dateModifiedKey: string;
  convertToUTC: boolean;
  timestampUpdateOnFileContentUpdated: AfterFileChangeLintTimes;
  fileModifiedTime: string;
  locale: string;
  currentTime: moment.Moment;
  fileName: string;
}
export class YamlTimestamp {
  apply(text: string, options: YamlTimestampOptions): string {
    let textModified = options.alreadyModified;
    const newText = initYAML(text);
    textModified = textModified || newText !== text;
    options.format = options.format.trimEnd();
    return formatYAML(newText, (text) => {
      if (options.dateCreated) {
        let newTextModified: boolean;
        [text, newTextModified] = this.handleDateCreatedValue(text, options);
        textModified = textModified || newTextModified;
      }
      if (options.dateModified) {
        text = this.handleDateModifiedValue(text, textModified, options);
      }
      return text;
    });
  }
  handleDateCreatedValue(
    text: string,
    options: YamlTimestampOptions,
  ): [string, boolean] {
    let textModified = false;
    const created_match_str = `\n${options.dateCreatedKey}: [^\n]+\n`;
    const created_key_match_str = `\n${options.dateCreatedKey}:[ \t]*\n`;
    const created_key_match = new RegExp(created_key_match_str);
    const created_match = new RegExp(created_match_str);
    const created_date = moment(options.fileCreatedTime);
    created_date.locale(options.locale);
    const formatted_date = options.convertToUTC
      ? created_date.utc().format(options.format)
      : created_date.format(options.format);
    const created_date_line = `\n${options.dateCreatedKey}: ${formatted_date}`;
    const keyWithValueFound = created_match.test(text);
    if (!keyWithValueFound && created_key_match.test(text)) {
      text = text.replace(
        created_key_match,
        escapeDollarSigns(created_date_line) + "\n",
      );
      textModified = true;
    } else if (!keyWithValueFound) {
      const yaml_end = text.indexOf("\n---");
      text = insert(
        text,
        yaml_end,
        `\n${options.dateCreatedKey}: ${formatted_date}`,
      );
      textModified = true;
    } else if (keyWithValueFound) {
      const createdDateString = this.getYAMLTimestampString(
        text,
        created_match,
        options.dateCreatedKey,
      );
      const actualFormat = parseFormat(createdDateString);
      if (
        options.dateCreatedSourceOfTruth == "frontmatter" &&
        options.format !== actualFormat
      ) {
        const yamlCreatedDateTime = this.parseValueToCurrentFormatIfPossible(
          createdDateString,
          options.format,
          options.locale,
          options.convertToUTC,
        );
        if (yamlCreatedDateTime == null) {
          throw new Error(
            "Invalid timestamp {DATE} in {FILE_NAME}."
              .replace("{DATE}", createdDateString)
              .replace("{FILE_NAME}", options.fileName),
          );
        }
        const formattedYamlCreatedDate = options.convertToUTC
          ? yamlCreatedDateTime.utc().format(options.format)
          : yamlCreatedDateTime.format(options.format);
        if (formattedYamlCreatedDate !== createdDateString) {
          const created_date_yaml_line = `\n${options.dateCreatedKey}: ${formattedYamlCreatedDate}`;
          text = text.replace(
            created_match,
            escapeDollarSigns(created_date_yaml_line) + "\n",
          );
          textModified = true;
        }
      } else if (options.dateCreatedSourceOfTruth != "frontmatter") {
        const createdDateTime = (options.convertToUTC ? moment.utc : moment)(
          createdDateString,
          options.format,
          options.locale,
        );
        if (
          createdDateTime == undefined ||
          !createdDateTime.isValid() ||
          (options.format !== "" &&
            createdDateTime.format(options.format) != createdDateString)
        ) {
          text = text.replace(
            created_match,
            escapeDollarSigns(created_date_line) + "\n",
          );
          textModified = true;
        }
      }
    }
    return [text, textModified];
  }
  handleDateModifiedValue(
    text: string,
    textModified: boolean,
    options: YamlTimestampOptions,
  ): string {
    const modified_match_str = `\n${options.dateModifiedKey}: [^\n]+\n`;
    const modified_key_match_str = `\n${options.dateModifiedKey}:[ \t]*\n`;
    const modified_key_match = new RegExp(modified_key_match_str);
    const modified_match = new RegExp(modified_match_str);
    const modified_date = moment(options.fileModifiedTime);
    modified_date.locale(options.locale);
    const formatted_modified_date = options.convertToUTC
      ? options.currentTime.utc().format(options.format)
      : options.currentTime.format(options.format);
    const modified_date_line = `\n${options.dateModifiedKey}: ${formatted_modified_date}`;
    const keyWithValueFound = modified_match.test(text);
    if (keyWithValueFound) {
      const originalString = this.getYAMLTimestampString(
        text,
        modified_match,
        options.dateModifiedKey,
      );
      const modifiedDateTime = (options.convertToUTC ? moment.utc : moment)(
        originalString,
        options.format,
        options.locale,
      );
      if (
        textModified ||
        modifiedDateTime == undefined ||
        !modifiedDateTime.isValid() ||
        modifiedDateTime.format(options.format) != originalString ||
        (options.dateModifiedSourceOfTruth != "user or Linter edits" &&
          this.getTimeDifferenceInSeconds(
            modifiedDateTime,
            modified_date,
            options,
          ) > 5)
      ) {
        text = text.replace(
          modified_match,
          escapeDollarSigns(modified_date_line) + "\n",
        );
      }
    } else if (modified_key_match.test(text)) {
      text = text.replace(
        modified_key_match,
        escapeDollarSigns(modified_date_line) + "\n",
      );
    } else if (!keyWithValueFound) {
      const yaml_end = text.indexOf("\n---");
      text = insert(text, yaml_end, modified_date_line);
    }
    return text;
  }
  parseValueToCurrentFormatIfPossible(
    timestamp: string,
    format: string,
    locale: string,
    utc: boolean,
  ): moment.Moment | null {
    if (timestamp == undefined) {
      return null;
    }
    const desiredFormatDate = utc
      ? moment.utc(timestamp, format, locale, true)
      : moment(timestamp, format, locale, true);
    if (desiredFormatDate != undefined && desiredFormatDate.isValid()) {
      return desiredFormatDate;
    }
    const actualFormat = parseFormat(timestamp);
    if (actualFormat != undefined) {
      const date = utc
        ? moment.utc(timestamp, actualFormat)
        : moment(timestamp, actualFormat);
      date.locale(locale);
      const formattedDateStr = utc
        ? date.utc().format(format)
        : date.format(format);
      return utc
        ? moment.utc(formattedDateStr, format, locale, true)
        : moment(formattedDateStr, format, locale, true);
    }
    return null;
  }
  getYAMLTimestampString(
    text: string,
    matchRegex: RegExp,
    key: string,
  ): string {
    const found = text.match(matchRegex);
    if (!found) throw new Error("Missing YAML timestamp");
    const match = found[0];
    return match.replace(key + ":", "").trim();
  }
  getTimeDifferenceInSeconds(
    modifiedDateTimeMetadata: moment.Moment,
    yamlModifiedDateTime: moment.Moment,
    options: YamlTimestampOptions,
  ): number {
    const formattedDateModifiedDate = (
      options.convertToUTC ? moment.utc : moment
    )(
      (options.convertToUTC
        ? yamlModifiedDateTime.clone().utc()
        : yamlModifiedDateTime
      ).format(options.format),
      options.format,
      options.locale,
      true,
    );
    return Math.abs(
      modifiedDateTimeMetadata.diff(formattedDateModifiedDate, "seconds"),
    );
  }
}

export interface CompactYamlOptions {
  innerNewLines: boolean;
}
export class CompactYaml {
  apply(text: string, options: CompactYamlOptions): string {
    return formatYAML(text, (text) => {
      const document = parseDocument(text.slice(0, -3));
      if (document.errors.length > 0) {
        return text;
      }
      const scalarRanges: [number, number][] = [];
      const anchors = new Set<string>();
      let hasUnresolvedAlias = false;
      visit(document, {
        Alias: (_key, node) => {
          if (!anchors.has(node.source)) {
            hasUnresolvedAlias = true;
            return visit.BREAK;
          }
        },
        Value: (_key, node) => {
          if (node.anchor) anchors.add(node.anchor);
          if (isScalar(node) && node.range) {
            scalarRanges.push([node.range[0], node.range[1]]);
          }
        },
      });
      if (hasUnresolvedAlias) {
        return text;
      }
      return text.replace(/\n{2,}/g, (newlines: string, offset: number) => {
        const atBoundary =
          offset === 3 || offset + newlines.length === text.length - 3;
        if (!options.innerNewLines && !atBoundary) {
          return newlines;
        }
        let compacted = "\n";
        for (let i = 1; i < newlines.length; i++) {
          if (
            scalarRanges.some(
              ([start, end]) => start <= offset + i && offset + i < end,
            )
          ) {
            compacted += "\n";
          }
        }
        return compacted;
      });
    });
  }
}

export class FootnoteAfterPunctuation {
  apply(text: string): string {
    return text.replace(/(\[\^[^\]]+\]) ?([,.;!:?])/gm, "$2$1");
  }
}

export interface MoveFootnotesToTheBottomOptions {
  includeBlankLineBetweenFootnotes: boolean;
}
export class MoveFootnotesToTheBottom {
  apply(text: string, options: MoveFootnotesToTheBottomOptions): string {
    return moveFootnotesToEnd(text, options.includeBlankLineBetweenFootnotes);
  }
}

export class ReIndexFootnotes {
  apply(text: string): string {
    return reIndexFootnotes(text);
  }
}

export class RemoveConsecutiveListMarkers {
  apply(text: string): string {
    return text.replace(/^([ |\t]*)- - (\p{L})/gmu, "$1- $2");
  }
}

export class RemoveEmptyListMarkers {
  apply(text: string): string {
    const emptyListMarkerRegex = new RegExp(
      `^${lineStartingWithWhitespaceOrBlockquoteTemplate}(-|\\*|\\+|\\d+[.)]|- (\\[(.)\\]))\\s*?$`,
      "gm",
    );
    text = text.replace(
      new RegExp(emptyListMarkerRegex.source + "\\n", "gm"),
      "",
    );
    text = text.replace(
      new RegExp("\\n" + emptyListMarkerRegex.source, "gm"),
      "",
    );
    return text.replace(emptyListMarkerRegex, "");
  }
}

export class RemoveEmptyLinesBetweenListMarkersAndChecklists {
  apply(text: string): string {
    const orderedMarkerRegexText = "(( |\\t)*\\d+\\.( |\\t)+.+)";
    text = this.replaceEmptyLinesBetweenList(text, orderedMarkerRegexText);
    const unorderedMarkerRegexText = `(( |\\t)*(?:- ${checklistBoxIndicator}|-(?! ${checklistBoxIndicator})|\\+|\\*)( |\\t)+.+)`;
    return this.replaceEmptyLinesBetweenList(text, unorderedMarkerRegexText);
  }
  replaceEmptyLinesBetweenList = function (
    text: string,
    listIndicatorRegexText: string,
  ): string {
    const listRegex = new RegExp(
      `^${listIndicatorRegexText}\n(?:(?:[\t\v\f\r \u00a0\u2000-\u200b\u2028-\u2029\u3000]+)?\n){1,}${listIndicatorRegexText}$`,
      "gm",
    );
    let match;
    let newText = text;
    do {
      match = newText.match(listRegex);
      newText = newText.replaceAll(listRegex, "$1\n$4");
    } while (match);
    return newText;
  };
}

export class SpaceAfterListMarkers {
  apply(text: string): string {
    text = text.replace(/^(\s*\d+\.|\s*[-+*])[^\S\r\n]+/gm, "$1 ");
    return text.replace(/^(\s*\d+\.|\s*[-+*]\s+\[[ xX]\])[^\S\r\n]+/gm, "$1 ");
  }
}

export class RemoveHyphenatedLineBreaks {
  apply(text: string): string {
    return text.replace(/\b[-‐] \b/g, "");
  }
}

export class CorrectClosingFenceIndentation {
  apply(text: string): string {
    return correctClosingFenceIndentation(text);
  }
}

export class ConsecutiveBlankLines {
  apply(text: string): string {
    return text.replace(multipleBlankLinesRegex, "\n\n");
  }
}

export class EmptyLineAroundCodeFences {
  apply(text: string): string {
    return ensureEmptyLinesAroundFencedCodeBlocks(text);
  }
}

export interface EmptyLineAroundMathBlockOptions {
  minimumNumberOfDollarSignsToBeAMathBlock: number;
}
export class EmptyLineAroundMathBlock {
  apply(text: string, options: EmptyLineAroundMathBlockOptions): string {
    return ensureEmptyLinesAroundMathBlock(
      text,
      options.minimumNumberOfDollarSignsToBeAMathBlock,
    );
  }
}

export class EmptyLineAroundTables {
  apply(text: string): string {
    return ensureEmptyLinesAroundTables(text);
  }
}

export class EmptyLineAroundHorizontalRules {
  apply(text: string): string {
    return ensureEmptyLinesAroundHorizontalRule(text);
  }
}

export interface HeadingBlankLinesOptions {
  bottom: boolean;
  emptyLineAfterYaml: boolean;
}
export class HeadingBlankLines {
  apply(text: string, options: HeadingBlankLinesOptions): string {
    if (!options.bottom) {
      text = text.replace(/^([^#\n][^\n]+)\n+(#+\s.*)/gm, "$1\n\n$2");
    } else {
      text = text.replace(/^(#+\s.*)/gm, "\n\n$1\n\n");
      text = text.replace(/\n+(#+\s.*)/g, "\n\n$1");
      text = text.replace(/(^#+\s.*)\n+/gm, "$1\n\n");
    }
    text = text.replace(/^\n+(#+\s.*)/, "$1");
    text = text.replace(/(#+\s.*)\n+$/, "$1");
    if (!options.emptyLineAfterYaml) {
      text = text.replace(
        new RegExp("(" + yamlRegex.source + ")\\n+(#+\\s.*)"),
        "$1\n$5",
      );
    }
    return text;
  }
}

export class LineBreakAtDocumentEnd {
  apply(text: string): string {
    if (text.length === 0) {
      return text;
    }
    text = text.replace(/\n+$/g, "");
    text += "\n";
    return text;
  }
}

export interface TrailingSpacesOptions {
  twoSpaceLineBreak: boolean;
}
export class TrailingSpaces {
  apply(text: string, options: TrailingSpacesOptions): string {
    text = ignoreListOfTypes(
      [IgnoreTypes.list],
      text,
      (text: string): string => {
        if (!options.twoSpaceLineBreak) {
          return text.replace(/[ \t]+$/gm, "");
        } else {
          text = text.replace(/(\S)[ \t]$/gm, "$1");
          text = text.replace(/(\S)[ \t]{3,}$/gm, "$1");
          text = text.replace(/(\S)( ?\t\t? ?)$/gm, "$1");
          return text;
        }
      },
    );
    text = updateListItemText(
      text,
      (text: string): string => {
        if (!options.twoSpaceLineBreak) {
          return text.replace(/[ \t]+$/gm, "");
        } else {
          text = text.replace(/(\S)[ \t]$/gm, "$1");
          text = text.replace(/(\S)[ \t]{3,}$/gm, "$1");
          text = text.replace(/(\S)( ?\t\t? ?)$/gm, "$1");
          return text;
        }
      },
      true,
    );
    if (!options.twoSpaceLineBreak) {
      text = text.replace(/^[ \t]+$/gm, "");
    } else {
      text = text.replace(/^[ \t]$/gm, "");
      text = text.replace(/^[ \t]{3,}$/gm, "");
      text = text.replace(/^( ?\t\t? ?)$/gm, "$1");
    }
    return text;
  }
}

export interface SpaceBetweenChineseJapaneseOrKoreanAndEnglishOrNumbersOptions {
  englishNonLetterCharactersAfterCJKCharacters: string;
  englishNonLetterCharactersBeforeCJKCharacters: string;
}
export class SpaceBetweenChineseJapaneseOrKoreanAndEnglishOrNumbers {
  apply(
    text: string,
    options: SpaceBetweenChineseJapaneseOrKoreanAndEnglishOrNumbersOptions,
  ): string {
    const head = this.buildHeadRegex(
      options.englishNonLetterCharactersAfterCJKCharacters,
    );
    const tail = this.buildTailRegex(
      options.englishNonLetterCharactersBeforeCJKCharacters,
    );
    const regexEscapedIgnoreExceptionPlaceHolders =
      `${IgnoreTypes.link.placeholder}|${IgnoreTypes.inlineMath.placeholder}|${IgnoreTypes.inlineCode.placeholder}|${IgnoreTypes.wikiLink.placeholder}`
        .replaceAll("{", "\\{")
        .replaceAll("}", ".+\\}");
    const ignoreExceptionsHead = new RegExp(
      `(\\p{sc=Han}|\\p{sc=Katakana}|\\p{sc=Hiragana}|\\p{sc=Hangul})( *)(${regexEscapedIgnoreExceptionPlaceHolders})`,
      "gmu",
    );
    const ignoreExceptionsTail = new RegExp(
      `(${regexEscapedIgnoreExceptionPlaceHolders})( *)(\\p{sc=Han}|\\p{sc=Katakana}|\\p{sc=Hiragana}|\\p{sc=Hangul})`,
      "gmu",
    );
    const addSpaceAroundChineseJapaneseKoreanAndEnglish = function (
      text: string,
    ): string {
      return text.replace(head, "$1 $3").replace(tail, "$1 $3");
    };
    let newText = ignoreListOfTypes(
      [IgnoreTypes.italics, IgnoreTypes.bold],
      text,
      addSpaceAroundChineseJapaneseKoreanAndEnglish,
    );
    newText = newText
      .replace(ignoreExceptionsHead, "$1 $3")
      .replace(ignoreExceptionsTail, "$1 $3");
    newText = updateItalicsText(
      newText,
      addSpaceAroundChineseJapaneseKoreanAndEnglish,
    );
    newText = updateBoldText(
      newText,
      addSpaceAroundChineseJapaneseKoreanAndEnglish,
    );
    return newText;
  }
  buildHeadRegex(englishPunctuationAndSymbols: string): RegExp {
    if (englishPunctuationAndSymbols && englishPunctuationAndSymbols !== "") {
      englishPunctuationAndSymbols = englishPunctuationAndSymbols.replaceAll(
        /\s/g,
        "",
      );
    }
    let puncAndSymbolGroup = "";
    if (
      englishPunctuationAndSymbols &&
      englishPunctuationAndSymbols.length != 0
    ) {
      puncAndSymbolGroup = `|[${escapeRegExp(englishPunctuationAndSymbols)}]`;
    }
    return new RegExp(
      `(\\p{sc=Han}|\\p{sc=Katakana}|\\p{sc=Hiragana}|\\p{sc=Hangul})( *)(\\[[^[]*\\]\\(.*\\)|\`[^\`]*\`|\\w+${puncAndSymbolGroup}|\\*[^*])`,
      "gmu",
    );
  }
  buildTailRegex(englishPunctuationAndSymbols: string): RegExp {
    if (englishPunctuationAndSymbols && englishPunctuationAndSymbols !== "") {
      englishPunctuationAndSymbols = englishPunctuationAndSymbols.replaceAll(
        /\s/g,
        "",
      );
    }
    let puncAndSymbolGroup = "";
    if (
      englishPunctuationAndSymbols &&
      englishPunctuationAndSymbols.length != 0
    ) {
      puncAndSymbolGroup = `|[${escapeRegExp(englishPunctuationAndSymbols)}]`;
    }
    return new RegExp(
      `(\\[[^[]*\\]\\(.*\\)|\`[^\`]*\`|\\w+${puncAndSymbolGroup}|[^*]\\*)( *)(\\p{sc=Han}|\\p{sc=Katakana}|\\p{sc=Hiragana}|\\p{sc=Hangul})`,
      "gmu",
    );
  }
}

export class RemoveLeftoverFootnotesFromQuoteOnPaste {
  apply(text: string): string {
    return text.replace(/(\D)[.,]\d+/g, "$1");
  }
}
