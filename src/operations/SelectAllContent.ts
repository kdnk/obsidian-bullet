import { Operation } from "./Operation";

import { Position, Root, maxPos, minPos } from "../root";

export class SelectAllContent implements Operation {
  private stopPropagation = false;
  private updated = false;
  private nextCycleCursor: Position | null = null;

  constructor(
    private root: Root,
    private cycleCursor: Position | null = null,
  ) {}

  shouldStopPropagation() {
    return this.stopPropagation;
  }

  shouldUpdate() {
    return this.updated;
  }

  getCycleCursor() {
    return this.nextCycleCursor;
  }

  perform() {
    const { root } = this;

    if (!root.hasSingleSelection()) {
      return;
    }

    const selection = root.getSelections()[0];
    const [rootStart, rootEnd] = root.getContentRange();
    const selectionFrom = minPos(selection.anchor, selection.head);
    const selectionTo = maxPos(selection.anchor, selection.head);

    if (
      selectionFrom.line < rootStart.line ||
      selectionTo.line > rootEnd.line
    ) {
      return false;
    }

    const isRootSelection = this.sameRange(
      selectionFrom,
      selectionTo,
      rootStart,
      rootEnd,
    );
    const targetCursor = isRootSelection
      ? (this.cycleCursor ?? root.getCursor())
      : selectionFrom;
    const list = root.getListUnderLine(targetCursor.line);

    if (!list) {
      return false;
    }

    const contentStart = list.getFirstLineContentStartAfterCheckbox();
    const contentEnd = list.getLastLineContentEnd();
    const subtreeEnd = list.getContentEndIncludingChildren();

    this.stopPropagation = true;
    this.updated = true;
    this.nextCycleCursor = contentStart;

    if (isRootSelection) {
      root.replaceSelections([{ anchor: contentStart, head: contentEnd }]);
    } else if (
      this.sameRange(selectionFrom, selectionTo, contentStart, contentEnd)
    ) {
      if (list.getChildren().length) {
        root.replaceSelections([{ anchor: contentStart, head: subtreeEnd }]);
      } else {
        root.replaceSelections([{ anchor: rootStart, head: rootEnd }]);
      }
    } else if (
      this.sameRange(selectionFrom, selectionTo, contentStart, subtreeEnd)
    ) {
      root.replaceSelections([{ anchor: rootStart, head: rootEnd }]);
    } else if (
      this.containsRange(selectionFrom, selectionTo, contentStart, contentEnd)
    ) {
      root.replaceSelections([{ anchor: contentStart, head: contentEnd }]);
    } else {
      this.stopPropagation = false;
      this.updated = false;
      this.nextCycleCursor = null;
      return false;
    }

    return true;
  }

  private sameRange(
    actualFrom: Position,
    actualTo: Position,
    expectedFrom: Position,
    expectedTo: Position,
  ) {
    return (
      actualFrom.line === expectedFrom.line &&
      actualFrom.ch === expectedFrom.ch &&
      actualTo.line === expectedTo.line &&
      actualTo.ch === expectedTo.ch
    );
  }

  private containsRange(
    selectionFrom: Position,
    selectionTo: Position,
    rangeFrom: Position,
    rangeTo: Position,
  ) {
    return (
      (selectionFrom.line > rangeFrom.line ||
        (selectionFrom.line === rangeFrom.line &&
          selectionFrom.ch >= rangeFrom.ch)) &&
      (selectionTo.line < rangeTo.line ||
        (selectionTo.line === rangeTo.line && selectionTo.ch <= rangeTo.ch))
    );
  }
}
