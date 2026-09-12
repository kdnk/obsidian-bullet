import { Logger } from "./Logger";
import { Settings } from "./Settings";

import { List, Root } from "../root";
import { checkboxRe } from "../utils/checkboxRe";
import {
  FenceMarker,
  getFenceOpening,
  isFenceClosing,
} from "../utils/fencedCode";

const bulletSignRe = `(?:[-*+]|\\d+\\.)`;
const optionalCheckboxRe = `(?:${checkboxRe})?`;
const defaultTabSize = 4;

const listItemRe = new RegExp(`^[ \t]*${bulletSignRe}(?:[ \t]|$)`);
const stringWithSpacesRe = new RegExp(`^[ \t]+`);
const parseListItemRe = new RegExp(
  `^([ \t]*)(${bulletSignRe})(?:( |\t)(${optionalCheckboxRe})(.*))?$`,
);

export interface ReaderPosition {
  line: number;
  ch: number;
}

export interface ReaderSelection {
  anchor: ReaderPosition;
  head: ReaderPosition;
}

export interface Reader {
  getCursor(): ReaderPosition;
  getLine(n: number): string;
  lastLine(): number;
  listSelections(): ReaderSelection[];
  getAllFoldedLines(): number[];
}

interface ParseListList {
  getFirstLineIndent(): string;
  getLines(): string[];
  setNotesIndent(notesIndent: string): void;
  getNotesIndent(): string | null;
  addLine(text: string, indentOverride?: string | null): void;
  getParent(): ParseListList | null;
  addAfterAll(list: ParseListList): void;
}

export class Parser {
  constructor(
    private logger: Logger,
    private settings: Settings,
  ) {}

  parseRange(editor: Reader, fromLine = 0, toLine = editor.lastLine()): Root[] {
    const lists: Root[] = [];

    for (let i = fromLine; i <= toLine; i++) {
      const line = editor.getLine(i);

      if (i === fromLine || this.isListItem(line)) {
        const list = this.parseWithLimits(editor, i, fromLine, toLine);

        if (list) {
          lists.push(list);
          i = list.getContentEnd().line;
        }
      }
    }

    return lists;
  }

  parse(editor: Reader, cursor = editor.getCursor()): Root | null {
    return this.parseWithLimits(editor, cursor.line, 0, editor.lastLine());
  }

