import { Text } from "@codemirror/state";

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

export class MarkdownLineClassifier {
  inspect(doc: Text, lineNumber: number): MarkdownLineInspection {
    const line = doc.line(lineNumber);
    const structuralBlockLines = this.findStructuralBlockLines(
      doc,
      Math.min(doc.lines, lineNumber + 1),
    );
    const kind = this.classifyLine(doc, lineNumber, structuralBlockLines);
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
              structuralBlockLines,
            ),
            isPlainEmpty: listMatch.content.length === 0,
            hasOwnedFollowingLine: this.hasOwnedFollowingLine(
              doc,
              lineNumber,
              listMatch.indent,
              structuralBlockLines,
            ),
          }
        : null,
    };
  }

  private classifyLine(
    doc: Text,
    lineNumber: number,
    structuralBlockLines: ReadonlySet<number>,
  ): MarkdownLineKind {
    const text = doc.line(lineNumber).text;
    const lexicalKind = classifyLexicalLine(
      text,
      structuralBlockLines.has(lineNumber),
    );

    if (
      lexicalKind === "body" &&
      this.hasListOwner(doc, lineNumber, text, structuralBlockLines)
    ) {
      return "list-continuation";
    }

    return lexicalKind;
  }

  private findStructuralBlockLines(
    doc: Text,
    lastLineNumber: number,
  ): ReadonlySet<number> {
    const structuralBlockLines = new Set<number>();
    let inFrontmatter = false;
    let fenceLength: number | null = null;

    for (let lineNumber = 1; lineNumber <= lastLineNumber; lineNumber++) {
      const text = doc.line(lineNumber).text;

      if (inFrontmatter) {
        structuralBlockLines.add(lineNumber);
        if (text === "---") {
          inFrontmatter = false;
        }
        continue;
      }

      if (lineNumber === 1 && text === "---") {
        structuralBlockLines.add(lineNumber);
        inFrontmatter = true;
        continue;
      }

      if (fenceLength !== null) {
        structuralBlockLines.add(lineNumber);
        const closingFence = closingFenceRe.exec(text);
        if (closingFence && closingFence[1].length >= fenceLength) {
          fenceLength = null;
        }
        continue;
      }

      const openingFence = fenceRe.exec(text);
      if (openingFence) {
        structuralBlockLines.add(lineNumber);
        fenceLength = openingFence[1].length;
      }
    }

    return structuralBlockLines;
  }

  private hasListOwner(
    doc: Text,
    lineNumber: number,
    text: string,
    structuralBlockLines: ReadonlySet<number>,
  ): boolean {
    const indent = indentRe.exec(text)?.[0];
    if (!indent) {
      return false;
    }

    return this.findShallowerListItem(
      doc,
      lineNumber,
      indent,
      structuralBlockLines,
    );
  }

  private hasLexicalParent(
    doc: Text,
    lineNumber: number,
    indent: string,
    structuralBlockLines: ReadonlySet<number>,
  ): boolean {
    return this.findShallowerListItem(
      doc,
      lineNumber,
      indent,
      structuralBlockLines,
    );
  }

  private findShallowerListItem(
    doc: Text,
    lineNumber: number,
    indent: string,
    structuralBlockLines: ReadonlySet<number>,
  ): boolean {
    const indentWidth = getIndentWidth(indent);

    for (
      let previousLineNumber = lineNumber - 1;
      previousLineNumber >= 1;
      previousLineNumber--
    ) {
      const previousText = doc.line(previousLineNumber).text;
      const previousKind = classifyLexicalLine(
        previousText,
        structuralBlockLines.has(previousLineNumber),
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
    structuralBlockLines: ReadonlySet<number>,
  ): boolean {
    if (lineNumber >= doc.lines) {
      return false;
    }

    const followingLineNumber = lineNumber + 1;
    const followingText = doc.line(followingLineNumber).text;
    const followingKind = classifyLexicalLine(
      followingText,
      structuralBlockLines.has(followingLineNumber),
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
