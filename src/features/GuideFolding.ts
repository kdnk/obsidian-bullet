import {
  foldEffect,
  foldable,
  foldedRanges,
  unfoldEffect,
} from "@codemirror/language";
import { Extension, Range, Text } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  PluginValue,
  ViewUpdate,
  WidgetType,
  scrollPastEnd,
} from "@codemirror/view";

import {
  ensureFoldScrollReserve,
  stableFoldScrollSnapshot,
} from "./FoldScroll";

import { MyEditorPosition, getEditorFromState } from "../editor";
import { getObsidianDomWindow } from "../obsidianDom";
import { List, Root } from "../root";
import { Parser, Reader } from "../services/Parser";
import { Settings } from "../services/Settings";

const INDENT_GUIDE_SELECTOR = ".cm-indent";
const INDENT_CONTAINER_SELECTOR = ".cm-hmd-list-indent";
const LINE_SELECTOR = ".cm-line";
const PERSISTENT_GUIDE_MARKER = "bullet-plugin-persistent-indent-guide";
const PERSISTENT_GUIDE_SELECTOR = `.${PERSISTENT_GUIDE_MARKER}`;
const PERSISTENT_GUIDE_CANDIDATE_SELECTOR =
  ".cm-hmd-list-indent > .cm-indent-spacing:not(.cm-indent)";
const HOVERED_GUIDE_MARKER = "bullet-plugin-hovered-indent-guide";
const HOVERED_GUIDE_SELECTOR = `.${HOVERED_GUIDE_MARKER}`;
const HOVERED_GUIDE_START_MARKER = "bullet-plugin-hovered-indent-guide-start";
const HOVERED_GUIDE_START_SELECTOR = `.${HOVERED_GUIDE_START_MARKER}`;
const HOVERED_GUIDE_END_MARKER = "bullet-plugin-hovered-indent-guide-end";
const HOVERED_GUIDE_END_SELECTOR = `.${HOVERED_GUIDE_END_MARKER}`;
const HOVERED_GUIDE_CANDIDATE_SELECTOR =
  `${INDENT_GUIDE_SELECTOR}:hover, ` +
  ".cm-hmd-list-indent > .cm-indent-spacing:hover";
const RENDERED_GUIDE_CANDIDATE_SELECTOR =
  ".cm-hmd-list-indent > .cm-indent, " +
  ".cm-hmd-list-indent > .cm-indent-spacing";
const OUTER_LIST_GUIDE_CLASS = "bullet-plugin-outer-list-guide";
const OUTER_LIST_GUIDE_SELECTOR = `.${OUTER_LIST_GUIDE_CLASS}`;
const HOVERED_OUTER_LIST_GUIDE_CLASS = "bullet-plugin-hovered-outer-list-guide";
const HOVERED_OUTER_LIST_GUIDE_SELECTOR = `.${HOVERED_OUTER_LIST_GUIDE_CLASS}`;
const HOVERED_OUTER_LIST_GUIDE_START_CLASS =
  "bullet-plugin-hovered-outer-list-guide-start";
const HOVERED_OUTER_LIST_GUIDE_START_SELECTOR = `.${HOVERED_OUTER_LIST_GUIDE_START_CLASS}`;
const HOVERED_OUTER_LIST_GUIDE_END_CLASS =
  "bullet-plugin-hovered-outer-list-guide-end";
const HOVERED_OUTER_LIST_GUIDE_END_SELECTOR = `.${HOVERED_OUTER_LIST_GUIDE_END_CLASS}`;
const CHUNK_LINE_ATTRIBUTE_RE = /^(0|[1-9]\d*)$/;

export const GUIDE_FOLDING_SCROLL_PAST_END_EXTENSION: Extension =
  scrollPastEnd();

type HoverMeasurement = {
  indentGuides: Element[];
  outerGuides: Element[];
};

interface OuterListChunk {
  root: Root;
  startLine: number;
  endLine: number;
  id: string;
  actionable: boolean;
}

interface GuideFoldTarget {
  line: number;
  fallbackCursor: MyEditorPosition;
}

