import {
  NO_OP_OUTCOME,
  Operation,
  STOP_ONLY_OUTCOME,
  UPDATED_OUTCOME,
} from "./Operation";

import { List, Root, recalculateNumericBullets } from "../root";
import { checkboxRe } from "../utils/checkboxRe";
import {
  endsWithClosedFence,
  getFenceOpening,
  isFenceClosing,
} from "../utils/fencedCode";
import { isEmptyLineOrEmptyCheckbox } from "../utils/isEmptyLineOrEmptyCheckbox";

type ItemInsertionIntent = "split" | "open-before" | "open-after";

export class CreateNewItem implements Operation {
  constructor(
    private root: Root,
    private defaultIndentChars: string,
    private numericBulletsEnabled: boolean,
    private intent: ItemInsertionIntent = "split",
    private documentPrefixBeforeRoot: string = "",
    private editingRoot?: List,
  ) {}

  perform() {
    const { root } = this;

    if (!root.hasSingleSelection()) {
      return NO_OP_OUTCOME;
    }

    const selection = root.getSelection();
    if (!selection || selection.anchor.line !== selection.head.line) {
      return NO_OP_OUTCOME;
    }

    const list = root.getListUnderCursor();
    const asChild = list === this.editingRoot;
    const lines = list.getLinesInfo();
    const opensItem = this.intent !== "split";
    const preservesEmptyItem =
      !asChild &&
      opensItem &&
      lines.length === 1 &&
      isEmptyLineOrEmptyCheckbox(lines[0].text);

    if (
      !asChild &&
      !opensItem &&
      lines.length === 1 &&
      isEmptyLineOrEmptyCheckbox(lines[0].text)
    ) {
      return NO_OP_OUTCOME;
    }

    const cursor = { line: selection.head.line, ch: selection.from };
    const lineUnderCursor = lines.find((l) => l.from.line === cursor.line);
    const lineIndex = lines.findIndex((l) => l.from.line === cursor.line);
    if (!lineUnderCursor || lineIndex < 0) {
      return NO_OP_OUTCOME;
    }

    if (selection.from < lineUnderCursor.from.ch) {
      return NO_OP_OUTCOME;
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
      this.intent === "split" &&
      selection.from === selection.to &&
      lineIndex === 0 &&
      checkboxAtContentStart !== null &&
      oldLines[0] === checkboxAtContentStart[0];

    if (shouldInsertUncheckedSiblingBeforeCurrentItem) {
      oldLines = lines.map((line) => line.text);
      newLines = [""];
    }

    const fenceLines = list.getLinesForFenceParsing(oldLines);
    let opening: ReturnType<typeof getFenceOpening> = null;
    for (const line of [
      ...this.documentPrefixBeforeRoot.split("\n"),
      ...fenceLines,
    ]) {
      if (opening) {
        if (isFenceClosing(line, opening)) opening = null;
      } else {
        opening = getFenceOpening(line);
      }
    }
    const isInsideCodeblock = opening !== null;

    if (isInsideCodeblock) {
      return NO_OP_OUTCOME;
    }

    const cursorAtLineEnd =
      cursor.ch - lineUnderCursor.from.ch === lineUnderCursor.text.length;
    const createSiblingAfterFence =
      lineIndex === lines.length - 1 &&
      cursorAtLineEnd &&
      endsWithClosedFence(fenceLines);

    if (
      !asChild &&
      lineIndex > 0 &&
      list.isEmpty() &&
      !hasCheckbox &&
      !createSiblingAfterFence
    ) {
      const line = lines[lineIndex];
      if (!line) {
        return STOP_ONLY_OUTCOME;
      }

      const lineText = line.text;
      const left = lineText.slice(0, selection.from - line.from.ch);
      const right = lineText.slice(selection.to - line.from.ch);
      const row = list.getRow(lineIndex);
      list.spliceRows(
        lineIndex,
        1,
        { ...row, text: left },
        { ...row, text: right },
      );

      root.replaceCursor({
        line: cursor.line + 1,
        ch: list.getNotesIndentOrThrow().length,
      });

      return UPDATED_OUTCOME;
    }

    const hasChildren = !list.isEmpty();
    const childIsFolded = list.isFoldRoot();
    const endPos = list.getLastLineContentEnd();
    const endOfLine = cursor.line === endPos.line && cursor.ch === endPos.ch;
    const insertAfter =
      this.intent !== "open-before" &&
      !shouldInsertUncheckedSiblingBeforeCurrentItem;

    const onChildLevel =
      asChild ||
      (!preservesEmptyItem &&
        insertAfter &&
        hasChildren &&
        !childIsFolded &&
        endOfLine);

    const firstChild = list.getChildren()[0] ?? null;
    const indent = onChildLevel
      ? firstChild
        ? firstChild.getFirstLineIndent()
        : list.getFirstLineIndent() + this.defaultIndentChars
      : list.getFirstLineIndent();

    let bullet =
      onChildLevel && firstChild ? firstChild.getBullet() : list.getBullet();
    if (asChild && /^\d+\.$/.test(bullet)) bullet = "1.";

    let spaceAfterBullet =
      onChildLevel && firstChild
        ? firstChild.getSpaceAfterBullet()
        : list.getSpaceAfterBullet();
    if ((asChild || preservesEmptyItem) && spaceAfterBullet.length === 0) {
      spaceAfterBullet = " ";
    }

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
      const notesIndent = list.getNotesIndentOrThrow();
      newList.setNotesIndent(
        asChild
          ? indent + notesIndent.slice(list.getFirstLineIndent().length)
          : notesIndent,
      );
      // A source tab may straddle the old continuation boundary. Materialize
      // its code-side columns before moving the note under a deeper marker.
      const continuedLines = asChild
        ? list.getLinesForFenceParsing().slice(lineIndex + 1)
        : newLines;
      for (const [index, line] of continuedLines.entries()) {
        const row = list.getRow(lineIndex + 1 + index);
        const indentOverride =
          asChild && (row.text !== "" || row.indentOverride !== "")
            ? null
            : row.indentOverride;
        newList.addLine(line, indentOverride);
      }
    }

    if (onChildLevel) {
      list.addBeforeAll(newList);
    } else {
      if (
        insertAfter &&
        !preservesEmptyItem &&
        (!childIsFolded || !endOfLine)
      ) {
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

    list.spliceRows(
      0,
      list.getLineCount(),
      ...oldLines.map((text, index) => ({ ...list.getRow(index), text })),
    );
    recalculateNumericBullets(
      this.editingRoot ?? root,
      this.numericBulletsEnabled,
    );

    const newListStart = newList.getFirstLineContentStart();
    root.replaceCursor({
      line: newListStart.line,
      ch: newListStart.ch + prefix.length,
    });
    return UPDATED_OUTCOME;
  }
}
