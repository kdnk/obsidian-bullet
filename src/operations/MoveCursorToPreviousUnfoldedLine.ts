import {
  NO_OP_OUTCOME,
  Operation,
  STOP_ONLY_OUTCOME,
  UPDATED_OUTCOME,
} from "./Operation";

import { MyEditor } from "../editor";
import { ListLine, Position, Root } from "../root";

export class MoveCursorToPreviousUnfoldedLine implements Operation {
  constructor(
    private root: Root,
    private editor: MyEditor,
  ) {}

  perform() {
    const { root } = this;

    if (!root.hasSingleCursor()) {
      return NO_OP_OUTCOME;
    }

    const list = this.root.getListUnderCursor();
    const cursor = this.root.getCursor();
    const lines = list.getLinesInfo();
    const lineNo = lines.findIndex((l) => {
      return (
        cursor.ch === l.from.ch + list.getCheckboxLength() &&
        cursor.line === l.from.line
      );
    });

    if (lineNo === 0) {
      return this.moveCursorToPreviousUnfoldedItem(root, cursor);
    } else if (lineNo > 0) {
      return this.moveCursorToPreviousNoteLine(root, lines, lineNo);
    }

    return NO_OP_OUTCOME;
  }

  private moveCursorToPreviousNoteLine(
    root: Root,
    lines: ListLine[],
    lineNo: number,
  ) {
    const previousLine = lines[lineNo - 1];
    if (!previousLine) {
      return STOP_ONLY_OUTCOME;
    }

    root.replaceCursor(previousLine.to);
    return UPDATED_OUTCOME;
  }

  private moveCursorToPreviousUnfoldedItem(root: Root, cursor: Position) {
    const prev = root.getListUnderLine(cursor.line - 1);

    if (!prev) {
      if (cursor.line < 1) {
        return NO_OP_OUTCOME;
      }

      root.replaceCursor({
        line: cursor.line - 1,
        ch: this.editor.getLine(cursor.line - 1).length,
      });
      return UPDATED_OUTCOME;
    }

    if (prev.isFolded()) {
      const foldRoot = prev.getTopFoldRoot();
      if (!foldRoot) {
        return STOP_ONLY_OUTCOME;
      }
      const firstLine = foldRoot.getLinesInfo()[0];
      if (!firstLine) {
        return STOP_ONLY_OUTCOME;
      }

      const firstLineEnd = firstLine.to;
      root.replaceCursor(firstLineEnd);
    } else {
      root.replaceCursor(prev.getLastLineContentEnd());
    }

    return UPDATED_OUTCOME;
  }
}
