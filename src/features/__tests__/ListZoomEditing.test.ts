import { history, redo, undo } from "@codemirror/commands";
import { codeFolding, foldEffect, foldedRanges } from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  Transaction,
  TransactionSpec,
} from "@codemirror/state";

import { makeLogger, makeSettings } from "../../__mocks__";
import { Parser } from "../../services/Parser";
import { ListZoomState, setListZoom } from "../ListZoom";

jest.mock(
  "obsidian",
  () => ({
    editorInfoField: jest
      .requireActual<typeof import("@codemirror/state")>("@codemirror/state")
      .StateField.define({
        create: () => null,
        update: (value: unknown) => value,
      }),
  }),
  { virtual: true },
);

const original = "- before\n\t- project\n\t\t- task\n\t- other\n- after";
function editor(text = original) {
  const zoom = new ListZoomState(new Parser(makeLogger(), makeSettings()));
  const view = {
    state: EditorState.create({
      doc: text,
      extensions: [zoom.extension, history(), codeFolding()],
    }).update({
      effects: setListZoom.of(9),
      selection: { anchor: 12 },
    }).state,
    dispatch(tr: Transaction | TransactionSpec) {
      view.state =
        tr instanceof Transaction ? tr.state : view.state.update(tr).state;
    },
  };
  return { zoom, view };
}

test.each([
  { name: "preceding sibling", changes: { from: 9, insert: "\t- new\n" } },
  { name: "following sibling", changes: { from: 28, insert: "\n\t- new" } },
  { name: "outdented child", changes: { from: 20, to: 21 } },
  { name: "outdented root", changes: { from: 9, to: 10 } },
  { name: "deleted root", changes: { from: 9, to: 28 } },
  {
    name: "replacement siblings",
    changes: { from: 12, to: 19, insert: "one\n\t- two" },
  },
])("keeps local $name edits inside the focused root", ({ changes }) => {
  const { zoom, view } = editor();
  view.dispatch({ changes, userEvent: "input" });
  expect(view.state.doc.toString()).toBe(original);
  expect(zoom.range(view.state)).toMatchObject({ from: 9, to: 28 });
  view.dispatch({
    changes: { from: view.state.selection.main.head, insert: "NEXT" },
    userEvent: "input",
  });
  expect(view.state.doc.toString()).toBe(
    original.replace("project", "NEXTproject"),
  );
});

test("root Enter keeps its split text and existing children in the zoomed subtree through history", () => {
  const { zoom, view } = editor();
  view.dispatch({ selection: { anchor: 15 } });
  const insertion = zoom.childInsertion(view.state, 9, "\t");
  expect(insertion).not.toBeNull();
  view.dispatch(insertion!);
  const after = "- before\n\t- pro\n\t\t- ject\n\t\t- task\n\t- other\n- after";
  expect(view.state.doc.toString()).toBe(after);
  expect(view.state.selection.main.head).toBe(after.indexOf("ject"));
  expect(zoom.range(view.state)?.from).toBe(9);
  undo(view);
  expect(view.state.doc.toString()).toBe(original);
  redo(view);
  expect(view.state.doc.toString()).toBe(after);
  expect(view.state.selection.main.head).toBe(after.indexOf("ject"));
});

test.each(["\t", "  "])(
  "prepares an empty child for a leaf with %j indentation",
  (indent) => {
    const { zoom, view } = editor("- before\n\t- leaf\n\t- other\n- after");
    const insertion = zoom.childInsertion(view.state, 9, indent, true)!;
    expect(insertion).not.toBeNull();
    const unfiltered = view.state.update({ ...insertion, filter: false }).state;
    expect(zoom.range(unfiltered)).toMatchObject({ from: 9 });
    view.dispatch(insertion);
    expect(view.state.doc.toString()).toBe(
      `- before\n\t- leaf\n\t${indent}- \n\t- other\n- after`,
    );
    expect(view.state.selection.main.head).toBe(view.state.doc.line(3).to);
  },
);

test("leaves native code newlines to the editor", () => {
  const { zoom, view } = editor(
    "- before\n\t- ```js\n\t  const value = 1;\n\t  ```\n- after",
  );
  view.dispatch({ selection: { anchor: view.state.doc.line(3).to } });
  expect(zoom.childInsertion(view.state, 9, "\t")).toBeNull();
});

test.each(["input.type", undefined])(
  "keeps the native cursor after a code newline that replaces the preceding character (%s)",
  (userEvent) => {
    const { zoom, view } = editor(
      "- before\n\t- ```js\n\t  code\n\t  ```\n\t\t- existing\n- after",
    );
    const end = view.state.doc.line(3).to;
    view.dispatch({ selection: { anchor: end } });
    view.dispatch({
      changes: { from: end - 1, to: end, insert: "e\n\t  " },
      userEvent,
    });
    expect(view.state.doc.line(4).text).toBe("\t  ");
    expect(view.state.selection.main.head).toBe(view.state.doc.line(4).to);
    expect(zoom.range(view.state)?.from).toBe(9);
  },
);

