import {
  EditorState,
  Extension,
  StateField,
  Text,
  Transaction,
} from "@codemirror/state";

import {
  FenceMarker,
  getFenceContent,
  getFenceOpening,
  isFenceClosing,
} from "../utils/fencedCode";

export type MarkdownLineKind =
  | "blank"
  | "list-item"
  | "list-continuation"
  | "structure"
  | "structure-prefix"
  | "body";

export interface ListLineInspection {
  prefix: string;
  // Physical line startから数えたrelative offset。
  contentStart: number;
  isRoot: boolean;
  isPlainEmpty: boolean;
  hasOwnedFollowingLine: boolean;
}

export interface MarkdownLineInspection {
  kind: MarkdownLineKind;
  from: number;
  to: number;
  text: string;
  listItem: ListLineInspection | null;
}

const listItemRe = /^([ \t]*)([-*+]|\d+\.)(?:([ \t]+)(.*))?$/;
const atxHeadingRe = /^ {0,3}#{1,6}(?:[ \t]+|$)/;
const quoteRe = /^ {0,3}>/;
const horizontalRuleRe =
  /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const structurePrefixRe = /^(?:#{1,6}|`{1,2}|-{1,2})$/;
const indentRe = /^[ \t]+/;

interface ListItemMatch {
  indent: string;
  prefix: string;
  content: string;
}

export interface CodeFenceContext {
  openingLineNumber: number;
  containerIndent: string;
}

interface StructuralBlockRange {
  from: number;
  to: number;
  structureFrom: number;
  fence: CodeFenceContext | null;
  ownerLineNumber: number | null;
}

class StructuralBlockIndex {
  constructor(private ranges: readonly StructuralBlockRange[]) {}

  has(lineNumber: number): boolean {
    const range = this.find(lineNumber);
    return range !== null && lineNumber >= range.structureFrom;
  }

  getCodeFence(lineNumber: number): CodeFenceContext | null {
    return this.find(lineNumber)?.fence ?? null;
  }

  getListOwner(lineNumber: number): number | null {
    return this.find(lineNumber)?.ownerLineNumber ?? null;
  }

  private find(lineNumber: number): StructuralBlockRange | null {
    let low = 0;
    let high = this.ranges.length - 1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const range = this.ranges[middle];
      if (lineNumber < range.from) {
        high = middle - 1;
      } else if (lineNumber > range.to) {
        low = middle + 1;
      } else {
        return range;
      }
    }

    return null;
  }
}

export class MarkdownLineClassifier {
  private codeFenceIndexes = new WeakMap<Text, StructuralBlockIndex>();
  private structuralBlockIndex = StateField.define<StructuralBlockIndex>({
    create: (state) => buildStructuralBlockIndex(state.doc, state.doc.lines),
    update: (index, transaction) =>
      canReuseStructuralBlockIndex(transaction)
        ? index
        : buildStructuralBlockIndex(
            transaction.newDoc,
            transaction.newDoc.lines,
          ),
  });

  readonly extension: Extension = this.structuralBlockIndex;

  getCodeFence(
    state: EditorState,
    lineNumber: number,
  ): CodeFenceContext | null {
    return this.getStructuralBlockIndex(state).getCodeFence(lineNumber);
  }

  classify(state: EditorState, lineNumber: number): MarkdownLineKind {
    return this.classifyLine(
      state.doc,
      lineNumber,
      this.getStructuralBlockIndex(state),
    );
  }

  inspect(state: EditorState, lineNumber: number): MarkdownLineInspection {
    const doc = state.doc;
    const line = doc.line(lineNumber);
    const structuralBlockIndex = this.getStructuralBlockIndex(state);
    const kind = this.classifyLine(doc, lineNumber, structuralBlockIndex);
    const listMatch = kind === "list-item" ? matchListItem(line.text) : null;

    return {
      kind,
      from: line.from,
      to: line.to,
      text: line.text,
      listItem: listMatch
        ? {
            prefix: listMatch.prefix,
            contentStart: listMatch.prefix.length,
            isRoot: !this.hasLexicalParent(
              doc,
              lineNumber,
              listMatch.indent,
              structuralBlockIndex,
            ),
            isPlainEmpty: listMatch.content.length === 0,
            hasOwnedFollowingLine: this.hasOwnedFollowingLine(
              doc,
              lineNumber,
              listMatch.indent,
              structuralBlockIndex,
            ),
          }
        : null,
    };
  }

  private getStructuralBlockIndex(state: EditorState): StructuralBlockIndex {
    const installed = state.field(this.structuralBlockIndex, false);
    if (installed) return installed;
    let index = this.codeFenceIndexes.get(state.doc);
    if (!index) {
      index = buildStructuralBlockIndex(state.doc, state.doc.lines);
      this.codeFenceIndexes.set(state.doc, index);
    }
    return index;
  }

