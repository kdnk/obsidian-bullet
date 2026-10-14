import { Plugin, editorLivePreviewField } from "obsidian";

import { foldedRanges } from "@codemirror/language";
import { EditorState, Extension } from "@codemirror/state";
import {
  Direction,
  EditorView,
  LayerMarker,
  ViewUpdate,
  layer,
} from "@codemirror/view";

import { Feature } from "./Feature";

import { getObsidianDomWindow } from "../obsidianDom";
import { Parser } from "../services/Parser";
import { Settings } from "../services/Settings";

interface ThreadNode {
  readonly from: number;
  readonly to: number;
  readonly indent: string;
}

interface ThreadPoint {
  readonly x: number;
  readonly y: number;
}

interface ThreadEdge {
  readonly parent: ThreadPoint;
  readonly child: ThreadPoint;
  readonly parentLine: number;
  readonly childLine: number;
}

type ZoomRange = { from: number; to: number; indent: string };

export function bulletThreadingPath(
  state: EditorState,
  parser: Parser,
): readonly ThreadNode[] {
  const cursorLine = state.doc.lineAt(state.selection.main.head);
  const cursor = {
    line: cursorLine.number - 1,
    ch: state.selection.main.head - cursorLine.from,
  };
  const root = parser.parse({
    getCursor: () => cursor,
    getLine: (line) => state.doc.line(line + 1).text,
    lastLine: () => state.doc.lines - 1,
    listSelections: () => [{ anchor: cursor, head: cursor }],
    getAllFoldedLines: () => [],
  });
  if (!root) return [];
  const path: ThreadNode[] = [];
  for (
    let item = root.getListUnderLine(cursor.line);
    item && item !== root.getRootList();
    item = item.getParent()
  ) {
    const position = item.getFirstLineContentStart();
    const line = state.doc.line(position.line + 1);
    const indent = item.getFirstLineIndent();
    path.push({
      from: line.from + indent.length,
      to: line.from + indent.length + item.getBullet().length,
      indent,
    });
  }
  return path.reverse();
}

class ThreadMarker implements LayerMarker {
  constructor(
    private doc: Document,
    private edge: ThreadEdge,
    private color: string,
  ) {}

  eq(other: LayerMarker): boolean {
    return (
      other instanceof ThreadMarker &&
      this.color === other.color &&
      this.edge.parent.x === other.edge.parent.x &&
      this.edge.parent.y === other.edge.parent.y &&
      this.edge.child.x === other.edge.child.x &&
      this.edge.child.y === other.edge.child.y &&
      this.edge.parentLine === other.edge.parentLine &&
      this.edge.childLine === other.edge.childLine
    );
  }

  draw() {
    const marker = getObsidianDomWindow(this.doc).createDiv();
    marker.className = "bullet-plugin-thread-edge";
    marker.setAttribute("data-parent-line", String(this.edge.parentLine));
    marker.setAttribute("data-child-line", String(this.edge.childLine));
    const { parent, child } = this.edge;
    if (child.x < parent.x)
      marker.className += " bullet-plugin-thread-edge-rtl";
    marker.style.setProperty(
      "--bullet-thread-left",
      `${Math.min(parent.x, child.x)}px`,
    );
    marker.style.setProperty("--bullet-thread-top", `${parent.y}px`);
    marker.style.setProperty(
      "--bullet-thread-width",
      `${Math.abs(child.x - parent.x)}px`,
    );
    marker.style.setProperty(
      "--bullet-thread-height",
      `${child.y - parent.y}px`,
    );
    marker.style.setProperty("--bullet-thread-color", this.color);
    return marker;
  }
}

function hiddenNode(
  state: EditorState,
  node: ThreadNode,
  zoom: ZoomRange | null,
) {
  if (zoom && (node.from < zoom.from || node.to > zoom.to)) return true;
  let hidden = false;
  foldedRanges(state).between(node.from, node.to, (from, to) => {
    if (from <= node.from && to >= node.to) hidden = true;
  });
  return hidden;
}

function markerPoint(view: EditorView, node: ThreadNode): ThreadPoint | null {
  const dom = view.domAtPos(node.from);
  const line =
    dom.node.parentElement?.closest(".cm-line") ??
    Array.from(view.contentDOM.children).find(
      (row) =>
        row.classList.contains("cm-line") &&
        view.state.doc.lineAt(view.posAtDOM(row, 0)).number ===
          view.state.doc.lineAt(node.from).number,
    );
  const markers = line?.querySelectorAll(
    ".list-bullet, .cm-formatting-list-ol, .task-list-item-checkbox",
  );
  if (markers) {
    for (const marker of Array.from(markers)) {
      const number = marker.querySelector(".list-number")?.getClientRects()[0];
      const bounds =
        number && number.width > 0 && number.height > 0
          ? number
          : marker.getClientRects()[0];
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        const offset =
          line?.classList.contains("bullet-plugin-code-opening-aligned") &&
          marker.classList.contains("list-bullet")
            ? parseFloat(
                getObsidianDomWindow(view.dom.ownerDocument)
                  .getComputedStyle(line)
                  .getPropertyValue("--bullet-code-opening-marker-offset"),
              )
            : 0;
        return {
          x: (bounds.left + bounds.right) / 2,
          y:
            (bounds.top + bounds.bottom) / 2 +
            (Number.isFinite(offset) ? offset * view.scaleY : 0),
        };
      }
    }
  }
  const start = view.coordsAtPos(node.from, 1);
  const end = view.coordsAtPos(node.to, -1);
  if (!start || !end) return null;
  return {
    x: (start.left + end.right) / 2,
    y: (start.top + start.bottom) / 2,
  };
}

