import { Plugin } from "obsidian";

import { EditorView, PluginValue, ViewPlugin } from "@codemirror/view";

import { DocumentBodyClass } from "./DocumentBodyClass";
import { Feature } from "./Feature";

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
const RENDERED_GUIDE_CANDIDATE_SELECTOR =
  ".cm-hmd-list-indent > .cm-indent, " +
  ".cm-hmd-list-indent > .cm-indent-spacing";

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
  editor: Pick<MyEditor, "foldEnsuringCursorVisible" | "unfold">,
  list: List,
) {
  const children = list.getChildren().filter((child) => !child.isEmpty());
  if (children.length === 0) {
    return false;
  }

  const shouldUnfold = children.every((child) => child.isFolded());
  for (const child of children) {
    const fallbackCursor = child.getFirstLineContentStart();
    if (shouldUnfold) {
      editor.unfold(fallbackCursor.line);
    } else {
      editor.foldEnsuringCursorVisible(fallbackCursor.line, fallbackCursor);
    }
  }

  return true;
}

export class VerticalLinesPluginValue implements PluginValue {
  private destroyed = false;
  private lastPointerGuide: Element | null = null;
  private measureKey = {};

  constructor(
    private settings: Settings,
    private parser: Parser,
    private view: EditorView,
  ) {
    this.view.contentDOM.addEventListener("mousedown", this.onMouseDown, true);
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

  update() {
    this.scheduleGuideSynchronization();
  }

  handleMouseDown(event: MouseEvent, view: EditorView) {
    if (
      !this.settings.verticalLines ||
      this.settings.verticalLinesAction !== "toggle-folding"
    ) {
      return false;
    }

    const pressedGuide = event.target;
    if (
      !isElementLike(pressedGuide) ||
      !pressedGuide.matches(INDENT_GUIDE_SELECTOR)
    ) {
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
    if (!target || !toggleVerticalGuideTarget(editor, target)) {
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
    synchronizePersistentIndentGuides(this.view.contentDOM, false);
  }

  private onMouseDown = (event: MouseEvent) => {
    if (this.handleMouseDown(event, this.view)) {
      event.stopPropagation();
    }
  };

  private interactionEnabled() {
    return (
      this.settings.verticalLines &&
      this.settings.verticalLinesAction === "toggle-folding"
    );
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

  private readHoveredGuideGroup(): Element[] {
    if (!this.interactionEnabled()) {
      return [];
    }
    const hoveredGuide = this.view.contentDOM.querySelector(
      `${INDENT_GUIDE_SELECTOR}:hover`,
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

  private onPointerMove = (event: PointerEvent) => {
    const guide =
      isElementLike(event.target) && event.target.matches(INDENT_GUIDE_SELECTOR)
        ? event.target
        : null;
    if (guide === this.lastPointerGuide) {
      return;
    }
    this.lastPointerGuide = guide;
    if (!guide) {
      synchronizeHoveredIndentGuides(this.view.contentDOM, []);
      return;
    }
    this.scheduleGuideSynchronization();
  };

  private onPointerLeave = () => {
    this.lastPointerGuide = null;
    synchronizeHoveredIndentGuides(this.view.contentDOM, []);
  };

  private onSettingsChange = () => {
    if (!this.interactionEnabled()) {
      this.lastPointerGuide = null;
      synchronizeHoveredIndentGuides(this.view.contentDOM, []);
    }
    this.scheduleGuideSynchronization();
  };

  private scheduleGuideSynchronization() {
    if (this.destroyed) {
      return;
    }

    this.view.requestMeasure({
      key: this.measureKey,
      read: () => this.readHoveredGuideGroup(),
      write: (highlightedGuides: Element[]) => {
        if (this.destroyed) {
          return;
        }

        synchronizePersistentIndentGuides(
          this.view.contentDOM,
          this.settings.verticalLines,
        );
        synchronizeHoveredIndentGuides(
          this.view.contentDOM,
          this.interactionEnabled() ? highlightedGuides : [],
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
    this.settings.onChange(this.updateBodyClasses);
    this.bodyClass.load();
    this.actionBodyClass.load();

    this.plugin.registerEditorExtension(
      ViewPlugin.define(
        (view) =>
          new VerticalLinesPluginValue(this.settings, this.parser, view),
      ),
    );
  }

  async unload() {
    this.settings.removeCallback(this.updateBodyClasses);
    this.actionBodyClass.unload();
    this.bodyClass.unload();
  }

  private updateBodyClasses = () => {
    this.bodyClass.update();
    this.actionBodyClass.update();
  };

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
