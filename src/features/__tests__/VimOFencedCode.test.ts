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
import { VimOBehaviourOverride } from "../VimOBehaviourOverride";

jest.mock(
  "obsidian",
  () => ({
    MarkdownView: class MarkdownView {},
    Notice: jest.fn(),
    Plugin: class Plugin {},
    editorInfoField: {},
  }),
  { virtual: true },
);

// Resolve this feature's legacy root-relative imports to the real modules.
jest.mock(
  "src/editor",
  () => jest.requireActual<typeof import("../../editor")>("../../editor"),
  {
    virtual: true,
  },
);
jest.mock(
  "src/operations/CreateNewItem",
  () =>
    jest.requireActual<typeof import("../../operations/CreateNewItem")>(
      "../../operations/CreateNewItem",
    ),
  { virtual: true },
);
jest.mock(
  "src/utils/insertPlainLine",
  () =>
    jest.requireActual<typeof import("../../utils/insertPlainLine")>(
      "../../utils/insertPlainLine",
    ),
  { virtual: true },
);

type VimAction = (cm: object, args: { after: boolean }) => void;

function createEditor(text: string, lineNumber: number) {
  let state = EditorState.create({ doc: text });
  const offset = (position: MyEditorPosition) =>
    state.doc.line(position.line + 1).from + position.ch;
  const position = (value: number) => {
    const line = state.doc.lineAt(value);
    return { line: line.number - 1, ch: value - line.from };
  };
  const dispatch = (spec: TransactionSpec) => {
    state = state.update(spec).state;
  };
  const editor = {
    cm: {
      get state() {
        return state;
      },
      dispatch,
    },
    getCursor: () => position(state.selection.main.head),
    getLine: (line: number) => state.doc.line(line + 1).text,
    lastLine: () => state.doc.lines - 1,
    getRange: (from: MyEditorPosition, to: MyEditorPosition) =>
      state.sliceDoc(offset(from), offset(to)),
    listSelections: () =>
      state.selection.ranges.map(({ anchor, head }) => ({
        anchor: position(anchor),
        head: position(head),
      })),
    replaceRange: (
      insert: string,
      from: MyEditorPosition,
      to: MyEditorPosition,
    ) => dispatch({ changes: { from: offset(from), to: offset(to), insert } }),
    setSelections: (selections: MyEditorSelection[]) =>
      dispatch({
        selection: EditorSelection.create(
          selections.map(({ anchor, head }) =>
            EditorSelection.range(offset(anchor), offset(head)),
          ),
        ),
      }),
  };
  const line = state.doc.line(lineNumber + 1);
  dispatch({ selection: { anchor: line.to } });
  return { editor, getText: () => state.doc.toString() };
}

async function invokeVim(text: string, line: number, after: boolean) {
  const harness = createEditor(text, line);
  const editor = new MyEditor(harness.editor as never);
  let action: VimAction | undefined;
  const nativeCommands: string[] = [];
  const vim = {
    defineAction: (_name: string, callback: VimAction) => {
      action = callback;
    },
    mapCommand: () => undefined,
    handleEx: (_cm: object, command: string) => {
      // The native editor is the external boundary. Leave delegated edits to
      // the real Obsidian verification script; all plugin operations run here.
      if (command !== "normal! A") nativeCommands.push(command);
    },
    enterInsertMode: () => undefined,
  };
  global.window = { CodeMirrorAdapter: { Vim: vim } } as never;
  const settings = Object.assign(makeSettings(), {
    overrideVimOBehaviour: true,
    onChange: () => undefined,
  });
  const feature = new VimOBehaviourOverride(
    {
      app: {
        workspace: {
          getActiveViewOfType: () => ({ editor: harness.editor }),
        },
      },
    } as never,
    settings,
    {
      getDefaultIndentChars: () => "\t",
      isSmartIndentListEnabled: () => true,
    } as never,
    new OperationPerformer(
      new Parser(makeLogger(), settings),
      new ChangesApplicator(),
    ),
  );
  await feature.load();
  if (!action) throw new Error("Vim action was not registered");
  action({}, { after });
  return {
    text: harness.getText(),
    cursor: editor.getCursor(),
    nativeCommands,
  };
}

