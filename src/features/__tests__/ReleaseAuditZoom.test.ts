import { history, isolateHistory, redo, undo } from "@codemirror/commands";
import {
  codeFolding,
  foldEffect,
  foldedRanges,
  unfoldEffect,
} from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  Transaction,
  TransactionSpec,
} from "@codemirror/state";

import { makeLogger, makeSettings } from "../../__mocks__";
import { MyEditor, MyEditorPosition, MyEditorSelection } from "../../editor";
import { CreateNewItem } from "../../operations/CreateNewItem";
import { KeepCursorWithinListContent } from "../../operations/KeepCursorWithinListContent";
import { ChangesApplicator } from "../../services/ChangesApplicator";
import { OperationPerformer } from "../../services/OperationPerformer";
import { Parser } from "../../services/Parser";
import { coordinateCrossNoteHistory, crossNoteHistory } from "../CrossNoteMove";
import { ListZoomState, setListZoom } from "../ListZoom";

jest.mock(
  "obsidian",
  () => ({
    editorInfoField: jest
      .requireActual<typeof import("@codemirror/state")>("@codemirror/state")
      .StateField.define({ create: () => null, update: (v: unknown) => v }),
  }),
  { virtual: true },
);

function editor(
  doc: string,
  zoomLine?: number,
  body?: string,
  keepCursor: "never" | "bullet-and-checkbox" = "bullet-and-checkbox",
) {
  const settings = makeSettings();
  settings.keepCursorWithinContent = keepCursor;
  const zoom = new ListZoomState(new Parser(makeLogger(), settings));
  const view = {
    zoom,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        codeFolding(),
        crossNoteHistory,
        EditorState.tabSize.of(4),
        zoom.extension,
      ],
    }),
    dispatch(tr: Transaction | TransactionSpec) {
      if (tr instanceof Transaction && tr.startState !== this.state)
        throw new Error("Stale transaction");
      this.state =
        tr instanceof Transaction ? tr.state : this.state.update(tr).state;
    },
  };
  coordinateCrossNoteHistory(view);
  if (zoomLine) {
    const line = view.state.doc.line(zoomLine);
    view.dispatch({
      effects: setListZoom.of(line.from),
      selection: { anchor: line.from + (body ? line.text.indexOf(body) : 0) },
    });
  }
  return { view, zoom };
}

function enter(
  view: ReturnType<typeof editor>["view"],
  repairCursor = false,
  numericBullets = true,
  keepCursor: "never" | "bullet-and-checkbox" = "bullet-and-checkbox",
) {
  const focused = view.zoom.range(view.state);
  if (focused) {
    const insertion = view.zoom.childInsertion(
      view.state,
      focused.from,
      "\t",
      false,
      numericBullets,
    );
    expect(insertion).not.toBeNull();
    if (insertion) view.dispatch(insertion);
    return;
  }
  const position = (offset: number) => {
    const line = view.state.doc.lineAt(offset);
    return { line: line.number - 1, ch: offset - line.from };
  };
  const offset = ({ line, ch }: MyEditorPosition) =>
    view.state.doc.line(line + 1).from + ch;
  const reader = {
    getCursor: () => position(view.state.selection.main.head),
    getLine: (line: number) => view.state.doc.line(line + 1).text,
    lastLine: () => view.state.doc.lines - 1,
    listSelections: () =>
      view.state.selection.ranges.map((range) => ({
        anchor: position(range.anchor),
        head: position(range.head),
      })),
    getAllFoldedLines: () => {
      const lines: number[] = [];
      foldedRanges(view.state).between(0, view.state.doc.length, (from) => {
        lines.push(view.state.doc.lineAt(from).number - 1);
      });
      return lines;
    },
    getRange: (from: MyEditorPosition, to: MyEditorPosition) =>
      view.state.doc.sliceString(offset(from), offset(to)),
    replaceRange: (...args: Parameters<MyEditor["replaceRange"]>) =>
      new MyEditor({ cm: view } as never).replaceRange(...args),
    setSelections: (ranges: MyEditorSelection[]) =>
      view.dispatch({
        selection: EditorSelection.create(
          ranges.map((range) =>
            EditorSelection.range(offset(range.anchor), offset(range.head)),
          ),
        ),
      }),
    fold: (line: number) => {
      const root = new Parser(makeLogger(), settings).parse(reader, {
        line,
        ch: 0,
      });
      const list = root?.getListUnderLine(line);
      if (!list) return;
      const from = view.state.doc.line(line + 1).to;
      const to = view.state.doc.line(
        list.getContentEndIncludingChildren().line + 1,
      ).to;
      if (to > from) view.dispatch({ effects: foldEffect.of({ from, to }) });
    },
    unfold: (line: number) => {
      const effects: ReturnType<typeof unfoldEffect.of>[] = [];
      foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
        if (view.state.doc.lineAt(from).number === line + 1)
          effects.push(unfoldEffect.of({ from, to }));
      });
      if (effects.length) view.dispatch({ effects });
    },
  } as unknown as MyEditor;
  const settings = makeSettings();
  settings.keepCursorWithinContent = keepCursor;
  const performer = new OperationPerformer(
    new Parser(makeLogger(), settings),
    new ChangesApplicator(),
  );
  performer.perform(
    (root) => new CreateNewItem(root, "\t", numericBullets),
    reader,
  );
  // Obsidian's selection coordinator performs this operation after Enter.
  if (repairCursor)
    performer.perform((root) => new KeepCursorWithinListContent(root), reader);
}

