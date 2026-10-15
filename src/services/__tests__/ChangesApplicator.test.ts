import { makeEditor, makeRoot } from "../../__mocks__";
import { MyEditor } from "../../editor";
import { DeleteTillPreviousLineContentEnd } from "../../operations/DeleteTillPreviousLineContentEnd";
import { List, Root } from "../../root";
import { ChangesApplicator } from "../ChangesApplicator";

type EditorAction = [string, ...unknown[]];

interface ChangesApplicatorArgs {
  actions: EditorAction[];
  editor: MyEditor;
  prevRoot: Root;
  newRoot: Root;
}

describe("changesApplicator", () => {
  test("should not touch folded lists if they are not changed", () => {
    const { actions, editor, prevRoot, newRoot } = makeArgs({
      editor: makeEditor({
        text: `
- 1
  - 2
    - 3
  - [ ] 4
- 5
`,
        cursor: { line: 4, ch: 9 },
        getAllFoldedLines: () => [2],
      }),

      changes: (root) => {
        root
          .getChildren()[0]
          .addAfterAll(
            new List(root, "  ", "-", "[ ]", true, " ", "[ ] ", false),
          );
        root.replaceCursor({ line: 5, ch: 8 });
      },
    });
    const changesApplicator = new ChangesApplicator();

    changesApplicator.apply(editor, prevRoot, newRoot);

    expect(actions).toStrictEqual([
      ["getRange", ...newRoot.getContentRange()],
      [
        "replaceRange",
        "  - [ ] 4\n  - [ ] ",
        { line: 4, ch: 0 },
        { line: 4, ch: 9 },
        [{ anchor: { line: 5, ch: 8 }, head: { line: 5, ch: 8 } }],
        false,
      ],
      [
        "setSelections",
        [{ anchor: { line: 5, ch: 8 }, head: { line: 5, ch: 8 } }],
      ],
    ]);
  });

  test("should touch folded lists if they are changed", () => {
    const { actions, editor, prevRoot, newRoot } = makeArgs({
      editor: makeEditor({
        text: `
- 1
  - 2
    - 3
  - [ ] 4
- 5
`,
        cursor: { line: 5, ch: 3 },
        getAllFoldedLines: () => [2],
      }),

      changes: (root) => {
        const list5 = root.getChildren()[1];
        const list5Parent = list5.getParent();
        list5Parent!.removeChild(list5);
        list5Parent!.addBeforeAll(list5);
        root.replaceCursor({ line: 1, ch: 3 });
      },
    });
    const changesApplicator = new ChangesApplicator();

    changesApplicator.apply(editor, prevRoot, newRoot);

    expect(actions).toStrictEqual([
      ["getRange", ...newRoot.getContentRange()],
      ["unfold", 2],
      [
        "replaceRange",
        "- 5\n- 1\n  - 2\n    - 3\n  - [ ] 4",
        { line: 1, ch: 0 },
        { line: 5, ch: 3 },
        [{ anchor: { line: 1, ch: 3 }, head: { line: 1, ch: 3 } }],
        false,
      ],
      ["fold", 3],
      [
        "setSelections",
        [{ anchor: { line: 1, ch: 3 }, head: { line: 1, ch: 3 } }],
      ],
    ]);
  });
});

test("reveals only the outer fold without replacing text or moving the cursor", () => {
  const text = "- parent\n  - child\n    - grandchild\n- next";
  const { actions, editor, prevRoot, newRoot } = makeArgs({
    editor: makeEditor({
      text,
      cursor: { line: 3, ch: 2 },
      getAllFoldedLines: () => [0, 1],
    }),
    changes: (root) => {
      new DeleteTillPreviousLineContentEnd(root, true, true).perform();
    },
  });
  new ChangesApplicator().apply(editor, prevRoot, newRoot);
  expect(newRoot.print()).toBe(text);
  expect(actions).toEqual([
    ["getRange", { line: 0, ch: 0 }, { line: 3, ch: 6 }],
    ["unfold", 0],
    [
      "setSelections",
      [{ anchor: { line: 3, ch: 2 }, head: { line: 3, ch: 2 } }],
    ],
  ]);
  expect(prevRoot.getChildren()[0].isFoldRoot()).toBe(true);
  expect(newRoot.getChildren()[0].isFoldRoot()).toBe(false);
  expect(newRoot.getChildren()[0].getChildren()[0].isFoldRoot()).toBe(true);
});

