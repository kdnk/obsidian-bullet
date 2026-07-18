import { NO_OP_OUTCOME, Operation, UPDATED_OUTCOME } from "./Operation";

import { List, Root, recalculateNumericBullets } from "../root";
import { isEmptyLineOrEmptyCheckbox } from "../utils/isEmptyLineOrEmptyCheckbox";

export class CreateNewRootItemAfterEmpty implements Operation {
  constructor(
    private root: Root,
    private numericBulletsEnabled: boolean,
  ) {}

  perform() {
    const { root } = this;

    if (!root.hasSingleSelection()) {
      return NO_OP_OUTCOME;
    }

    const selection = root.getSelection();
    if (selection.anchor.line !== selection.head.line) {
      return NO_OP_OUTCOME;
    }

    const list = root.getListUnderCursor();
    const lines = list.getLines();
    if (
      lines.length !== 1 ||
      !isEmptyLineOrEmptyCheckbox(lines[0]) ||
      list.getLevel() !== 1
    ) {
      return NO_OP_OUTCOME;
    }

    const hasCheckbox = list.hasCheckbox();
    const prefix = hasCheckbox ? "[ ] " : "";
    const sibling = new List(
      list.getRoot(),
      list.getFirstLineIndent(),
      list.getBullet(),
      prefix,
      hasCheckbox,
      list.getSpaceAfterBullet(),
      prefix,
      false,
    );

    list.getParentOrThrow().addAfter(list, sibling);
    recalculateNumericBullets(root, this.numericBulletsEnabled);
    root.replaceCursor(sibling.getFirstLineContentStartAfterCheckbox());

    return UPDATED_OUTCOME;
  }
}
