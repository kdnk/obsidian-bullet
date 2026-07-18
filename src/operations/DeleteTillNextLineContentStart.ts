import { DeleteTillPreviousLineContentEnd } from "./DeleteTillPreviousLineContentEnd";
import { NO_OP_OUTCOME, Operation } from "./Operation";

import { Root } from "../root";

export class DeleteTillNextLineContentStart implements Operation {
  private deleteTillPreviousLineContentEnd: DeleteTillPreviousLineContentEnd;

  constructor(
    private root: Root,
    private numericBulletsEnabled: boolean,
  ) {
    this.deleteTillPreviousLineContentEnd =
      new DeleteTillPreviousLineContentEnd(root, numericBulletsEnabled, false);
  }

  perform() {
    const { root } = this;

    if (!root.hasSingleCursor()) {
      return NO_OP_OUTCOME;
    }

    const list = root.getListUnderCursor();
    const cursor = root.getCursor();
    const lines = list.getLinesInfo();

    const lineNo = lines.findIndex(
      (l) => cursor.ch === l.to.ch && cursor.line === l.to.line,
    );

    if (lineNo === lines.length - 1) {
      const nextLine = lines[lineNo].to.line + 1;
      const nextList = root.getListUnderLine(nextLine);
      if (!nextList) {
        return NO_OP_OUTCOME;
      }
      root.replaceCursor(nextList.getFirstLineContentStart());
      return this.deleteTillPreviousLineContentEnd.perform();
    } else if (lineNo >= 0) {
      root.replaceCursor(lines[lineNo + 1].from);
      return this.deleteTillPreviousLineContentEnd.perform();
    }

    return NO_OP_OUTCOME;
  }
}