describe("Vim open-line editing in fenced code", () => {
  const originalWindow = global.window;
  afterEach(() => {
    global.window = originalWindow;
  });

  test.each([
    ["nested body o", "- parent\n\t- ```js\n\t  code\n\t  ```", 2, true],
    ["nested body O", "- parent\n\t- ```js\n\t  code\n\t  ```", 2, false],
    ["root literal marker o", "```yaml\n- literal\n```", 1, true],
    ["root literal marker O", "```yaml\n- literal\n```", 1, false],
    ["root indented closing o", "```yaml\n- literal\n  ```", 2, true],
    ["nested opening O", "- parent\n\t- ```js\n\t  code\n\t  ```", 1, false],
    ["nested closing O", "- parent\n\t- ```js\n\t  code\n\t  ```", 3, false],
    ["continuation body o", "- parent\n\t```js\n\tcode\n\t```", 2, true],
  ] as const)(
    "delegates %s to native Vim before any list edit or unindented insertion",
    async (_name, text, line, after) => {
      const result = await invokeVim(text, line, after);
      expect(result.text).toBe(text);
      expect(result.nativeCommands).toEqual([
        after ? "normal! o" : "normal! O",
      ]);
    },
  );

  test.each([
    [true, "- item\n- "],
    [false, "- \n- item"],
  ])("keeps ordinary list insertion with after=%s", async (after, expected) => {
    const result = await invokeVim("- item", 0, after);
    expect(result.text).toBe(expected);
    expect(result.nativeCommands).toEqual([]);
  });

  test.each([
    [true, "- ```js\n  code\n  ```\n\n- item\n- ", { line: 5, ch: 2 }],
    [false, "- ```js\n  code\n  ```\n\n- \n- item", { line: 4, ch: 2 }],
  ])(
    "keeps a separate ordinary list after a closed attached fence with after=%s",
    async (after, expected, cursor) => {
      const result = await invokeVim(
        "- ```js\n  code\n  ```\n\n- item",
        4,
        after,
      );
      expect(result.text).toBe(expected);
      expect(result.cursor).toEqual(cursor);
      expect(result.nativeCommands).toEqual([]);
    },
  );

  test("opens the first code row with the attached fence's full container indent", async () => {
    const result = await invokeVim(
      "- parent\n\t- ```js\n\t  code\n\t  ```",
      1,
      true,
    );
    expect(result.text).toBe("- parent\n\t- ```js\n\t  \n\t  code\n\t  ```");
    expect(result.cursor).toEqual({ line: 2, ch: 3 });
    expect(result.nativeCommands).toEqual([]);
  });

  test.each([
    [
      "tab separator",
      "-\t```js\n\tcode\n\t```",
      "-\t```js\n \t\n\tcode\n\t```",
      { line: 1, ch: 2 },
    ],
    [
      "multiple separator spaces",
      "-   ```js\n    code\n    ```",
      "-   ```js\n    \n    code\n    ```",
      { line: 1, ch: 4 },
    ],
  ] as const)(
    "includes the complete %s in the attached fence container",
    async (_name, text, expected, cursor) => {
      const result = await invokeVim(text, 0, true);
      expect(result.text).toBe(expected);
      expect(result.cursor).toEqual(cursor);
      expect(result.nativeCommands).toEqual([]);
    },
  );

  test.each([
    [
      "o on empty body",
      "- parent\n\t- ```js\n\t  code\n\n\t  ```",
      3,
      true,
      "- parent\n\t- ```js\n\t  code\n\n\t  \n\t  ```",
      { line: 4, ch: 3 },
    ],
    [
      "O on empty body",
      "- parent\n\t- ```js\n\t  code\n\n\t  ```",
      3,
      false,
      "- parent\n\t- ```js\n\t  code\n\t  \n\n\t  ```",
      { line: 3, ch: 3 },
    ],
    [
      "o on underindented blank",
      "- parent\n\t- ```js\n\t\n\t  ```",
      2,
      true,
      "- parent\n\t- ```js\n\t\n\t  \n\t  ```",
      { line: 3, ch: 3 },
    ],
    [
      "o on tab-separated fence blank",
      "-\t```js\n\tcode\n\n\t```",
      2,
      true,
      "-\t```js\n\tcode\n\n \t\n\t```",
      { line: 3, ch: 2 },
    ],
    [
      "O on multi-space-separated fence blank",
      "-   ```js\n    code\n\n    ```",
      2,
      false,
      "-   ```js\n    code\n    \n\n    ```",
      { line: 2, ch: 4 },
    ],
    [
      "O on continuation fence blank",
      "- parent\n\t```js\n\n\t```",
      2,
      false,
      "- parent\n\t```js\n\t\n\n\t```",
      { line: 2, ch: 1 },
    ],
  ] as const)(
    "retains the code container for %s",
    async (_name, text, line, after, expected, cursor) => {
      const result = await invokeVim(text, line, after);
      expect(result.text).toBe(expected);
      expect(result.cursor).toEqual(cursor);
      expect(result.nativeCommands).toEqual([]);
    },
  );

  test("creates a sibling after a nested closing fence", async () => {
    const result = await invokeVim(
      "- parent\n\t- ```js\n\t  code\n\t  ```",
      3,
      true,
    );
    expect(result.text).toBe("- parent\n\t- ```js\n\t  code\n\t  ```\n\t- ");
    expect(result.nativeCommands).toEqual([]);
  });
});
