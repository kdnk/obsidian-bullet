import {
  NO_OP_OUTCOME,
  Operation,
  STOP_ONLY_OUTCOME,
  UPDATED_OUTCOME,
} from "./Operation";

import { Position, Root, recalculateNumericBullets } from "../root";

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

    const anchorPosition = (position: Position) => {
      const owner = root.getListUnderLine(position.line);
      if (!owner) return () => position;

      const row = position.line - root.getContentLinesRangeOf(owner)[0];
      const offset = position.ch - owner.getLinesInfo()[row].from.ch;
      return () => {
        const { from } = owner.getLinesInfo()[row];
        return { line: from.line, ch: Math.max(0, from.ch + offset) };
      };
    };
    const selections = root.getSelections().map((selection) => ({
      anchor: anchorPosition(selection.anchor),
      head: anchorPosition(selection.head),
    }));
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

    recalculateNumericBullets(root, this.numericBulletsEnabled);

    root.replaceSelections(
      selections.map((selection) => ({
        anchor: selection.anchor(),
        head: selection.head(),
      })),
    );
    return UPDATED_OUTCOME;
  }
}
