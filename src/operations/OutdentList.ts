import {
  NO_OP_OUTCOME,
  Operation,
  STOP_ONLY_OUTCOME,
  UPDATED_OUTCOME,
} from "./Operation";

import { Root, recalculateNumericBullets } from "../root";

export class OutdentList implements Operation {
  constructor(
    private root: Root,
    private numericBulletsEnabled: boolean,
  ) {}

  perform() {
    const { root } = this;

    if (!root.hasSingleCursor()) {
      return NO_OP_OUTCOME;
    }

    const list = root.getListUnderCursor();
    const parent = list.getParent();
    if (!parent) {
      return STOP_ONLY_OUTCOME;
    }

    const grandParent = parent.getParent();

    if (!grandParent) {
      return STOP_ONLY_OUTCOME;
    }

    const listStartLineBefore = root.getContentLinesRangeOf(list)[0];
    const indentRmFrom = parent.getFirstLineIndent().length;
    const indentRmTill = list.getFirstLineIndent().length;

    parent.removeChild(list);
    grandParent.addAfter(parent, list);
    list.unindentContent(indentRmFrom, indentRmTill);

    const listStartLineAfter = root.getContentLinesRangeOf(list)[0];
    const lineDiff = listStartLineAfter - listStartLineBefore;
    const chDiff = indentRmTill - indentRmFrom;

    const cursor = root.getCursor();
    root.replaceCursor({
      line: cursor.line + lineDiff,
      ch: cursor.ch - chDiff,
    });

    recalculateNumericBullets(root, this.numericBulletsEnabled);
    return UPDATED_OUTCOME;
  }
}
