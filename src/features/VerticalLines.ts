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
const LINE_GUIDES_SELECTOR = ".cm-hmd-list-indent .cm-indent";

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
  constructor(
    private settings: Settings,
    private parser: Parser,
  ) {}

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

    const guides = Array.from(
      lineElement.querySelectorAll(LINE_GUIDES_SELECTOR),
    );
    const target = resolveVerticalGuideTarget(list, guides, pressedGuide);
    if (!target || !toggleVerticalGuideTarget(editor, target)) {
      return false;
    }

    event.preventDefault();
    return true;
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
        () => new VerticalLinesPluginValue(this.settings, this.parser),
        {
          eventHandlers: {
            mousedown(event, view) {
              return this.handleMouseDown(event, view);
            },
          },
        },
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
