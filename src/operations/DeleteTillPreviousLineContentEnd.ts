import {
  NO_OP_OUTCOME,
  Operation,
  STOP_ONLY_OUTCOME,
  UPDATED_OUTCOME,
} from "./Operation";

import {
  List,
  ListLine,
  Position,
  Root,
  recalculateNumericBullets,
} from "../root";
import { getFenceContent, reindentListPrefix } from "../utils/fencedCode";
import { isEmptyLineOrEmptyCheckbox } from "../utils/isEmptyLineOrEmptyCheckbox";

export class DeleteTillPreviousLineContentEnd implements Operation {
  constructor(
    private root: Root,
    private numericBulletsEnabled: boolean,
    private removeEmptyLeafItem: boolean,
  ) {}

  perform() {
    const { root } = this;

    if (!root.hasSingleCursor()) {
      return NO_OP_OUTCOME;
    }

    const list = root.getListUnderCursor();
    const cursor = root.getCursor();
    const lines = list.getLinesInfo();

    const lineNo = lines.findIndex(
      (line) => cursor.line === line.from.line && cursor.ch === line.from.ch,
    );
    const firstLine = lines[0];
    const syntheticContentStartMatch =
      this.removeEmptyLeafItem &&
      firstLine !== undefined &&
      cursor.line === firstLine.from.line &&
      cursor.ch !== firstLine.from.ch &&
      cursor.ch === firstLine.to.ch &&
      isEmptyLineOrEmptyCheckbox(firstLine.text);

    if (lineNo >= 0 || syntheticContentStartMatch) {
      const previousLine = cursor.line - 1;
      const fold = root.getListUnderLine(previousLine)?.getTopFoldRoot();
      if (fold && previousLine > fold.getFirstLineContentStart().line) {
        fold.unfold();
        return UPDATED_OUTCOME;
      }
    }

    if (
      (lineNo === 0 || syntheticContentStartMatch) &&
      this.removeEmptyLeafItem &&
      lines.length === 1 &&
      firstLine !== undefined &&
      isEmptyLineOrEmptyCheckbox(firstLine.text) &&
      list.isEmpty()
    ) {
      return this.removeEmptyList(root, cursor, list);
    }

    if (syntheticContentStartMatch) {
      return NO_OP_OUTCOME;
    }

    if (lineNo === 0) {
      return this.mergeWithPreviousItem(root, cursor, list);
    } else if (lineNo > 0) {
      return this.mergeNotes(root, cursor, list, lines, lineNo);
    }

    return NO_OP_OUTCOME;
  }

  private removeEmptyList(root: Root, cursor: Position, list: List) {
    const previousList = this.getVisibleListUnderLine(root, cursor.line - 1);
    const nextList = this.getVisibleListUnderLine(root, cursor.line + 1);
    const parent = list.getParent();

    if (!parent) {
      return STOP_ONLY_OUTCOME;
    }

    parent.removeChild(list);
    recalculateNumericBullets(root, this.numericBulletsEnabled);

    if (previousList) {
      root.replaceCursor(previousList.getLastLineContentEnd());
    } else if (nextList) {
      root.replaceCursor(nextList.getFirstLineContentStart());
    } else {
      root.replaceCursor(root.getContentStart());
    }

    return UPDATED_OUTCOME;
  }

  private getVisibleListUnderLine(root: Root, line: number) {
    const list = root.getListUnderLine(line);
    return list?.getTopFoldRoot() ?? list;
  }

  private mergeNotes(
    root: Root,
    cursor: Position,
    list: List,
    lines: ListLine[],
    lineNo: number,
  ) {
    const prevLineNo = lineNo - 1;

    root.replaceCursor({
      line: cursor.line - 1,
      ch: lines[prevLineNo].text.length + lines[prevLineNo].from.ch,
    });

    list.spliceRows(prevLineNo, 2, {
      ...list.getRow(prevLineNo),
      text: lines[prevLineNo].text + lines[lineNo].text,
    });
    return UPDATED_OUTCOME;
  }

  private mergeWithPreviousItem(root: Root, cursor: Position, list: List) {
    if (root.getChildren()[0] === list && list.isEmpty()) {
      return NO_OP_OUTCOME;
    }

    const prev = root.getListUnderLine(cursor.line - 1);

    if (!prev) {
      return STOP_ONLY_OUTCOME;
    }

    const bothAreEmpty = prev.isEmpty() && list.isEmpty();
    const prevIsEmptyAndSameLevel =
      prev.isEmpty() && !list.isEmpty() && prev.getLevel() === list.getLevel();
    const listIsEmptyAndPrevIsParent =
      list.isEmpty() && prev.getLevel() === list.getLevel() - 1;

    if (bothAreEmpty || prevIsEmptyAndSameLevel || listIsEmptyAndPrevIsParent) {
      const parent = list.getParent();
      if (!parent) {
        return STOP_ONLY_OUTCOME;
      }

      const prevEnd = prev.getLastLineContentEnd();
      let mutated = false;

      if (!prev.getNotesIndent() && list.getNotesIndent()) {
        prev.setNotesIndent(
          prev.getFirstLineIndent() +
            list
              .getNotesIndentOrThrow()
              .slice(list.getFirstLineIndent().length),
        );
        mutated = true;
      }

      const oldLines = prev.getLines();
      const newLines = list.getLines();
      const lastOldLine = oldLines[oldLines.length - 1];
      const firstNewLine = newLines[0];
      if (lastOldLine === undefined || firstNewLine === undefined) {
        return mutated ? UPDATED_OUTCOME : STOP_ONLY_OUTCOME;
      }

      prev.spliceRows(oldLines.length - 1, 1, {
        ...prev.getRow(oldLines.length - 1),
        text: lastOldLine + firstNewLine,
      });
      for (let index = 1; index < newLines.length; index++) {
        const row = list.getRow(index);
        const oldIndent = list.getNotesIndentOrThrow();
        const newIndent = prev.getNotesIndentOrThrow();
        const raw = (row.indentOverride ?? oldIndent) + row.text;
        if (oldIndent === newIndent || raw === "") {
          prev.addLine(row.text, row.indentOverride);
          continue;
        }
        const prefix = raw.match(/^[ \t]*/)?.[0] ?? "";
        const adjusted =
          reindentListPrefix(prefix, oldIndent, newIndent) +
          raw.slice(prefix.length);
        const offset = getFenceContent(adjusted, newIndent)?.offset ?? 0;
        prev.addLine(adjusted.slice(offset), adjusted.slice(0, offset));
      }
      parent.removeChild(list);

      for (const c of list.getChildren()) {
        list.removeChild(c);
        prev.addAfterAll(c);
      }

      root.replaceCursor(prevEnd);

      recalculateNumericBullets(root, this.numericBulletsEnabled);
      return UPDATED_OUTCOME;
    }

    return STOP_ONLY_OUTCOME;
  }
}
