import { Plugin } from "obsidian";

import {
  EditorView,
  PluginValue,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";

import { Feature } from "./Feature";
import {
  applyVerticalLineElementStyle,
  getVerticalLinesMutationObserverOptions,
} from "./verticalLinesDom";
import {
  getVerticalLineHeight,
  getVerticalLineTop,
  getVerticalLinesContentLeft,
  measureVerticalGuide,
} from "./verticalLinesMeasurements";
import { createAnimationFrameScheduler } from "./verticalLinesScheduling";

import { MyEditor, getEditorFromState } from "../editor";
import { List } from "../root";
import { Parser } from "../services/Parser";
import { Settings } from "../services/Settings";

const VERTICAL_LINES_BODY_CLASS = "bullet-plugin-vertical-lines";
const CONTENT_TOP_OFFSET = 24;

interface LineData {
  top: number;
  left: number;
  width: number;
  height: string;
  guideOffsetX: number;
  list: List;
}

export class VerticalLinesPluginValue implements PluginValue {
  private scroller!: HTMLElement;
  private contentContainer!: HTMLElement;
  private editor!: MyEditor;
  private lastLine = 0;
  private toLine = 0;
  private lines: LineData[] = [];
  private lineElements: HTMLElement[] = [];
  private contentLeft = 0;
  private scheduler: ReturnType<typeof createAnimationFrameScheduler>;
  private resizeObserver?: ResizeObserver;
  private mutationObserver?: MutationObserver;
  private waitForEditorTimeout: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(
    private settings: Settings,
    private parser: Parser,
    private view: EditorView,
  ) {
    this.scheduler = createAnimationFrameScheduler(this.calculate);
    this.view.scrollDOM.addEventListener("scroll", this.onScroll);
    this.settings.onChange(this.scheduleRecalculate);

    this.prepareDom();
    this.observeLayoutChanges();
    this.waitForEditor();
  }

  private waitForEditor = () => {
    if (this.destroyed) {
      return;
    }

    this.waitForEditorTimeout = null;
    const editor = getEditorFromState(this.view.state);
    if (!editor) {
      this.waitForEditorTimeout = setTimeout(this.waitForEditor, 0);
      return;
    }
    this.editor = editor;
    this.scheduleRecalculate();
  };

  private prepareDom() {
    this.contentContainer = document.createElement("div");
    this.contentContainer.classList.add(
      "bullet-plugin-list-lines-content-container",
    );

    this.scroller = document.createElement("div");
    this.scroller.classList.add("bullet-plugin-list-lines-scroller");

    this.scroller.appendChild(this.contentContainer);
    this.view.dom.appendChild(this.scroller);
  }

  private observeLayoutChanges() {
    if (typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(this.scheduleRecalculate);
      this.resizeObserver.observe(this.view.scrollDOM);
      this.resizeObserver.observe(this.view.contentDOM);

      const contentContainer = this.view.contentDOM.parentElement;
      if (contentContainer) {
        this.resizeObserver.observe(contentContainer);

        if (contentContainer.parentElement) {
          this.resizeObserver.observe(contentContainer.parentElement);
        }
      }
    }

    if (typeof MutationObserver === "function") {
      this.mutationObserver = new MutationObserver(this.scheduleRecalculate);
      const observerOptions = getVerticalLinesMutationObserverOptions();
      this.mutationObserver.observe(this.view.contentDOM, observerOptions);

      const contentContainer = this.view.contentDOM.parentElement;
      const sizer = contentContainer?.parentElement;
      if (sizer) {
        this.mutationObserver.observe(sizer, observerOptions);
      }
    }
  }

  private onScroll = (e: Event) => {
    const { scrollLeft, scrollTop } = e.target as HTMLElement;
    this.scroller.scrollTo(scrollLeft, scrollTop);
  };

  private scheduleRecalculate = () => {
    this.scheduler.schedule();
  };

  update(update: ViewUpdate) {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.geometryChanged ||
      update.transactions.some((tr) => tr.reconfigured)
    ) {
      this.scheduleRecalculate();
    }
  }

  private calculate = () => {
    this.lines = [];
    this.contentLeft = getVerticalLinesContentLeft(this.view);

    if (
      this.settings.verticalLines &&
      this.view.viewportLineBlocks.length > 0 &&
      this.view.visibleRanges.length > 0
    ) {
      const fromLine = this.editor.offsetToPos(this.view.viewport.from).line;
      const toLine = this.editor.offsetToPos(this.view.viewport.to).line;
      this.toLine = toLine;
      const lists = this.parser.parseRange(this.editor, fromLine, toLine);

      for (const list of lists) {
        this.lastLine = list.getContentEnd().line;

        for (const c of list.getChildren()) {
          this.recursive(c);
        }
      }

      this.lines.sort((a, b) =>
        a.top === b.top ? a.left - b.left : a.top - b.top,
      );
    }

    this.updateDom();
  };

  private getNextSibling(list: List): List | null {
    let listTmp = list;
    let p = listTmp.getParent();
    while (p) {
      const nextSibling = p.getNextSiblingOf(listTmp);
      if (nextSibling) {
        return nextSibling;
      }
      listTmp = p;
      p = listTmp.getParent();
    }
    return null;
  }

  private recursive(
    list: List,
    parentCtx: { rootLeft?: number; rootPadding?: number } = {},
  ) {
    const children = list.getChildren();

    if (children.length === 0) {
      return;
    }

    const fromOffset = this.editor.posToOffset({
      line: list.getFirstLineContentStart().line,
      ch: list.getFirstLineIndent().length,
    });
    const nextSibling = this.getNextSibling(list);
    const tillOffset = this.editor.posToOffset({
      line: nextSibling
        ? nextSibling.getFirstLineContentStart().line - 1
        : this.lastLine,
      ch: 0,
    });

    const visibleRange = this.getVisibleRange();
    if (!visibleRange) {
      return;
    }

    const { from: visibleFrom, to: visibleTo } = visibleRange;

    if (fromOffset > visibleTo || tillOffset < visibleFrom) {
      return;
    }

    const coords = this.view.coordsAtPos(fromOffset, 1);
    if (!coords) {
      return;
    }

    const line = this.getLineElementAt(fromOffset);
    const currentPadding = this.getLinePaddingStart(line);
    const currentX = this.getGuideX(list, line, fromOffset, coords);
    if (parentCtx.rootLeft === undefined) {
      parentCtx.rootLeft = currentX;
      parentCtx.rootPadding = currentPadding ?? 0;
    }
    const lineLayout = measureVerticalGuide({
      contentLeft: this.contentLeft,
      currentX,
      currentPadding,
      rootX: parentCtx.rootLeft,
      rootPadding: parentCtx.rootPadding ?? 0,
      hasCheckbox: list.hasCheckbox(),
    });

    const top = getVerticalLineTop(
      visibleFrom > 0 && fromOffset < visibleFrom,
      this.view.lineBlockAt(fromOffset).top,
    );
    const bottom =
      tillOffset > visibleTo
        ? this.view.lineBlockAt(visibleTo - 1).bottom
        : this.view.lineBlockAt(tillOffset).bottom;
    const height = bottom - top;
    const isClippedAtVisibleBottom =
      tillOffset > visibleTo || this.isRangeClippedAtVisibleBottom(nextSibling);

    if (height > 0 && !list.isFolded()) {
      const nextSibling = list.getParentOrThrow().getNextSiblingOf(list);
      const hasNextSibling =
        !!nextSibling &&
        this.editor.posToOffset(nextSibling.getFirstLineContentStart()) <=
          visibleTo;

      this.lines.push({
        top,
        left: lineLayout.left,
        width: lineLayout.width,
        height: getVerticalLineHeight(
          height,
          hasNextSibling,
          isClippedAtVisibleBottom,
        ),
        guideOffsetX: lineLayout.guideOffsetX,
        list,
      });
    }

    for (const child of children) {
      if (!child.isEmpty()) {
        this.recursive(child, parentCtx);
      }
    }
  }

  private onClick = (e: MouseEvent) => {
    e.preventDefault();

    const line = this.lines[Number((e.target as HTMLElement).dataset.index)];
    if (!line) {
      return;
    }

    switch (this.settings.verticalLinesAction) {
      case "toggle-folding":
        this.toggleFolding(line);
        break;
    }
  };

  private toggleFolding(line: LineData) {
    const { list } = line;

    if (list.isEmpty()) {
      return;
    }

    let needToUnfold = true;
    const linesToToggle: number[] = [];
    for (const c of list.getChildren()) {
      if (c.isEmpty()) {
        continue;
      }
      if (!c.isFolded()) {
        needToUnfold = false;
      }
      linesToToggle.push(c.getFirstLineContentStart().line);
    }

    const editor = getEditorFromState(this.view.state);
    if (!editor) {
      return;
    }

    for (const l of linesToToggle) {
      if (needToUnfold) {
        editor.unfold(l);
      } else {
        editor.fold(l);
      }
    }
  }

  private updateDom() {
    const cmScroll = this.view.scrollDOM;
    const cmContent = this.view.contentDOM;
    const cmContentContainer = cmContent.parentElement;
    if (!cmContentContainer) {
      return;
    }

    const cmSizer = cmContentContainer.parentElement;
    if (!cmSizer || !(cmContent.firstElementChild instanceof HTMLElement)) {
      return;
    }

    /**
     * Obsidian can add additional elements into Content Manager.
     * The most obvious case is the 'embedded-backlinks' core plugin that adds a menu inside a Content Manager.
     * We must take heights of all of these elements into account
     * to be able to calculate the correct size of lines' container.
     */
    let cmSizerChildrenSumHeight = 0;
    for (let i = 0; i < cmSizer.children.length; i++) {
      const child = cmSizer.children[i];
      if (child) {
        cmSizerChildrenSumHeight += child.clientHeight;
      }
    }

    this.scroller.style.top = cmScroll.offsetTop + "px";
    this.contentContainer.style.height = cmSizerChildrenSumHeight + "px";
    this.contentContainer.style.marginLeft =
      getVerticalLinesContentLeft(this.view) + "px";
    this.contentContainer.style.marginTop =
      cmContent.firstElementChild.offsetTop - CONTENT_TOP_OFFSET + "px";

    for (let i = 0; i < this.lines.length; i++) {
      if (this.lineElements.length === i) {
        const e = document.createElement("div");
        e.classList.add("bullet-plugin-list-line");
        e.dataset.index = String(i);
        e.addEventListener("mousedown", this.onClick);
        this.contentContainer.appendChild(e);
        this.lineElements.push(e);
      }

      const l = this.lines[i];
      const e = this.lineElements[i];
      if (!l || !e) {
        continue;
      }

      applyVerticalLineElementStyle(e, {
        top: l.top + "px",
        left: l.left + "px",
        width: l.width + "px",
        height: l.height,
        guideOffsetX: `${l.guideOffsetX}px`,
        display: "block",
      });
    }

    for (let i = this.lines.length; i < this.lineElements.length; i++) {
      const e = this.lineElements[i];
      if (!e) {
        continue;
      }

      applyVerticalLineElementStyle(e, {
        top: "0px",
        left: "0px",
        width: "5px",
        height: "0px",
        guideOffsetX: e.style.getPropertyValue("--bullet-guide-offset-x"),
        display: "none",
      });
    }
  }

  destroy() {
    this.destroyed = true;
    this.settings.removeCallback(this.scheduleRecalculate);
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.view.dom.removeChild(this.scroller);
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    this.scheduler.cancel();
    if (this.waitForEditorTimeout !== null) {
      clearTimeout(this.waitForEditorTimeout);
      this.waitForEditorTimeout = null;
    }
  }

  private getGuideX(
    list: List,
    line: HTMLElement | null,
    fromOffset: number,
    coords: Pick<DOMRect, "right">,
  ) {
    const scrollerLeft = this.view.scrollDOM.getBoundingClientRect().left;
    const scrollLeft = this.view.scrollDOM.scrollLeft;

    if (list.hasCheckbox()) {
      const checkbox = line?.querySelector(".task-list-item-checkbox");
      if (checkbox instanceof HTMLElement) {
        const rect = checkbox.getBoundingClientRect();
        return rect.left - scrollerLeft + scrollLeft + rect.width / 2;
      }
    }

    return coords.right - scrollerLeft + scrollLeft;
  }

  private getVisibleRange(): { from: number; to: number } | null {
    const first = this.view.visibleRanges[0];
    const last = this.view.visibleRanges[this.view.visibleRanges.length - 1];
    if (!first || !last) {
      return null;
    }

    return {
      from: first.from,
      to: last.to,
    };
  }

  private isRangeClippedAtVisibleBottom(nextSibling: List | null) {
    if (nextSibling || this.lastLine !== this.toLine) {
      return false;
    }

    const nextLine = this.toLine + 1;
    if (nextLine > this.editor.lastLine()) {
      return false;
    }

    return /^[ \t]*(?:[-*+]|\d+\.)( |\t)|^[ \t]+/.test(
      this.editor.getLine(nextLine),
    );
  }

  private getLinePaddingStart(line: HTMLElement | null): number | null {
    if (!line) {
      return null;
    }

    const padding = line.style.paddingInlineStart || line.style.paddingLeft;
    if (padding) {
      return Number.parseFloat(padding);
    }

    const computedPadding = window.getComputedStyle(line).paddingInlineStart;
    return computedPadding ? Number.parseFloat(computedPadding) : null;
  }

  private getLineElementAt(offset: number): HTMLElement | null {
    const domAtPos = this.view.domAtPos(offset);
    let node: Node | null = domAtPos.node;

    while (node) {
      if (node instanceof HTMLElement && node.classList.contains("cm-line")) {
        return node;
      }
      node = node.parentNode;
    }

    return null;
  }
}

export class VerticalLines implements Feature {
  private updateBodyClassInterval: number | null = null;

  constructor(
    private plugin: Plugin,
    private settings: Settings,
    private parser: Parser,
  ) {}

  async load() {
    this.updateBodyClass();
    this.updateBodyClassInterval = window.setInterval(() => {
      this.updateBodyClass();
    }, 1000);

    this.plugin.registerEditorExtension(
      ViewPlugin.define(
        (view) =>
          new VerticalLinesPluginValue(this.settings, this.parser, view),
      ),
    );
  }

  async unload() {
    if (this.updateBodyClassInterval !== null) {
      clearInterval(this.updateBodyClassInterval);
      this.updateBodyClassInterval = null;
    }
    document.body.classList.remove(VERTICAL_LINES_BODY_CLASS);
  }

  private updateBodyClass = () => {
    const shouldExists = this.settings.verticalLines;
    const exists = document.body.classList.contains(VERTICAL_LINES_BODY_CLASS);

    if (shouldExists && !exists) {
      document.body.classList.add(VERTICAL_LINES_BODY_CLASS);
    }

    if (!shouldExists && exists) {
      document.body.classList.remove(VERTICAL_LINES_BODY_CLASS);
    }
  };
}