test("release audit: Enter splitting an ordered root adds a child without renumbering its hidden sibling", () => {
  const original = "- work\n\t1. project\n\t\t- task\n\t2. other\n- personal";
  const { view } = editor(original, 2, "project");
  view.dispatch({ selection: { anchor: view.state.selection.main.head + 3 } });
  enter(view, true);
  expect(view.state.doc.toString()).toBe(
    "- work\n\t1. pro\n\t\t- ject\n\t\t- task\n\t2. other\n- personal",
  );
});

test("release audit: Enter after visible leaf under unnormalized hidden ordered root inserts child", () => {
  const original = "9. work\n\t- project\n\t\t- task\n\t- other\n- personal";
  const { view } = editor(original, 2, "project");
  view.dispatch({ selection: { anchor: view.state.doc.line(3).to } });
  enter(view, true);
  expect(view.state.doc.toString()).toBe(
    "9. work\n\t- project\n\t\t- task\n\t\t- \n\t- other\n- personal",
  );
});

test.each(["-", "1."])(
  "release audit: root split with %s leaves the new body available for typing",
  (marker) => {
    const original = `- work\n\t${marker} project\n\t\t- task\n- personal`;
    const { view, zoom } = editor(original, 2, "project");
    view.dispatch({
      selection: { anchor: view.state.selection.main.head + 3 },
    });
    enter(view, true);
    const after =
      marker === "-"
        ? "- work\n\t- pro\n\t\t- ject\n\t\t- task\n- personal"
        : "- work\n\t1. pro\n\t\t- ject\n\t\t- task\n- personal";
    expect(view.state.doc.toString()).toBe(after);
    expect(view.state.selection.main.head).toBe(after.indexOf("ject"));
    expect(zoom.range(view.state)?.from).toBe(view.state.doc.line(2).from);
    view.dispatch({
      changes: { from: view.state.selection.main.head, insert: "new " },
      annotations: isolateHistory.of("full"),
      userEvent: "input",
    });
    expect(view.state.doc.toString()).toBe(after.replace("ject", "new ject"));
    undo(view);
    expect(view.state.doc.toString()).toBe(after);
    undo(view);
    expect(view.state.doc.toString()).toBe(original);
    redo(view);
    expect(view.state.doc.toString()).toBe(after);
    expect(view.state.selection.main.head).toBe(after.indexOf("ject"));
  },
);

test.each([
  {
    name: "unchecked numbered task with a hidden sibling",
    original:
      "- work\n\t1. [ ] project\n\t\t- task\n\t2. [ ] other\n- personal",
    after:
      "- work\n\t1. [ ] pro\n\t\t- [ ] ject\n\t\t- task\n\t2. [ ] other\n- personal",
    cursor: "ject",
  },
  {
    name: "checked task with spaces",
    original: "- work\n    - [x] project\n        - task\n- personal",
    after:
      "- work\n    - [x] pro\n        - [ ] ject\n        - task\n- personal",
    cursor: "ject",
  },
  {
    name: "leaf root end before hidden text",
    original: "- work\n\t- project\n- personal",
    after: "- work\n\t- project\n\t\t- \n- personal",
    cursor: "\n- personal",
  },
  {
    name: "leaf root end at EOF",
    original: "- work\n\t- project",
    after: "- work\n\t- project\n\t\t- ",
    cursor: "",
  },
])(
  "Enter creates an editable first child and retains the focused root: $name",
  ({ original, after, cursor }) => {
    const { view, zoom } = editor(original, 2, "project");
    view.dispatch({
      selection: {
        anchor: view.state.selection.main.head + (cursor === "ject" ? 3 : 7),
      },
    });
    enter(view, true);
    const destination = cursor ? after.indexOf(cursor) : after.length;
    expect(view.state.doc.toString()).toBe(after);
    expect(view.state.selection.main.head).toBe(destination);
    expect(zoom.range(view.state)?.from).toBe(view.state.doc.line(2).from);
    view.dispatch({
      changes: { from: view.state.selection.main.head, insert: "NEXT" },
      annotations: isolateHistory.of("full"),
      userEvent: "input",
    });
    const typed =
      after.slice(0, destination) + "NEXT" + after.slice(destination);
    expect(view.state.doc.toString()).toBe(typed);
    undo(view);
    expect(view.state.doc.toString()).toBe(after);
    undo(view);
    expect(view.state.doc.toString()).toBe(original);
    redo(view);
    expect(view.state.doc.toString()).toBe(after);
    expect(view.state.selection.main.head).toBe(destination);
    redo(view);
    expect(view.state.doc.toString()).toBe(typed);
  },
);

