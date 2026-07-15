import {
  NO_OP_OUTCOME,
  Operation,
  STOP_ONLY_OUTCOME,
  UPDATED_OUTCOME,
} from "./Operation";

import { Root, recalculateNumericBullets } from "../root";

export class MoveListUp implements Operation {
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
    const prev = parent.getPrevSiblingOf(list);

    const listStartLineBefore = root.getContentLinesRangeOf(list)[0];
    let moved = false;

    if (!prev && grandParent) {
      const newParent = grandParent.getPrevSiblingOf(parent);

      if (newParent) {
        moved = true;
        parent.removeChild(list);
        newParent.addAfterAll(list);
      }
    } else if (prev) {
      moved = true;
      parent.removeChild(list);
      parent.addBefore(prev, list);
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
