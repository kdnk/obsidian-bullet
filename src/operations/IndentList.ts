import { Operation } from "./Operation";

import { Root, recalculateNumericBullets } from "../root";

export class IndentList implements Operation {
  private stopPropagation = false;
  private updated = false;

  constructor(
    private root: Root,
    private defaultIndentChars: string,
    private numericBulletsEnabled: boolean,
  ) {}

  shouldStopPropagation() {
    return this.stopPropagation;
  }

  shouldUpdate() {
    return this.updated;
  }

  private getIndentWidth(indent: string) {
    let width = 0;

    for (const char of indent) {
      width += char === "\t" ? 4 : 1;
    }

    return width;
  }

  private getSmallestIndentUnit(...indents: string[]) {
    return indents.reduce((smallest, current) => {
      if (current === "") {
        return smallest;
      }

      if (smallest === "") {
        return current;
      }

      return this.getIndentWidth(current) < this.getIndentWidth(smallest)
        ? current
        : smallest;
    }, "");
  }

  perform() {
    const { root } = this;

    if (!root.hasSingleCursor()) {
      return;
    }

    this.stopPropagation = true;

    const list = root.getListUnderCursor();
    const parent = list.getParent();
    if (!parent) {
      return;
    }

    const prev = parent.getPrevSiblingOf(list);

    if (!prev) {
      return;
    }

    this.updated = true;

    const listStartLineBefore = root.getContentLinesRangeOf(list)[0];

    const indentPos = list.getFirstLineIndent().length;
    let indentChars = "";

    if (indentChars === "" && !prev.isEmpty()) {
      const firstPrevChild = prev.getChildren()[0];
      if (!firstPrevChild) {
        return;
      }
      indentChars = firstPrevChild
        .getFirstLineIndent()
        .slice(prev.getFirstLineIndent().length);
    }

    if (indentChars === "") {
      const currentIndentChars = list
        .getFirstLineIndent()
        .slice(parent.getFirstLineIndent().length);
      indentChars = this.getSmallestIndentUnit(
        currentIndentChars,
        this.defaultIndentChars,
      );
    }

    if (indentChars === "" && !list.isEmpty()) {
      const firstChild = list.getChildren()[0];
      if (!firstChild) {
        return;
      }
      indentChars = firstChild
        .getFirstLineIndent()
        .slice(list.getFirstLineIndent().length);
    }

    if (indentChars === "") {
      indentChars = this.defaultIndentChars;
    }

    parent.removeChild(list);
    prev.addAfterAll(list);
    list.indentContent(indentPos, indentChars);

    const listStartLineAfter = root.getContentLinesRangeOf(list)[0];
    const lineDiff = listStartLineAfter - listStartLineBefore;

    const cursor = root.getCursor();
    root.replaceCursor({
      line: cursor.line + lineDiff,
      ch: cursor.ch + indentChars.length,
    });

    recalculateNumericBullets(root, this.numericBulletsEnabled);
  }
}
