import { Plugin } from "obsidian";

import { Extension } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  PluginValue,
  ViewPlugin,
  ViewUpdate,
  scrollPastEnd,
} from "@codemirror/view";

import { DocumentBodyClass } from "./DocumentBodyClass";
import { Feature } from "./Feature";
import {
  OUTER_LIST_GUIDE_SELECTOR,
  buildOuterListGuideDecorations,
  collectHoveredOuterListGuides,
  collectOuterListChunks,
  isOuterListChunkActionable,
  synchronizeHoveredOuterListGuides,
  toggleOuterListChunk,
} from "./OuterListGuide";

import { MyEditor, getEditorFromState } from "../editor";
import { List, Root } from "../root";
import { Parser } from "../services/Parser";
import { Settings } from "../services/Settings";

const VERTICAL_LINES_BODY_CLASS = "bullet-plugin-vertical-lines";
const VERTICAL_LINES_ACTION_BODY_CLASS =
  "bullet-plugin-vertical-lines-action-toggle-folding";
const INDENT_GUIDE_SELECTOR = ".cm-indent";
const INDENT_CONTAINER_SELECTOR = ".cm-hmd-list-indent";
const LINE_SELECTOR = ".cm-line";
const PERSISTENT_GUIDE_MARKER = "bullet-plugin-persistent-indent-guide";
const PERSISTENT_GUIDE_SELECTOR = `.${PERSISTENT_GUIDE_MARKER}`;
const PERSISTENT_GUIDE_CANDIDATE_SELECTOR =
  ".cm-hmd-list-indent > .cm-indent-spacing:not(.cm-indent)";
const HOVERED_GUIDE_MARKER = "bullet-plugin-hovered-indent-guide";
const HOVERED_GUIDE_SELECTOR = `.${HOVERED_GUIDE_MARKER}`;
const HOVERED_GUIDE_CANDIDATE_SELECTOR =
  `${INDENT_GUIDE_SELECTOR}:hover, ` +
  ".cm-hmd-list-indent > .cm-indent-spacing:hover";
const RENDERED_GUIDE_CANDIDATE_SELECTOR =
  ".cm-hmd-list-indent > .cm-indent, " +
  ".cm-hmd-list-indent > .cm-indent-spacing";
const CHUNK_LINE_ATTRIBUTE_RE = /^(0|[1-9]\d*)$/;

export const VERTICAL_GUIDE_SCROLL_PAST_END_EXTENSION = scrollPastEnd();

type HoverMeasurement = {
  indentGuides: Element[];
  outerGuides: Element[];
};

