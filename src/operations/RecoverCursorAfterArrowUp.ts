import {
  NO_OP_OUTCOME,
  Operation,
  STOP_ONLY_OUTCOME,
  UPDATED_OUTCOME,
} from "./Operation";

import { Position, Root } from "../root";

export class RecoverCursorAfterArrowUp implements Operation {
  constructor(
    private root: Root,
    private previousCursor: Position,
  ) {}

  perform() {
    const { root, previousCursor } = this;

    if (!root.hasSingleCursor()) {
      return NO_OP_OUTCOME;
    }

    const cursor = root.getCursor();

    if (previousCursor.line !== cursor.line || previousCursor.ch <= cursor.ch) {
      return NO_OP_OUTCOME;
    }

    const list = root.getListUnderCursor();
    const contentStart = list.getFirstLineContentStartAfterCheckbox();

    if (
      cursor.line !== contentStart.line ||
      cursor.ch >= contentStart.ch ||
      previousCursor.ch < contentStart.ch
    ) {
      return NO_OP_OUTCOME;
    }

    const prev = root.getListUnderLine(cursor.line - 1);

    if (!prev) {
      return NO_OP_OUTCOME;
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

      root.replaceCursor(firstLine.to);
    } else {
      root.replaceCursor(prev.getLastLineContentEnd());
    }

    return UPDATED_OUTCOME;
  }
}
