import { NO_OP_OUTCOME, Operation } from "./Operation";
import { OutdentList } from "./OutdentList";

import { Root } from "../root";
import { isEmptyLineOrEmptyCheckbox } from "../utils/isEmptyLineOrEmptyCheckbox";

export class OutdentListIfItsEmpty implements Operation {
  private outdentList: OutdentList;

  constructor(
    private root: Root,
    private numericBulletsEnabled: boolean,
  ) {
    this.outdentList = new OutdentList(root, numericBulletsEnabled);
  }

  perform() {
    const { root } = this;

    if (!root.hasSingleCursor()) {
      return NO_OP_OUTCOME;
    }

    const list = root.getListUnderCursor();
    const lines = list.getLines();

    if (
      lines.length > 1 ||
      !isEmptyLineOrEmptyCheckbox(lines[0]) ||
      list.getLevel() === 1
    ) {
      return NO_OP_OUTCOME;
    }

    return this.outdentList.perform();
  }
}
