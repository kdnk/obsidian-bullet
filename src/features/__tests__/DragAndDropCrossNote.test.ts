import { editorInfoField } from "obsidian";

import { history, redo, undo } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import {
  EditorState,
  StateField,
  Transaction,
  TransactionSpec,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { Parser } from "../../services/Parser";
import { coordinateCrossNoteHistory, crossNoteHistory } from "../CrossNoteMove";
import { DragAndDrop } from "../DragAndDrop";
import { ListZoomState, setListZoom } from "../ListZoom";

jest.mock(
  "obsidian",
  () => ({
    editorInfoField: jest
      .requireActual<typeof import("@codemirror/state")>("@codemirror/state")
      .StateField.define({ create: () => null, update: (v: unknown) => v }),
    Notice: class {},
    Platform: { isDesktop: true },
  }),
  { virtual: true },
);
jest.mock(
  "../../editor",
  () => ({
    getEditorFromState: (state: EditorState) =>
      state.field(
        jest.requireMock<{ editorInfoField: StateField<{ editor: unknown }> }>(
          "obsidian",
        ).editorInfoField,
      ).editor,
  }),
  { virtual: true },
);

function setup(
  targetText: string,
  sourceText = "- move\n\t- child\n- keep",
  options: {
    sourceZoomLine?: number;
    targetZoomLine?: number;
    dragLine?: number;
  } = {},
) {
  const parser = new Parser(
    { bind: () => () => {} } as never,
    { keepCursorWithinContent: "bullet-and-checkbox" } as never,
  );
  const zoom = new ListZoomState(parser);
  const doc = {
    body: { classList: { add() {}, remove() {} } },
    elementFromPoint: (): unknown => target.dom,
  };
  function makeView(text: string, path: string, left: number) {
    const reader = {
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: (line: number) => view.state.doc.line(line + 1).text,
      lastLine: () => view.state.doc.lines - 1,
      listSelections: () => [
        { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
      ],
      getAllFoldedLines: () => [],
      posToOffset: ({ line, ch }: { line: number; ch: number }) =>
        view.state.doc.line(line + 1).from + ch,
      offsetToPos: (offset: number) => {
        const line = view.state.doc.lineAt(offset);
        return { line: line.number - 1, ch: offset - line.from };
      },
    };
    const view = {
      state: EditorState.create({
        doc: text,
        extensions: [
          history(),
          crossNoteHistory,
          EditorState.tabSize.of(4),
          indentUnit.of("\t"),
          zoom.extension,
          (editorInfoField as StateField<unknown>).init(() => ({
            file: { path },
            editor: reader,
          })),
        ],
      }),
      dom: {
        isConnected: true,
        ownerDocument: doc,
        classList: { contains: (name: string) => name === "cm-editor" },
        querySelector: (selector: string) =>
          selector === ".cm-indent"
            ? { offsetWidth: 16 }
            : { getBoundingClientRect: () => ({ left }) },
      },
      contentDOM: {
        offsetWidth: 400,
        getBoundingClientRect: () => ({ left, top: 0, width: 400 }),
      },
      focus: jest.fn(),
      defaultCharacterWidth: 4,
      posAtCoords: ({ y }: { y: number }) =>
        view.state.doc.line(
          Math.max(
            1,
            Math.min(
              view.state.doc.lines,
              Math.floor(y / 20) +
                view.state.doc.lineAt(zoom.range(view.state)?.from ?? 0).number,
            ),
          ),
        ).from,
      posAtDOM: (marker: { offset: number }) => marker.offset,
      coordsAtPos: (pos: number) => {
        const range = zoom.range(view.state);
        // CodeMirror can map positions in a block replacement to its boundary.
        const visiblePos = range
          ? Math.max(range.from, Math.min(range.to, pos))
          : pos;
        return {
          left,
          top:
            (view.state.doc.lineAt(visiblePos).number -
              view.state.doc.lineAt(range?.from ?? 0).number) *
            20,
        };
      },
      lineBlockAt: () => ({ height: 20 }),
      dispatch(tr: Transaction | TransactionSpec) {
        this.state =
          tr instanceof Transaction ? tr.state : this.state.update(tr).state;
      },
    };
    coordinateCrossNoteHistory(view);
    return view;
  }
  const source = makeView(sourceText, "source.md", 0);
  const target = makeView(targetText, "target.md", 500);
  if (options.sourceZoomLine)
    source.dispatch({
      effects: setListZoom.of(
        source.state.doc.line(options.sourceZoomLine).from,
      ),
    });
  if (options.targetZoomLine)
    target.dispatch({
      effects: setListZoom.of(
        target.state.doc.line(options.targetZoomLine).from,
      ),
    });
  jest
    .spyOn(EditorView, "findFromDOM")
    .mockReturnValue(target as unknown as EditorView);
  const targetLeaf = {
    view: { editor: target.state.field(editorInfoField).editor },
  };
  const setActiveLeaf = jest.fn();
  const feature = new DragAndDrop(
    {
      app: {
        workspace: { getLeavesOfType: () => [targetLeaf], setActiveLeaf },
      },
    } as never,
    { dragAndDrop: true } as never,
    { getDefaultIndentChars: () => "\t" } as never,
    parser,
    {} as never,
    (state: EditorState) => zoom.range(state),
  );
  const internals = feature as unknown as {
    preStart: unknown;
    documents: Map<unknown, unknown>;
    startDragging(): void;
    detectAndDrawDropZone(x: number, y: number): void;
    stopDragging(): void;
  };
  const style: Record<string, string> = {};
  internals.documents.set(doc, {
    doc,
    dropZone: {
      setCssStyles: (next: Record<string, string>) =>
        Object.assign(style, next),
    },
  });
  internals.preStart = {
    x: 0,
    y: 0,
    view: source,
    target: { offset: source.state.doc.line(options.dragLine ?? 1).from },
  };
  internals.startDragging();
  return {
    source,
    target,
    internals,
    style,
    doc,
    targetLeaf,
    setActiveLeaf,
    zoom,
  };
}
afterEach(() => jest.restoreAllMocks());

test("routes a drag to another pane, draws its indent, and moves a subtree as a child", () => {
  const { source, target, internals, style } = setup("- parent");
  internals.detectAndDrawDropZone(516, 12);
  expect(style.left).toBe("516px");
  internals.stopDragging();
  expect(source.state.doc.toString()).toBe("- keep");
  expect(target.state.doc.toString()).toBe("- parent\n\t- move\n\t\t- child");
  undo(target);
  expect(source.state.doc.toString()).toBe("- move\n\t- child\n- keep");
  expect(target.state.doc.toString()).toBe("- parent");
});

test("moves a fenced-code subtree containing list-looking code to another note", () => {
  const sourceText = [
    "- move",
    "\t- ```go",
    "\t  const value = 1;",
    "\t  - literal list marker",
    "\t  ```",
    "\t- child",
    "- keep",
  ].join("\n");
  const { source, target, internals } = setup("- destination", sourceText);

  internals.detectAndDrawDropZone(500, 0);
  internals.stopDragging();

  expect(source.state.doc.toString()).toBe("- keep");
  expect(target.state.doc.toString()).toBe(
    sourceText.replace("\n- keep", "\n- destination"),
  );
});

test("dedents a zoomed destination indicator while preserving raw code indentation and both zoom roots", () => {
  const sourceText =
    "- source\n\t- focus\n\t\t- ```js\n\t\t  - literal\n\t\t  ```\n\t\t- survivor\n\t- outside";
  const targetText =
    "- envelope\n\t- focus\n\t\t- existing\n\t- hidden\n- tail";
  const { source, target, internals, style, zoom } = setup(
    targetText,
    sourceText,
    {
      sourceZoomLine: 2,
      targetZoomLine: 2,
      dragLine: 3,
    },
  );
  internals.detectAndDrawDropZone(516, 12);
  expect(style.left).toBe("516px");
  internals.stopDragging();
  const sourceAfter = "- source\n\t- focus\n\t\t- survivor\n\t- outside";
  const targetAfter =
    "- envelope\n\t- focus\n\t\t- ```js\n\t\t  - literal\n\t\t  ```\n\t\t- existing\n\t- hidden\n- tail";
  expect(source.state.doc.toString()).toBe(sourceAfter);
  expect(target.state.doc.toString()).toBe(targetAfter);
  expect(zoom.range(source.state)?.ancestors.map(({ label }) => label)).toEqual(
    ["source", "focus"],
  );
  expect(zoom.range(target.state)?.ancestors.map(({ label }) => label)).toEqual(
    ["envelope", "focus"],
  );
  undo(target);
  expect(source.state.doc.toString()).toBe(sourceText);
  expect(target.state.doc.toString()).toBe(targetText);
  expect(zoom.range(source.state)?.ancestors.map(({ label }) => label)).toEqual(
    ["source", "focus"],
  );
  expect(zoom.range(target.state)?.ancestors.map(({ label }) => label)).toEqual(
    ["envelope", "focus"],
  );
  redo(target);
  expect(source.state.doc.toString()).toBe(sourceAfter);
  expect(target.state.doc.toString()).toBe(targetAfter);
  expect(zoom.range(source.state)?.ancestors.map(({ label }) => label)).toEqual(
    ["source", "focus"],
  );
  expect(zoom.range(target.state)?.ancestors.map(({ label }) => label)).toEqual(
    ["envelope", "focus"],
  );
});

test("uses retained columns for a partially dedented tab in a zoomed destination", () => {
  const { source, target, internals, style } = setup(
    "- envelope\n  - focus\n\t- existing\n- hidden",
    undefined,
    { targetZoomLine: 2 },
  );
  internals.detectAndDrawDropZone(508, 12);
  expect(style.left).toBe("508px");
  internals.stopDragging();
  expect(source.state.doc.toString()).toBe("- keep");
  expect(target.state.doc.toString()).toBe(
    "- envelope\n  - focus\n\t- move\n\t\t- child\n\t- existing\n- hidden",
  );
});

test("uses the source editor's current zoom for a same-note drop without changing the raw level", () => {
  const { source, internals, style, doc } = setup(
    "- unused",
    "- envelope\n\t- focus\n\t\t- move\n\t\t- sibling\n\t- hidden",
    { sourceZoomLine: 2, dragLine: 3 },
  );
  doc.elementFromPoint = () => source.dom;
  jest
    .spyOn(EditorView, "findFromDOM")
    .mockReturnValue(source as unknown as EditorView);
  internals.detectAndDrawDropZone(16, 32);
  expect(style.left).toBe("16px");
  const state = (
    internals as unknown as {
      state: { dropVariant: { level: number; whereToMove: string } };
    }
  ).state;
  expect(state.dropVariant).toMatchObject({ level: 3, whereToMove: "before" });

  source.dispatch({ effects: setListZoom.of(null) });
  internals.detectAndDrawDropZone(32, 52);
  expect(style.left).toBe("32px");
  expect(state.dropVariant).toMatchObject({ level: 3, whereToMove: "before" });
});

test("does not measure hidden zoom candidates at their replacement boundary", () => {
  const { target, internals, style, zoom } = setup(
    "- envelope\n\t- focus\n\t\t- existing\n\t- hidden\n- tail",
    undefined,
    { targetZoomLine: 2 },
  );
  const range = zoom.range(target.state)!;
  const measured = jest.spyOn(target, "coordsAtPos");
  internals.detectAndDrawDropZone(500, 0);
  expect(
    measured.mock.calls.every(([pos]) => pos >= range.from && pos <= range.to),
  ).toBe(true);
  expect(style.left).toBe("516px");
  internals.stopDragging();
  expect(target.state.doc.toString()).toBe(
    "- envelope\n\t- focus\n\t\t- move\n\t\t\t- child\n\t\t- existing\n\t- hidden\n- tail",
  );
});

test("clears a zoomed same-note drop when an edit makes the collected list positions stale", () => {
  const { source, internals, style, doc } = setup(
    "- unused",
    "- envelope\n\t- focus\n\t\t- move\n\t\t- sibling\n\t- hidden",
    { sourceZoomLine: 2, dragLine: 3 },
  );
  doc.elementFromPoint = () => source.dom;
  jest
    .spyOn(EditorView, "findFromDOM")
    .mockReturnValue(source as unknown as EditorView);
  internals.detectAndDrawDropZone(16, 32);
  source.dispatch({
    changes: {
      from: source.state.doc.line(4).from,
      to: source.state.doc.line(4).to,
    },
  });
  expect(() => internals.detectAndDrawDropZone(16, 32)).not.toThrow();
  expect(style.display).toBe("none");
});

test("does not offer a sibling outside a focused root or an insertion beyond its editable boundary", () => {
  const targetText = "- envelope\n\t- focus\n\t- hidden";
  const { source, target, internals, style } = setup(targetText, undefined, {
    targetZoomLine: 2,
  });
  internals.detectAndDrawDropZone(500, 0);
  expect(style.display).toBe("none");
  internals.stopDragging();
  expect(source.state.doc.toString()).toBe("- move\n\t- child\n- keep");
  expect(target.state.doc.toString()).toBe(targetText);
});

test("allows an inside drop at the end of a focused root when it is also document EOF", () => {
  const { source, target, internals, style, zoom } = setup(
    "- envelope\n\t- focus",
    undefined,
    { targetZoomLine: 2 },
  );
  internals.detectAndDrawDropZone(516, 12);
  expect(style.left).toBe("516px");
  internals.stopDragging();
  expect(source.state.doc.toString()).toBe("- keep");
  expect(target.state.doc.toString()).toBe(
    "- envelope\n\t- focus\n\t\t- move\n\t\t\t- child",
  );
  expect(zoom.range(target.state)?.ancestors.map(({ label }) => label)).toEqual(
    ["envelope", "focus"],
  );
});

test("moves a fenced-code subtree with extra indentation and a physical blank line", () => {
  const sourceText = [
    "- move",
    "\t- ```go",
    "\t    additionally indented",
    "",
    "\t  - literal list marker",
    "\t  ```",
    "- keep",
  ].join("\n");
  const { source, target, internals } = setup("- destination", sourceText);

  internals.detectAndDrawDropZone(500, 0);
  internals.stopDragging();

  expect(source.state.doc.toString()).toBe("- keep");
  expect(target.state.doc.toString()).toBe(
    sourceText.replace("\n- keep", "\n- destination"),
  );
});

test("routes a drop into an empty note", () => {
  const { source, target, internals } = setup("");
  internals.detectAndDrawDropZone(500, 0);
  internals.stopDragging();
  expect(source.state.doc.toString()).toBe("- keep");
  expect(target.state.doc.toString()).toBe("- move\n\t- child");
});

test("rejects a drop if the destination changed after drawing its indicator", () => {
  const { source, target, internals } = setup("- parent");
  internals.detectAndDrawDropZone(516, 12);
  target.dispatch({ changes: { from: 0, insert: "edit" } });
  internals.stopDragging();
  expect(source.state.doc.toString()).toBe("- move\n\t- child\n- keep");
  expect(target.state.doc.toString()).toBe("edit- parent");
});

test("follows the hovered list chunk within the destination pane", () => {
  const { source, target, internals } = setup("- first\n\n# gap\n\n- second");
  internals.detectAndDrawDropZone(500, 0);
  internals.detectAndDrawDropZone(500, 80);
  internals.stopDragging();
  expect(source.state.doc.toString()).toBe("- keep");
  expect(target.state.doc.toString()).toBe(
    "- first\n\n# gap\n\n- move\n\t- child\n- second",
  );
});

test("cancels the pending drop when the pointer leaves the document", () => {
  const { source, target, internals, doc, style } = setup("- parent");
  internals.detectAndDrawDropZone(516, 12);
  doc.elementFromPoint = () => null;
  internals.detectAndDrawDropZone(9000, 9000);
  expect(style.display).toBe("none");
  internals.stopDragging();
  expect(source.state.doc.toString()).toBe("- move\n\t- child\n- keep");
  expect(target.state.doc.toString()).toBe("- parent");
});

test("activates the exact destination pane and focuses the moved item after a successful drop", () => {
  const { target, internals, targetLeaf, setActiveLeaf } = setup("- parent");
  internals.detectAndDrawDropZone(516, 12);
  internals.stopDragging();
  expect(target.state.selection.main.head).toBe(12);
  expect(setActiveLeaf).toHaveBeenCalledWith(targetLeaf, { focus: true });
  expect(target.focus).toHaveBeenCalledTimes(1);
});

test.each([
  { text: "\n", y: 20, want: "\n- move\n\t- child" },
  { text: "# Heading", y: 12, want: "# Heading\n- move\n\t- child" },
  {
    text: "```md\n- code\n```\nBody",
    y: 72,
    want: "```md\n- code\n```\nBody\n- move\n\t- child",
  },
  {
    text: "---\ntags:\n- example\n---",
    y: 40,
    want: "---\ntags:\n- example\n---\n- move\n\t- child",
  },
  {
    text: "Plain paragraph",
    y: 12,
    want: "Plain paragraph\n- move\n\t- child",
  },
  { text: "Plain paragraph", y: 0, want: "- move\n\t- child\nPlain paragraph" },
  {
    text: "Before\n\nAfter",
    y: 20,
    want: "Before\n- move\n\t- child\n\nAfter",
  },
  {
    text: "---\ntitle: Example\n---",
    y: 20,
    want: "---\ntitle: Example\n---\n- move\n\t- child",
  },
  {
    text: "---\ntitle: Example\n---\n",
    y: 60,
    want: "---\ntitle: Example\n---\n- move\n\t- child",
  },
])(
  "moves into a non-list destination at a line boundary: $text / $y",
  ({ text, y, want }) => {
    const { source, target, internals, style } = setup(text);
    internals.detectAndDrawDropZone(500, y);
    expect(style.display).toBe("block");
    internals.stopDragging();
    expect(source.state.doc.toString()).toBe("- keep");
    expect(target.state.doc.toString()).toBe(want);
    undo(target);
    expect(source.state.doc.toString()).toBe("- move\n\t- child\n- keep");
    expect(target.state.doc.toString()).toBe(text);
    redo(source);
    expect(source.state.doc.toString()).toBe("- keep");
    expect(target.state.doc.toString()).toBe(want);
  },
);

test.each(["```md\n- code\n```", "~~~\nplain\n~~~", "---\ntitle: unfinished"])(
  "does not drop into fenced code or unclosed frontmatter: %s",
  (text) => {
    const { source, target, internals, style } = setup(text);
    internals.detectAndDrawDropZone(500, 20);
    expect(style.display).toBe("none");
    internals.stopDragging();
    expect(source.state.doc.toString()).toBe("- move\n\t- child\n- keep");
    expect(target.state.doc.toString()).toBe(text);
  },
);