  private classifyLine(
    doc: Text,
    lineNumber: number,
    structuralBlockIndex: StructuralBlockIndex,
  ): MarkdownLineKind {
    const text = doc.line(lineNumber).text;
    const lexicalKind = classifyLexicalLine(
      text,
      structuralBlockIndex.has(lineNumber),
    );

    if (
      lexicalKind === "body" &&
      this.hasListOwner(doc, lineNumber, text, structuralBlockIndex)
    ) {
      return "list-continuation";
    }

    return lexicalKind;
  }

  private hasListOwner(
    doc: Text,
    lineNumber: number,
    text: string,
    structuralBlockIndex: StructuralBlockIndex,
  ): boolean {
    const indent = indentRe.exec(text)?.[0];
    if (!indent) {
      return false;
    }

    return this.findShallowerListItem(
      doc,
      lineNumber,
      indent,
      structuralBlockIndex,
    );
  }

  private hasLexicalParent(
    doc: Text,
    lineNumber: number,
    indent: string,
    structuralBlockIndex: StructuralBlockIndex,
  ): boolean {
    return this.findShallowerListItem(
      doc,
      lineNumber,
      indent,
      structuralBlockIndex,
    );
  }

  private findShallowerListItem(
    doc: Text,
    lineNumber: number,
    indent: string,
    structuralBlockIndex: StructuralBlockIndex,
  ): boolean {
    const indentWidth = getIndentWidth(indent);
    if (indentWidth === 0) {
      return false;
    }

    for (
      let previousLineNumber = lineNumber - 1;
      previousLineNumber >= 1;
      previousLineNumber--
    ) {
      const owner = structuralBlockIndex.getListOwner(previousLineNumber);
      if (owner !== null) {
        previousLineNumber = owner;
      }
      const previousText = doc.line(previousLineNumber).text;
      const previousKind = classifyLexicalLine(
        previousText,
        structuralBlockIndex.has(previousLineNumber),
      );

      if (
        previousKind === "blank" ||
        previousKind === "structure" ||
        previousKind === "structure-prefix"
      ) {
        return false;
      }

      const previousListItem =
        previousKind === "list-item" ? matchListItem(previousText) : null;
      if (
        previousListItem &&
        getIndentWidth(previousListItem.indent) < indentWidth
      ) {
        return true;
      }

      if (previousKind === "body" && !indentRe.test(previousText)) {
        return false;
      }
    }

    return false;
  }

  private hasOwnedFollowingLine(
    doc: Text,
    lineNumber: number,
    indent: string,
    structuralBlockIndex: StructuralBlockIndex,
  ): boolean {
    if (lineNumber >= doc.lines) {
      return false;
    }

    let followingLineNumber = lineNumber + 1;
    while (
      followingLineNumber < doc.lines &&
      doc.line(followingLineNumber).text.trim().length === 0
    ) {
      followingLineNumber++;
    }
    const currentIndentWidth = getIndentWidth(indent);
    if (structuralBlockIndex.getListOwner(followingLineNumber) === lineNumber) {
      return true;
    }
    if (followingLineNumber !== lineNumber + 1) return false;
    const followingText = doc.line(followingLineNumber).text;
    const followingKind = classifyLexicalLine(
      followingText,
      structuralBlockIndex.has(followingLineNumber),
    );

    if (followingKind === "list-item") {
      const followingListItem = matchListItem(followingText);
      return (
        followingListItem !== null &&
        getIndentWidth(followingListItem.indent) > currentIndentWidth
      );
    }

    if (followingKind !== "body") {
      return false;
    }

    const followingIndent = indentRe.exec(followingText)?.[0];
    return (
      followingIndent !== undefined &&
      getIndentWidth(followingIndent) > currentIndentWidth
    );
  }
}

