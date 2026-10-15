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

    if (cursor.ch < lines[lineNo].from.ch) {
      return STOP_ONLY_OUTCOME;
    }

    list.spliceRows(lineNo, 1, {
      ...list.getRow(lineNo),
      text: lines[lineNo].text.slice(cursor.ch - lines[lineNo].from.ch),
    });
    root.replaceCursor(lines[lineNo].from);
    return UPDATED_OUTCOME;
  }
}
