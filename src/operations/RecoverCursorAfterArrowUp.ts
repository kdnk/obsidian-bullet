import { Operation } from "./Operation";

import { Position, Root } from "../root";

export class RecoverCursorAfterArrowUp implements Operation {
  private stopPropagation = false;
  private updated = false;

  constructor(
    private root: Root,
    private previousCursor: Position,
  ) {}

  shouldStopPropagation() {
    return this.stopPropagation;
  }

  shouldUpdate() {
    return this.updated;
  }

  perform() {
    const { root, previousCursor } = this;

    if (!root.hasSingleCursor()) {
      return;
    }

    const cursor = root.getCursor();

    if (previousCursor.line !== cursor.line || previousCursor.ch <= cursor.ch) {
      return;
    }

    const list = root.getListUnderCursor();
    const contentStart = list.getFirstLineContentStartAfterCheckbox();

    if (
      cursor.line !== contentStart.line ||
      cursor.ch >= contentStart.ch ||
      previousCursor.ch < contentStart.ch
    ) {
      return;
    }

    const prev = root.getListUnderLine(cursor.line - 1);

    if (!prev) {
      return;
    }

    this.stopPropagation = true;
    this.updated = true;

    if (prev.isFolded()) {
      const foldRoot = prev.getTopFoldRoot();
      if (!foldRoot) {
        return;
      }
      const firstLine = foldRoot.getLinesInfo()[0];
      if (!firstLine) {
        return;
      }

      root.replaceCursor(firstLine.to);
    } else {
      root.replaceCursor(prev.getLastLineContentEnd());
    }
  }
}
