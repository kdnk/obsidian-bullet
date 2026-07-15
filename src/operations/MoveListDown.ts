import {
  NO_OP_OUTCOME,
  Operation,
  STOP_ONLY_OUTCOME,
  UPDATED_OUTCOME,
} from "./Operation";

import { Root, recalculateNumericBullets } from "../root";

export class MoveListDown implements Operation {
  constructor(
    private root: Root,
    private numericBulletsEnabled: boolean,
  ) {}

  perform() {
    const { root } = this;

    if (!root.hasSingleSelection()) {
      return NO_OP_OUTCOME;
    }

    const list = root.getListUnderCursor();
    const parent = list.getParent();
    if (!parent) {
      return STOP_ONLY_OUTCOME;
    }

    const grandParent = parent.getParent();
    const next = parent.getNextSiblingOf(list);

    const listStartLineBefore = root.getContentLinesRangeOf(list)[0];
    let moved = false;

    if (!next && grandParent) {
      const newParent = grandParent.getNextSiblingOf(parent);

      if (newParent) {
        moved = true;
        parent.removeChild(list);
        newParent.addBeforeAll(list);
      }
    } else if (next) {
      moved = true;
      parent.removeChild(list);
      parent.addAfter(next, list);
    }

    if (!moved) {
      return STOP_ONLY_OUTCOME;
    }

    const listStartLineAfter = root.getContentLinesRangeOf(list)[0];
    const lineDiff = listStartLineAfter - listStartLineBefore;

    root.replaceSelections(
      root.getSelections().map((selection) => ({
        anchor: {
          line: selection.anchor.line + lineDiff,
          ch: selection.anchor.ch,
        },
        head: {
          line: selection.head.line + lineDiff,
          ch: selection.head.ch,
        },
      })),
    );

    recalculateNumericBullets(root, this.numericBulletsEnabled);
    return UPDATED_OUTCOME;
  }
}
