import { NO_OP_OUTCOME, Operation, UPDATED_OUTCOME } from "./Operation";

import { List, Root } from "../root";

export class InsertNewLineWithoutBullet implements Operation {
  constructor(private root: Root) {}

  perform() {
    const { root } = this;

    if (!root.hasSingleSelection()) {
      return NO_OP_OUTCOME;
    }

    const selection = root.getSelection();
    if (!selection || selection.anchor.line !== selection.head.line) {
      return NO_OP_OUTCOME;
    }

    const list = root.getListUnderCursor();
    const lines = list.getLinesInfo();
    const cursor = root.getCursor();
    const lineIndex = lines.findIndex((line) => line.from.line === cursor.line);

    if (lineIndex < 0) {
      return NO_OP_OUTCOME;
    }

    const lineUnderCursor = lines[lineIndex];
    if (!lineUnderCursor) {
      return NO_OP_OUTCOME;
    }

    if (cursor.ch < lineUnderCursor.from.ch) {
      return NO_OP_OUTCOME;
    }

    const lineOffset = cursor.ch - lineUnderCursor.from.ch;
    const lineText = lineUnderCursor.text;
    const left = lineText.slice(0, lineOffset);
    const right = lineText.slice(lineOffset);
    const newLines = list.getLines();

    newLines.splice(lineIndex, 1, left, right);

    if (!list.getNotesIndent()) {
      list.setNotesIndent(this.createNotesIndent(list));
    }

    list.replaceLines(newLines);

    root.replaceCursor({
      line: cursor.line + 1,
      ch: list.getNotesIndentOrThrow().length,
    });
    return UPDATED_OUTCOME;
  }

  private createNotesIndent(list: List) {
    return (
      list.getFirstLineIndent() +
      " ".repeat(list.getBullet().length + list.getSpaceAfterBullet().length)
    );
  }
}