class OuterListGuideWidget extends WidgetType {
  constructor(
    private chunk: Pick<
      OuterListChunk,
      "id" | "startLine" | "endLine" | "actionable"
    >,
  ) {
    super();
  }

  eq(other: WidgetType) {
    return (
      other instanceof OuterListGuideWidget &&
      this.chunk.id === other.chunk.id &&
      this.chunk.actionable === other.chunk.actionable
    );
  }

  toDOM(view: EditorView) {
    const element = getObsidianDomWindow(view.dom.ownerDocument).createSpan();
    element.className = OUTER_LIST_GUIDE_CLASS;
    element.dataset.chunkId = this.chunk.id;
    element.dataset.chunkStart = String(this.chunk.startLine);
    element.dataset.chunkEnd = String(this.chunk.endLine);
    element.dataset.actionable = String(this.chunk.actionable);
    element.setAttribute("aria-hidden", "true");
    return element;
  }

  ignoreEvent() {
    return false;
  }
}

function collectHoveredOuterListGuides(contentDOM: ParentNode) {
  const hovered = contentDOM.querySelector<HTMLElement>(
    `${OUTER_LIST_GUIDE_SELECTOR}[data-actionable="true"]:hover`,
  );
  const chunkId = hovered?.dataset.chunkId;
  if (hovered?.dataset.actionable !== "true" || !chunkId) return [];

  return Array.from(
    contentDOM.querySelectorAll<HTMLElement>(OUTER_LIST_GUIDE_SELECTOR),
  ).filter((element) => element.dataset.chunkId === chunkId);
}

function synchronizeHoveredOuterListGuides(
  contentDOM: ParentNode,
  guides: Iterable<Element>,
) {
  synchronizeHoverMarkers(
    contentDOM,
    guides,
    HOVERED_OUTER_LIST_GUIDE_CLASS,
    HOVERED_OUTER_LIST_GUIDE_SELECTOR,
    HOVERED_OUTER_LIST_GUIDE_START_CLASS,
    HOVERED_OUTER_LIST_GUIDE_START_SELECTOR,
    HOVERED_OUTER_LIST_GUIDE_END_CLASS,
    HOVERED_OUTER_LIST_GUIDE_END_SELECTOR,
  );
}

function synchronizeHoverMarkers(
  contentDOM: ParentNode,
  guides: Iterable<Element>,
  marker: string,
  markerSelector: string,
  startMarker: string,
  startSelector: string,
  endMarker: string,
  endSelector: string,
) {
  const ordered = Array.from(guides);
  const next = new Set(ordered);

  for (const element of Array.from(
    contentDOM.querySelectorAll(startSelector),
  )) {
    element.classList.remove(startMarker);
  }
  for (const element of Array.from(contentDOM.querySelectorAll(endSelector))) {
    element.classList.remove(endMarker);
  }
  for (const element of Array.from(
    contentDOM.querySelectorAll(markerSelector),
  )) {
    if (!next.has(element)) {
      element.classList.remove(marker);
    }
  }
  for (const element of ordered) {
    element.classList.add(marker);
  }
  ordered[0]?.classList.add(startMarker);
  ordered[ordered.length - 1]?.classList.add(endMarker);
}

function buildOuterListGuideDecorations(
  doc: Text,
  chunks: readonly OuterListChunk[],
) {
  const ranges: Range<Decoration>[] = [];
  for (const chunk of chunks) {
    for (let line = chunk.startLine; line <= chunk.endLine; line++) {
      ranges.push(
        Decoration.widget({
          widget: new OuterListGuideWidget(chunk),
          side: -1,
        }).range(doc.line(line + 1).from),
      );
    }
  }
  return Decoration.set(ranges, true);
}

function collectOuterListChunks(
  parser: Parser,
  editor: Reader,
): OuterListChunk[] {
  const roots: Root[] = [];
  let segmentStart = 0;

  const appendSegment = (segmentEnd: number) => {
    if (segmentStart <= segmentEnd) {
      roots.push(...parser.parseRange(editor, segmentStart, segmentEnd));
    }
  };

  for (let line = 0; line <= editor.lastLine(); line++) {
    if (editor.getLine(line).trim().length > 0) continue;
    appendSegment(line - 1);
    segmentStart = line + 1;
  }
  appendSegment(editor.lastLine());

  return roots.map((root) => {
    const startLine = root.getContentStart().line;
    const endLine = root.getContentEnd().line;
    return {
      root,
      startLine,
      endLine,
      id: `${startLine}:${endLine}`,
      actionable: isOuterListChunkActionable(root),
    };
  });
}