test.each([
  { name: "hidden body", before: "2. other", after: "3. changed" },
  { name: "arbitrary hidden number", before: "2. other", after: "90. other" },
  { name: "hidden indent", before: "2. other", after: "\t3. other" },
])(
  "a visible split cannot authorize an unrelated $name edit",
  ({ before, after }) => {
    const original = `- work\n\t1. project\n\t\t- task\n\t${before}\n- personal`;
    const { view, zoom } = editor(original, 2, "project");
    const cursor = view.state.selection.main.head + 3;
    view.dispatch({ selection: { anchor: cursor } });
    view.dispatch({
      changes: {
        from: 7,
        to: original.indexOf("\n- personal"),
        insert: `\t1. pro\n\t\t- ject\n\t\t- task\n\t${after}`,
      },
    });
    expect(view.state.doc.toString()).toBe(original);
    expect(view.state.selection.main.head).toBe(cursor);
    expect(zoom.range(view.state)?.from).toBe(7);
  },
);

test("a child insertion cannot authorize hidden renumbering", () => {
  const original = "- work\n\t1. project\n\t\t- task\n\t2. other\n- personal";
  const { view, zoom } = editor(original, 2, "project");
  view.dispatch({
    changes: {
      from: 7,
      to: original.indexOf("\n- personal"),
      insert: "\t1. pro\n\t\t- ject\n\t\t- task\n\t3. other",
    },
  });
  expect(view.state.doc.toString()).toBe(original);
  expect(zoom.range(view.state)?.from).toBe(7);
});

test("an Enter inside the focused subtree keeps zoom and its redo cursor on the new child", () => {
  const original = "- work\n\t- project\n\t\t- task\n- personal";
  const { view, zoom } = editor(original, 2, "project");
  view.dispatch({ selection: { anchor: original.indexOf("task") + 2 } });
  enter(view, true);
  const after = "- work\n\t- project\n\t\t- ta\n\t\t- sk\n- personal";
  expect(view.state.doc.toString()).toBe(after);
  expect(view.state.selection.main.head).toBe(after.indexOf("sk"));
  expect(zoom.range(view.state)?.from).toBe(7);
  undo(view);
  expect(view.state.doc.toString()).toBe(original);
  redo(view);
  expect(view.state.doc.toString()).toBe(after);
  expect(view.state.selection.main.head).toBe(after.indexOf("sk"));
  view.dispatch({
    changes: { from: view.state.selection.main.head, insert: "NEXT" },
    userEvent: "input",
  });
  expect(view.state.doc.toString()).toBe(after.replace("sk", "NEXTsk"));
});

test("an unordered split remains editable when automatic numbering is disabled", () => {
  const original = "9. work\n\t- project\n\t\t- task\n- personal";
  const { view, zoom } = editor(original, 2, "project");
  view.dispatch({ selection: { anchor: view.state.selection.main.head + 3 } });
  enter(view, true, false);
  const after = "9. work\n\t- pro\n\t\t- ject\n\t\t- task\n- personal";
  expect(view.state.doc.toString()).toBe(after);
  expect(view.state.selection.main.head).toBe(after.indexOf("ject"));
  expect(zoom.range(view.state)?.from).toBe(view.state.doc.line(2).from);
  view.dispatch({
    changes: { from: view.state.selection.main.head, insert: "NEXT" },
    userEvent: "input",
  });
  expect(view.state.doc.toString()).toBe(after.replace("ject", "NEXTject"));
});

