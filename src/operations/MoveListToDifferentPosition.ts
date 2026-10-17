import { NO_OP_OUTCOME, Operation, UPDATED_OUTCOME } from "./Operation";

import { List, Root, recalculateNumericBullets } from "../root";

interface CursorAnchor {
  cursorList: List;
  lineDiff: number;
  chDiff: number;
}

export class MoveListToDifferentPosition implements Operation {
  constructor(
    private root: Root,
    private listToMove: List,
    private placeToMove: List,
    private whereToMove: "before" | "after" | "inside",
    private defaultIndentChars: string,
    private numericBulletsEnabled: boolean,
  ) {}

  perform() {
    if (this.listToMove === this.placeToMove) {
      return NO_OP_OUTCOME;
    }

    const cursorAnchor = this.calculateCursorAnchor();
    this.moveList();
    this.changeIndent();
    recalculateNumericBullets(this.root, this.numericBulletsEnabled);
    this.restoreCursor(cursorAnchor);
    return UPDATED_OUTCOME;
  }

  private calculateCursorAnchor(): CursorAnchor | null {
    const cursorLine = this.root.getCursor().line;

    const lines = [
      this.listToMove.getFirstLineContentStart().line,
      this.listToMove.getContentEndIncludingChildren().line,
      this.placeToMove.getFirstLineContentStart().line,
      this.placeToMove.getContentEndIncludingChildren().line,
    ];
    const listStartLine = Math.min(...lines);
    const listEndLine = Math.max(...lines);

    if (cursorLine < listStartLine || cursorLine > listEndLine) {
      return null;
    }

    const cursor = this.root.getCursor();
    const cursorList = this.root.getListUnderLine(cursor.line);
    if (!cursorList) {
      return null;
    }

    const cursorListStart = cursorList.getFirstLineContentStart();
    const lineDiff = cursor.line - cursorListStart.line;
    const chDiff = cursor.ch - cursorList.getLinesInfo()[lineDiff].from.ch;

    return { cursorList, lineDiff, chDiff };
  }

  private moveList() {
    this.listToMove.getParentOrThrow().removeChild(this.listToMove);

    switch (this.whereToMove) {
      case "before":
        this.placeToMove
          .getParentOrThrow()
          .addBefore(this.placeToMove, this.listToMove);
        break;

      case "after":
        this.placeToMove
          .getParentOrThrow()
          .addAfter(this.placeToMove, this.listToMove);
        break;

      case "inside":
        this.placeToMove.addBeforeAll(this.listToMove);
        break;
    }
  }

  private changeIndent() {
    const newIndent =
      this.whereToMove === "inside"
        ? this.placeToMove.getFirstLineIndent() + this.defaultIndentChars
        : this.placeToMove.getFirstLineIndent();
    this.listToMove.reindentSubtree(newIndent);
  }

  private restoreCursor(cursorAnchor: CursorAnchor | null) {
    if (cursorAnchor) {
      const row = cursorAnchor.cursorList.getLinesInfo()[cursorAnchor.lineDiff];

      this.root.replaceCursor({
        line: row.from.line,
        ch: Math.max(0, row.from.ch + cursorAnchor.chDiff),
      });
    } else {
      // When you move a list, the screen scrolls to the cursor.
      // It is better to move the cursor into the viewport than let the screen scroll.
      this.root.replaceCursor(this.listToMove.getLastLineContentEnd());
    }
  }
}