function buildStructuralBlockIndex(
  doc: Text,
  lastLineNumber: number,
): StructuralBlockIndex {
  const ranges: StructuralBlockRange[] = [];
  let frontmatterStart: number | null = null;
  let fence: {
    from: number;
    openingLineNumber: number;
    marker: FenceMarker;
    containerIndent: string;
    ownerLineNumber: number | null;
  } | null = null;
  const listContainers: {
    indent: string;
    width: number;
    ownerLineNumber: number;
  }[] = [];

  for (let lineNumber = 1; lineNumber <= lastLineNumber; lineNumber++) {
    const text = doc.line(lineNumber).text;

    if (frontmatterStart !== null) {
      if (text === "---") {
        ranges.push({
          from: frontmatterStart,
          to: lineNumber,
          structureFrom: frontmatterStart,
          fence: null,
          ownerLineNumber: null,
        });
        frontmatterStart = null;
      }
      continue;
    }

    if (lineNumber === 1 && text === "---") {
      frontmatterStart = lineNumber;
      continue;
    }

    if (fence !== null) {
      // Physical blank lines remain code even when their container indent is
      // absent. A nonblank dedent ends a list's fence before this line.
      if (text.trim().length === 0) continue;
      const content = getFenceContent(text, fence.containerIndent);
      if (content) {
        if (isFenceClosing(content.text, fence.marker)) {
          ranges.push({
            from: fence.openingLineNumber,
            to: lineNumber,
            structureFrom: fence.from,
            ownerLineNumber: fence.ownerLineNumber,
            fence: {
              openingLineNumber: fence.openingLineNumber,
              containerIndent: fence.containerIndent,
            },
          });
          fence = null;
        }
        continue;
      }
      if (fence.openingLineNumber < lineNumber) {
        ranges.push({
          from: fence.openingLineNumber,
          to: lineNumber - 1,
          structureFrom: fence.from,
          ownerLineNumber: fence.ownerLineNumber,
          fence: {
            openingLineNumber: fence.openingLineNumber,
            containerIndent: fence.containerIndent,
          },
        });
      }
      fence = null;
    }

    // A blank can separate a list marker from its fenced continuation without
    // ending that list's container. The blank itself remains ordinary Markdown.
    if (text.trim().length === 0) continue;

    const listItem =
      classifyLexicalLine(text, false) === "list-item"
        ? matchListItem(text)
        : null;
    const indent = listItem?.indent ?? indentRe.exec(text)?.[0] ?? "";
    const indentWidth = getIndentWidth(indent);
    while (
      listContainers.length > 0 &&
      listContainers[listContainers.length - 1].width > indentWidth
    ) {
      listContainers.pop();
    }

    if (listItem) {
      const width = getIndentWidth(listItem.prefix);
      const containerIndent = indent + " ".repeat(width - indentWidth);
      listContainers.push({
        indent: containerIndent,
        width,
        ownerLineNumber: lineNumber,
      });
      const tableEnd = getTableEnd(
        doc,
        lineNumber,
        listItem.content,
        containerIndent,
      );
      if (tableEnd !== null) {
        ranges.push({
          from: lineNumber,
          to: tableEnd,
          structureFrom: lineNumber + 1,
          fence: null,
          ownerLineNumber: lineNumber,
        });
        lineNumber = tableEnd;
        continue;
      }
      const marker = getFenceOpening(listItem.content);
      if (marker) {
        fence = {
          // Keep the opening list marker available to list editing commands.
          from: lineNumber + 1,
          openingLineNumber: lineNumber,
          marker,
          containerIndent,
          ownerLineNumber: lineNumber,
        };
      }
      continue;
    }

    const container = listContainers[listContainers.length - 1];
    const content = container ? getFenceContent(text, container.indent) : null;
    const continuationFence = content ? getFenceOpening(content.text) : null;
    const marker = continuationFence ?? getFenceOpening(text);
    if (marker) {
      fence = {
        from: lineNumber,
        openingLineNumber: lineNumber,
        marker,
        containerIndent: continuationFence ? container.indent : "",
        ownerLineNumber: continuationFence ? container.ownerLineNumber : null,
      };
    } else {
      const tableEnd = getTableEnd(
        doc,
        lineNumber,
        content?.text ?? text,
        container?.indent ?? "",
      );
      if (tableEnd !== null) {
        ranges.push({
          from: lineNumber,
          to: tableEnd,
          structureFrom: lineNumber,
          fence: null,
          ownerLineNumber: container?.ownerLineNumber ?? null,
        });
        lineNumber = tableEnd;
      } else if (classifyLexicalLine(text, false) !== "body") {
        listContainers.length = 0;
      }
    }
  }

  if (frontmatterStart !== null) {
    ranges.push({
      from: frontmatterStart,
      to: lastLineNumber,
      structureFrom: frontmatterStart,
      fence: null,
      ownerLineNumber: null,
    });
  }
  if (fence !== null) {
    ranges.push({
      from: fence.openingLineNumber,
      to: lastLineNumber,
      structureFrom: fence.from,
      ownerLineNumber: fence.ownerLineNumber,
      fence: {
        openingLineNumber: fence.openingLineNumber,
        containerIndent: fence.containerIndent,
      },
    });
  }

  return new StructuralBlockIndex(ranges);
}

