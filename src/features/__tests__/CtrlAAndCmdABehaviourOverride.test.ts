import {
  EditorSelection,
  EditorState,
  TransactionSpec,
} from "@codemirror/state";

import { makeLogger, makeSettings } from "../../__mocks__";
import { MyEditor, MyEditorPosition, MyEditorSelection } from "../../editor";
import { ChangesApplicator } from "../../services/ChangesApplicator";
import { OperationPerformer } from "../../services/OperationPerformer";
import { Parser } from "../../services/Parser";
import { CtrlAAndCmdABehaviourOverride } from "../CtrlAAndCmdABehaviourOverride";

jest.mock("obsidian", () => ({ editorInfoField: {} }), { virtual: true });

function makePane(text: string, cursor: number) {
  const view = {
    state: EditorState.create({ doc: text, selection: { anchor: cursor } }),
    dispatch(spec: TransactionSpec) {
      view.state = view.state.update(spec).state;
    },
  };
  const offset = (position: MyEditorPosition) =>
    view.state.doc.line(position.line + 1).from + position.ch;
  const position = (offset: number) => {
    const line = view.state.doc.lineAt(offset);
    return { line: line.number - 1, ch: offset - line.from };
  };
  const nativeEditor = {
    cm: view,
    getCursor: () => position(view.state.selection.main.head),
    getLine: (line: number) => view.state.doc.line(line + 1).text,
    lastLine: () => view.state.doc.lines - 1,
    listSelections: () =>
      view.state.selection.ranges.map(({ anchor, head }) => ({
        anchor: position(anchor),
        head: position(head),
      })),
    getRange: (from: MyEditorPosition, to: MyEditorPosition) =>
      view.state.doc.sliceString(offset(from), offset(to)),
    offsetToPos: position,
    setSelections: (selections: MyEditorSelection[]) =>
      view.dispatch({
        selection: EditorSelection.create(
          selections.map(({ anchor, head }) =>
            EditorSelection.range(offset(anchor), offset(head)),
          ),
        ),
      }),
  };
  return {
    view,
    editor: () => new MyEditor(nativeEditor as never),
    selectedText: () => {
      const { from, to } = view.state.selection.main;
      return view.state.doc.sliceString(from, to);
    },
    type: (text: string) => view.dispatch(view.state.replaceSelection(text)),
  };
}

function setup() {
  const settings = makeSettings();
  const feature = new CtrlAAndCmdABehaviourOverride(
    { registerEditorExtension: jest.fn(), addCommand: jest.fn() } as never,
    settings,
    { isOpened: () => false } as never,
    new OperationPerformer(
      new Parser(makeLogger(), settings),
      new ChangesApplicator(),
    ),
  );
  return {
    feature,
    press: (pane: ReturnType<typeof makePane>) => feature["run"](pane.editor()),
  };
}

test("keeps the cycle anchored across fresh editor wrappers", () => {
  const { press } = setup();
  const pane = makePane(
    "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
    11,
  );

  expect(press(pane).shouldStopPropagation).toBe(true);
  expect(pane.selectedText()).toBe("item 2");
  press(pane);
  expect(pane.selectedText()).toBe("item 2\n    - item 2.1\n    - item 2.2");
  press(pane);
  expect(pane.selectedText()).toBe(
    "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3",
  );
  press(pane);
  expect(pane.selectedText()).toBe("item 2");
});

test("another pane cannot change the item selected for replacement", () => {
  const { press } = setup();
  const paneA = makePane("- first A\n- second A", 12);
  const paneB = makePane("- first B\n- second B", 4);

  press(paneA);
  expect(paneA.selectedText()).toBe("second A");
  press(paneA);
  expect(paneA.selectedText()).toBe("- first A\n- second A");
  press(paneB);
  expect(paneB.selectedText()).toBe("first B");
  press(paneA);
  expect(paneA.selectedText()).toBe("second A");
  paneA.type("replacement");
  expect(paneA.view.state.doc.toString()).toBe("- first A\n- replacement");
  expect(paneB.view.state.doc.toString()).toBe("- first B\n- second B");
});

test("a manual selection starts a new cycle", () => {
  const { press } = setup();
  const pane = makePane("- first A\n- second A", 12);

  press(pane);
  expect(pane.selectedText()).toBe("second A");
  pane.view.dispatch({ selection: { anchor: 0, head: 20 } });
  press(pane);
  expect(pane.selectedText()).toBe("first A");
});

test("an edit starts a new cycle even when selection offsets are unchanged", () => {
  const { press } = setup();
  const pane = makePane("- first A\n- second A", 12);

  press(pane);
  press(pane);
  pane.view.dispatch({
    changes: { from: 0, to: 20, insert: "- first B\n- second B" },
    selection: { anchor: 0, head: 20 },
  });
  press(pane);
  expect(pane.selectedText()).toBe("first B");
});

test("a new document in the same pane does not inherit the old cycle", () => {
  const { press } = setup();
  const pane = makePane("- first A\n- second A", 12);

  press(pane);
  press(pane);
  pane.view.state = EditorState.create({
    doc: "- first A\n- second A",
    selection: { anchor: 0, head: 20 },
  });
  press(pane);
  expect(pane.selectedText()).toBe("first A");
});

test("unloading clears the previous cycle", async () => {
  const { feature, press } = setup();
  const pane = makePane("- first A\n- second A", 12);

  press(pane);
  press(pane);
  await feature.unload();
  press(pane);
  expect(pane.selectedText()).toBe("first A");
});