function isFoldableTopLevelList(list: List) {
  return list.getLineCount() > 1 || !list.isEmpty();
}

function isOuterListChunkActionable(root: Root) {
  return root.getChildren().some(isFoldableTopLevelList);
}

function foldInside(view: EditorView, from: number, to: number) {
  let found: { from: number; to: number } | null = null;
  foldedRanges(view.state).between(from, to, (from, to) => {
    if (!found || found.from > from) found = { from, to };
  });
  return found;
}

function setGuideTargetsFolded(
  view: EditorView,
  targets: readonly GuideFoldTarget[],
  folded: boolean,
): boolean {
  const resolved: Array<{
    range: { from: number; to: number };
    target: GuideFoldTarget;
  }> = [];
  for (const target of targets) {
    const line = view.lineBlockAt(view.state.doc.line(target.line + 1).from);
    const range = folded
      ? foldable(view.state, line.from, line.to)
      : foldInside(view, line.from, line.to);

    if (range && range.from !== range.to) {
      resolved.push({ range, target });
    }
  }

  if (resolved.length === 0) {
    return false;
  }

  ensureFoldScrollReserve(view);
  const effects = [
    stableFoldScrollSnapshot(view),
    ...resolved.map(({ range }) =>
      (folded ? foldEffect : unfoldEffect).of(range),
    ),
  ];
  const selectionHead = view.state.selection.main.head;
  const selectedTarget = folded
    ? resolved.find(
        ({ range }) => range.from < selectionHead && selectionHead < range.to,
      )
    : undefined;

  if (selectedTarget) {
    const fallbackCursor = selectedTarget.target.fallbackCursor;
    const fallbackLine = view.state.doc.line(fallbackCursor.line + 1);
    const fallbackOffset = Math.min(
      fallbackLine.from + fallbackCursor.ch,
      fallbackLine.to,
    );
    view.dispatch({
      selection: { anchor: fallbackOffset, head: fallbackOffset },
      effects,
    });
  } else {
    view.dispatch({ effects });
  }

  return true;
}

function toggleOuterListChunk(view: EditorView, root: Root) {
  const targets = root.getChildren().filter(isFoldableTopLevelList);
  if (targets.length === 0) return false;

  const shouldUnfold = targets.every((target) => target.isFolded());
  return setGuideTargetsFolded(
    view,
    targets.map((target) => {
      const fallbackCursor = target.getFirstLineContentStart();
      return { line: fallbackCursor.line, fallbackCursor };
    }),
    !shouldUnfold,
  );
}

function synchronizePersistentIndentGuides(
  contentDOM: ParentNode,
  enabled: boolean,
) {
  if (enabled) {
    for (const element of Array.from(
      contentDOM.querySelectorAll(PERSISTENT_GUIDE_CANDIDATE_SELECTOR),
    )) {
      element.classList.add("cm-indent", PERSISTENT_GUIDE_MARKER);
    }
    return;
  }

  for (const element of Array.from(
    contentDOM.querySelectorAll(PERSISTENT_GUIDE_SELECTOR),
  )) {
    element.classList.remove("cm-indent", PERSISTENT_GUIDE_MARKER);
  }
}

function getGuideIndentPrefix(pressedGuide: Element): string | null {
  const indentContainer = pressedGuide.parentElement;
  if (!indentContainer?.matches(INDENT_CONTAINER_SELECTOR)) {
    return null;
  }

  let prefix = "";
  for (const child of Array.from(indentContainer.childNodes)) {
    if (child === pressedGuide) {
      return prefix;
    }
    prefix += child.textContent ?? "";
  }

  return null;
}

