import { editorLivePreviewField } from "obsidian";

import { syntaxTree } from "@codemirror/language";
import { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";

import { Tree } from "@lezer/common";

import { getObsidianDomWindow } from "../obsidianDom";

class TaskBulletWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM(view: EditorView) {
    const win = getObsidianDomWindow(view.dom.ownerDocument);
    const marker = win.createSpan();
    marker.className =
      "cm-formatting cm-formatting-list cm-formatting-list-ul bullet-plugin-task-bullet";
    marker.setAttribute("aria-label", "Zoom into task");
    const bullet = win.createSpan();
    bullet.className = "list-bullet";
    bullet.textContent = "-";
    marker.append(bullet, " ");
    return marker;
  }

  ignoreEvent() {
    return false;
  }
}

const taskBullet = Decoration.widget({
  widget: new TaskBulletWidget(),
  side: -1,
});

export function taskBulletDecorations(
  state: EditorState,
  tree: Tree,
  ranges: readonly { from: number; to: number }[],
  livePreview: boolean,
): DecorationSet {
  if (!livePreview) return Decoration.none;
  const decorations: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const range of ranges) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (!node.name.split("_").includes("HyperMD-task-line")) return;
        const line = state.doc.lineAt(node.from);
        const match = /^([\t ]*[-*+][\t ]+)\[[^[\]]\](?:[\t ]|$)/.exec(
          line.text,
        );
        if (!match) return;
        const from = line.from + match[1].length;
        if (from < range.from || from > range.to || seen.has(from)) return;
        seen.add(from);
        decorations.push(taskBullet.range(from));
      },
    });
  }
  return Decoration.set(decorations, true);
}

export const taskBullets = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state) ||
        update.startState.field(editorLivePreviewField, false) !==
          update.state.field(editorLivePreviewField, false)
      )
        this.decorations = this.build(update.view);
    }

    private build(view: EditorView) {
      return taskBulletDecorations(
        view.state,
        syntaxTree(view.state),
        view.visibleRanges,
        view.state.field(editorLivePreviewField, false) === true,
      );
    }
  },
  { decorations: (value) => value.decorations },
);