test.each([false, true])(
  "replacing a selected body range moves the remainder into a visible child (reverse: %s)",
  (reverse) => {
    const original = "- work\n\t1. project\n\t\t- task\n\t2. other\n- personal";
    const { view, zoom } = editor(original, 2, "project");
    const from = original.indexOf("ject");
    view.dispatch({
      selection: EditorSelection.single(
        reverse ? from + 3 : from,
        reverse ? from : from + 3,
      ),
    });
    enter(view, true);
    const after =
      "- work\n\t1. pro\n\t\t- t\n\t\t- task\n\t2. other\n- personal";
    const destination = after.indexOf("- t") + 2;
    expect(view.state.doc.toString()).toBe(after);
    expect(view.state.selection.main.head).toBe(destination);
    expect(zoom.range(view.state)?.from).toBe(view.state.doc.line(2).from);
    undo(view);
    expect(view.state.doc.toString()).toBe(original);
    expect(view.state.selection.main.from).toBe(from);
    expect(view.state.selection.main.to).toBe(from + 3);
    redo(view);
    expect(view.state.doc.toString()).toBe(after);
    expect(view.state.selection.main.head).toBe(destination);
    view.dispatch({
      changes: { from: view.state.selection.main.head, insert: "NEXT" },
      userEvent: "input",
    });
    expect(view.state.doc.toString()).toBe(after.replace("- t", "- NEXTt"));
  },
);

test("Enter after a folded focused root opens an editable first child", () => {
  const original = "- work\n\t- project\n\t\t- task\n- personal";
  const { view, zoom } = editor(original, 2, "project");
  view.dispatch({
    effects: foldEffect.of({
      from: view.state.doc.line(2).to,
      to: view.state.doc.line(3).to,
    }),
    selection: { anchor: view.state.doc.line(2).to },
  });
  enter(view, true);
  const after = "- work\n\t- project\n\t\t- \n\t\t- task\n- personal";
  const destination = after.indexOf("\n\t\t- task");
  expect(view.state.doc.toString()).toBe(after);
  expect(view.state.selection.main.head).toBe(destination);
  expect(zoom.range(view.state)?.from).toBe(view.state.doc.line(2).from);
  view.dispatch({
    changes: { from: view.state.selection.main.head, insert: "NEXT" },
    userEvent: "input",
    annotations: isolateHistory.of("full"),
  });
  expect(view.state.doc.toString()).toBe(
    after.replace("\n\t\t- task", "NEXT\n\t\t- task"),
  );
  undo(view);
  undo(view);
  expect(view.state.doc.toString()).toBe(original);
  redo(view);
  expect(view.state.doc.toString()).toBe(after);
  expect(view.state.selection.main.head).toBe(destination);
});

test.each([undefined, "input"])(
  "empty child insertion cannot smuggle arbitrary hidden numbering (%s)",
  (userEvent) => {
    const original = "- work\n\t1. project\n\t\t- task\n\t2. other\n- personal";
    const { view, zoom } = editor(original, 2, "project");
    view.dispatch({
      changes: {
        from: 7,
        to: original.indexOf("\n- personal"),
        insert: "\t1. project\n\t\t- \n\t\t- task\n\t999999. other",
      },
      userEvent,
    });
    expect(view.state.doc.toString()).toBe(original);
    expect(zoom.range(view.state)?.from).toBe(7);
  },
);

test.each([false, true])(
  "checked task Enter preserves the accepted cursor without a repair handler (zoom: %s)",
  (useZoom) => {
    const original = "- work\n\t1. [x] project\n\t\t- task\n- personal";
    const { view, zoom } = editor(
      original,
      useZoom ? 2 : undefined,
      "project",
      "never",
    );
    view.dispatch({ selection: { anchor: original.indexOf("project") } });
    enter(view, false, true, "never");
    const after = useZoom
      ? "- work\n\t1. [x] project\n\t\t- [ ] \n\t\t- task\n- personal"
      : "- work\n\t1. [ ] \n\t2. [x] project\n\t\t- task\n- personal";
    const destination = useZoom
      ? after.indexOf("\n\t\t- task")
      : after.indexOf("\n\t2.");
    expect(view.state.doc.toString()).toBe(after);
    expect(view.state.selection.main.head).toBe(destination);
    if (useZoom)
      expect(zoom.range(view.state)?.from).toBe(view.state.doc.line(2).from);
    view.dispatch({
      changes: { from: view.state.selection.main.head, insert: "NEXT" },
      userEvent: "input",
      annotations: isolateHistory.of("full"),
    });
    const typed = useZoom
      ? "- work\n\t1. [x] project\n\t\t- [ ] NEXT\n\t\t- task\n- personal"
      : "- work\n\t1. [ ] NEXT\n\t2. [x] project\n\t\t- task\n- personal";
    expect(view.state.doc.toString()).toBe(typed);
    undo(view);
    expect(view.state.doc.toString()).toBe(after);
    undo(view);
    expect(view.state.doc.toString()).toBe(original);
    redo(view);
    expect(view.state.doc.toString()).toBe(after);
    expect(view.state.selection.main.head).toBe(destination);
  },
);

