import { NO_OP_OUTCOME, Operation, UPDATED_OUTCOME } from "./Operation";

import { Position, Root } from "../root";

export class RecoverCursorAfterFoldedNavigation implements Operation {
  private refoldLine: number | null = null;

  constructor(
    private root: Root,
    private previousCursor: Position | null,
    private previousFoldedLines: number[],
    private pressedKey: string | null,
  ) {}

  getRefoldLine() {
    return this.refoldLine;
  }

  perform() {
    const { root, previousCursor, previousFoldedLines, pressedKey } = this;

    if (
      !root.hasSingleCursor() ||
      !previousCursor ||
      pressedKey !== "ArrowDown"
    ) {
      return NO_OP_OUTCOME;
    }

    if (previousFoldedLines.indexOf(previousCursor.line) === -1) {
      return NO_OP_OUTCOME;
    }

    const cursor = root.getCursor();

    if (cursor.line <= previousCursor.line) {
      return NO_OP_OUTCOME;
    }

    const previousList = root.getListUnderLine(previousCursor.line);

    if (!previousList) {
      return NO_OP_OUTCOME;
    }

    const foldedContentEnd = previousList.getContentEndIncludingChildren();

    if (cursor.line > foldedContentEnd.line) {
      return NO_OP_OUTCOME;
    }

    const nextList = root.getListUnderLine(foldedContentEnd.line + 1);

    if (!nextList) {
      return NO_OP_OUTCOME;
    }
    this.refoldLine = previousCursor.line;
    root.replaceCursor(nextList.getFirstLineContentStartAfterCheckbox());
    return UPDATED_OUTCOME;
  }
}
