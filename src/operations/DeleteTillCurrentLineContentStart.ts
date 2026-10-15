import {
  NO_OP_OUTCOME,
  Operation,
  STOP_ONLY_OUTCOME,
  UPDATED_OUTCOME,
} from "./Operation";

import { Root } from "../root";

export class DeleteTillCurrentLineContentStart implements Operation {
  constructor(private root: Root) {}

  perform() {
    const { root } = this;

    if (!root.hasSingleCursor()) {
      return NO_OP_OUTCOME;
    }

    const cursor = root.getCursor();
    const list = root.getListUnderCursor();
    const lines = list.getLinesInfo();
    const lineNo = lines.findIndex((l) => l.from.line === cursor.line);
    const line = lines[lineNo];
    const checkboxLength = lineNo === 0 ? list.getCheckboxLength() : 0;
    const contentStart = { ...line.from, ch: line.from.ch + checkboxLength };

    if (cursor.ch < contentStart.ch) {
      return STOP_ONLY_OUTCOME;
    }

    list.spliceRows(lineNo, 1, {
      ...list.getRow(lineNo),
      text:
        line.text.slice(0, checkboxLength) +
        line.text.slice(cursor.ch - line.from.ch),
    });
    root.replaceCursor(contentStart);
    return UPDATED_OUTCOME;
  }
}
