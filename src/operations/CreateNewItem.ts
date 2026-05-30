import { Operation } from "./Operation";

import { List, Root, recalculateNumericBullets } from "../root";
import { checkboxRe } from "../utils/checkboxRe";
import { isEmptyLineOrEmptyCheckbox } from "../utils/isEmptyLineOrEmptyCheckbox";

export class CreateNewItem implements Operation {
  private stopPropagation = false;
  private updated = false;

  constructor(
    private root: Root,
    private defaultIndentChars: string,
    private numericBulletsEnabled: boolean,
    private after: boolean = true,
    private documentPrefixBeforeRoot: string = "",
  ) {}

  shouldStopPropagation() {
    return this.stopPropagation;
  }

  shouldUpdate() {
    return this.updated;
  }

  perform() {
    const { root } = this;

    if (!root.hasSingleSelection()) {
      return;
    }

    const selection = root.getSelection();
    if (!selection || selection.anchor.line !== selection.head.line) {
      return;
    }

    const list = root.getListUnderCursor();
    const lines = list.getLinesInfo();

    if (lines.length === 1 && isEmptyLineOrEmptyCheckbox(lines[0].text)) {
      return;
    }

    const cursor = root.getCursor();
    const lineUnderCursor = lines.find((l) => l.from.line === cursor.line);
    const lineIndex = lines.findIndex((l) => l.from.line === cursor.line);
    if (!lineUnderCursor || lineIndex < 0) {
      return;
    }

    if (cursor.ch < lineUnderCursor.from.ch) {
      return;
    }

    const checkboxAtContentStart = new RegExp(`^${checkboxRe}`).exec(
      lines[0].text,
    );
    const cursorOffsetInCurrentLine = selection.from - lineUnderCursor.from.ch;
    const cursorInsideLeadingCheckbox =
      lineIndex === 0 &&
      checkboxAtContentStart !== null &&
      cursorOffsetInCurrentLine < checkboxAtContentStart[0].length;
    const hasCheckboxInContent =
      checkboxAtContentStart !== null && !cursorInsideLeadingCheckbox;
    const hasCheckbox = hasCheckboxInContent || list.getCheckboxLength() > 0;

    let { oldLines, newLines } = lines.reduce(
      (acc, line) => {
        if (cursor.line > line.from.line) {
          acc.oldLines.push(line.text);
        } else if (cursor.line === line.from.line) {
          const left = line.text.slice(0, selection.from - line.from.ch);
          const right = line.text.slice(selection.to - line.from.ch);
          acc.oldLines.push(left);
          acc.newLines.push(right);
        } else if (cursor.line < line.from.line) {
          acc.newLines.push(line.text);
        }

        return acc;
      },
      {
        oldLines: [] as string[],
        newLines: [] as string[],
      },
    );

    const shouldInsertUncheckedSiblingBeforeCurrentItem =
      lineIndex === 0 &&
      checkboxAtContentStart !== null &&
      oldLines[0] === checkboxAtContentStart[0];

    if (shouldInsertUncheckedSiblingBeforeCurrentItem) {
      oldLines = lines.map((line) => line.text);
      newLines = [""];
    }

    const codeBlockBacticks = oldLines.join("\n").split("```").length - 1;
    const codeBlockBacticksBeforeRoot =
      this.documentPrefixBeforeRoot.split("```").length - 1;
    const isInsideCodeblock =
      (codeBlockBacticksBeforeRoot + codeBlockBacticks) % 2 !== 0;

    if (isInsideCodeblock) {
      return;
    }

    this.stopPropagation = true;
    this.updated = true;

    if (lineIndex > 0 && list.isEmpty() && !hasCheckbox) {
      const lineOffset = cursor.ch - lineUnderCursor.from.ch;
      const line = lines[lineIndex];
      if (!line) {
        return;
      }

      const lineText = line.text;
      const left = lineText.slice(0, lineOffset);
      const right = lineText.slice(lineOffset);
      const newLines = list.getLines();

      newLines.splice(lineIndex, 1, left, right);
      list.replaceLines(newLines);

      root.replaceCursor({
        line: cursor.line + 1,
        ch: list.getNotesIndentOrThrow().length,
      });

      return;
    }

    const hasChildren = !list.isEmpty();
    const childIsFolded = list.isFoldRoot();
    const endPos = list.getLastLineContentEnd();
    const endOfLine = cursor.line === endPos.line && cursor.ch === endPos.ch;
    const insertAfter =
      this.after && !shouldInsertUncheckedSiblingBeforeCurrentItem;

    const onChildLevel =
      insertAfter && hasChildren && !childIsFolded && endOfLine;

    const firstChild = list.getChildren()[0] ?? null;
    const indent = onChildLevel
      ? firstChild
        ? firstChild.getFirstLineIndent()
        : list.getFirstLineIndent() + this.defaultIndentChars
      : list.getFirstLineIndent();

    const bullet =
      onChildLevel && firstChild ? firstChild.getBullet() : list.getBullet();

    const spaceAfterBullet =
      onChildLevel && firstChild
        ? firstChild.getSpaceAfterBullet()
        : list.getSpaceAfterBullet();

    const prefix = hasCheckbox ? "[ ] " : "";

    const newList = new List(
      list.getRoot(),
      indent,
      bullet,
      prefix,
      hasCheckbox,
      spaceAfterBullet,
      prefix + newLines.shift()!,
      false,
    );

    if (newLines.length > 0) {
      newList.setNotesIndent(list.getNotesIndentOrThrow());
      for (const line of newLines) {
        newList.addLine(line);
      }
    }

    if (onChildLevel) {
      list.addBeforeAll(newList);
    } else {
      if (insertAfter && (!childIsFolded || !endOfLine)) {
        const children = list.getChildren();
        for (const child of children) {
          list.removeChild(child);
          newList.addAfterAll(child);
        }
      }

      if (insertAfter) {
        list.getParentOrThrow().addAfter(list, newList);
      } else {
        list.getParentOrThrow().addBefore(list, newList);
      }
    }

    list.replaceLines(oldLines);
    recalculateNumericBullets(root, this.numericBulletsEnabled);

    const newListStart = newList.getFirstLineContentStart();
    root.replaceCursor({
      line: newListStart.line,
      ch: newListStart.ch + prefix.length,
    });
  }
}