function makeArgs(opts: {
  editor: MyEditor;
  changes: (root: Root) => void;
}): ChangesApplicatorArgs {
  const actions: EditorAction[] = [];
  const prevRoot = makeRoot({
    editor: opts.editor,
  });
  const newRoot = prevRoot.clone();
  opts.changes(newRoot);
  let selections = prevRoot.getSelections();
  const mockedEditor = {
    listSelections: () => selections,
    getRange: (...args: Parameters<MyEditor["getRange"]>) => {
      actions.push(["getRange", ...args]);
      return prevRoot.print();
    },
    unfold: (...args: Parameters<MyEditor["unfold"]>) => {
      actions.push(["unfold", ...args]);
    },
    replaceRange: (...args: Parameters<MyEditor["replaceRange"]>) => {
      actions.push(["replaceRange", ...args]);
      selections = args[3] ?? selections;
    },
    setSelections: (...args: Parameters<MyEditor["setSelections"]>) => {
      actions.push(["setSelections", ...args]);
    },
    fold: (...args: Parameters<MyEditor["fold"]>) => {
      actions.push(["fold", ...args]);
    },
  } as unknown as MyEditor;

  return {
    actions,
    editor: mockedEditor,
    prevRoot,
    newRoot,
  };
}

test("keeps a requested unfold when the same update also changes text", () => {
  const { actions, editor, prevRoot, newRoot } = makeArgs({
    editor: makeEditor({
      text: "- parent\n  - child\n- next",
      cursor: { line: 2, ch: 2 },
      getAllFoldedLines: () => [0],
    }),
    changes: (root) => {
      const parent = root.getChildren()[0];
      parent.unfold();
      parent.replaceLines(["updated"]);
    },
  });
  new ChangesApplicator().apply(editor, prevRoot, newRoot);
  expect(newRoot.print()).toBe("- updated\n  - child\n- next");
  expect(actions).toEqual([
    ["getRange", { line: 0, ch: 0 }, { line: 2, ch: 6 }],
    ["unfold", 0],
    [
      "replaceRange",
      "- updated",
      { line: 0, ch: 0 },
      { line: 0, ch: 8 },
      [{ anchor: { line: 2, ch: 2 }, head: { line: 2, ch: 2 } }],
      false,
    ],
    [
      "setSelections",
      [{ anchor: { line: 2, ch: 2 }, head: { line: 2, ch: 2 } }],
    ],
  ]);
});

test("retains the editor's accepted selection after a text edit and refold", () => {
  const { actions, editor, prevRoot, newRoot } = makeArgs({
    editor: makeEditor({
      text: "- parent\n  - child\n- next",
      cursor: { line: 2, ch: 2 },
      getAllFoldedLines: () => [0],
    }),
    changes: (root) => {
      root.getChildren()[0].replaceLines(["updated"]);
    },
  });
  editor.listSelections = () => [
    { anchor: { line: 2, ch: 4 }, head: { line: 2, ch: 4 } },
  ];
  new ChangesApplicator().apply(editor, prevRoot, newRoot);
  expect(newRoot.print()).toBe("- updated\n  - child\n- next");
  expect(actions).toEqual([
    ["getRange", { line: 0, ch: 0 }, { line: 2, ch: 6 }],
    ["unfold", 0],
    [
      "replaceRange",
      "- updated",
      { line: 0, ch: 0 },
      { line: 0, ch: 8 },
      [{ anchor: { line: 2, ch: 2 }, head: { line: 2, ch: 2 } }],
      false,
    ],
    ["fold", 0],
    [
      "setSelections",
      [{ anchor: { line: 2, ch: 4 }, head: { line: 2, ch: 4 } }],
    ],
  ]);
});