function getTableCells(text: string): string[] | null {
  if (getIndentWidth(indentRe.exec(text)?.[0] ?? "") > 3) return null;
  const row = text.trim();
  const cells: string[] = [];
  let start = 0;
  for (let index = 0; index < row.length; index++) {
    if (row[index] === "\\") {
      index++;
    } else if (row[index] === "|") {
      cells.push(row.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (cells.length === 0) return null;
  cells.push(row.slice(start).trim());
  if (row.startsWith("|")) cells.shift();
  if (start === row.length) cells.pop();
  return cells.length > 0 ? cells : null;
}

function isTableDelimiter(cells: readonly string[]): boolean {
  return cells.every((cell) => /^:?-+:?$/.test(cell));
}

function getTableEnd(
  doc: Text,
  headerLineNumber: number,
  headerText: string,
  containerIndent: string,
): number | null {
  if (
    headerLineNumber >= doc.lines ||
    classifyLexicalLine(headerText, false) !== "body"
  )
    return null;
  const header = getTableCells(headerText);
  if (!header) return null;
  const delimiterText = getFenceContent(
    doc.line(headerLineNumber + 1).text,
    containerIndent,
  )?.text;
  const delimiter =
    delimiterText === undefined ? null : getTableCells(delimiterText);
  if (
    !delimiter ||
    delimiter.length !== header.length ||
    !isTableDelimiter(delimiter)
  )
    return null;
  let end = headerLineNumber + 1;
  while (end < doc.lines) {
    const row = getFenceContent(doc.line(end + 1).text, containerIndent)?.text;
    if (
      row === undefined ||
      classifyLexicalLine(row, false) !== "body" ||
      getFenceOpening(row) ||
      !getTableCells(row)
    )
      break;
    end++;
  }
  return end;
}

function canReuseStructuralBlockIndex(transaction: Transaction): boolean {
  if (!transaction.docChanged) {
    return true;
  }

  let canReuse = true;
  transaction.changes.iterChanges(
    (fromBefore, toBefore, fromAfter, toAfter, inserted) => {
      if (!canReuse) {
        return;
      }

      const beforeStartLine = transaction.startState.doc.lineAt(fromBefore);
      const beforeEndLine = transaction.startState.doc.lineAt(toBefore);
      const afterStartLine = transaction.newDoc.lineAt(fromAfter);
      const afterEndLine = transaction.newDoc.lineAt(toAfter);
      canReuse =
        inserted.lines === 1 &&
        beforeStartLine.number === beforeEndLine.number &&
        afterStartLine.number === afterEndLine.number &&
        !isStructuralBoundaryCandidate(beforeStartLine.text) &&
        !isStructuralBoundaryCandidate(afterStartLine.text) &&
        hasSameContainerContext(beforeStartLine.text, afterStartLine.text);
    },
    true,
  );

  return canReuse;
}

function isStructuralBoundaryCandidate(text: string): boolean {
  return (
    text === "---" ||
    getFenceOpening(text.trimStart()) !== null ||
    getFenceOpening(matchListItem(text)?.content ?? "") !== null
  );
}

function hasSameContainerContext(before: string, after: string): boolean {
  const beforeContent = (matchListItem(before)?.content ?? before).trimStart();
  const afterContent = (matchListItem(after)?.content ?? after).trimStart();
  const beforeCells = getTableCells(beforeContent);
  const afterCells = getTableCells(afterContent);
  return (
    classifyLexicalLine(beforeContent, false) ===
      classifyLexicalLine(afterContent, false) &&
    beforeCells?.length === afterCells?.length &&
    (beforeCells === null || isTableDelimiter(beforeCells)) ===
      (afterCells === null || isTableDelimiter(afterCells)) &&
    indentRe.exec(before)?.[0] === indentRe.exec(after)?.[0] &&
    matchListItem(before)?.prefix === matchListItem(after)?.prefix &&
    classifyLexicalLine(before, false) === classifyLexicalLine(after, false)
  );
}

function classifyLexicalLine(
  text: string,
  isStructuralBlockLine: boolean,
): Exclude<MarkdownLineKind, "list-continuation"> {
  if (isStructuralBlockLine) {
    return "structure";
  }
  if (text.trim().length === 0) {
    return "blank";
  }
  if (
    horizontalRuleRe.test(text) ||
    atxHeadingRe.test(text) ||
    quoteRe.test(text)
  ) {
    return "structure";
  }
  if (listItemRe.test(text)) {
    return "list-item";
  }
  if (structurePrefixRe.test(text)) {
    return "structure-prefix";
  }

  return "body";
}

function matchListItem(text: string): ListItemMatch | null {
  const match = listItemRe.exec(text);
  if (!match) {
    return null;
  }

  const [, indent, marker, spacing = "", content = ""] = match;
  return {
    indent,
    prefix: `${indent}${marker}${spacing}`,
    content,
  };
}

function getIndentWidth(indent: string): number {
  let width = 0;
  for (const character of indent) {
    width += character === "\t" ? 4 - (width % 4) : 1;
  }
  return width;
}
