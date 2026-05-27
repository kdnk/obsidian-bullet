import { Operation } from "./Operation";

import { List, Position, Root, maxPos, minPos } from "../root";

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

    const list = this.getCycleListForSelection(
      selectionFrom,
      selectionTo,
      rootStart,
      rootEnd,
    );

    if (!list) {
      return false;
    }

    const contentStart = list.getFirstLineContentStartAfterCheckbox();
    const contentEnd = list.getLastLineContentEnd();
    const subtreeEnd = list.getContentEndIncludingChildren();
    const [scopeStart, scopeEnd] = this.getExpansionScopeRange(
      list,
      rootStart,
      rootEnd,
    );
    const isRootSelection = this.sameRange(
      selectionFrom,
      selectionTo,
      rootStart,
      rootEnd,
    );

    this.stopPropagation = true;
    this.updated = true;
    this.nextCycleCursor = contentStart;

    if (
      isRootSelection ||
      this.sameRange(selectionFrom, selectionTo, scopeStart, scopeEnd)
    ) {
      root.replaceSelections([{ anchor: contentStart, head: contentEnd }]);
    } else if (
      this.sameRange(selectionFrom, selectionTo, contentStart, contentEnd)
    ) {
      if (list.getChildren().length) {
        root.replaceSelections([{ anchor: contentStart, head: subtreeEnd }]);
      } else {
        root.replaceSelections([{ anchor: scopeStart, head: scopeEnd }]);
      }
    } else if (
      this.sameRange(selectionFrom, selectionTo, contentStart, subtreeEnd)
    ) {
      root.replaceSelections([{ anchor: scopeStart, head: scopeEnd }]);
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

  private getExpansionScopeRange(
    list: List,
    rootStart: Position,
    rootEnd: Position,
  ): [Position, Position] {
    const parent = list.getParent();

    if (parent && parent.getParent()) {
      return [
        { line: parent.getFirstLineContentStart().line, ch: 0 },
        parent.getContentEndIncludingChildren(),
      ];
    }

    return [rootStart, rootEnd];
  }

  private getCycleListForSelection(
    selectionFrom: Position,
    selectionTo: Position,
    rootStart: Position,
    rootEnd: Position,
  ) {
    const cycleList = this.cycleCursor
      ? this.root.getListUnderLine(this.cycleCursor.line)
      : null;

    if (
      cycleList &&
      this.selectionBelongsToList(
        selectionFrom,
        selectionTo,
        cycleList,
        rootStart,
        rootEnd,
      )
    ) {
      return cycleList;
    }

    return this.root.getListUnderLine(selectionFrom.line);
  }

  private selectionBelongsToList(
    selectionFrom: Position,
    selectionTo: Position,
    list: List,
    rootStart: Position,
    rootEnd: Position,
  ) {
    const contentStart = list.getFirstLineContentStartAfterCheckbox();
    const contentEnd = list.getLastLineContentEnd();
    const subtreeEnd = list.getContentEndIncludingChildren();
    const [scopeStart, scopeEnd] = this.getExpansionScopeRange(
      list,
      rootStart,
      rootEnd,
    );

    return (
      this.sameRange(selectionFrom, selectionTo, rootStart, rootEnd) ||
      this.sameRange(selectionFrom, selectionTo, contentStart, contentEnd) ||
      this.sameRange(selectionFrom, selectionTo, contentStart, subtreeEnd) ||
      this.sameRange(selectionFrom, selectionTo, scopeStart, scopeEnd) ||
      this.containsRange(selectionFrom, selectionTo, contentStart, contentEnd)
    );
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