function resolveVerticalGuideTarget(
  list: List,
  pressedGuide: Element,
): List | null {
  const indentPrefix = getGuideIndentPrefix(pressedGuide);
  if (indentPrefix === null) {
    return null;
  }

  let ancestor = list.getParent();
  while (ancestor?.getParent()) {
    if (ancestor.getFirstLineIndent() === indentPrefix) {
      return ancestor;
    }
    ancestor = ancestor.getParent();
  }

  return null;
}

function hasSameListStart(left: List, right: List) {
  const leftStart = left.getFirstLineContentStart();
  const rightStart = right.getFirstLineContentStart();
  return leftStart.line === rightStart.line && leftStart.ch === rightStart.ch;
}

function collectVerticalGuideGroup(
  hoveredGuide: Element,
  guides: Iterable<Element>,
  getListForGuide: (guide: Element) => List | null,
): Element[] {
  const hoveredList = getListForGuide(hoveredGuide);
  const hoveredTarget = hoveredList
    ? resolveVerticalGuideTarget(hoveredList, hoveredGuide)
    : null;
  if (!hoveredTarget) {
    return [];
  }

  return Array.from(guides).filter((guide) => {
    const list = getListForGuide(guide);
    const target = list ? resolveVerticalGuideTarget(list, guide) : null;
    return target ? hasSameListStart(target, hoveredTarget) : false;
  });
}

function synchronizeHoveredIndentGuides(
  contentDOM: ParentNode,
  highlightedGuides: Iterable<Element>,
) {
  synchronizeHoverMarkers(
    contentDOM,
    highlightedGuides,
    HOVERED_GUIDE_MARKER,
    HOVERED_GUIDE_SELECTOR,
    HOVERED_GUIDE_START_MARKER,
    HOVERED_GUIDE_START_SELECTOR,
    HOVERED_GUIDE_END_MARKER,
    HOVERED_GUIDE_END_SELECTOR,
  );
}

function toggleVerticalGuideTarget(view: EditorView, list: List) {
  const children = list.getChildren().filter((child) => !child.isEmpty());
  if (children.length === 0) {
    return false;
  }

  const shouldUnfold = children.every((child) => child.isFolded());
  return setGuideTargetsFolded(
    view,
    children.map((child) => {
      const fallbackCursor = child.getFirstLineContentStart();
      return { line: fallbackCursor.line, fallbackCursor };
    }),
    !shouldUnfold,
  );
}

function isVerticalGuideTargetActionable(list: List) {
  return list.getChildren().some((child) => !child.isEmpty());
}

export class GuideFoldingPluginValue implements PluginValue {
  decorations: DecorationSet;

  private destroyed = false;
  private lastOuterVisibility: boolean;
  private lastPointerGuide: Element | null = null;
  private measureKey = {};

  constructor(
    private settings: Settings,
    private parser: Parser,
    private view: EditorView,
  ) {
    this.lastOuterVisibility = this.outerVisibility();
    this.decorations = this.buildOuterDecorations();
    this.view.contentDOM.addEventListener("mousedown", this.onMouseDown, true);
    this.view.contentDOM.addEventListener("click", this.onClick, true);
    this.view.contentDOM.addEventListener(
      "pointermove",
      this.onPointerMove,
      true,
    );
    this.view.contentDOM.addEventListener(
      "pointerleave",
      this.onPointerLeave,
      true,
    );
    this.settings.onChange(
      ["outerListLines", "listLineAction"],
      this.onSettingsChange,
    );
    this.scheduleGuideSynchronization();
  }

  update(update: ViewUpdate) {
    if (update.docChanged) {
      this.decorations = this.buildOuterDecorations();
    }
    this.scheduleGuideSynchronization();
  }

  private handleMouseDown(event: MouseEvent) {
    return this.handleGuideInteraction(event, false);
  }

  private handleClick(event: MouseEvent) {
    return this.handleGuideInteraction(event, true);
  }

