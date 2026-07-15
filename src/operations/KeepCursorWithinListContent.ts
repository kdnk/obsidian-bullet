import { NO_OP_OUTCOME, Operation, UPDATED_OUTCOME } from "./Operation";

import { Root } from "../root";

export class KeepCursorWithinListContent implements Operation {
  constructor(private root: Root) {}

  perform() {
    const { root } = this;

    if (!root.hasSingleCursor()) {
      return NO_OP_OUTCOME;
    }

    const cursor = root.getCursor();
    const list = root.getListUnderCursor();
    const contentStart = list.getFirstLineContentStartAfterCheckbox();
    const linePrefix =
      contentStart.line === cursor.line
        ? contentStart.ch
        : list.getNotesIndentOrThrow().length;

    if (cursor.ch < linePrefix) {
      root.replaceCursor({
        line: cursor.line,
        ch: linePrefix,
      });
      return UPDATED_OUTCOME;
    }

    return NO_OP_OUTCOME;
  }
}