test.each([false, true])(
  "rejects a native root split into a sibling and preserves continued root typing (explicit selection: %s)",
  (explicitSelection) => {
    const original = "- work\n\t1. project\n\t\t- task\n\t2. other\n- personal";
    const { view, zoom } = editor(original, 2, "project");
    const split = original.indexOf("project") + 3;
    view.dispatch({ selection: { anchor: split } });
    view.dispatch({
      // Native Enter may replace the preceding character and map selection.
      changes: { from: split - 1, to: split, insert: "o\n\t2. " },
      selection: explicitSelection ? { anchor: split + 5 } : undefined,
      userEvent: "input.type",
      annotations: isolateHistory.of("full"),
    });
    expect(view.state.doc.toString()).toBe(original);
    expect(zoom.range(view.state)?.from).toBe(7);
    expect(view.state.selection.main.head).toBe(split);
    view.dispatch({
      changes: { from: view.state.selection.main.head, insert: "NEXT" },
      userEvent: "input",
      annotations: isolateHistory.of("full"),
    });
    expect(view.state.doc.toString()).toBe(
      original.replace("project", "proNEXTject"),
    );
    undo(view);
    expect(view.state.doc.toString()).toBe(original);
    expect(zoom.range(view.state)?.from).toBe(7);
    redo(view);
    expect(view.state.doc.toString()).toBe(
      original.replace("project", "proNEXTject"),
    );
  },
);

test.each([false, true])(
  "rejects a native sibling before the focused body without moving the cursor (explicit selection: %s)",
  (explicitSelection) => {
    const original = "- work\n\t1. project\n\t\t- task\n- personal";
    const { view, zoom } = editor(original, 2, "project");
    const from = original.indexOf("project");
    view.dispatch({
      changes: { from: from - 1, to: from, insert: " \n\t2. " },
      selection: explicitSelection ? { anchor: from + 5 } : undefined,
      userEvent: "input.type",
    });
    expect(view.state.doc.toString()).toBe(original);
    expect(zoom.range(view.state)?.from).toBe(7);
    expect(view.state.selection.main.head).toBe(from);
    view.dispatch({
      changes: { from: view.state.selection.main.head, insert: "NEXT" },
      userEvent: "input",
    });
    expect(view.state.doc.toString()).toBe(
      original.replace("project", "NEXTproject"),
    );
  },
);

test("a native child split cannot accompany a hidden document edit", () => {
  const original = "- work\n\t1. project\n\t\t- task\n\t2. other\n- personal";
  const { view, zoom } = editor(original, 2, "project");
  const split = original.indexOf("project") + 3;
  view.dispatch({ selection: { anchor: split } });
  view.dispatch({
    changes: [
      { from: split, insert: "\n\t\t- " },
      { from: original.indexOf("other"), insert: "changed " },
    ],
    selection: { anchor: split + 6 },
    userEvent: "input",
  });
  expect(view.state.doc.toString()).toBe(original);
  expect(view.state.selection.main.head).toBe(split);
  expect(zoom.range(view.state)?.from).toBe(7);
});

test("a folded checked root reveals its new child without a repair handler", () => {
  const original = "- work\n\t1. [x] project\n\t\t- task\n- personal";
  const { view, zoom } = editor(original, 2, "project", "never");
  view.dispatch({
    effects: foldEffect.of({
      from: view.state.doc.line(2).to,
      to: view.state.doc.line(3).to,
    }),
  });
  enter(view, false, true, "never");
  const after = "- work\n\t1. [x] project\n\t\t- [ ] \n\t\t- task\n- personal";
  expect(view.state.doc.toString()).toBe(after);
  expect(view.state.selection.main.head).toBe(after.indexOf("\n\t\t- task"));
  expect(zoom.range(view.state)?.from).toBe(view.state.doc.line(2).from);
  const folds: [number, number][] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
    folds.push([from, to]);
  });
  expect(folds).toEqual([]);
  view.dispatch({
    changes: { from: view.state.selection.main.head, insert: "NEXT" },
    userEvent: "input",
  });
  expect(view.state.doc.toString()).toBe(
    after.replace("\n\t\t- task", "NEXT\n\t\t- task"),
  );
});