  private handleGuideInteraction(event: MouseEvent, shouldToggle: boolean) {
    if (!this.interactionEnabled()) {
      return false;
    }

    const pressedGuide = event.target;
    if (!isElementLike(pressedGuide)) {
      return false;
    }

    if (pressedGuide.matches(OUTER_LIST_GUIDE_SELECTOR)) {
      if (
        !this.settings.outerVerticalLines ||
        pressedGuide.getAttribute("data-actionable") !== "true"
      ) {
        return false;
      }
      const startAttribute = pressedGuide.getAttribute("data-chunk-start");
      const endAttribute = pressedGuide.getAttribute("data-chunk-end");
      if (
        startAttribute === null ||
        endAttribute === null ||
        !CHUNK_LINE_ATTRIBUTE_RE.test(startAttribute) ||
        !CHUNK_LINE_ATTRIBUTE_RE.test(endAttribute)
      ) {
        return false;
      }
      const startLine = Number(startAttribute);
      const endLine = Number(endAttribute);
      const editor = getEditorFromState(this.view.state);
      if (!editor) {
        return false;
      }
      if (
        !Number.isInteger(startLine) ||
        !Number.isInteger(endLine) ||
        startLine < 0 ||
        endLine < startLine ||
        endLine > editor.lastLine()
      ) {
        return false;
      }
      const roots = this.parser.parseRange(editor, startLine, endLine);
      if (roots.length !== 1) {
        return false;
      }
      const root = roots[0];
      if (
        !root ||
        root.getContentStart().line !== startLine ||
        root.getContentEnd().line !== endLine ||
        !isOuterListChunkActionable(root) ||
        (shouldToggle && !toggleOuterListChunk(this.view, root))
      ) {
        return false;
      }
      event.preventDefault();
      return true;
    }

    if (!pressedGuide.matches(INDENT_GUIDE_SELECTOR)) {
      return false;
    }

    const lineElement = pressedGuide.closest(LINE_SELECTOR);
    if (!lineElement) {
      return false;
    }

    const editor = getEditorFromState(this.view.state);
    if (!editor) {
      return false;
    }

    let offset: number;
    try {
      offset = this.view.posAtDOM(lineElement);
    } catch {
      return false;
    }

    const line = this.view.state.doc.lineAt(offset).number - 1;
    const root = this.parser.parse(editor, { line, ch: 0 });
    const list = root?.getListUnderLine(line);
    if (!list) {
      return false;
    }

    const target = resolveVerticalGuideTarget(list, pressedGuide);
    if (
      !target ||
      !isVerticalGuideTargetActionable(target) ||
      (shouldToggle && !toggleVerticalGuideTarget(this.view, target))
    ) {
      return false;
    }

    event.preventDefault();
    return true;
  }

  destroy() {
    this.destroyed = true;
    this.view.contentDOM.removeEventListener(
      "mousedown",
      this.onMouseDown,
      true,
    );
    this.view.contentDOM.removeEventListener("click", this.onClick, true);
    this.view.contentDOM.removeEventListener(
      "pointermove",
      this.onPointerMove,
      true,
    );
    this.view.contentDOM.removeEventListener(
      "pointerleave",
      this.onPointerLeave,
      true,
    );
    this.settings.removeCallback(this.onSettingsChange);
    synchronizeHoveredIndentGuides(this.view.contentDOM, []);
    synchronizeHoveredOuterListGuides(this.view.contentDOM, []);
    synchronizePersistentIndentGuides(this.view.contentDOM, false);
  }

  private onMouseDown = (event: MouseEvent) => {
    if (this.handleMouseDown(event)) {
      event.stopPropagation();
    }
  };

  private onClick = (event: MouseEvent) => {
    if (this.handleClick(event)) {
      event.stopPropagation();
    }
  };

  private interactionEnabled() {
    return this.settings.verticalLinesAction === "toggle-folding";
  }

  private outerInteractionEnabled() {
    return this.interactionEnabled() && this.settings.outerVerticalLines;
  }

  private getLineForGuide(guide: Element): number | null {
    const lineElement = guide.closest(LINE_SELECTOR);
    if (!lineElement) {
      return null;
    }
    try {
      const offset = this.view.posAtDOM(lineElement);
      return this.view.state.doc.lineAt(offset).number - 1;
    } catch {
      return null;
    }
  }

  private getListForGuide(root: Root, guide: Element) {
    const line = this.getLineForGuide(guide);
    return line === null ? null : root.getListUnderLine(line);
  }

