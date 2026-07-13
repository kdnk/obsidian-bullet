import { Plugin } from "obsidian";

import { EditorView, PluginValue, ViewPlugin } from "@codemirror/view";

import { DocumentBodyClass } from "./DocumentBodyClass";
import { Feature } from "./Feature";

import { MyEditor, getEditorFromState } from "../editor";
import { List } from "../root";
import { Parser } from "../services/Parser";
import { Settings } from "../services/Settings";

const VERTICAL_LINES_BODY_CLASS = "bullet-plugin-vertical-lines";
const INDENT_GUIDE_SELECTOR = ".cm-indent";
const LINE_SELECTOR = ".cm-line";

export function resolveVerticalGuideTarget(list: List): List | null {
  let target: List | null = null;
  let ancestor = list.getParent();

  while (ancestor?.getParent()) {
    target = ancestor;
    ancestor = ancestor.getParent();
  }

  return target;
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
  constructor(
    private settings: Settings,
    private parser: Parser,
    private view: EditorView,
  ) {
    this.view.contentDOM.addEventListener("mousedown", this.onMouseDown, true);
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

    const target = resolveVerticalGuideTarget(list);
    if (!target || !toggleVerticalGuideTarget(editor, target)) {
      return false;
    }

    event.preventDefault();
    return true;
  }

  destroy() {
    this.view.contentDOM.removeEventListener(
      "mousedown",
      this.onMouseDown,
      true,
    );
  }

  private onMouseDown = (event: MouseEvent) => {
    if (this.handleMouseDown(event, this.view)) {
      event.stopPropagation();
    }
  };
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