function sameMarkerShape(
  state: EditorState,
  parent: ThreadNode,
  child: ThreadNode,
) {
  if (
    state.doc.sliceString(parent.from, parent.to) !==
    state.doc.sliceString(child.from, child.to)
  )
    return false;
  const task = /^[ \t]+\[[^[\]]\](?:[ \t]|$)/;
  const parentLine = state.doc.lineAt(parent.to);
  const childLine = state.doc.lineAt(child.to);
  return (
    task.test(parentLine.text.slice(parent.to - parentLine.from)) ===
    task.test(childLine.text.slice(child.to - childLine.from))
  );
}

export class BulletThreading implements Feature {
  private editorExtensions: Extension[] = [];

  constructor(
    private plugin: Plugin,
    private settings: Settings,
    private parser: Parser,
    private zoomRange?: (state: EditorState) => ZoomRange | null,
  ) {}

  async load() {
    this.synchronize(false);
    this.plugin.registerEditorExtension(this.editorExtensions);
    this.settings.onChange(
      ["bulletThreading", "bulletThreadingColor"],
      this.update,
    );
  }

  async unload() {
    this.settings.removeCallback(this.update);
    if (this.editorExtensions.length === 0) return;
    this.editorExtensions.length = 0;
    this.plugin.app.workspace.updateOptions();
  }

  private update = () => this.synchronize(true);

  private synchronize(updateViews: boolean) {
    const enabled = this.settings.bulletThreading;
    if (!enabled && this.editorExtensions.length === 0) return;
    this.editorExtensions.splice(
      0,
      this.editorExtensions.length,
      ...(enabled ? [this.extension()] : []),
    );
    if (updateViews) this.plugin.app.workspace.updateOptions();
  }

  private extension(): Extension {
    const paths = new WeakMap<
      EditorView,
      { doc: EditorState["doc"]; line: number; path: readonly ThreadNode[] }
    >();
    return layer({
      above: true,
      class: "bullet-plugin-threading-layer",
      update: (update: ViewUpdate) =>
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.transactions.some(
          (transaction) => transaction.effects.length > 0,
        ),
      markers: (view) => {
        if (view.state.field(editorLivePreviewField, false) !== true) return [];
        const cursorLine = view.state.doc.lineAt(
          view.state.selection.main.head,
        );
        let cached = paths.get(view);
        if (
          !cached ||
          cached.doc !== view.state.doc ||
          cached.line !== cursorLine.number
        ) {
          cached = {
            doc: view.state.doc,
            line: cursorLine.number,
            path: bulletThreadingPath(view.state, this.parser),
          };
          paths.set(view, cached);
        }
        const zoom = this.zoomRange?.(view.state) ?? null;
        const path = cached.path.filter(
          (node) => !hiddenNode(view.state, node, zoom),
        );
        if (path.length < 2) return [];
        const visible = path.map((node) => {
          if (
            !view.visibleRanges.some(
              ({ from, to }) => node.from >= from && node.to <= to,
            )
          )
            return null;
          return markerPoint(view, node);
        });
        const scroll = view.scrollDOM.getBoundingClientRect();
        const base = {
          x:
            (view.textDirection === Direction.LTR
              ? scroll.left
              : scroll.right - view.scrollDOM.clientWidth * view.scaleX) -
            view.scrollDOM.scrollLeft * view.scaleX,
          y: scroll.top - view.scrollDOM.scrollTop * view.scaleY,
        };
        const markers: ThreadMarker[] = [];
        for (let index = 1; index < path.length; index++) {
          const child = visible[index];
          if (!child) continue;
          const parentNode = path[index - 1];
          const childNode = path[index];
          const measuredParent = visible[index - 1];
          let parent = measuredParent
            ? { x: measuredParent.x, y: measuredParent.y + 4 }
            : null;
          if (
            !parent &&
            view.visibleRanges.every(({ from }) => parentNode.to < from) &&
            childNode.indent.startsWith(parentNode.indent) &&
            parentNode.indent.length >= (zoom?.indent.length ?? 0) &&
            sameMarkerShape(view.state, parentNode, childNode)
          ) {
            const lineStart = childNode.from - childNode.indent.length;
            const prefix = view.coordsAtPos(
              lineStart + parentNode.indent.length,
              1,
            );
            const markerStart = view.coordsAtPos(childNode.from, -1);
            if (prefix && markerStart) {
              parent = {
                x: prefix.left + child.x - markerStart.left,
                y: scroll.top,
              };
            }
          }
          if (!parent || child.y <= parent.y) continue;
          const direction = Math.sign(child.x - parent.x);
          if (Math.abs(child.x - parent.x) <= 4) continue;
          markers.push(
            new ThreadMarker(
              view.dom.ownerDocument,
              {
                parent: { x: parent.x - base.x, y: parent.y - base.y },
                child: {
                  x: child.x - base.x - direction * 4,
                  y: child.y - base.y,
                },
                parentLine:
                  view.state.doc.lineAt(path[index - 1].from).number - 1,
                childLine: view.state.doc.lineAt(path[index].from).number - 1,
              },
              this.settings.bulletThreadingColor,
            ),
          );
        }
        return markers;
      },
      destroy: (_layer, view) => paths.delete(view),
    });
  }
}
