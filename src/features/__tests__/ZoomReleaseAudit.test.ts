import { history, isolateHistory, redo, undo } from "@codemirror/commands";
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
import {
  CrossNoteMove,
  coordinateCrossNoteHistory,
  crossNoteHistory,
} from "../CrossNoteMove";
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

function editor(doc: string, zoomLine?: number, body?: string) {
  const zoom = new ListZoomState(new Parser(makeLogger(), makeSettings()));
  const view = {
    state: EditorState.create({
      doc,
      extensions: [
        history(),
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

function enter(view: ReturnType<typeof editor>["view"], repairCursor = false) {
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
    getAllFoldedLines: () => [],
    getRange: (from: MyEditorPosition, to: MyEditorPosition) =>
      view.state.doc.sliceString(offset(from), offset(to)),
    replaceRange: (
      insert: string,
      from: MyEditorPosition,
      to: MyEditorPosition,
    ) =>
      view.dispatch({
        changes: { from: offset(from), to: offset(to), insert },
      }),
    setSelections: (ranges: MyEditorSelection[]) =>
      view.dispatch({
        selection: EditorSelection.create(
          ranges.map((range) =>
            EditorSelection.range(offset(range.anchor), offset(range.head)),
          ),
        ),
      }),
    fold: () => {},
    unfold: () => {},
  } as unknown as MyEditor;
  const performer = new OperationPerformer(
    new Parser(makeLogger(), makeSettings()),
    new ChangesApplicator(),
  );
  performer.perform((root) => new CreateNewItem(root, "\t", true), reader);
  // Obsidian's selection coordinator performs this operation after Enter.
  if (repairCursor)
    performer.perform((root) => new KeepCursorWithinListContent(root), reader);
}

const markerCases = [
  { name: "tabs / dash", indent: "\t", marker: "- " },
  { name: "spaces / star", indent: "    ", marker: "* " },
  { name: "mixed indent / plus", indent: "\t  ", marker: "+ " },
  { name: "tabs / ordered", indent: "\t", marker: "12. " },
  { name: "spaces / unchecked", indent: "    ", marker: "- [ ] " },
  { name: "tabs / checked", indent: "\t", marker: "- [x] " },
];

describe.each(markerCases)(
  "zoom insertion audit: $name",
  ({ indent, marker }) => {
    const focusedLine = `${indent}${marker}project`;
    const childLine = `${indent}\t- task`;
    const original = `- work\n${focusedLine}\n${childLine}\n- personal`;
    const inserted = `${indent}${marker}new\n`;

    test.each(["precise", "whole", "line", "parent-context"])(
      "keeps the original item editable through %s insertion and native history",
      (kind) => {
        const { view, zoom } = editor(original, 2, "project");
        const before = view.state.selection.main.head;
        const root = view.state.doc.line(2).from;
        const expected = `- work\n${inserted}${focusedLine}\n${childLine}\n- personal`;
        const changes =
          kind === "precise"
            ? { from: root, insert: inserted }
            : kind === "whole"
              ? { from: 0, to: original.length, insert: expected }
              : kind === "line"
                ? {
                    from: root,
                    to: view.state.doc.line(2).to,
                    insert: inserted + focusedLine,
                  }
                : {
                    from: 0,
                    to: 6,
                    insert: "- work\n" + inserted.slice(0, -1),
                  };
        view.dispatch({
          changes,
          userEvent: kind === "whole" ? "set" : "input",
          annotations: isolateHistory.of("full"),
        });
        expect(view.state.doc.toString()).toBe(expected);
        expect(zoom.range(view.state)?.from).toBe(root + inserted.length);
        expect(view.state.selection.main.head).toBe(before + inserted.length);
        view.dispatch({
          changes: { from: view.state.selection.main.head, insert: "updated " },
          userEvent: "input",
          annotations: isolateHistory.of("full"),
        });
        expect(view.state.doc.line(3).text).toBe(
          `${indent}${marker}updated project`,
        );
        expect(undo(view)).toBe(true);
        expect(view.state.doc.toString()).toBe(expected);
        expect(redo(view)).toBe(true);
        expect(view.state.doc.line(3).text).toBe(
          `${indent}${marker}updated project`,
        );
        expect(zoom.range(view.state)?.from).toBe(view.state.doc.line(3).from);
        expect(undo(view)).toBe(true);
        expect(undo(view)).toBe(true);
        expect(view.state.doc.toString()).toBe(original);
        // Undo changes a now-hidden sibling, so existing policy reveals it.
        expect(zoom.range(view.state)).toBeNull();
        expect(redo(view)).toBe(true);
        expect(view.state.doc.toString()).toBe(expected);
      },
    );
  },
);

test.each(["1.", "9.", "99."])(
  "Enter before a zoomed ordered %s item keeps typing and history on the original body",
  (marker) => {
    const original = `- work\n\t${marker} project\n\t\t- task\n- personal`;
    const { view, zoom } = editor(original, 2, "project");
    enter(view);
    const first = "- work\n\t1. \n\t2. project\n\t\t- task\n- personal";
    expect(view.state.doc.toString()).toBe(first);
    expect(zoom.range(view.state)?.from).toBe(view.state.doc.line(3).from);
    expect(view.state.selection.main.head).toBe(
      view.state.doc.line(3).from + 4,
    );
    // Separate the two Enter commands into native history steps.
    view.dispatch({ annotations: isolateHistory.of("full") });
    enter(view);
    const second = "- work\n\t1. \n\t2. \n\t3. project\n\t\t- task\n- personal";
    expect(view.state.doc.toString()).toBe(second);
    expect(zoom.range(view.state)?.from).toBe(view.state.doc.line(4).from);
    expect(view.state.selection.main.head).toBe(
      view.state.doc.line(4).from + 4,
    );
    view.dispatch({
      changes: { from: view.state.selection.main.head, insert: "updated " },
      userEvent: "input",
      annotations: isolateHistory.of("full"),
    });
    expect(view.state.doc.line(4).text).toBe("\t3. updated project");
    undo(view);
    expect(view.state.doc.toString()).toBe(second);
    redo(view);
    expect(view.state.doc.line(4).text).toBe("\t3. updated project");
    undo(view);
    undo(view);
    expect(view.state.doc.toString()).toBe(first);
    expect(zoom.range(view.state)).toBeNull();
    undo(view);
    expect(view.state.doc.toString()).toBe(original);
  },
);

test.each(["[ ]", "[x]"])(
  "Enter before a zoomed numbered task %s follows its original item",
  (checkbox) => {
    const { view, zoom } = editor(
      `- work\n\t1. ${checkbox} project\n\t\t- task\n- personal`,
      2,
      "project",
    );
    enter(view);
    expect(view.state.doc.toString()).toBe(
      `- work\n\t1. [ ] \n\t2. ${checkbox} project\n\t\t- task\n- personal`,
    );
    expect(zoom.range(view.state)?.from).toBe(view.state.doc.line(3).from);
  },
);

describe.each(["", "[ ] ", "[x] "])(
  "ordered siblings with checkbox %j",
  (checkbox) => {
    test.each([false, true])(
      "Enter renumbers hidden siblings and preserves focus (preceding sibling: %s)",
      (hasBefore) => {
        const beforeLine = hasBefore ? `\t1. ${checkbox}before\n` : "";
        const number = hasBefore ? 2 : 1;
        const original = `- work\n${beforeLine}\t${number}. ${checkbox}project\n\t\t- task\n\t${number + 1}. ${checkbox}other\n- personal`;
        const rootLine = hasBefore ? 3 : 2;
        const { view, zoom } = editor(original, rootLine, "project");
        enter(view, true);
        const empty = checkbox ? "[ ] " : "";
        const expected = `- work\n${beforeLine}\t${number}. ${empty}\n\t${number + 1}. ${checkbox}project\n\t\t- task\n\t${number + 2}. ${checkbox}other\n- personal`;
        expect(view.state.doc.toString()).toBe(expected);
        expect(zoom.range(view.state)?.from).toBe(
          view.state.doc.line(rootLine + 1).from,
        );
        expect(view.state.selection.main.head).toBe(
          expected.indexOf("project"),
        );
        view.dispatch({
          changes: { from: view.state.selection.main.head, insert: "updated " },
          userEvent: "input",
          annotations: isolateHistory.of("full"),
        });
        expect(view.state.doc.toString()).toBe(
          expected.replace("project", "updated project"),
        );
        undo(view);
        expect(view.state.doc.toString()).toBe(expected);
        undo(view);
        expect(view.state.doc.toString()).toBe(original);
        expect(zoom.range(view.state)).toBeNull();
        redo(view);
        expect(view.state.doc.toString()).toBe(expected);
        expect(view.state.selection.main.head).toBe(
          expected.indexOf("project"),
        );
      },
    );
  },
);

test.each([
  {
    name: "hidden descendant",
    original:
      "- work\n\t1. project\n\t\t- task\n\t2. other\n\t\t9. nested\n- personal",
    expected:
      "- work\n\t1. \n\t2. project\n\t\t- task\n\t3. other\n\t\t1. nested\n- personal",
  },
  {
    name: "hidden ancestor",
    original: "9. work\n\t1. project\n\t\t- task\n\t2. other\n- personal",
    expected:
      "1. work\n\t1. \n\t2. project\n\t\t- task\n\t3. other\n- personal",
  },
  {
    name: "hidden bare ordered item",
    original: "- work\n\t1. project\n\t\t- task\n\t2.\n- personal",
    expected: "- work\n\t1. \n\t2. project\n\t\t- task\n\t3.\n- personal",
  },
])(
  "Enter preserves recursive normalization of a $name",
  ({ original, expected }) => {
    const { view, zoom } = editor(original, 2, "project");
    enter(view, true);
    expect(view.state.doc.toString()).toBe(expected);
    expect(zoom.range(view.state)?.from).toBe(view.state.doc.line(3).from);
    expect(view.state.selection.main.head).toBe(expected.indexOf("project"));
    view.dispatch({
      changes: { from: view.state.selection.main.head, insert: "updated " },
      userEvent: "input",
      annotations: isolateHistory.of("full"),
    });
    expect(view.state.doc.toString()).toBe(
      expected.replace("project", "updated project"),
    );
    undo(view);
    expect(view.state.doc.toString()).toBe(expected);
    undo(view);
    expect(view.state.doc.toString()).toBe(original);
    expect(zoom.range(view.state)).toBeNull();
    redo(view);
    expect(view.state.doc.toString()).toBe(expected);
    expect(view.state.selection.main.head).toBe(expected.indexOf("project"));
  },
);

test.each([
  { original: "\t2. other", replacement: "\t3. changed" },
  { original: "\t2. [x] other", replacement: "\t3. [ ] other" },
  { original: "\t2. other", replacement: "\t\t3. other" },
  {
    original: "\t- ```md\n\t  1. literal\n\t  ```",
    replacement: "\t- ```md\n\t  2. literal\n\t  ```",
  },
  {
    original: "\n- another\n\t1. external",
    replacement: "\n- another\n\t2. external",
  },
])(
  "does not authorize hidden edits combined with an ordered insertion: $replacement",
  ({ original: hidden, replacement }) => {
    const original = `- work\n\t1. project\n\t\t- task\n${hidden}\n- personal`;
    const { view, zoom } = editor(original, 2, "project");
    view.dispatch({
      changes: {
        from: 7,
        to: original.length - "\n- personal".length,
        insert: `\t1. \n\t2. project\n\t\t- task\n${replacement}`,
      },
    });
    expect(view.state.doc.toString()).toBe(original);
    expect(zoom.range(view.state)?.from).toBe(7);
    expect(view.state.selection.main.head).toBe(11);
  },
);

test("does not authorize a hidden sibling renumber without an ordered insertion", () => {
  const original = "- work\n\t1. project\n\t\t- task\n\t2. other";
  const { view, zoom } = editor(original, 2, "project");
  const digit = original.indexOf("2. other");
  view.dispatch({
    changes: { from: digit, to: digit + 1, insert: "3" },
    userEvent: "input",
  });
  expect(view.state.doc.toString()).toBe(original);
  expect(zoom.range(view.state)?.from).toBe(7);
});

test.each(["set", "undo", "redo"])(
  "reveals hidden sibling renumbering delivered as %s even when it matches local Enter",
  (userEvent) => {
    const original = "- work\n\t1. project\n\t\t- task\n\t2. other\n- personal";
    const next =
      "- work\n\t1. \n\t2. project\n\t\t- task\n\t3. other\n- personal";
    const { view, zoom } = editor(original, 2, "project");
    view.dispatch({
      changes: { from: 0, to: original.length, insert: next },
      userEvent,
      filter: userEvent === "set",
    });
    expect(view.state.doc.toString()).toBe(next);
    expect(zoom.range(view.state)).toBeNull();
  },
);

test("does not authorize hidden renumbering after a malformed empty task marker", () => {
  const original = "- work\n\t1. project\n\t\t- task\n\t2. other\n- personal";
  const { view, zoom } = editor(original, 2, "project");
  view.dispatch({
    changes: {
      from: 7,
      to: original.indexOf("\n- personal"),
      insert: "\t1.[ ]\n\t2. project\n\t\t- task\n\t3. other",
    },
  });
  expect(view.state.doc.toString()).toBe(original);
  expect(zoom.range(view.state)?.from).toBe(7);
});

test("ordered insertion preserves an explicit visible caller selection", () => {
  const original = "- work\n\t1. project\n\t\t- task\n- personal";
  const next = "- work\n\t1. \n\t2. project\n\t\t- task\n- personal";
  const { view, zoom } = editor(original, 2, "project");
  view.dispatch({
    changes: { from: 0, to: original.length, insert: next },
    selection: EditorSelection.single(
      next.indexOf("task"),
      next.indexOf("task") + 4,
    ),
    userEvent: "set",
  });
  expect(view.state.doc.toString()).toBe(next);
  expect(zoom.range(view.state)?.from).toBe(12);
  expect(
    view.state.doc.sliceString(
      view.state.selection.main.from,
      view.state.selection.main.to,
    ),
  ).toBe("task");
});

test.each(["input", "set"])(
  "ordered body tracking does not conceal a hidden parent edit (%s)",
  (userEvent) => {
    const original = "- work\n\t1. project\n\t\t- task\n- personal";
    const { view, zoom } = editor(original, 2, "project");
    view.dispatch({
      changes: [
        { from: 2, to: 6, insert: "office" },
        { from: 11, insert: "\n\t2. " },
      ],
      userEvent,
    });
    expect(view.state.doc.toString()).toBe(
      userEvent === "input"
        ? original
        : "- office\n\t1. \n\t2. project\n\t\t- task\n- personal",
    );
    if (userEvent === "input") expect(zoom.range(view.state)?.from).toBe(7);
    else expect(zoom.range(view.state)).toBeNull();
  },
);

test("an ordered split in the middle keeps the first part as the focused item", () => {
  const { view, zoom } = editor(
    "- work\n\t1. project\n\t\t- task\n- personal",
    2,
    "project",
  );
  view.dispatch({ selection: { anchor: view.state.selection.main.head + 3 } });
  enter(view);
  expect(view.state.doc.toString()).toBe(
    "- work\n\t1. pro\n\t2. ject\n\t\t- task\n- personal",
  );
  expect(zoom.range(view.state)?.from).toBe(7);
});

test.each(["1.", "9.", "99."])(
  "Enter before an unindented zoomed %s item follows its original body",
  (marker) => {
    const { view, zoom } = editor(
      `${marker} project\n\t- task\n- personal`,
      1,
      "project",
    );
    enter(view);
    expect(view.state.doc.toString()).toBe(
      "1. \n2. project\n\t- task\n- personal",
    );
    expect(zoom.range(view.state)?.from).toBe(4);
    expect(view.state.selection.main.head).toBe(7);
    view.dispatch({
      changes: { from: view.state.selection.main.head, insert: "updated " },
      userEvent: "input",
    });
    expect(view.state.doc.line(2).text).toBe("2. updated project");
  },
);

test.each([
  { sourceZoom: false, targetZoom: false },
  { sourceZoom: true, targetZoom: false },
  { sourceZoom: false, targetZoom: true },
  { sourceZoom: true, targetZoom: true },
])(
  "moves the last visible code child with source zoom $sourceZoom and target zoom $targetZoom",
  ({ sourceZoom, targetZoom }) => {
    const sourceText =
      "- source\n\t- focus\n\t\t- ```js\n\t\t  - literal\n\t\t  ```\n\t- hidden";
    const targetText = "- target\n\t- focus\n\t\t- existing\n\t- hidden";
    const { view: source, zoom: sourceRange } = editor(
      sourceText,
      sourceZoom ? 2 : undefined,
    );
    const { view: target, zoom: targetRange } = editor(
      targetText,
      targetZoom ? 2 : undefined,
    );
    const move = new CrossNoteMove(
      source,
      target,
      { from: source.state.doc.line(3).from, to: source.state.doc.line(5).to },
      target.state.doc.line(3).from,
      "\t\t",
    );

    expect(move.apply()).toBe(true);
    const sourceAfter = "- source\n\t- focus\n\t- hidden";
    const targetAfter =
      "- target\n\t- focus\n\t\t- ```js\n\t\t  - literal\n\t\t  ```\n\t\t- existing\n\t- hidden";
    expect(source.state.doc.toString()).toBe(sourceAfter);
    expect(target.state.doc.toString()).toBe(targetAfter);
    if (sourceZoom) expect(sourceRange.range(source.state)?.from).toBe(9);
    if (targetZoom) expect(targetRange.range(target.state)?.from).toBe(9);
    undo(target);
    expect(source.state.doc.toString()).toBe(sourceText);
    expect(target.state.doc.toString()).toBe(targetText);
    redo(source);
    expect(source.state.doc.toString()).toBe(sourceAfter);
    expect(target.state.doc.toString()).toBe(targetAfter);
  },
);

test.each([
  {
    name: "the only child before a hidden sibling",
    text: "- source\n\t- focus\n\t\t- move\n\t- hidden",
    after: "- source\n\t- focus\n\t- hidden",
    moveLine: 3,
  },
  {
    name: "the last child after a visible survivor",
    text: "- source\n\t- focus\n\t\t- survivor\n\t\t- move\n\t- hidden",
    after: "- source\n\t- focus\n\t\t- survivor\n\t- hidden",
    moveLine: 4,
  },
  {
    name: "the first child before a visible survivor",
    text: "- source\n\t- focus\n\t\t- move\n\t\t- survivor\n\t- hidden",
    after: "- source\n\t- focus\n\t\t- survivor\n\t- hidden",
    moveLine: 3,
  },
  {
    name: "the only child at document EOF",
    text: "- source\n\t- focus\n\t\t- move",
    after: "- source\n\t- focus",
    moveLine: 3,
  },
])(
  "moves $name out of zoom with exact paired history",
  ({ text, after, moveLine }) => {
    const { view: source, zoom } = editor(text, 2, "focus");
    const { view: target } = editor("- destination");
    const line = source.state.doc.line(moveLine);
    expect(new CrossNoteMove(source, target, line, 13, "\t").apply()).toBe(
      true,
    );
    expect(source.state.doc.toString()).toBe(after);
    expect(target.state.doc.toString()).toBe("- destination\n\t- move");
    expect(zoom.range(source.state)?.from).toBe(9);
    undo(source);
    expect(source.state.doc.toString()).toBe(text);
    expect(target.state.doc.toString()).toBe("- destination");
    expect(zoom.range(source.state)?.from).toBe(9);
    redo(target);
    expect(source.state.doc.toString()).toBe(after);
    expect(target.state.doc.toString()).toBe("- destination\n\t- move");
    expect(zoom.range(source.state)?.from).toBe(9);
  },
);