test("can delete a child's contents without changing a hidden sibling", () => {
  const { zoom, view } = editor();
  view.dispatch({ changes: { from: 20, to: 28 }, userEvent: "delete" });
  expect(view.state.doc.toString()).toBe(
    "- before\n\t- project\n\n\t- other\n- after",
  );
  expect(zoom.range(view.state)).toMatchObject({ from: 9, to: 19 });
});

test("Enter after a folded descendant creates its sibling", () => {
  const text =
    "- before\n\t- project\n\t\t- folded\n\t\t\t- grandchild\n\t\t- sibling\n- after";
  const { zoom, view } = editor(text);
  view.dispatch({
    effects: foldEffect.of({
      from: view.state.doc.line(3).to,
      to: view.state.doc.line(4).to,
    }),
    selection: { anchor: view.state.doc.line(3).to },
  });
  view.dispatch(zoom.childInsertion(view.state, 9, "\t")!);
  expect(view.state.doc.toString()).toBe(
    "- before\n\t- project\n\t\t- folded\n\t\t\t- grandchild\n\t\t- \n\t\t- sibling\n- after",
  );
  expect(view.state.selection.main.head).toBe(view.state.doc.line(5).to);
});

test("adding a child preserves a saved position in the leaf's unchanged continuation", () => {
  const { zoom, view } = editor(
    "- before\n\t- leaf\n\t  long continuation\n\t  another row\n\t- other",
  );
  const position = view.state.doc.line(4).from;
  const insertion = zoom.childInsertion(view.state, 9, "\t", true)!;
  const changes = view.state.changes(insertion.changes);
  expect(EditorSelection.cursor(position).map(changes).head).toBe(position);
});

test("Enter retains other folded branches across scoped renumbering", () => {
  const { zoom, view } = editor(
    "- before\n\t- project\n\t\t9. first\n\t\t\t- A\n\t\t10. edit\n\t\t11. last\n\t\t\t- B\n- after",
  );
  view.dispatch({
    effects: [
      foldEffect.of({
        from: view.state.doc.line(3).to,
        to: view.state.doc.line(4).to,
      }),
      foldEffect.of({
        from: view.state.doc.line(6).to,
        to: view.state.doc.line(7).to,
      }),
    ],
    selection: { anchor: view.state.doc.line(5).to },
  });
  view.dispatch(zoom.childInsertion(view.state, 9, "\t")!);
  const folded: string[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from) => {
    folded.push(view.state.doc.lineAt(from).text);
  });
  expect(folded).toEqual(["\t\t1. first", "\t\t4. last"]);
});

test("leaves descendant Enter native when overrides are disabled", () => {
  const { zoom, view } = editor();
  view.dispatch({ selection: { anchor: view.state.doc.line(3).to } });
  expect(
    zoom.childInsertion(view.state, 9, "\t", false, true, false),
  ).toBeNull();
  view.dispatch({ selection: { anchor: view.state.doc.line(2).to } });
  expect(
    zoom.childInsertion(view.state, 9, "\t", false, true, false),
  ).not.toBeNull();
});

test.each([
  {
    body: "\t\t9. folded\n\t\t   note\n\t\t\t- child",
    startLine: 3,
    endLine: 5,
    endAtStart: false,
  },
  {
    body: "\t\t9. code\n\t\t   ```js\n\t\t   const x = 1;\n\t\t   ```",
    startLine: 4,
    endLine: 6,
    endAtStart: true,
  },
])(
  "preserves original multiline fold boundaries during numbering ($startLine)",
  ({ body, startLine, endLine, endAtStart }) => {
    const { zoom, view } = editor(
      `- before\n\t- project\n${body}\n\t\t10. edit\n\t\t11. last\n- after`,
    );
    const from = view.state.doc.line(startLine).to;
    const end = view.state.doc.line(endLine);
    view.dispatch({
      effects: foldEffect.of({ from, to: endAtStart ? end.from : end.to }),
      selection: { anchor: view.state.doc.line(endLine + 1).to },
    });
    view.dispatch(zoom.childInsertion(view.state, 9, "\t")!);
    const folds: { from: number; to: number }[] = [];
    foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
      folds.push({ from, to });
    });
    const newEnd = view.state.doc.line(endLine);
    expect(folds).toEqual([
      {
        from: view.state.doc.line(startLine).to,
        to: endAtStart ? newEnd.from : newEnd.to,
      },
    ]);
  },
);
