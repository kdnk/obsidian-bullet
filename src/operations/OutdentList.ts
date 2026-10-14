import {
  NO_OP_OUTCOME,
  Operation,
  STOP_ONLY_OUTCOME,
  UPDATED_OUTCOME,
} from "./Operation";
import { indentFencedCode } from "./indentFencedCode";

import { Root, recalculateNumericBullets } from "../root";

export class OutdentList implements Operation {
  constructor(
    private root: Root,
    private numericBulletsEnabled: boolean,
    private defaultIndentChars = "\t",
  ) {}

  perform() {
    const { root } = this;

    if (!root.hasSingleSelection()) {
      return NO_OP_OUTCOME;
    }

    const codeOutcome = indentFencedCode(
      root,
      "outdent",
      this.defaultIndentChars,
    );
    if (codeOutcome) return codeOutcome;

    const selection = root.getSelection();
    if (selection.anchor.line !== selection.head.line) {
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

    root.replaceSelections([
      {
        anchor: {
          line: selection.anchor.line + lineDiff,
          ch: Math.max(0, selection.anchor.ch - chDiff),
        },
        head: {
          line: selection.head.line + lineDiff,
          ch: Math.max(0, selection.head.ch - chDiff),
        },
      },
    ]);

    recalculateNumericBullets(root, this.numericBulletsEnabled);
    return UPDATED_OUTCOME;
  }
}
