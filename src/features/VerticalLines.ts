import { Plugin } from "obsidian";

import {
  EditorView,
  PluginValue,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";

import { DocumentBodyClass } from "./DocumentBodyClass";
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
const LIST_BLOCK_LINE_RE = /^[ \t]*(?:[-*+]|\d+\.)( |\t)|^[ \t]+/;

interface LineData {
  top: number;
  left: number;
  width: number;
  height: string;
  guideOffsetX: number;
  list: List;
}

interface GuideMeasurement {
  currentX: number;
  currentPadding: number | null;
}

export function resolveVerticalGuideTarget(
  list: List,
  guides: readonly Element[],
  pressedGuide: Element,
): List | null {
  const pressedIndex = guides.indexOf(pressedGuide);
  if (pressedIndex < 0) {
    return null;
  }

  const ancestors: List[] = [];
  for (
    let ancestor = list.getParent();
    ancestor?.getParent();
    ancestor = ancestor.getParent()
  ) {
    ancestors.unshift(ancestor);
  }

  const ancestorIndex = pressedIndex - (guides.length - ancestors.length);
  return ancestorIndex >= 0 ? (ancestors[ancestorIndex] ?? null) : null;
}

export function toggleVerticalGuideTarget(
  editor: Pick<MyEditor, "fold" | "unfold">,
  list: List,
) {
  const children = list.getChildren().filter((child) => !child.isEmpty());
  if (children.length === 0) {
    return false;
  }

  const shouldUnfold = children.every((child) => child.isFolded());
  for (const child of children) {
    const line = child.getFirstLineContentStart().line;
    if (shouldUnfold) {
      editor.unfold(line);
    } else {
      editor.fold(line);
    }
  }

  return true;
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
  private guideMeasurements = new Map<string, GuideMeasurement>();
  private scheduler: ReturnType<typeof createAnimationFrameScheduler>;
  private resizeObserver?: ResizeObserver;
  private mutationObserver?: MutationObserver;
  private waitForEditorTimeout: number | null = null;
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
      this.waitForEditorTimeout = window.setTimeout(this.waitForEditor, 0);
      return;
    }
    this.editor = editor;
    this.scheduleRecalculate();
  };

  private prepareDom() {
    const doc = this.view.dom.ownerDocument ?? activeDocument;

    this.contentContainer = doc.createElement("div");
    this.contentContainer.classList.add(
      "bullet-plugin-list-lines-content-container",
    );

    this.scroller = doc.createElement("div");
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
    this.scroller.scrollLeft = scrollLeft;
    this.scroller.scrollTop = scrollTop;
    this.scheduleRecalculate();
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
      const visibleFromLine = this.editor.offsetToPos(
        this.view.viewport.from,
      ).line;
      const fromLine = this.getListBlockStartLine(visibleFromLine);
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

    const measurementOffset =
      fromOffset < visibleFrom ? visibleFrom : fromOffset;
    const guideMeasurementKey = this.getGuideMeasurementKey(list);
    const cachedGuideMeasurement =
      this.guideMeasurements.get(guideMeasurementKey);
    const startCoords = this.view.coordsAtPos(fromOffset, 1);
    const shouldPreferCachedClippedMeasurement =
      fromOffset < visibleFrom && !startCoords && !!cachedGuideMeasurement;
    const coords = shouldPreferCachedClippedMeasurement
      ? null
      : (startCoords ??
        (measurementOffset !== fromOffset
          ? this.view.coordsAtPos(measurementOffset, 1)
          : null));

    const line = this.getLineElementAt(measurementOffset);
    const currentPadding = this.getLinePaddingStart(line);
    const currentX = shouldPreferCachedClippedMeasurement
      ? null
      : this.getGuideX(list, line, measurementOffset, coords, currentPadding);
    const guideMeasurement =
      currentX === null ? cachedGuideMeasurement : { currentX, currentPadding };

    if (guideMeasurement && height > 0 && !list.isFolded()) {
      this.guideMeasurements.set(guideMeasurementKey, guideMeasurement);
      if (parentCtx.rootLeft === undefined) {
        parentCtx.rootLeft = guideMeasurement.currentX;
        parentCtx.rootPadding = guideMeasurement.currentPadding ?? 0;
      }
      const lineLayout = measureVerticalGuide({
        contentLeft: this.contentLeft,
        currentX: guideMeasurement.currentX,
        currentPadding: guideMeasurement.currentPadding,
        rootX: parentCtx.rootLeft,
        rootPadding: parentCtx.rootPadding ?? 0,
        hasCheckbox: list.hasCheckbox(),
      });
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
    const firstElementChild = cmContent.firstElementChild;
    if (!cmSizer || !isInstanceOf(firstElementChild, HTMLElement)) {
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

    this.scroller.setCssStyles({ top: cmScroll.offsetTop + "px" });
    const overlayScrollHeight = Math.max(
      cmSizerChildrenSumHeight,
      cmScroll.scrollHeight,
    );

    this.contentContainer.setCssStyles({
      height: overlayScrollHeight + "px",
      marginLeft: this.contentLeft + "px",
      marginTop: firstElementChild.offsetTop - CONTENT_TOP_OFFSET + "px",
    });

    for (let i = 0; i < this.lines.length; i++) {
      if (this.lineElements.length === i) {
        const e = (this.view.dom.ownerDocument ?? activeDocument).createElement(
          "div",
        );
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
      window.clearTimeout(this.waitForEditorTimeout);
      this.waitForEditorTimeout = null;
    }
  }

  private getGuideX(
    list: List,
    line: HTMLElement | null,
    fromOffset: number,
    coords: Pick<DOMRect, "right"> | null,
    currentPadding: number | null,
  ) {
    const scrollerLeft = this.view.scrollDOM.getBoundingClientRect().left;
    const scrollLeft = this.view.scrollDOM.scrollLeft;

    if (list.hasCheckbox()) {
      const checkbox = line?.querySelector(".task-list-item-checkbox");
      if (isInstanceOf(checkbox, HTMLElement)) {
        const rect = checkbox.getBoundingClientRect();
        return rect.left - scrollerLeft + scrollLeft + rect.width / 2;
      }
    }

    if (coords) {
      return coords.right - scrollerLeft + scrollLeft;
    }

    if (currentPadding !== null) {
      return this.contentLeft + currentPadding;
    }

    return null;
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

  private getListBlockStartLine(fromLine: number) {
    let line = fromLine;

    while (line > 0 && this.isListBlockLine(line - 1)) {
      line--;
    }

    return line;
  }

  private isListBlockLine(line: number) {
    return LIST_BLOCK_LINE_RE.test(this.editor.getLine(line));
  }

  private getGuideMeasurementKey(list: List) {
    const firstLineContentStart = list.getFirstLineContentStart();
    return `${firstLineContentStart.line}:${list.getFirstLineIndent()}:${list.hasCheckbox()}`;
  }

  private getLinePaddingStart(line: HTMLElement | null): number | null {
    if (!line) {
      return null;
    }

    const padding = line.style.paddingInlineStart || line.style.paddingLeft;
    if (padding) {
      return Number.parseFloat(padding);
    }

    const computedPadding = line.win.getComputedStyle(line).paddingInlineStart;
    return computedPadding ? Number.parseFloat(computedPadding) : null;
  }

  private getLineElementAt(offset: number): HTMLElement | null {
    const domAtPos = this.view.domAtPos(offset);
    let node: Node | null = domAtPos.node;

    while (node) {
      if (
        isInstanceOf(node, HTMLElement) &&
        node.classList.contains("cm-line")
      ) {
        return node;
      }
      node = node.parentNode;
    }

    return null;
  }
}

interface InstanceOfCapable {
  instanceOf<T>(type: { new (): T }): this is T;
}

function hasInstanceOf(value: unknown): value is InstanceOfCapable {
  return (
    typeof value === "object" &&
    value !== null &&
    "instanceOf" in value &&
    typeof value.instanceOf === "function"
  );
}

function isInstanceOf<T>(value: unknown, type: { new (): T }): value is T {
  if (!value) {
    return false;
  }

  if (hasInstanceOf(value)) {
    return value.instanceOf(type);
  }

  const hasInstance = type[Symbol.hasInstance];
  return (
    typeof hasInstance === "function" && Boolean(hasInstance.call(type, value))
  );
}

export class VerticalLines implements Feature {
  private bodyClass: DocumentBodyClass;

  constructor(
    private plugin: Plugin,
    private settings: Settings,
    private parser: Parser,
  ) {
    this.bodyClass = new DocumentBodyClass(
      this.plugin,
      VERTICAL_LINES_BODY_CLASS,
      this.shouldApplyBodyClass,
    );
  }

  async load() {
    this.settings.onChange(this.updateBodyClass);
    this.updateBodyClass();
    this.bodyClass.load();

    this.plugin.registerEditorExtension(
      ViewPlugin.define(
        (view) =>
          new VerticalLinesPluginValue(this.settings, this.parser, view),
      ),
    );
  }

  async unload() {
    this.settings.removeCallback(this.updateBodyClass);
    this.bodyClass.unload();
  }

  private updateBodyClass = () => {
    this.bodyClass.update();
  };

  private shouldApplyBodyClass = () => {
    return this.settings.verticalLines;
  };
}