export function synchronizePersistentIndentGuides(
  contentDOM: ParentNode,
  enabled: boolean,
) {
  if (enabled) {
    contentDOM
      .querySelectorAll(PERSISTENT_GUIDE_CANDIDATE_SELECTOR)
      .forEach((element) => {
        element.classList.add("cm-indent", PERSISTENT_GUIDE_MARKER);
      });
    return;
  }

  contentDOM.querySelectorAll(PERSISTENT_GUIDE_SELECTOR).forEach((element) => {
    element.classList.remove("cm-indent", PERSISTENT_GUIDE_MARKER);
  });
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

export function resolveVerticalGuideTarget(
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

export function collectVerticalGuideGroup(
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

export function synchronizeHoveredIndentGuides(
  contentDOM: ParentNode,
  highlightedGuides: Iterable<Element>,
) {
  const highlighted = new Set(highlightedGuides);
  contentDOM.querySelectorAll(HOVERED_GUIDE_SELECTOR).forEach((element) => {
    if (!highlighted.has(element)) {
      element.classList.remove(HOVERED_GUIDE_MARKER);
    }
  });
  highlighted.forEach((element) => {
    element.classList.add(HOVERED_GUIDE_MARKER);
  });
}

export function toggleVerticalGuideTarget(
  editor: Pick<MyEditor, "setFoldedPreservingScroll">,
  list: List,
) {
  const children = list.getChildren().filter((child) => !child.isEmpty());
  if (children.length === 0) {
    return false;
  }

  const shouldUnfold = children.every((child) => child.isFolded());
  return editor.setFoldedPreservingScroll(
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

export class VerticalLinesPluginValue implements PluginValue {
  decorations: DecorationSet;

  private destroyed = false;
  private lastOuterVisibility: [boolean, boolean];
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
    this.settings.onChange(this.onSettingsChange);
    this.scheduleGuideSynchronization();
  }

  update(update: ViewUpdate) {
    if (update.docChanged) {
      this.decorations = this.buildOuterDecorations();
    }
    this.scheduleGuideSynchronization();
  }

  handleMouseDown(event: MouseEvent, view: EditorView) {
    return this.handleGuideInteraction(event, view, false);
  }

  handleClick(event: MouseEvent, view: EditorView) {
    return this.handleGuideInteraction(event, view, true);
  }

  private handleGuideInteraction(
    event: MouseEvent,
    view: EditorView,
    shouldToggle: boolean,
  ) {
    if (
      !this.settings.verticalLines ||
      this.settings.verticalLinesAction !== "toggle-folding"
    ) {
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
      const editor = getEditorFromState(view.state);
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
        (shouldToggle && !toggleOuterListChunk(editor, root))
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

    const editor = getEditorFromState(view.state);
    if (!editor) {
      return false;
    }

    let offset: number;
    try {
      offset = view.posAtDOM(lineElement);
    } catch {
      return false;
    }

    const line = view.state.doc.lineAt(offset).number - 1;
    const root = this.parser.parse(editor, { line, ch: 0 });
    const list = root?.getListUnderLine(line);
    if (!list) {
      return false;
    }

    const target = resolveVerticalGuideTarget(list, pressedGuide);
    if (
      !target ||
      !isVerticalGuideTargetActionable(target) ||
      (shouldToggle && !toggleVerticalGuideTarget(editor, target))
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
    if (this.handleMouseDown(event, this.view)) {
      event.stopPropagation();
    }
  };

  private onClick = (event: MouseEvent) => {
    if (this.handleClick(event, this.view)) {
      event.stopPropagation();
    }
  };

  private interactionEnabled() {
    return (
      this.settings.verticalLines &&
      this.settings.verticalLinesAction === "toggle-folding"
    );
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
    if (
      outerVisibility[0] !== this.lastOuterVisibility[0] ||
      outerVisibility[1] !== this.lastOuterVisibility[1]
    ) {
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

  private outerVisibility(): [boolean, boolean] {
    return [this.settings.verticalLines, this.settings.outerVerticalLines];
  }

  private buildOuterDecorations() {
    if (!this.settings.verticalLines || !this.settings.outerVerticalLines) {
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
          this.settings.verticalLines,
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

export class VerticalLines implements Feature {
  private bodyClass: DocumentBodyClass;
  private actionBodyClass: DocumentBodyClass;
  private editorExtensions: Extension[] = [];

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
    this.actionBodyClass = new DocumentBodyClass(
      this.plugin,
      VERTICAL_LINES_ACTION_BODY_CLASS,
      this.shouldApplyActionBodyClass,
    );
  }

  async load() {
    this.editorExtensions = [
      ViewPlugin.define(
        (view) =>
          new VerticalLinesPluginValue(this.settings, this.parser, view),
        { decorations: (value) => value.decorations },
      ),
    ];
    this.synchronizeScrollPastEndExtension(false);
    this.plugin.registerEditorExtension(this.editorExtensions);

    this.settings.onChange(this.updateBodyClasses);
    this.bodyClass.load();
    this.actionBodyClass.load();
  }

  async unload() {
    this.settings.removeCallback(this.updateBodyClasses);
    this.actionBodyClass.unload();
    this.bodyClass.unload();
  }

  private updateBodyClasses = () => {
    this.bodyClass.update();
    this.actionBodyClass.update();
    this.synchronizeScrollPastEndExtension(true);
  };

  private synchronizeScrollPastEndExtension(updateViews: boolean) {
    const extensionIndex = this.editorExtensions.indexOf(
      VERTICAL_GUIDE_SCROLL_PAST_END_EXTENSION,
    );
    const enabled = extensionIndex !== -1;
    const shouldEnable = this.shouldApplyActionBodyClass();
    if (enabled === shouldEnable) {
      return;
    }

    if (shouldEnable) {
      this.editorExtensions.push(VERTICAL_GUIDE_SCROLL_PAST_END_EXTENSION);
    } else {
      this.editorExtensions.splice(extensionIndex, 1);
    }

    if (updateViews) {
      this.plugin.app.workspace.updateOptions();
    }
  }

  private shouldApplyBodyClass = () => {
    return this.settings.verticalLines;
  };

  private shouldApplyActionBodyClass = () => {
    return (
      this.settings.verticalLines &&
      this.settings.verticalLinesAction === "toggle-folding"
    );
  };
}
