import { makeEditor, makeRoot } from "../../__mocks__";
import { MyEditor } from "../../editor";
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
      ],
      ["fold", 3],
      [
        "setSelections",
        [{ anchor: { line: 1, ch: 3 }, head: { line: 1, ch: 3 } }],
      ],
    ]);
  });
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
  const mockedEditor = {
    getRange: (...args: Parameters<MyEditor["getRange"]>) => {
      actions.push(["getRange", ...args]);
      return prevRoot.print();
    },
    unfold: (...args: Parameters<MyEditor["unfold"]>) => {
      actions.push(["unfold", ...args]);
    },
    replaceRange: (...args: Parameters<MyEditor["replaceRange"]>) => {
      actions.push(["replaceRange", ...args]);
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