  private readHoveredIndentGuideGroup(): Element[] {
    if (!this.interactionEnabled()) return [];
    const hoveredGuide = this.view.contentDOM.querySelector(
      HOVERED_GUIDE_CANDIDATE_SELECTOR,
    );
    if (!hoveredGuide) {
      return [];
    }
    const hoveredLine = this.getLineForGuide(hoveredGuide);
    const editor = getEditorFromState(this.view.state);
    if (hoveredLine === null || !editor) {
      return [];
    }
    const root = this.parser.parse(editor, { line: hoveredLine, ch: 0 });
    if (!root) {
      return [];
    }
    return collectVerticalGuideGroup(
      hoveredGuide,
      Array.from(
        this.view.contentDOM.querySelectorAll(
          RENDERED_GUIDE_CANDIDATE_SELECTOR,
        ),
      ),
      (guide) => this.getListForGuide(root, guide),
    );
  }

  private readHoverMeasurement(): HoverMeasurement {
    return {
      indentGuides: this.readHoveredIndentGuideGroup(),
      outerGuides: this.outerInteractionEnabled()
        ? collectHoveredOuterListGuides(this.view.contentDOM)
        : [],
    };
  }

  private onPointerMove = (event: PointerEvent) => {
    const guide =
      isElementLike(event.target) &&
      (event.target.matches(INDENT_GUIDE_SELECTOR) ||
        (event.target.matches(OUTER_LIST_GUIDE_SELECTOR) &&
          event.target.getAttribute("data-actionable") === "true"))
        ? event.target
        : null;
    if (!guide) {
      this.lastPointerGuide = null;
      synchronizeHoveredIndentGuides(this.view.contentDOM, []);
      synchronizeHoveredOuterListGuides(this.view.contentDOM, []);
      return;
    }
    if (guide === this.lastPointerGuide) return;
    this.lastPointerGuide = guide;
    this.scheduleGuideSynchronization();
  };

  private onPointerLeave = () => {
    this.lastPointerGuide = null;
    synchronizeHoveredIndentGuides(this.view.contentDOM, []);
    synchronizeHoveredOuterListGuides(this.view.contentDOM, []);
  };

  private onSettingsChange = () => {
    const outerVisibility = this.outerVisibility();
    if (outerVisibility !== this.lastOuterVisibility) {
      this.lastOuterVisibility = outerVisibility;
      this.decorations = this.buildOuterDecorations();
      this.view.dispatch({});
    }
    if (!this.interactionEnabled()) {
      this.lastPointerGuide = null;
      synchronizeHoveredIndentGuides(this.view.contentDOM, []);
    }
    if (!this.outerInteractionEnabled()) {
      synchronizeHoveredOuterListGuides(this.view.contentDOM, []);
    }
    this.scheduleGuideSynchronization();
  };

  private outerVisibility() {
    return this.settings.outerVerticalLines;
  }

  private buildOuterDecorations() {
    if (!this.settings.outerVerticalLines) {
      return Decoration.none;
    }
    const editor = getEditorFromState(this.view.state);
    if (!editor) {
      return Decoration.none;
    }
    return buildOuterListGuideDecorations(
      this.view.state.doc,
      collectOuterListChunks(this.parser, editor),
    );
  }

  private scheduleGuideSynchronization() {
    if (this.destroyed) {
      return;
    }

    this.view.requestMeasure({
      key: this.measureKey,
      read: () => this.readHoverMeasurement(),
      write: (measurement: HoverMeasurement) => {
        if (this.destroyed) {
          return;
        }

        synchronizePersistentIndentGuides(
          this.view.contentDOM,
          this.interactionEnabled(),
        );
        synchronizeHoveredIndentGuides(
          this.view.contentDOM,
          this.interactionEnabled() ? (measurement?.indentGuides ?? []) : [],
        );
        synchronizeHoveredOuterListGuides(
          this.view.contentDOM,
          this.outerInteractionEnabled()
            ? (measurement?.outerGuides ?? [])
            : [],
        );
      },
    });
  }
}

function isElementLike(value: EventTarget | null): value is Element {
  if (!value || typeof value !== "object") {
    return false;
  }

  const element = value as Partial<Element>;
  return (
    typeof element.matches === "function" &&
    typeof element.closest === "function"
  );
}
