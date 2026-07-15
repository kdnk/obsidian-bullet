import { NO_OP_OUTCOME, Operation, UPDATED_OUTCOME } from "./Operation";

import { Root } from "../root";

export class KeepCursorOutsideFoldedLines implements Operation {
  constructor(private root: Root) {}

  perform() {
    const { root } = this;

    if (!root.hasSingleCursor()) {
      return NO_OP_OUTCOME;
    }

    const cursor = root.getCursor();

    const list = root.getListUnderCursor();
    if (!list.isFolded()) {
      return NO_OP_OUTCOME;
    }

    const foldRoot = list.getTopFoldRoot();
    if (!foldRoot) {
      return NO_OP_OUTCOME;
    }

    const firstLine = foldRoot.getLinesInfo()[0];
    if (!firstLine) {
      return NO_OP_OUTCOME;
    }

    const firstLineEnd = firstLine.to;

    if (cursor.line > firstLineEnd.line) {
      root.replaceCursor(firstLineEnd);
      return UPDATED_OUTCOME;
    }

    return NO_OP_OUTCOME;
  }
}
