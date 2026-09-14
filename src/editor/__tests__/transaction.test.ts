import { history, historyField, redo, undo } from "@codemirror/commands";
import {
  ChangeSet,
  EditorSelection,
  EditorState,
  Transaction,
  TransactionSpec,
} from "@codemirror/state";

import { MyEditor, MyEditorPosition } from "..";

import { makeLogger, makeSettings } from "../../__mocks__";
import { CreateNewItem } from "../../operations/CreateNewItem";
import { ChangesApplicator } from "../../services/ChangesApplicator";
import { OperationPerformer } from "../../services/OperationPerformer";
import { Parser } from "../../services/Parser";

jest.mock("obsidian", () => ({ editorInfoField: {} }), { virtual: true });

function setup(text: string, cursor: number) {
  const view = {
    state: EditorState.create({
      doc: text,
      selection: { anchor: cursor },
      extensions: history(),
    }),
    dispatch(tr: Transaction | TransactionSpec) {
      view.state =
        tr instanceof Transaction ? tr.state : view.state.update(tr).state;
    },
  };
  const offset = (position: MyEditorPosition, state = view.state) =>
    state.doc.line(position.line + 1).from + position.ch;
  const position = (offset: number) => {
    const line = view.state.doc.lineAt(offset);
    return { line: line.number - 1, ch: offset - line.from };
  };
  const editor = new MyEditor({
    cm: view,
    getCursor: () => position(view.state.selection.main.head),
    getLine: (line: number) => view.state.doc.line(line + 1).text,
    lastLine: () => view.state.doc.lines - 1,
    listSelections: () =>
      view.state.selection.ranges.map((range) => ({
        anchor: position(range.anchor),
        head: position(range.head),
      })),
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
    setSelections: (
      selections: { anchor: MyEditorPosition; head: MyEditorPosition }[],
    ) =>
      view.dispatch({
        selection: EditorSelection.create(
          selections.map(({ anchor, head }) =>
            EditorSelection.range(offset(anchor), offset(head)),
          ),
        ),
      }),
  } as never);
  return { editor, view };
}

function undoWithLegacySelectionMapping(
  view: ReturnType<typeof setup>["view"],
) {
  // Obsidian 1.14's bundled history maps the event's original selection when
  // no later selection transaction was recorded. Recent CM uses the current
  // selection instead. Set that fallback without recording it, so the same
  // undo command exercises the bundled behavior as well.
  const events = view.state.field(historyField) as {
    done: {
      startSelection: EditorSelection;
      changes: ChangeSet;
      selectionsAfter: EditorSelection[];
    }[];
  };
  const event = events.done[events.done.length - 1];
  if (!event.selectionsAfter.length) {
    view.dispatch({
      selection: event.startSelection.map(event.changes.invertedDesc, 1),
      annotations: Transaction.addToHistory.of(false),
      filter: false,
    });
  }
  return undo(view);
}

describe.each([
  { history: "current CodeMirror", undo },
  {
    history: "Obsidian's legacy selection fallback",
    undo: undoWithLegacySelectionMapping,
  },
])("$history", ({ undo }) => {
  test.each([
    {
      name: "root split",
      original: "- project",
      cursor: 5,
      after: "- pro\n- ject",
      destination: 8,
    },
    {
      name: "root end",
      original: "- project",
      cursor: 9,
      after: "- project\n- ",
      destination: 12,
    },
    {
      name: "ordered split",
      original: "1. project\n2. other",
      cursor: 6,
      after: "1. pro\n2. ject\n3. other",
      destination: 10,
    },
    {
      name: "checked task start",
      original: "1. [x] project",
      cursor: 7,
      after: "1. [ ] \n2. [x] project",
      destination: 7,
    },
  ])(
    "Redo after $name restores the Enter destination before typing",
    ({ original, cursor, after, destination }) => {
      const { editor, view } = setup(original, cursor);
      const performer = new OperationPerformer(
        new Parser(makeLogger(), makeSettings()),
        new ChangesApplicator(),
      );
      performer.perform((root) => new CreateNewItem(root, "\t", true), editor);
      expect(view.state.doc.toString()).toBe(after);
      expect(view.state.selection.main.head).toBe(destination);
      undo(view);
      expect(view.state.doc.toString()).toBe(original);
      expect(view.state.selection.main.head).toBe(cursor);
      redo(view);
      expect(view.state.doc.toString()).toBe(after);
      expect(view.state.selection.main.head).toBe(destination);
      view.dispatch({
        changes: { from: view.state.selection.main.head, insert: "NEXT" },
        userEvent: "input",
      });
      expect(view.state.doc.toString()).toBe(
        after.slice(0, destination) + "NEXT" + after.slice(destination),
      );
    },
  );
});