  private parseWithLimits(
    editor: Reader,
    parsingStartLine: number,
    limitFrom: number,
    limitTo: number,
  ): Root | null {
    const d = this.logger.bind("parseList");
    const error = (msg: string): null => {
      d(msg);
      return null;
    };

    const line = editor.getLine(parsingStartLine);

    let listLookingPos: number | null = null;

    if (this.isListItem(line)) {
      listLookingPos = parsingStartLine;
    } else if (this.isLineWithIndent(line)) {
      let listLookingPosSearch = parsingStartLine - 1;
      while (listLookingPosSearch >= 0) {
        const line = editor.getLine(listLookingPosSearch);
        if (this.isListItem(line)) {
          listLookingPos = listLookingPosSearch;
          break;
        } else if (this.isLineWithIndent(line)) {
          listLookingPosSearch--;
        } else {
          break;
        }
      }
    }

    if (listLookingPos === null) {
      listLookingPos = this.findFenceOwnerAt(
        editor,
        parsingStartLine,
        limitFrom,
      );
      if (listLookingPos === null) return null;
    }

    let listStartLine: number | null = null;
    let listStartLineLookup = listLookingPos;
    while (listStartLineLookup >= 0) {
      const line = editor.getLine(listStartLineLookup);
      if (!this.isListItem(line) && !this.isLineWithIndent(line)) {
        break;
      }
      if (this.isListItem(line)) {
        listStartLine = listStartLineLookup;
        if (listStartLineLookup <= limitFrom) {
          break;
        }
      }
      listStartLineLookup--;
    }

    if (listStartLine === null) {
      return null;
    }

    if (
      listStartLine > limitFrom &&
      editor.getLine(listStartLine - 1).length === 0
    ) {
      const fenceOwner = this.findFenceOwnerAt(
        editor,
        parsingStartLine,
        limitFrom,
      );
      if (fenceOwner !== null && fenceOwner < listStartLine) {
        listStartLine = fenceOwner;
        while (listStartLine > limitFrom) {
          const previous = editor.getLine(listStartLine - 1);
          if (!this.isListItem(previous) && !this.isLineWithIndent(previous))
            break;
          listStartLine--;
        }
      }
    }

    let listEndLine = listStartLine;
    let listEndLineLookup = listStartLine;
    let rangeFence: {
      marker: FenceMarker;
      containerIndent: string;
    } | null = null;
    let listEndLineWasAcceptedInsideFence = false;
    while (listEndLineLookup <= editor.lastLine()) {
      const line = editor.getLine(listEndLineLookup);
      if (rangeFence) {
        if (line.length === 0) {
          listEndLine = listEndLineLookup++;
          listEndLineWasAcceptedInsideFence = true;
          continue;
        }
        if (!line.startsWith(rangeFence.containerIndent)) break;
        const content = line.slice(rangeFence.containerIndent.length);
        listEndLine = listEndLineLookup;
        listEndLineWasAcceptedInsideFence = true;
        if (isFenceClosing(content, rangeFence.marker)) rangeFence = null;
        if (listEndLineLookup >= limitTo) break;
        listEndLineLookup++;
        continue;
      }
      if (!this.isListItem(line) && !this.isLineWithIndent(line)) {
        break;
      }
      if (!this.isEmptyLine(line)) {
        listEndLine = listEndLineLookup;
        listEndLineWasAcceptedInsideFence = false;
      }
      const listMatch = parseListItemRe.exec(line);
      if (listMatch) {
        const content = listMatch[5] ?? "";
        const marker = getFenceOpening(content);
        if (marker) {
          const indent = listMatch[1];
          rangeFence = {
            marker,
            containerIndent:
              indent + " ".repeat(line.length - content.length - indent.length),
          };
        }
      } else {
        const indent = line.match(/^[ \t]*/)?.[0] ?? "";
        const marker = getFenceOpening(line.slice(indent.length));
        if (marker) rangeFence = { marker, containerIndent: indent };
      }
      if (listEndLineLookup >= limitTo) {
        listEndLine = limitTo;
        break;
      }
      listEndLineLookup++;
    }

    if (listStartLine > parsingStartLine || listEndLine < parsingStartLine) {
      return null;
    }

    // if the last line contains only spaces and that's incorrect indent, then ignore the last line
    // https://github.com/vslinko/obsidian-outliner/issues/368
    if (listEndLine > listStartLine && !listEndLineWasAcceptedInsideFence) {
      const lastLine = editor.getLine(listEndLine);
      if (lastLine.trim().length === 0) {
        const prevLine = editor.getLine(listEndLine - 1);
        const prevLineIndent = /^(\s*)/.exec(prevLine)![1];
        if (!lastLine.startsWith(prevLineIndent)) {
          listEndLine--;
        }
      }
    }

    const root = new Root(
      { line: listStartLine, ch: 0 },
      { line: listEndLine, ch: editor.getLine(listEndLine).length },
      editor.listSelections().map((r) => ({
        anchor: { line: r.anchor.line, ch: r.anchor.ch },
        head: { line: r.head.line, ch: r.head.ch },
      })),
    );

    const firstListItem = parseListItemRe.exec(editor.getLine(listStartLine));
    const baseIndentWidth = firstListItem
      ? this.getIndentWidth(firstListItem[1])
      : 0;
    const indentWidths = new WeakMap<ParseListList, number>();

    let currentParent: ParseListList = root.getRootList();
    indentWidths.set(currentParent, 0);
    let currentList: ParseListList | null = null;
    let currentIndentWidth = 0;
    let activeFence: { marker: FenceMarker; owner: ParseListList } | null =
      null;

    const foldedLines = editor.getAllFoldedLines();

    for (let l = listStartLine; l <= listEndLine; l++) {
      const line = editor.getLine(l);

      if (activeFence) {
        const owner: ParseListList = activeFence.owner;
        const marker: FenceMarker = activeFence.marker;
        if (line.length === 0) {
          owner.addLine("", "");
          currentList = owner;
          continue;
        }
        const noteIndentRaw = line.match(/^[ \t]*/)?.[0] || "";
        const noteIndentWidth =
          this.getIndentWidth(noteIndentRaw) - baseIndentWidth;
        const listIndentWidth = indentWidths.get(owner);
        if (listIndentWidth === undefined) {
          return error(`Unable to parse list: missing indent width`);
        }
        const expectedNoteIndent = owner.getNotesIndent();
        const expectedNoteIndentWidth = expectedNoteIndent
          ? this.getIndentWidth(expectedNoteIndent) - baseIndentWidth
          : null;
        const hasDeeperNoteIndent =
          expectedNoteIndent !== null &&
          expectedNoteIndentWidth !== null &&
          noteIndentWidth > expectedNoteIndentWidth &&
          noteIndentRaw.startsWith(expectedNoteIndent);

        if (
          expectedNoteIndentWidth !== null &&
          noteIndentWidth !== expectedNoteIndentWidth &&
          !hasDeeperNoteIndent
        ) {
          return error(`Unable to parse fenced code: unexpected indentation`);
        }
        if (!expectedNoteIndent) {
          if (!noteIndentRaw || noteIndentWidth <= listIndentWidth) {
            return error(`Unable to parse fenced code: expected indentation`);
          }
          owner.setNotesIndent(noteIndentRaw);
        }

        const contentStart = hasDeeperNoteIndent
          ? expectedNoteIndent.length
          : noteIndentRaw.length;
        const content = line.slice(contentStart);
        owner.addLine(content);
        currentList = owner;
        if (isFenceClosing(content, marker)) activeFence = null;
        continue;
      }

      const matches = parseListItemRe.exec(line);

      if (matches) {
        const [, indent, bullet, spaceAfterBullet = ""] = matches;
        let [, , , , optionalCheckbox = "", content = ""] = matches;
        const hadCheckbox = optionalCheckbox.length > 0;

        content = optionalCheckbox + content;
        if (this.settings.keepCursorWithinContent !== "bullet-and-checkbox") {
          optionalCheckbox = "";
        }

        const indentWidth = this.getIndentWidth(indent) - baseIndentWidth;

        if (indentWidth < 0) {
          return error(
            `Unable to parse list: negative indent after base shift`,
          );
        }

        if (indentWidth > currentIndentWidth) {
          if (!currentList) {
            return error(`Unable to parse list: expected parent list`);
          }
          currentParent = currentList;
          currentIndentWidth = indentWidth;
        } else if (indentWidth < currentIndentWidth) {
          while (
            indentWidths.get(currentParent)! >= indentWidth &&
            currentParent.getParent()
          ) {
            const parent = currentParent.getParent();
            if (!parent) {
              break;
            }
            currentParent = parent;
          }
          currentIndentWidth = indentWidth;
        }

        const foldRoot = foldedLines.indexOf(l) !== -1;

        currentList = new List(
          root,
          indent,
          bullet,
          optionalCheckbox,
          hadCheckbox,
          spaceAfterBullet,
          content,
          foldRoot,
        );
        currentParent.addAfterAll(currentList);
        indentWidths.set(currentList, indentWidth);
        const opening = getFenceOpening(currentList.getLines()[0]);
        if (opening) {
          const contentStart =
            currentList.getFirstLineIndent().length +
            bullet.length +
            spaceAfterBullet.length +
            optionalCheckbox.length;
          currentList.setNotesIndent(
            currentList.getFirstLineIndent() +
              " ".repeat(
                contentStart - currentList.getFirstLineIndent().length,
              ),
          );
          activeFence = { marker: opening, owner: currentList };
        }
      } else if (this.isLineWithIndent(line)) {
        if (!currentList) {
          return error(
            `Unable to parse list: expected list item, got empty line`,
          );
        }

        const noteIndentRaw = line.match(/^[ \t]*/)?.[0] || "";
        const noteIndentWidth =
          this.getIndentWidth(noteIndentRaw) - baseIndentWidth;
        const listIndentWidth = indentWidths.get(currentList);
        if (listIndentWidth === undefined) {
          return error(`Unable to parse list: missing indent width`);
        }

        const expectedNoteIndent = currentList.getNotesIndent();
        const expectedNoteIndentWidth = expectedNoteIndent
          ? this.getIndentWidth(expectedNoteIndent) - baseIndentWidth
          : null;
        const hasDeeperNoteIndent =
          expectedNoteIndent !== null &&
          expectedNoteIndentWidth !== null &&
          noteIndentWidth > expectedNoteIndentWidth &&
          noteIndentRaw.startsWith(expectedNoteIndent);

        if (
          expectedNoteIndentWidth !== null &&
          noteIndentWidth !== expectedNoteIndentWidth &&
          !hasDeeperNoteIndent
        ) {
          const expected = expectedNoteIndent!
            .replace(/ /g, "S")
            .replace(/\t/g, "T");
          const got = noteIndentRaw.replace(/ /g, "S").replace(/\t/g, "T");

          return error(
            `Unable to parse list: expected indent "${expected}", got "${got}"`,
          );
        }

        if (!currentList.getNotesIndent()) {
          if (!noteIndentRaw || noteIndentWidth <= listIndentWidth) {
            if (/^\s+$/.test(line)) {
              continue;
            }

            return error(
              `Unable to parse list: expected some indent, got no indent`,
            );
          }

          currentList.setNotesIndent(noteIndentRaw);
        }

        // Keep indentation inside note content, such as a fenced code block.
        const contentStart = hasDeeperNoteIndent
          ? expectedNoteIndent.length
          : noteIndentRaw.length;
        const content = line.slice(contentStart);
        currentList.addLine(content);
        const opening = getFenceOpening(content);
        if (opening) activeFence = { marker: opening, owner: currentList };
      } else {
        return error(
          `Unable to parse list: expected list item or note, got "${line}"`,
        );
      }
    }

    return root;
  }

