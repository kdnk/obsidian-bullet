import type { Code, Nodes, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { mathFromMarkdown } from "mdast-util-math";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";
import { math } from "micromark-extension-math";
import { combineExtensions } from "micromark-util-combine-extensions";
import type { Node } from "unist";
import { SKIP, visit } from "unist-util-visit";

type Point = { line: number; column: number; offset: number };
type Position = { start: Point; end: Point };
function positionOf(node: Node): Position {
  const position = node.position;
  if (
    !position ||
    typeof position.start.offset !== "number" ||
    typeof position.end.offset !== "number"
  )
    throw new Error("Markdown parser returned a node without source offsets");
  return {
    start: { ...position.start, offset: position.start.offset },
    end: { ...position.end, offset: position.end.offset },
  };
}
function mapValue<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) throw new Error("Missing parsed footnote");
  return value;
}
function footnoteKey(text: string): string {
  const match = /\[\^.*?\]/.exec(text);
  if (!match) throw new Error("Invalid parsed footnote");
  return match[0];
}

const LRU = new Map<number, Root>();
type PositionPlusEmptyIndicator = {
  position: Position;
  isEmpty: boolean;
};
export enum MDAstTypes {
  Link = "link",
  Footnote = "footnoteDefinition",
  Paragraph = "paragraph",
  Italics = "emphasis",
  Bold = "strong",
  ListItem = "listItem",
  Code = "code",
  InlineCode = "inlineCode",
  Image = "image",
  List = "list",
  Blockquote = "blockquote",
  HorizontalRule = "thematicBreak",
  Html = "html",
  Heading = "heading",
  Text = "text",
  Math = "math",
  InlineMath = "inlineMath",
}
function parseTextToAST(text: string): Root {
  const textHash = hashString53Bit(text);
  if (LRU.has(textHash)) {
    return mapValue(LRU, textHash);
  }
  const ast = fromMarkdown(text, {
    extensions: [
      combineExtensions([
        gfmFootnote(),
        gfmTaskListItem(),
        frontmatter(["yaml"]),
      ]),
      math(),
    ],
    mdastExtensions: [
      [
        gfmFootnoteFromMarkdown(),
        gfmTaskListItemFromMarkdown(),
        frontmatterFromMarkdown(["yaml"]),
      ],
      mathFromMarkdown(),
    ],
  });
  if (LRU.size >= 200) LRU.clear();
  LRU.set(textHash, ast);
  return ast;
}
type FenceIndentEdit = {
  start: number;
  end: number;
  prefix: string;
};
type LocatedCode = {
  code: Code;
  inList: boolean;
};
export function correctClosingFenceIndentation(text: string): string {
  while (true) {
    const codes = getCodeNodes(parseTextToAST(text));
    const edits: FenceIndentEdit[] = [];
    for (const { code, inList } of codes) {
      if (!inList) {
        continue;
      }
      const edit = getClosingFenceIndentEdit(text, code);
      if (edit) {
        edits.push(edit);
      }
    }
    if (edits.length === 0) {
      for (let index = 0; index < codes.length - 1; index++) {
        const { code, inList } = codes[index];
        if (!inList) {
          continue;
        }
        const edit = getUnderIndentedClosingFenceEdit(
          text,
          code,
          codes[index + 1].code,
        );
        if (edit) {
          edits.push(edit);
          break;
        }
      }
    }
    if (edits.length === 0) {
      return text;
    }
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      text = text.slice(0, edit.start) + edit.prefix + text.slice(edit.end);
    }
  }
}
function getCodeNodes(root: Root): LocatedCode[] {
  const codes: LocatedCode[] = [];
  const collectCodes = (node: Nodes, inList: boolean): void => {
    if (node.type === "blockquote") {
      return;
    }
    if (node.type === "code") {
      codes.push({ code: node, inList });
    } else if ("children" in node) {
      for (const child of node.children) {
        collectCodes(child, inList || node.type === "listItem");
      }
    }
  };
  collectCodes(root, false);
  return codes;
}
function getClosingFenceIndentEdit(
  text: string,
  code: Code,
): FenceIndentEdit | undefined {
  const start = code.position?.start.offset;
  const end = code.position?.end.offset;
  if (start === undefined || end === undefined) {
    return;
  }
  const source = text.slice(start, end);
  const opener = source.match(/^(`{3,}|~{3,})/);
  if (!opener) {
    return;
  }
  const sourceLines = [...source.matchAll(/([^\r\n]*)(?:\r\n|\r|\n|$)/g)];
  const valueLines = code.value.split(/\r\n|\r|\n/);
  let sourceIndex = sourceLines.length - 1;
  while (sourceIndex >= 0 && /^[ \t]*$/.test(sourceLines[sourceIndex][1])) {
    sourceIndex--;
  }
  let valueIndex = valueLines.length - 1;
  while (valueIndex >= 0 && /^[ \t]*$/.test(valueLines[valueIndex])) {
    valueIndex--;
  }
  if (valueIndex < 0 || sourceIndex !== valueIndex + 1) {
    return;
  }
  const sourceLine = sourceLines[sourceIndex];
  const closer = sourceLine[1].match(/^([ \t]*)(`{3,}|~{3,})[ \t]*$/);
  const valueCloser = valueLines[valueIndex].match(
    /^[ \t]*(`{3,}|~{3,})[ \t]*$/,
  );
  if (
    !closer ||
    !valueCloser ||
    closer[2] !== valueCloser[1] ||
    closer[2][0] !== opener[1][0] ||
    closer[2].length < opener[1].length
  ) {
    return;
  }
  const openerLineStart =
    Math.max(
      text.lastIndexOf("\n", start - 1),
      text.lastIndexOf("\r", start - 1),
    ) + 1;
  const openerPrefix = text.slice(openerLineStart, start);
  if (!/^(?:[ \t]|(?:[-+*]|\d{1,9}[.)])(?=[ \t]))*$/.test(openerPrefix)) {
    return;
  }
  const prefix = openerPrefix.replace(/[-+*]|\d{1,9}[.)]/g, (marker) =>
    " ".repeat(marker.length),
  );
  if (indentationWidth(closer[1]) <= indentationWidth(prefix)) {
    return;
  }
  const closerStart = start + sourceLine.index;
  return { start: closerStart, end: closerStart + closer[1].length, prefix };
}
function getUnderIndentedClosingFenceEdit(
  text: string,
  code: Code,
  candidate: Code,
): FenceIndentEdit | undefined {
  const position = code.position;
  const candidatePosition = candidate.position;
  const start = position?.start.offset;
  const end = position?.end.offset;
  const candidateStart = candidatePosition?.start.offset;
  if (
    !position ||
    !candidatePosition ||
    start === undefined ||
    end === undefined ||
    candidateStart === undefined ||
    position.end.line + 1 !== candidatePosition.start.line
  ) {
    return;
  }
  const opener = text.slice(start).match(/^(`{3,}|~{3,})/);
  const openerLineStart =
    Math.max(
      text.lastIndexOf("\n", start - 1),
      text.lastIndexOf("\r", start - 1),
    ) + 1;
  const openerPrefix = text.slice(openerLineStart, start);
  if (
    !opener ||
    !/^(?:[ \t]|(?:[-+*]|\d{1,9}[.)])(?=[ \t]))*$/.test(openerPrefix)
  ) {
    return;
  }
  const candidateLineStart =
    Math.max(
      text.lastIndexOf("\n", candidateStart - 1),
      text.lastIndexOf("\r", candidateStart - 1),
    ) + 1;
  const closer = text
    .slice(candidateLineStart)
    .match(/^([ \t]*)(`{3,}|~{3,})[ \t]*(?=\r|\n|$)/);
  if (
    !closer ||
    closer[2][0] !== opener[1][0] ||
    closer[2].length < opener[1].length
  ) {
    return;
  }
  const previousLineStart =
    Math.max(text.lastIndexOf("\n", end - 1), text.lastIndexOf("\r", end - 1)) +
    1;
  if (/^[ \t]*$/.test(text.slice(previousLineStart, end))) {
    return;
  }
  const prefix = openerPrefix.replace(/[-+*]|\d{1,9}[.)]/g, (marker) =>
    " ".repeat(marker.length),
  );
  if (indentationWidth(closer[1]) >= indentationWidth(prefix)) {
    return;
  }
  const edit = {
    start: candidateLineStart,
    end: candidateLineStart + closer[1].length,
    prefix,
  };
  const trial = text.slice(0, edit.start) + edit.prefix + text.slice(edit.end);
  const repaired = getCodeNodes(parseTextToAST(trial)).find(
    ({ code: node }) => node.position?.start.offset === start,
  )?.code;
  if (
    repaired?.position?.end.line !== candidatePosition.start.line ||
    repaired.value !== code.value ||
    repaired.lang !== code.lang ||
    repaired.meta !== code.meta
  ) {
    return;
  }
  return edit;
}
function indentationWidth(prefix: string): number {
  let width = 0;
  for (const character of prefix) {
    width += character === "\t" ? 4 - (width % 4) : 1;
  }
  return width;
}
export function getPositions(type: MDAstTypes, text: string): Position[] {
  const ast = parseTextToAST(text);
  const positions: Position[] = [];
  visit(ast, type, (node) => {
    positions.push(positionOf(node));
  });
  positions.sort((a, b) => b.start.offset - a.start.offset);
  return positions;
}
function getListItemTextPositions(
  text: string,
  includeEmptyNodes: boolean = false,
): PositionPlusEmptyIndicator[] {
  const ast = parseTextToAST(text);
  const positions: PositionPlusEmptyIndicator[] = [];
  visit(ast, "listItem", (node) => {
    if (!node.children || node.children.length === 0) {
      if (includeEmptyNodes) {
        positions.push({
          position: positionOf(node),
          isEmpty: true,
        });
      }
      return;
    }
    for (const childNode of node.children) {
      if (childNode.type === "paragraph") {
        positions.push({
          position: positionOf(childNode),
          isEmpty: false,
        });
      }
    }
  });
  positions.sort((a, b) => b.position.start.offset - a.position.start.offset);
  return positions;
}
export function moveFootnotesToEnd(
  text: string,
  includeBlankLinesBetweenFootnotes: boolean,
): string {
  const positions: Position[] = getPositions(MDAstTypes.Footnote, text);
  let footnotes: string[] = [];
  type footnoteKeyInfo = {
    key: string;
    referencePositions: number[];
    footnotesReferencingKey: string[];
  };
  const footnoteKeyToFootnoteKeyInfo = new Map<string, footnoteKeyInfo>();
  const mapOfFootnoteToFootnoteReferenceIndex = new Map<string, number>();
  const getAllReferencePositionsForFootnote = function (
    text: string,
    footnote: string,
    startOfFootnoteReferenceSearch: number,
  ): void {
    const footnoteReference = footnoteKey(footnote);
    const keyInfoExisting = footnoteKeyToFootnoteKeyInfo.get(footnoteReference);
    if (keyInfoExisting) {
      const keyInfo = keyInfoExisting;
      keyInfo.footnotesReferencingKey.push(footnote);
      footnoteKeyToFootnoteKeyInfo.set(footnoteReference, keyInfo);
      return;
    }
    let footnoteReferenceLocation: number;
    const footnoteReferenceLocations: number[] = [];
    do {
      footnoteReferenceLocation = text.lastIndexOf(
        footnoteReference,
        startOfFootnoteReferenceSearch,
      );
      if (footnoteReferenceLocation === -1) {
        continue;
      }
      footnoteReferenceLocations.push(footnoteReferenceLocation);
      startOfFootnoteReferenceSearch = footnoteReferenceLocation - 1;
    } while (footnoteReferenceLocation > 0);
    const keyInfo: footnoteKeyInfo = {
      key: footnoteReference,
      referencePositions: footnoteReferenceLocations,
      footnotesReferencingKey: [footnote],
    };
    footnoteKeyToFootnoteKeyInfo.set(footnoteReference, keyInfo);
  };
  for (const position of positions) {
    const footnote = text.substring(position.start.offset, position.end.offset);
    footnotes.push(footnote);
    if (
      position.end.offset < text.length &&
      text[position.end.offset] === "\n"
    ) {
      text =
        text.substring(0, position.end.offset) +
        text.substring(position.end.offset + 1);
    }
    if (
      position.end.offset < text.length &&
      text[position.end.offset] === "\n"
    ) {
      text =
        text.substring(0, position.end.offset) +
        text.substring(position.end.offset + 1);
    }
    text =
      text.substring(0, position.start.offset) +
      text.substring(position.end.offset);
    getAllReferencePositionsForFootnote(text, footnote, position.start.offset);
  }
  for (const footnoteData of footnoteKeyToFootnoteKeyInfo) {
    const keyInfo = footnoteData[1];
    let offset =
      keyInfo.referencePositions.length -
      keyInfo.footnotesReferencingKey.length;
    offset = offset >= 0 ? offset : 0;
    let index = 0;
    for (const footnote of keyInfo.footnotesReferencingKey) {
      if (index + offset >= keyInfo.referencePositions.length) {
        throw new Error(
          "Missing footnote reference for {FOOTNOTE}.".replace(
            "{FOOTNOTE}",
            footnote,
          ),
        );
      }
      mapOfFootnoteToFootnoteReferenceIndex.set(
        footnote,
        keyInfo.referencePositions[offset + index++],
      );
    }
  }
  footnotes = footnotes.sort((f1: string, f2: string) => {
    return (
      mapValue(mapOfFootnoteToFootnoteReferenceIndex, f1) -
      mapValue(mapOfFootnoteToFootnoteReferenceIndex, f2)
    );
  });
  if (footnotes.length > 0) {
    text = text.trimEnd();
  }
  let whitespaceBetweenFootnotes = "\n";
  if (includeBlankLinesBetweenFootnotes) {
    whitespaceBetweenFootnotes = "\n\n";
  } else if (footnotes.length > 0) {
    text += "\n";
  }
  for (const footnote of footnotes) {
    text += whitespaceBetweenFootnotes + footnote;
  }
  return text;
}
export function reIndexFootnotes(text: string): string {
  const positions: Position[] = getPositions(MDAstTypes.Footnote, text);
  const footnotes: string[] = [];
  type keyInfo = {
    key: string;
    position: number;
  };
  const footnoteToFootnoteKey = new Map<string, string>();
  const oldKeyToNewKey = new Map<string, string>();
  const footnoteReferenceLocationInfo: keyInfo[] = [];
  const footnoteKeys = new Set<string>();
  const duplicateFootnotesToReplace: string[] = [];
  const getAllFootnoteReferences = function (
    text: string,
    footnote: string,
    startOfFootnoteReferenceSearch: number,
  ): void {
    const footnoteReference = footnoteKey(footnote);
    footnoteToFootnoteKey.set(footnote, footnoteReference);
    const footnoteKeyAlreadyUsed = footnoteKeys.has(footnoteReference);
    if (footnoteKeyAlreadyUsed && footnotes.includes(footnote)) {
      duplicateFootnotesToReplace.unshift(footnote);
      return;
    } else if (footnoteKeyAlreadyUsed) {
      throw new Error(
        "Footnote {FOOTNOTE_KEY} has conflicting definitions.".replace(
          "{FOOTNOTE_KEY}",
          footnoteReference,
        ),
      );
    }
    let footnoteReferenceLocation: number;
    do {
      footnoteReferenceLocation = text.lastIndexOf(
        footnoteReference,
        startOfFootnoteReferenceSearch,
      );
      if (footnoteReferenceLocation === -1) {
        continue;
      }
      if (
        footnoteReferenceLocation + footnote.length > text.length ||
        text.substring(
          footnoteReferenceLocation,
          footnoteReferenceLocation + footnote.length,
        ) !== footnote
      ) {
        footnoteReferenceLocationInfo.push({
          key: footnoteReference,
          position: footnoteReferenceLocation,
        });
      }
      startOfFootnoteReferenceSearch = footnoteReferenceLocation - 1;
    } while (footnoteReferenceLocation > 0);
    footnoteKeys.add(footnoteReference);
  };
  for (const position of positions) {
    const footnote = text.substring(position.start.offset, position.end.offset);
    footnotes.unshift(footnote);
    getAllFootnoteReferences(text, footnote, position.start.offset);
  }
  let footnoteIndex = 1;
  const footnotesAdded = new Set<string>();
  for (const footnote of footnotes) {
    if (footnotesAdded.has(footnote)) {
      continue;
    }
    footnotesAdded.add(footnote);
    const footnoteKey = mapValue(footnoteToFootnoteKey, footnote);
    const newFootnoteKey = `[^${footnoteIndex++}]`;
    oldKeyToNewKey.set(footnoteKey, newFootnoteKey);
  }
  footnoteReferenceLocationInfo.sort((pos1: keyInfo, pos2: keyInfo) => {
    return pos2.position - pos1.position;
  });
  for (const footnoteReference of footnoteReferenceLocationInfo) {
    const newFootnoteKey = mapValue(oldKeyToNewKey, footnoteReference.key);
    text = replaceAt(
      text,
      footnoteReference.key,
      newFootnoteKey,
      footnoteReference.position,
    );
  }
  for (const footnote of footnotesAdded) {
    const footnoteKey = mapValue(footnoteToFootnoteKey, footnote);
    const newFootnoteKey = mapValue(oldKeyToNewKey, footnoteKey);
    text = text.replace(
      footnote,
      footnote.replace(footnoteKey, newFootnoteKey),
    );
  }
  for (const duplicateFootnoteDefinition of duplicateFootnotesToReplace) {
    let newText = text.replace(`\n${duplicateFootnoteDefinition}\n`, "\n");
    if (text === newText) {
      newText = text.replace(duplicateFootnoteDefinition, "");
    }
    text = newText;
  }
  return text;
}
export function updateItalicsText(
  text: string,
  func: (text: string) => string,
): string {
  const positions: Position[] = getPositions(MDAstTypes.Italics, text);
  for (const position of positions) {
    let italicText = text.substring(
      position.start.offset + 1,
      position.end.offset - 1,
    );
    italicText = func(italicText);
    text = replaceTextBetweenStartAndEndWithNewValue(
      text,
      position.start.offset + 1,
      position.end.offset - 1,
      italicText,
    );
  }
  return text;
}
export function updateBoldText(
  text: string,
  func: (text: string) => string,
): string {
  const positions: Position[] = getPositions(MDAstTypes.Bold, text);
  for (const position of positions) {
    let boldText = text.substring(
      position.start.offset + 2,
      position.end.offset - 2,
    );
    boldText = func(boldText);
    text = replaceTextBetweenStartAndEndWithNewValue(
      text,
      position.start.offset + 2,
      position.end.offset - 2,
      boldText,
    );
  }
  return text;
}
export function updateListItemText(
  text: string,
  func: (text: string) => string,
  includeEmptyNodes: boolean = false,
): string {
  const positions: PositionPlusEmptyIndicator[] = getListItemTextPositions(
    text,
    includeEmptyNodes,
  );
  for (const position of positions) {
    let startIndex = position.position.start.offset;
    if (position.isEmpty) {
      while (
        startIndex < position.position.end.offset &&
        text.charAt(startIndex).trim() !== ""
      ) {
        startIndex++;
      }
      if (startIndex < position.position.end.offset) {
        startIndex++;
      }
    } else {
      while (startIndex > 0 && text.charAt(startIndex - 1).trim() === "") {
        startIndex--;
      }
      if (startIndex === 0 || text.charAt(startIndex - 1).trim() != "") {
        startIndex++;
      }
    }
    let listText = text.substring(startIndex, position.position.end.offset);
    if (checklistBoxStartsTextRegex.test(listText)) {
      startIndex += 4;
      listText = listText.substring(4);
    }
    listText = func(listText);
    text = replaceTextBetweenStartAndEndWithNewValue(
      text,
      startIndex,
      position.position.end.offset,
      listText,
    );
  }
  return text;
}
export function ensureEmptyLinesAroundFencedCodeBlocks(text: string): string {
  const positions: Position[] = [];
  visit(parseTextToAST(text), (node) => {
    if (node.type === "listItem") {
      return SKIP;
    }
    if (node.type === "code") {
      positions.push(positionOf(node));
    }
  });
  positions.sort((a, b) => b.start.offset - a.start.offset);
  for (const position of positions) {
    const codeBlock = text.substring(
      position.start.offset,
      position.end.offset,
    );
    if (!codeBlock.startsWith("```") && !codeBlock.startsWith(`~~~`)) {
      continue;
    }
    text = makeSureContentHasEmptyLinesAddedBeforeAndAfter(
      text,
      position.start.offset,
      position.end.offset,
    );
  }
  return text;
}
export function ensureEmptyLinesAroundMathBlock(
  text: string,
  numberOfDollarSignsForMathBlock: number,
): string {
  let positions: Position[] = getPositions(MDAstTypes.Math, text);
  for (const position of positions) {
    text = makeSureContentHasEmptyLinesAddedBeforeAndAfter(
      text,
      position.start.offset,
      position.end.offset,
    );
  }
  positions = getPositions(MDAstTypes.InlineMath, text);
  for (const position of positions) {
    if (
      !text
        .substring(position.start.offset, position.end.offset)
        .startsWith("$".repeat(numberOfDollarSignsForMathBlock))
    ) {
      continue;
    }
    text = makeSureContentHasEmptyLinesAddedBeforeAndAfter(
      text,
      position.start.offset,
      position.end.offset,
    );
  }
  return text;
}
export function ensureEmptyLinesAroundHorizontalRule(text: string): string {
  const positions: Position[] = getPositions(MDAstTypes.HorizontalRule, text);
  for (const position of positions) {
    text = makeSureContentHasEmptyLinesAddedBeforeAndAfter(
      text,
      position.start.offset,
      position.end.offset,
    );
  }
  return text;
}
export function getAllTablesInText(text: string): {
  startIndex: number;
  endIndex: number;
}[] {
  const regexMatches = [...text.matchAll(tableSeparator)];
  const positions: {
    startIndex: number;
    endIndex: number;
  }[] = [];
  for (const match of regexMatches) {
    const startOfCurrentLine = getStartOfLineIndex(text, match.index);
    if (startOfCurrentLine === 0) {
      continue;
    }
    const startOfPreviousLine = getStartOfLineIndex(
      text,
      startOfCurrentLine - 1,
    );
    const separatorRowMatch = match[0];
    const tableRowSeparator = text.substring(
      startOfCurrentLine,
      match.index + separatorRowMatch.length,
    );
    if (isInvalidTableSeparatorRow(tableRowSeparator, separatorRowMatch)) {
      continue;
    }
    let start = startOfPreviousLine;
    let firstLine = text.substring(startOfPreviousLine, startOfCurrentLine - 1);
    if (!separatorRowMatch.includes("|") && !firstLine.includes("|")) {
      continue;
    }
    firstLine = firstLine.replace(tableStartingPipe, (match: string) => {
      const trimmedMatch = match.trim();
      if (trimmedMatch === "" || trimmedMatch === "|") {
        return "";
      }
      start += match.length - 1;
      return "";
    });
    let delimiterLine = separatorRowMatch.replace(tableStartingPipe, "");
    if (firstLine.endsWith("|")) {
      firstLine = firstLine.slice(0, -1);
    }
    if (delimiterLine.endsWith("|")) {
      delimiterLine = delimiterLine.slice(0, -1);
    }
    if (
      countTableDelimiters(firstLine) !== countTableDelimiters(delimiterLine)
    ) {
      continue;
    }
    if (startOfPreviousLine !== 0) {
      const startOfTwoLinesPrior = getStartOfLineIndex(
        text,
        startOfPreviousLine - 1,
      );
      const twoLinesPrior = text.substring(
        startOfTwoLinesPrior,
        startOfPreviousLine - 1,
      );
      if (twoLinesPrior.startsWith("|") || twoLinesPrior.endsWith("|")) {
        continue;
      }
    }
    let end = match.index + match[0].length;
    if (end >= text.length - 1) {
      positions.push({
        startIndex: start,
        endIndex: text.length,
      });
      continue;
    }
    const remainingLines = text.substring(end + 1).split("\n");
    let index = 0;
    while (
      index < remainingLines.length &&
      tableRow.test(remainingLines[index])
    ) {
      end += remainingLines[index].length + 1;
      index++;
    }
    positions.push({
      startIndex: start,
      endIndex: end,
    });
  }
  return positions.reverse();
}
function isInvalidTableSeparatorRow(
  fullRow: string,
  separatorMatch: string,
): boolean {
  if (fullRow.trim() === "") {
    return true;
  }
  if (separatorMatch.includes("||")) {
    return true;
  }
  const nonSeparatorContent = fullRow.replace(separatorMatch, "");
  return /[^\s>]/.test(nonSeparatorContent);
}
function countTableDelimiters(line: string): number {
  let previousCharIsEscapeChar = false;
  let numEscapeCharsInARow = 0;
  let numDelimiters = 0;
  let currentChar: string;
  for (let i = 0; i < line.length; i++) {
    currentChar = line[i];
    if (currentChar === "\\") {
      numEscapeCharsInARow++;
      previousCharIsEscapeChar = numEscapeCharsInARow % 2 == 1;
    } else {
      numEscapeCharsInARow = 0;
      if (currentChar === "|" && !previousCharIsEscapeChar) {
        numDelimiters++;
      }
      previousCharIsEscapeChar = false;
    }
  }
  return numDelimiters;
}
export function getAllCustomIgnoreSectionsInText(text: string): {
  startIndex: number;
  endIndex: number;
}[] {
  let iteratorIndex = 0;
  const positions: {
    startIndex: number;
    endIndex: number;
  }[] = [];
  const startMatches = [...text.matchAll(customIgnoreAllStartIndicator)];
  if (!startMatches || startMatches.length === 0) {
    return positions;
  }
  const endMatches = [...text.matchAll(customIgnoreAllEndIndicator)];
  startMatches.forEach((startMatch) => {
    iteratorIndex = startMatch.index;
    let foundEndingIndicator = false;
    let endingPosition = text.length - 1;
    while (endMatches && endMatches.length !== 0 && !foundEndingIndicator) {
      if (endMatches[0].index <= iteratorIndex) {
        endMatches.shift();
      } else {
        foundEndingIndicator = true;
        const endingIndicator = endMatches[0];
        endingPosition = endingIndicator.index + endingIndicator[0].length;
      }
    }
    positions.push({
      startIndex: iteratorIndex,
      endIndex: endingPosition,
    });
    if (!endMatches || endMatches.length === 0) {
      return;
    }
  });
  return positions.reverse();
}
export const yamlRegex = /^---\n((?:(((?!---)(?:.|\n)*?)\n)?))---(?=\n|$)/;
export const wikiLinkRegex =
  /(!?)\[{2}([^\][\n|]+)(\|([^\][\n|]+))?(\|([^\][\n|]+))?\]{2}/g;
