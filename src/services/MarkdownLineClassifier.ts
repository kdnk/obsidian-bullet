import {
  EditorState,
  Extension,
  StateField,
  Text,
  Transaction,
} from "@codemirror/state";

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

const listItemRe = /^([ \t]*)([-*+]|\d+\.)([ \t]+)(.*)$/;
const atxHeadingRe = /^ {0,3}#{1,6}(?:[ \t]+|$)/;
const quoteRe = /^ {0,3}>/;
const horizontalRuleRe = /^ {0,3}(?:-[ \t]*){3,}$/;
const fenceRe = /^ {0,3}(`{3,})(?:[^`]*)$/;
const closingFenceRe = /^ {0,3}(`{3,})[ \t]*$/;
const structurePrefixRe = /^(?:#{1,6}|`{1,2}|-{1,2})$/;
const indentRe = /^[ \t]+/;

interface ListItemMatch {
  indent: string;
  prefix: string;
  content: string;
}

interface StructuralBlockRange {
  from: number;
  to: number;
}

class StructuralBlockIndex {
  constructor(private ranges: readonly StructuralBlockRange[]) {}

  has(lineNumber: number): boolean {
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
        return true;
      }
    }

    return false;
  }
}

export class MarkdownLineClassifier {
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

  classify(state: EditorState, lineNumber: number): MarkdownLineKind {
    return this.classifyLine(
      state.doc,
      lineNumber,
      this.getStructuralBlockIndex(state, lineNumber),
    );
  }

  inspect(state: EditorState, lineNumber: number): MarkdownLineInspection {
    const doc = state.doc;
    const line = doc.line(lineNumber);
    const structuralBlockIndex = this.getStructuralBlockIndex(
      state,
      lineNumber,
    );
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

  private getStructuralBlockIndex(
    state: EditorState,
    lineNumber: number,
  ): StructuralBlockIndex {
    return (
      state.field(this.structuralBlockIndex, false) ??
      buildStructuralBlockIndex(
        state.doc,
        Math.min(state.doc.lines, lineNumber + 1),
      )
    );
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

    const followingLineNumber = lineNumber + 1;
    const followingText = doc.line(followingLineNumber).text;
    const followingKind = classifyLexicalLine(
      followingText,
      structuralBlockIndex.has(followingLineNumber),
    );
    const currentIndentWidth = getIndentWidth(indent);

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
  let fenceStart: number | null = null;
  let fenceLength: number | null = null;

  for (let lineNumber = 1; lineNumber <= lastLineNumber; lineNumber++) {
    const text = doc.line(lineNumber).text;

    if (frontmatterStart !== null) {
      if (text === "---") {
        ranges.push({ from: frontmatterStart, to: lineNumber });
        frontmatterStart = null;
      }
      continue;
    }

    if (lineNumber === 1 && text === "---") {
      frontmatterStart = lineNumber;
      continue;
    }

    if (fenceLength !== null) {
      const closingFence = closingFenceRe.exec(text);
      if (closingFence && closingFence[1].length >= fenceLength) {
        ranges.push({ from: fenceStart!, to: lineNumber });
        fenceStart = null;
        fenceLength = null;
      }
      continue;
    }

    const openingFence = fenceRe.exec(text);
    if (openingFence) {
      fenceStart = lineNumber;
      fenceLength = openingFence[1].length;
    }
  }

  if (frontmatterStart !== null) {
    ranges.push({ from: frontmatterStart, to: lastLineNumber });
  }
  if (fenceStart !== null) {
    ranges.push({ from: fenceStart, to: lastLineNumber });
  }

  return new StructuralBlockIndex(ranges);
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
        !isStructuralBoundaryCandidate(afterStartLine.text);
    },
    true,
  );

  return canReuse;
}

function isStructuralBoundaryCandidate(text: string): boolean {
  return text === "---" || fenceRe.test(text);
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

  const [, indent, marker, spacing, content] = match;
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