  private isEmptyLine(line: string) {
    return line.length === 0;
  }

  private isLineWithIndent(line: string) {
    return stringWithSpacesRe.test(line);
  }

  isListItem(line: string) {
    return listItemRe.test(line);
  }

  private getIndentWidth(indent: string) {
    let width = 0;

    for (const char of indent) {
      if (char === "\t") {
        width += defaultTabSize;
      } else {
        width++;
      }
    }

    return width;
  }

  private findFenceOwnerAt(
    editor: Reader,
    targetLine: number,
    fromLine: number,
  ): number | null {
    let scanStart = fromLine;
    for (
      let lineNumber = targetLine - 1;
      lineNumber >= fromLine;
      lineNumber--
    ) {
      const line = editor.getLine(lineNumber);
      if (
        line.length > 0 &&
        !this.isListItem(line) &&
        !this.isLineWithIndent(line)
      ) {
        scanStart = lineNumber + 1;
        break;
      }
    }

    let activeFence: {
      marker: FenceMarker;
      containerIndent: string;
      ownerLine: number;
    } | null = null;
    let lastListOwner: number | null = null;

    for (let lineNumber = scanStart; lineNumber < targetLine; lineNumber++) {
      const line = editor.getLine(lineNumber);

      if (activeFence) {
        if (line.length === 0) continue;
        if (line.startsWith(activeFence.containerIndent)) {
          const content = line.slice(activeFence.containerIndent.length);
          if (isFenceClosing(content, activeFence.marker)) activeFence = null;
          continue;
        }
        activeFence = null;
      }

      if (line.length === 0) {
        lastListOwner = null;
        continue;
      }

      const listMatch = parseListItemRe.exec(line);
      if (listMatch) {
        const content = listMatch[5] ?? "";
        const marker = getFenceOpening(content);
        lastListOwner = lineNumber;
        if (marker) {
          const indent = listMatch[1];
          activeFence = {
            marker,
            containerIndent:
              indent + " ".repeat(line.length - content.length - indent.length),
            ownerLine: lineNumber,
          };
        }
      } else if (this.isLineWithIndent(line)) {
        const indent = line.match(/^[ \t]*/)?.[0] ?? "";
        const marker = getFenceOpening(line.slice(indent.length));
        if (marker && lastListOwner !== null) {
          activeFence = {
            marker,
            containerIndent: indent,
            ownerLine: lastListOwner,
          };
        }
      } else {
        lastListOwner = null;
      }
    }

    if (!activeFence) return null;
    const target = editor.getLine(targetLine);
    return target.length === 0 || target.startsWith(activeFence.containerIndent)
      ? activeFence.ownerLine
      : null;
  }
}