export const genericLinkRegex = /(!?)\[([^[]*)\](\(.*\))/g;
export const tagWithLeadingWhitespaceRegex =
  /(\s|^)(#(?=\d*[\p{L}\-_/\p{Emoji_Presentation}])[\p{L}\-_\d/\p{Emoji_Presentation}]+)/gu;
export const obsidianMultilineCommentRegex = /^%%\n[^%]*\n%%/gm;
export const lineStartingWithWhitespaceOrBlockquoteTemplate = `\\s*(>\\s*)*`;
export const tableSeparator =
  /(\|? *:?-{1,}:? *\|?)(\| *:?-{1,}:? *\|?)*( |\t)*$/gm;
export const tableStartingPipe = /^(((>[ ]?)*)|([ ]{0,3}))\|/m;
export const tableRow = /[^\n]*?\|[^\n]*?(\n|$)/m;
export const urlRegex =
  /(?:(?:(?:[a-z]+:)?\/\/)|www\.)(?:localhost|(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}|(?:(?:[a-fA-F\d]{1,4}:){7}(?:[a-fA-F\d]{1,4}|:)|(?:[a-fA-F\d]{1,4}:){6}(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}|:[a-fA-F\d]{1,4}|:)|(?:[a-fA-F\d]{1,4}:){5}(?::(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}|(?::[a-fA-F\d]{1,4}){1,2}|:)|(?:[a-fA-F\d]{1,4}:){4}(?:(?::[a-fA-F\d]{1,4}){0,1}:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}|(?::[a-fA-F\d]{1,4}){1,3}|:)|(?:[a-fA-F\d]{1,4}:){3}(?:(?::[a-fA-F\d]{1,4}){0,2}:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}|(?::[a-fA-F\d]{1,4}){1,4}|:)|(?:[a-fA-F\d]{1,4}:){2}(?:(?::[a-fA-F\d]{1,4}){0,3}:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}|(?::[a-fA-F\d]{1,4}){1,5}|:)|(?:[a-fA-F\d]{1,4}:){1}(?:(?::[a-fA-F\d]{1,4}){0,4}:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}|(?::[a-fA-F\d]{1,4}){1,6}|:)|(?::(?:(?::[a-fA-F\d]{1,4}){0,5}:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}|(?::[a-fA-F\d]{1,4}){1,7}|:)))(?:%[0-9a-zA-Z]{1,})?|(?:(?:[a-z0-9][-_]*)*[a-z0-9]+)(?:\.(?:[a-z0-9]-*)*[a-z0-9]+)*(?:\.(?:[a-z]{2,})))(?::\d{2,5})?(?:(?:[/?#][a-z0-9-_%/&=?$.+~!*‘(,#@]*[a-z0-9-%_/$+~!*‘(,])|[/])?/gi;
export const anchorTagRegex = /<a[\s]+([^>]+)>((?:.(?!<\/a>))*.)<\/a>/g;
export const customIgnoreAllStartIndicator =
  generateHTMLLinterCommentWithSpecificTextAndWhitespaceRegexMatch(true);
export const customIgnoreAllEndIndicator =
  generateHTMLLinterCommentWithSpecificTextAndWhitespaceRegexMatch(false);
export const templaterCommandRegex = /<%[^]*?%>/g;
export const checklistBoxIndicator = "\\[.\\]";
export const checklistBoxStartsTextRegex = new RegExp(
  `^${checklistBoxIndicator}`,
);
export const footnoteDefinitionIndicatorAtStartOfLine =
  /^(\[\^[^\]]*\]) ?([,.;!:?])/gm;
export const calloutRegex = /^(>\s*)+\[![^\s]*\]/m;
export const codeBlockBlockquoteRegex = /^\n?(>\s*)+((```)|(~~~))/m;
export const multipleBlankLinesRegex =
  /(\n([\t\v\f\r \u00a0\u2000-\u200b\u2028-\u2029\u3000]+)?){2,}\n/g;
export function escapeDollarSigns(str: string): string {
  return str.replace(/\$/g, "$$$$");
}
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function ensureEmptyLinesAroundTables(text: string): string {
  const tablePositions = getAllTablesInText(text);
  if (tablePositions.length === 0) {
    return text;
  }
  for (const tablePosition of tablePositions) {
    text = makeSureContentHasEmptyLinesAddedBeforeAndAfter(
      text,
      tablePosition.startIndex,
      tablePosition.endIndex,
    );
  }
  return text;
}
export function generateHTMLLinterCommentWithSpecificTextAndWhitespaceRegexMatch(
  isStart: boolean,
): RegExp {
  const regexTemplate = "(?:<!-{2,}|%%) *linter-{ENDING_TEXT} *(?:-{2,}>|%%)";
  let endingText = "";
  if (isStart) {
    endingText += "disable";
  } else {
    endingText += "enable";
  }
  return new RegExp(regexTemplate.replace("{ENDING_TEXT}", endingText), "g");
}
export function insert(str: string, index: number, value: string): string {
  return str.substring(0, index) + value + str.substring(index);
}
export function replaceTextBetweenStartAndEndWithNewValue(
  str: string,
  start: number,
  end: number,
  value: string,
): string {
  return str.substring(0, start) + value + str.substring(end);
}
export function getStartOfLineWhitespaceOrBlockquoteLevel(
  text: string,
  startPosition: number,
): [string, number] {
  if (startPosition === 0) {
    return ["", 0];
  }
  let startOfLine = "";
  let index = startPosition;
  while (index >= 0) {
    const char = text.charAt(index);
    if (char === "\n") {
      break;
    } else if (char.trim() === "" || char === ">") {
      startOfLine = char + startOfLine;
    } else {
      startOfLine = "";
    }
    index--;
  }
  return [startOfLine, index];
}
function getEmptyLine(line: string = ""): string {
  const [lineStart] = getStartOfLineWhitespaceOrBlockquoteLevel(
    line,
    line.length,
  );
  return "\n" + lineStart.trim();
}
function getEmptyLineForAfterBlockquote(
  nextLine: string = "",
  isCallout: boolean = false,
  blockquoteLevel: number = 1,
): string {
  const potentialEmptyLine = getEmptyLine(nextLine);
  const nextBlockquoteLevel = countInstances(potentialEmptyLine, ">");
  const dealingWithACallout = isCallout || calloutRegex.test(nextLine);
  if (dealingWithACallout && blockquoteLevel === nextBlockquoteLevel) {
    return potentialEmptyLine.substring(0, potentialEmptyLine.lastIndexOf(">"));
  }
  if (blockquoteLevel < nextBlockquoteLevel) {
    return potentialEmptyLine.substring(0, potentialEmptyLine.lastIndexOf(">"));
  }
  return potentialEmptyLine;
}
function makeSureContentHasASingleEmptyLineBeforeItUnlessItStartsAFile(
  text: string,
  startOfContent: number,
): string {
  if (startOfContent === 0) {
    return text;
  }
  let index = startOfContent;
  let startOfNewContent = startOfContent;
  while (index >= 0) {
    const currentChar = text.charAt(index);
    if (currentChar.trim() !== "") {
      break;
    } else if (currentChar === "\n") {
      startOfNewContent = index;
    }
    index--;
  }
  if (index < 0 || startOfNewContent === 0) {
    return text.substring(startOfContent + 1);
  }
  return (
    text.substring(0, startOfNewContent) + "\n" + text.substring(startOfContent)
  );
}
function makeSureContentHasASingleEmptyLineBeforeItUnlessItStartsAFileForBlockquote(
  text: string,
  startOfLine: string,
  startOfContent: number,
  isCallout: boolean = false,
  addingEmptyLinesAroundBlockquotes: boolean = false,
): string {
  if (startOfContent === 0) {
    return text;
  }
  const nestingLevel = startOfLine.split(">").length - 1;
  let index = startOfContent;
  let startOfNewContent = startOfContent;
  let lineNestingLevel = 0;
  let foundABlankLine = false;
  let previousChar = "";
  while (index >= 0) {
    const currentChar = text.charAt(index);
    if (currentChar.trim() !== "" && currentChar !== ">") {
      break;
    } else if (currentChar === ">") {
      if (foundABlankLine) {
        break;
      }
      lineNestingLevel++;
    } else if (currentChar === "\n") {
      if (
        lineNestingLevel === 0 ||
        lineNestingLevel === nestingLevel ||
        lineNestingLevel + 1 === nestingLevel
      ) {
        startOfNewContent = index;
        lineNestingLevel = 0;
        if (previousChar === "\n") {
          foundABlankLine = true;
        }
      } else {
        break;
      }
    }
    index--;
    previousChar = currentChar;
  }
  if (index < 0 || startOfNewContent === 0) {
    return text.substring(startOfContent + 1);
  }
  const startingEmptyLines = text.substring(startOfNewContent, startOfContent);
  const startsWithEmptyLine =
    startingEmptyLines === "\n" || startingEmptyLines.startsWith("\n\n");
  if (startsWithEmptyLine) {
    return (
      text.substring(0, startOfNewContent) +
      "\n" +
      text.substring(startOfContent)
    );
  }
  const indexOfLastNewLine = text.lastIndexOf("\n", startOfNewContent - 1);
  let priorLine: string;
  if (indexOfLastNewLine === -1) {
    priorLine = text.substring(0, startOfNewContent);
  } else {
    priorLine = text.substring(indexOfLastNewLine, startOfNewContent);
  }
  let firstLineOfBlockquote: string;
  const indexOfEndOfFirstLine = text.indexOf("\n", startOfContent + 1);
  if (indexOfEndOfFirstLine === -1) {
    firstLineOfBlockquote = text.substring(startOfContent);
  } else {
    firstLineOfBlockquote = text.substring(
      startOfContent,
      indexOfEndOfFirstLine,
    );
  }
  let emptyLine: string;
  if (addingEmptyLinesAroundBlockquotes) {
    emptyLine = getEmptyLineForAfterBlockquote(
      priorLine,
      isCallout,
      nestingLevel,
    );
  } else if (
    countInstances(priorLine, ">") != 0 &&
    !calloutRegex.test(priorLine) &&
    (codeBlockBlockquoteRegex.test(priorLine) ||
      codeBlockBlockquoteRegex.test(firstLineOfBlockquote))
  ) {
    emptyLine = text.substring(startOfNewContent, startOfContent).trimEnd();
  } else {
    emptyLine = getEmptyLine(priorLine);
  }
  return (
    text.substring(0, startOfNewContent) +
    emptyLine +
    text.substring(startOfContent)
  );
}
function makeSureContentHasASingleEmptyLineAfterItUnlessItEndsAFile(
  text: string,
  endOfContent: number,
): string {
  if (endOfContent === text.length - 1) {
    return text;
  }
  let index = endOfContent;
  let endOfNewContent = endOfContent;
  let isFirstNewLine = true;
  while (index < text.length) {
    const currentChar = text.charAt(index);
    if (currentChar.trim() !== "") {
      break;
    } else if (currentChar === "\n") {
      if (isFirstNewLine) {
        isFirstNewLine = false;
      } else {
        endOfNewContent = index;
      }
    }
    index++;
  }
  if (index === text.length || endOfNewContent === text.length - 1) {
    return text.substring(0, endOfContent);
  }
  return (
    text.substring(0, endOfContent) + "\n" + text.substring(endOfNewContent)
  );
}
function makeSureContentHasASingleEmptyLineAfterItUnlessItEndsAFileForBlockquote(
  text: string,
  startOfLine: string,
  endOfContent: number,
  isCallout: boolean = false,
  addingEmptyLinesAroundBlockquotes: boolean = false,
): string {
  if (endOfContent === text.length - 1) {
    return text;
  }
  const nestingLevel = startOfLine.split(">").length - 1;
  let index = endOfContent;
  let endOfNewContent = endOfContent;
  let isFirstNewLine = true;
  let lineNestingLevel = 0;
  let foundABlankLine = false;
  let previousChar = "";
  let firstChar = true;
  const preEndingChar = text.charAt(index - 1);
  while (index < text.length) {
    const currentChar = text.charAt(index);
    if (currentChar.trim() !== "" && currentChar !== ">") {
      break;
    } else if (currentChar === ">") {
      if (foundABlankLine) {
        break;
      }
      lineNestingLevel++;
    } else if (currentChar === "\n") {
      if (
        lineNestingLevel === 0 ||
        lineNestingLevel === nestingLevel ||
        lineNestingLevel + 1 === nestingLevel
      ) {
        lineNestingLevel = 0;
        if (isFirstNewLine) {
          isFirstNewLine = false;
        } else {
          endOfNewContent = index;
        }
        if (previousChar === "\n") {
          foundABlankLine = true;
        }
      } else {
        break;
      }
    }
    index++;
    previousChar = currentChar;
    if (
      firstChar &&
      currentChar === "\n" &&
      addingEmptyLinesAroundBlockquotes &&
      preEndingChar === "\n"
    ) {
      endOfNewContent = index;
      break;
    }
    firstChar = false;
  }
  if (index === text.length || endOfNewContent === text.length - 1) {
    return text.substring(0, endOfContent);
  }
  const endingEmptyLines = text.substring(endOfContent, endOfNewContent);
  const endsInEmptyLine =
    endingEmptyLines === "\n" || endingEmptyLines.endsWith("\n\n");
  if (endsInEmptyLine) {
    return (
      text.substring(0, endOfContent) + "\n" + text.substring(endOfNewContent)
    );
  }
  const indexOfSecondNewLineAfterContent = text.indexOf(
    "\n",
    endOfNewContent + 1,
  );
  let nextLine: string;
  if (indexOfSecondNewLineAfterContent === -1) {
    nextLine = text.substring(endOfNewContent);
  } else {
    nextLine = text.substring(
      endOfNewContent + 1,
      indexOfSecondNewLineAfterContent,
    );
  }
  let lastLineOfBlockquote: string;
  const indexOfEndOfLastLine = text.lastIndexOf("\n", endOfContent - 1);
  if (indexOfEndOfLastLine === -1) {
    lastLineOfBlockquote = text.substring(0, endOfNewContent);
  } else {
    lastLineOfBlockquote = text.substring(
      indexOfEndOfLastLine + 1,
      endOfContent,
    );
  }
  let emptyLine: string;
  if (addingEmptyLinesAroundBlockquotes) {
    emptyLine = getEmptyLineForAfterBlockquote(
      nextLine,
      isCallout,
      nestingLevel,
    );
  } else if (
    codeBlockBlockquoteRegex.test(nextLine) ||
    codeBlockBlockquoteRegex.test(lastLineOfBlockquote)
  ) {
    emptyLine = text.substring(endOfContent, endOfNewContent).trimEnd();
  } else {
    emptyLine = getEmptyLine(nextLine);
  }
  return (
    text.substring(0, endOfContent) +
    emptyLine +
    text.substring(endOfNewContent)
  );
}
export function makeSureContentHasEmptyLinesAddedBeforeAndAfter(
  text: string,
  start: number,
  end: number,
  addingEmptyLinesAroundBlockquotes: boolean = false,
): string {
  const [startOfLine, initialStartOfLineIndex] =
    getStartOfLineWhitespaceOrBlockquoteLevel(text, start);
  let startOfLineIndex = initialStartOfLineIndex;
  if (startOfLine.trim() !== "") {
    const isCallout = calloutRegex.test(text.substring(start, end));
    const blockquoteLevel = countInstances(startOfLine, ">");
    const newEnd = getIndexOfEndOfLastNonEmptyLine(text, end, blockquoteLevel);
    const newText =
      makeSureContentHasASingleEmptyLineAfterItUnlessItEndsAFileForBlockquote(
        text,
        startOfLine,
        newEnd,
        isCallout,
        addingEmptyLinesAroundBlockquotes,
      );
    startOfLineIndex = getIndexOfStartOfFirstNonEmptyLine(
      newText,
      startOfLineIndex,
      blockquoteLevel,
    );
    return makeSureContentHasASingleEmptyLineBeforeItUnlessItStartsAFileForBlockquote(
      newText,
      startOfLine,
      startOfLineIndex,
      isCallout,
      addingEmptyLinesAroundBlockquotes,
    );
  }
  const newText = makeSureContentHasASingleEmptyLineAfterItUnlessItEndsAFile(
    text,
    end,
  );
  return makeSureContentHasASingleEmptyLineBeforeItUnlessItStartsAFile(
    newText,
    startOfLineIndex,
  );
}
export function hashString53Bit(str: string, seed: number = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
export function getStartOfLineIndex(
  text: string,
  indexToStartFrom: number,
): number {
  if (indexToStartFrom == 0) {
    return indexToStartFrom;
  }
  let startOfLineIndex = indexToStartFrom;
  while (startOfLineIndex > 0 && text.charAt(startOfLineIndex - 1) !== "\n") {
    startOfLineIndex--;
  }
  return startOfLineIndex;
}
export function replaceAt(
  text: string,
  search: string,
  replace: string,
  start: number,
): string {
  if (start > text.length - 1) {
    return text;
  }
  return (
    text.slice(0, start) +
    text.slice(start, text.length).replace(search, replace)
  );
}
export function countInstances(text: string, instancesOf: string): number {
  let counter = 0;
  for (let i = 0, input_length = text.length; i < input_length; i++) {
    const index_of_sub = text.indexOf(instancesOf, i);
    if (index_of_sub > -1) {
      counter++;
      i = index_of_sub;
    }
  }
  return counter;
}
function getIndexOfStartOfFirstNonEmptyLine(
  text: string,
  currentStartOfBlockquote: number,
  blockquoteLevel: number,
): number {
  let actualStartOfBlockquote = currentStartOfBlockquote;
  let blockquoteIndex = currentStartOfBlockquote + 1;
  let currentChar: string;
  let foundNewStart = false;
  let level = 0;
  while (blockquoteIndex < text.length) {
    currentChar = text.charAt(blockquoteIndex);
    if (currentChar.trim() !== "" && currentChar !== ">") {
      foundNewStart = true;
      break;
    } else if (currentChar === "\n") {
      if (level !== blockquoteLevel) {
        break;
      }
      level = 0;
      actualStartOfBlockquote = blockquoteIndex;
    } else if (currentChar === ">") {
      level++;
    }
    blockquoteIndex++;
  }
  if (foundNewStart) {
    return actualStartOfBlockquote;
  }
  return currentStartOfBlockquote;
}
function getIndexOfEndOfLastNonEmptyLine(
  text: string,
  currentEndOfBlockquote: number,
  blockquoteLevel: number,
): number {
  let actualEndOfBlockquote = currentEndOfBlockquote;
  let blockquoteIndex = currentEndOfBlockquote - 1;
  let currentChar: string;
  let foundNewEnd = false;
  let level = 0;
  while (blockquoteIndex >= 0) {
    currentChar = text.charAt(blockquoteIndex);
    if (currentChar.trim() !== "" && currentChar !== ">") {
      foundNewEnd = true;
      break;
    } else if (currentChar === "\n") {
      if (level !== blockquoteLevel) {
        break;
      }
      level = 0;
      actualEndOfBlockquote = blockquoteIndex;
    } else if (currentChar === ">") {
      level++;
    }
    blockquoteIndex--;
  }
  if (foundNewEnd) {
    return actualEndOfBlockquote;
  }
  return currentEndOfBlockquote;
}
export type IgnoreFunction = (
  text: string,
  placeholder: string,
) => [placeholderInfo[], string];
export type IgnoreType = {
  replaceAction: MDAstTypes | RegExp | IgnoreFunction;
  placeholder: string;
};
export const IgnoreTypes: Record<string, IgnoreType> = {
  code: {
    replaceAction: MDAstTypes.Code,
    placeholder: "{CODE_BLOCK_PLACEHOLDER}",
  },
  inlineCode: {
    replaceAction: MDAstTypes.InlineCode,
    placeholder: "{INLINE_CODE_BLOCK_PLACEHOLDER}",
  },
  image: {
    replaceAction: MDAstTypes.Image,
    placeholder: "{IMAGE_PLACEHOLDER}",
  },
  thematicBreak: {
    replaceAction: MDAstTypes.HorizontalRule,
    placeholder: "{HORIZONTAL_RULE_PLACEHOLDER}",
  },
  italics: {
    replaceAction: MDAstTypes.Italics,
    placeholder: "{ITALICS_PLACEHOLDER}",
  },
  bold: { replaceAction: MDAstTypes.Bold, placeholder: "{STRONG_PLACEHOLDER}" },
  list: { replaceAction: MDAstTypes.List, placeholder: "{LIST_PLACEHOLDER}" },
  blockquote: {
    replaceAction: MDAstTypes.Blockquote,
    placeholder: "{BLOCKQUOTE_PLACEHOLDER}",
  },
  math: { replaceAction: MDAstTypes.Math, placeholder: "{MATH_PLACEHOLDER}" },
  inlineMath: {
    replaceAction: MDAstTypes.InlineMath,
    placeholder: "{INLINE_MATH_PLACEHOLDER}",
  },
  html: { replaceAction: MDAstTypes.Html, placeholder: "{HTML_PLACEHOLDER}" },
  heading: {
    replaceAction: MDAstTypes.Heading,
    placeholder: "{HEADING_PLACEHOLDER}",
  },
  yaml: {
    replaceAction: yamlRegex,
    placeholder: escapeDollarSigns("---\n---"),
  },
  wikiLink: {
    replaceAction: wikiLinkRegex,
    placeholder: "{WIKI_LINK_PLACEHOLDER}",
  },
  obsidianMultiLineComments: {
    replaceAction: obsidianMultilineCommentRegex,
    placeholder: "{OBSIDIAN_COMMENT_PLACEHOLDER}",
  },
  footnoteAtStartOfLine: {
    replaceAction: footnoteDefinitionIndicatorAtStartOfLine,
    placeholder: "{FOOTNOTE_AT_START_OF_LINE_PLACEHOLDER}",
  },
  footnoteAfterATask: {
    replaceAction: /- \[.] (\[\^\w+\]) ?([,.;!:?])/gm,
    placeholder: "{FOOTNOTE_AFTER_A_TASK_PLACEHOLDER}",
  },
  url: { replaceAction: urlRegex, placeholder: "{URL_PLACEHOLDER}" },
  anchorTag: {
    replaceAction: anchorTagRegex,
    placeholder: "{ANCHOR_PLACEHOLDER}",
  },
  templaterCommand: {
    replaceAction: templaterCommandRegex,
    placeholder: "{TEMPLATER_PLACEHOLDER}",
  },
  link: {
    replaceAction: replaceMarkdownLinks,
    placeholder: "{REGULAR_LINK_PLACEHOLDER}",
  },
  tag: { replaceAction: replaceTags, placeholder: "#tag-placeholder" },
  table: { replaceAction: replaceTables, placeholder: "{TABLE_PLACEHOLDER}" },
  customIgnore: {
    replaceAction: replaceCustomIgnore,
    placeholder: "{CUSTOM_IGNORE_PLACEHOLDER}",
  },
} as const;
type placeholderInfo = {
  placeholder: string;
  replacedValue: string;
};
export function ignoreListOfTypes(
  ignoreTypes: IgnoreType[],
  text: string,
  func: (text: string) => string,
): string {
  let placeholders: placeholderInfo[] = [];
  let tempPlaceholders: placeholderInfo[] = [];
  for (const ignoreType of ignoreTypes) {
    if (typeof ignoreType.replaceAction === "string") {
      [tempPlaceholders, text] = replaceMdastType(
        text,
        ignoreType.placeholder,
        ignoreType.replaceAction,
      );
    } else if (ignoreType.replaceAction instanceof RegExp) {
      [tempPlaceholders, text] = replaceRegex(
        text,
        ignoreType.placeholder,
        ignoreType.replaceAction,
      );
    } else if (typeof ignoreType.replaceAction === "function") {
      const ignoreFunc: IgnoreFunction = ignoreType.replaceAction;
      [tempPlaceholders, text] = ignoreFunc(text, ignoreType.placeholder);
    }
    placeholders.push(...tempPlaceholders);
  }
  text = func(text);
  placeholders = placeholders.reverse();
  if (placeholders != null && placeholders.length > 0) {
    placeholders.forEach((replacedInfo: placeholderInfo) => {
      text = text.replace(
        new RegExp(replacedInfo.placeholder, "i"),
        escapeDollarSigns(replacedInfo.replacedValue),
      );
    });
  }
  return text;
}
function replaceMdastType(
  text: string,
  placeholder: string,
  type: MDAstTypes,
): [placeholderInfo[], string] {
  let positions: Position[] = getPositions(type, text);
  const replacedValues: placeholderInfo[] = [];
  if (type === MDAstTypes.List) {
    positions = removeOverlappingPositions(positions);
  }
  for (const position of positions) {
    const valueToReplace = text.substring(
      position.start.offset,
      position.end.offset,
    );
    replacedValues.push({
      placeholder: getNewPlaceHolder(placeholder),
      replacedValue: valueToReplace,
    });
  }
  let i = 0;
  for (const position of positions) {
    text = replaceTextBetweenStartAndEndWithNewValue(
      text,
      position.start.offset,
      position.end.offset,
      replacedValues[i++].placeholder,
    );
  }
  replacedValues.reverse();
  return [replacedValues, text];
}
function replaceRegex(
  text: string,
  placeholder: string,
  regex: RegExp,
): [placeholderInfo[], string] {
  const textMatches: placeholderInfo[] = [];
  if (regex.flags.includes("g")) {
    text = text.replaceAll(regex, (match: string) => {
      const id = getNewPlaceHolder(placeholder);
      textMatches.push({ placeholder: id, replacedValue: match });
      return id;
    });
  } else {
    text = text.replace(regex, (match: string) => {
      const id = getNewPlaceHolder(placeholder);
      textMatches.push({ placeholder: id, replacedValue: match });
      return id;
    });
  }
  return [textMatches, text];
}
function replaceMarkdownLinks(
  text: string,
  regularLinkPlaceholder: string,
): [placeholderInfo[], string] {
  const positions: Position[] = getPositions(MDAstTypes.Link, text);
  const replacedRegularLinks: placeholderInfo[] = [];
  const positionsToReplace: Position[] = [];
  for (const position of positions) {
    if (position == undefined) {
      continue;
    }
    const regularLink = text.substring(
      position.start.offset,
      position.end.offset,
    );
    if (!regularLink.match(genericLinkRegex)) {
      continue;
    }
    positionsToReplace.push(position);
    replacedRegularLinks.push({
      placeholder: getNewPlaceHolder(regularLinkPlaceholder),
      replacedValue: regularLink,
    });
  }
  let i = 0;
  for (const position of positionsToReplace) {
    text = replaceTextBetweenStartAndEndWithNewValue(
      text,
      position.start.offset,
      position.end.offset,
      replacedRegularLinks[i++].placeholder,
    );
  }
  replacedRegularLinks.reverse();
  return [replacedRegularLinks, text];
}
function replaceTags(
  text: string,
  placeholder: string,
): [placeholderInfo[], string] {
  const replacedValues: placeholderInfo[] = [];
  text = text.replace(
    tagWithLeadingWhitespaceRegex,
    (_, whitespace: string, tag: string) => {
      const id = getNewPlaceHolder(placeholder);
      replacedValues.push({ placeholder: id, replacedValue: tag });
      return whitespace + id;
    },
  );
  return [replacedValues, text];
}
function replaceTables(
  text: string,
  tablePlaceholder: string,
): [placeholderInfo[], string] {
  const tablePositions = getAllTablesInText(text);
  const replacedTables: placeholderInfo[] = new Array<placeholderInfo>(
    tablePositions.length,
  );
  let index = 0;
  const length = replacedTables.length;
  for (const tablePosition of tablePositions) {
    replacedTables[length - 1 - index++] = {
      placeholder: getNewPlaceHolder(tablePlaceholder),
      replacedValue: text.substring(
        tablePosition.startIndex,
        tablePosition.endIndex,
      ),
    };
  }
  let i = length - 1;
  for (const tablePosition of tablePositions) {
    text = replaceTextBetweenStartAndEndWithNewValue(
      text,
      tablePosition.startIndex,
      tablePosition.endIndex,
      replacedTables[i--].placeholder,
    );
  }
  return [replacedTables, text];
}
function replaceCustomIgnore(
  text: string,
  customIgnorePlaceholder: string,
): [placeholderInfo[], string] {
  const customIgnorePositions = getAllCustomIgnoreSectionsInText(text);
  const replacedSections: placeholderInfo[] = new Array<placeholderInfo>(
    customIgnorePositions.length,
  );
  let index = 0;
  const length = replacedSections.length;
  for (const customIgnorePosition of customIgnorePositions) {
    replacedSections[length - 1 - index++] = {
      placeholder: getNewPlaceHolder(customIgnorePlaceholder),
      replacedValue: text.substring(
        customIgnorePosition.startIndex,
        customIgnorePosition.endIndex,
      ),
    };
  }
  let i = length - 1;
  for (const customIgnorePosition of customIgnorePositions) {
    text = replaceTextBetweenStartAndEndWithNewValue(
      text,
      customIgnorePosition.startIndex,
      customIgnorePosition.endIndex,
      replacedSections[i--].placeholder,
    );
  }
  return [replacedSections, text];
}
function removeOverlappingPositions(positions: Position[]): Position[] {
  const last = positions.pop();
  if (!last) return [];
  let lastPosition = last;
  const result = [last];
  for (let current = positions.pop(); current; current = positions.pop()) {
    if (
      lastPosition.start.offset >= current.end.offset ||
      current.start.offset >= lastPosition.end.offset
    ) {
      result.unshift(current);
      lastPosition = current;
    }
  }
  return result;
}
function getNewPlaceHolder(placeholder: string): string {
  if (placeholder.includes("---")) {
    return placeholder;
  }
  const uuid =
    Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
  if (placeholder.endsWith("}")) {
    return placeholder.replace("}", uuid + "}");
  }
  return placeholder + uuid;
}
export function initYAML(text: string): string {
  if (text.match(yamlRegex) === null) {
    text = "---\n---\n" + text;
  }
  return text;
}
export function formatYAML(
  text: string,
  func: (text: string) => string,
): string {
  const match = text.match(yamlRegex);
  if (!match) {
    return text;
  }
  const oldYaml = match[0];
  const newYaml = func(oldYaml);
  text = text.replace(oldYaml, escapeDollarSigns(newYaml));
  return text;
}
