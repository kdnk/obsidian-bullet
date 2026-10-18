import { deleteCharBackward } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import { DeleteTillPreviousLineContentEnd } from "../DeleteTillPreviousLineContentEnd";
import {
  NO_OP_OUTCOME,
  STOP_ONLY_OUTCOME,
  UPDATED_OUTCOME,
} from "../Operation";

const deepCode = [
  "- root",
  "\t- second",
  "\t\t- third",
  "\t\t\t- fourth",
  "\t\t\t\t- fifth",
  "\t\t\t\t\t- ```",
  "\t\t\t\t\t  before",
  "\t\t\t\t\t    hello",
  "\t\t\t\t\t  ```",
].join("\n");

test("caps native indentation-unit deletion at the raw fenced-code container", () => {
  let state = EditorState.create({
    doc: deepCode,
    extensions: [EditorState.tabSize.of(4), indentUnit.of("\t")],
  });
  state = state.update({
    selection: EditorSelection.cursor(state.doc.line(8).from + 9),
  }).state;
  expect(
    deleteCharBackward({
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = transaction.state;
      },
    } as unknown as EditorView),
  ).toBe(true);
  expect(state.doc.line(8).text).toBe("\t\t\t\t\thello");

  const root = makeRoot({
    editor: makeEditor({ text: deepCode, cursor: { line: 7, ch: 9 } }),
  });
  expect(
    new DeleteTillPreviousLineContentEnd(root, true, false).perform(),
  ).toEqual(UPDATED_OUTCOME);
  expect(root.print()).toBe(deepCode.replace("    hello", "  hello"));
  expect(root.getCursor()).toEqual({ line: 7, ch: 7 });
});

test.each([
  {
    name: "two-column indentation unit",
    text: "1. ```\n   before\n    hello\n   ```",
    cursor: { line: 2, ch: 4 },
    indentation: { tabSize: 4, indentUnit: 2 },
    expected: "1. ```\n   before\n   hello\n   ```",
    expectedCursor: { line: 2, ch: 3 },
  },
  {
    name: "eight-column tabs",
    text: "- parent\n\t- ```\n\t  before\n\t        hello\n\t  ```",
    cursor: { line: 3, ch: 9 },
    indentation: { tabSize: 8, indentUnit: 8 },
    expected: "- parent\n\t- ```\n\t  before\n\t  hello\n\t  ```",
    expectedCursor: { line: 3, ch: 3 },
  },
  {
    name: "blank code row",
    text: "- ```\n  before\n    \n  ```",
    cursor: { line: 2, ch: 4 },
    indentation: { tabSize: 4, indentUnit: 4 },
    expected: "- ```\n  before\n  \n  ```",
    expectedCursor: { line: 2, ch: 2 },
  },
])(
  "caps $name at the container and then joins at the boundary",
  ({ text, cursor, indentation, expected, expectedCursor }) => {
    const root = makeRoot({ editor: makeEditor({ text, cursor }) });
    const operation = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      false,
      indentation,
    );
    expect(operation.perform()).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe(expected);
    expect(root.getCursor()).toEqual(expectedCursor);
    expect(operation.perform()).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe(expected.replace(/before\n[ \t]+/, "before"));
  },
);

test.each([
  {
    name: "ordinary list continuation",
    text: "- item\n  before\n    hello",
    ch: 4,
  },
  { name: "ordinary code text", text: "- ```\n  hello\n  ```", ch: 4 },
])("leaves $name to native deletion", ({ text, ch }) => {
  const line = text.includes("before") ? 2 : 1;
  const root = makeRoot({ editor: makeEditor({ text, cursor: { line, ch } }) });
  expect(
    new DeleteTillPreviousLineContentEnd(root, true, false).perform(),
  ).toEqual(NO_OP_OUTCOME);
  expect(root.print()).toBe(text);
  expect(root.getCursor()).toEqual({ line, ch });
});

test.each([
  {
    name: "four code columns",
    prefix: "      ",
    ch: 6,
    after: "  ",
    afterCh: 2,
  },
  {
    name: "eight code columns",
    prefix: "          ",
    ch: 10,
    after: "      ",
    afterCh: 6,
  },
  {
    name: "partial code indentation",
    prefix: "        ",
    ch: 8,
    after: "      ",
    afterCh: 6,
  },
  {
    name: "code tab crossing the stop",
    prefix: "  \t\t",
    ch: 4,
    after: "  \t  ",
    afterCh: 5,
  },
  {
    name: "first literal code tab",
    prefix: "  \t",
    ch: 3,
    after: "  ",
    afterCh: 2,
  },
])(
  "deletes $name from the code origin on blank and populated rows",
  ({ prefix, ch, after, afterCh }) => {
    for (const content of ["", "hello"]) {
      const text = `- \`\`\`\n  before\n${prefix}${content}\n  \`\`\``;
      const root = makeRoot({
        editor: makeEditor({ text, cursor: { line: 2, ch } }),
      });
      expect(
        new DeleteTillPreviousLineContentEnd(root, true, false).perform(),
      ).toEqual(UPDATED_OUTCOME);
      expect(root.print()).toBe(
        `- \`\`\`\n  before\n${after}${content}\n  \`\`\``,
      );
      expect(root.getCursor()).toEqual({ line: 2, ch: afterCh });
    }
  },
);

test.each([
  {
    name: "deep list",
    container: "\t\t\t  ",
    indentation: "        ",
    expected: "    ",
    tabSize: 4,
    indentUnit: 4,
  },
  {
    name: "two-column unit",
    container: "  ",
    indentation: "    ",
    expected: "  ",
    tabSize: 4,
    indentUnit: 2,
  },
  {
    name: "eight-column unit",
    container: "\t  ",
    indentation: "                ",
    expected: "        ",
    tabSize: 8,
    indentUnit: 8,
  },
])(
  "uses the configured code-relative stop for $name",
  ({ container, indentation, expected, tabSize, indentUnit }) => {
    const parents =
      container === "\t\t\t  "
        ? "- root\n\t- second\n\t\t- third\n"
        : container === "\t  "
          ? "- root\n"
          : "";
    const opener = container.slice(0, -2) + "- ```";
    const line = parents.split("\n").length + 1;
    const text = `${parents}${opener}\n${container}before\n${container}${indentation}hello\n${container}\`\`\``;
    const root = makeRoot({
      editor: makeEditor({
        text,
        cursor: { line, ch: container.length + indentation.length },
      }),
    });
    expect(
      new DeleteTillPreviousLineContentEnd(root, true, false, {
        tabSize,
        indentUnit,
      }).perform(),
    ).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe(
      `${parents}${opener}\n${container}before\n${container}${expected}hello\n${container}\`\`\``,
    );
    expect(root.getCursor()).toEqual({
      line,
      ch: container.length + expected.length,
    });
  },
);

test.each([199, 200, 201, 202])(
  "uses the code-relative stop at raw column %i",
  (column) => {
    for (const content of ["", "hello"]) {
      const root = makeRoot({
        editor: makeEditor({
          text: `- \`\`\`\n  before\n${" ".repeat(column)}${content}\n  \`\`\``,
          cursor: { line: 2, ch: column },
        }),
      });
      expect(
        new DeleteTillPreviousLineContentEnd(root, true, false).perform(),
      ).toEqual(UPDATED_OUTCOME);
      expect(root.print()).toBe(
        `- \`\`\`\n  before\n${" ".repeat(198)}${content}\n  \`\`\``,
      );
      expect(root.getCursor()).toEqual({ line: 2, ch: 198 });
    }
  },
);

test("splits only the tab crossing a code-relative stop without deleting the container", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- ```\n  before\n\t\t  hello\n  ```",
      cursor: { line: 2, ch: 4 },
    }),
  });
  const operation = new DeleteTillPreviousLineContentEnd(root, true, false);
  expect(operation.perform()).toEqual(UPDATED_OUTCOME);
  expect(root.print()).toBe("- ```\n  before\n\t  hello\n  ```");
  expect(root.getCursor()).toEqual({ line: 2, ch: 3 });
  expect(operation.perform()).toEqual(UPDATED_OUTCOME);
  expect(root.print()).toBe("- ```\n  before\n  hello\n  ```");
  expect(root.getCursor()).toEqual({ line: 2, ch: 2 });
});

test("uses code-relative stops inside a continuation fence without changing whitespace after the cursor", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- parent\n  ```\n          hello\n  ```",
      cursor: { line: 2, ch: 6 },
    }),
  });
  expect(
    new DeleteTillPreviousLineContentEnd(root, true, false).perform(),
  ).toEqual(UPDATED_OUTCOME);
  expect(root.print()).toBe("- parent\n  ```\n      hello\n  ```");
  expect(root.getCursor()).toEqual({ line: 2, ch: 2 });
});

test.each(["", " ", "  ", "\t", "\t "])(
  "does not add indentation while deleting an incomplete deep code container %j",
  (blank) => {
    const text = `- root\n\t- second\n\t\t- third\n\t\t\t- \`\`\`\n\t\t\t  before\n${blank}\n\t\t\t  \`\`\``;
    const root = makeRoot({
      editor: makeEditor({ text, cursor: { line: 5, ch: blank.length } }),
    });
    expect(
      new DeleteTillPreviousLineContentEnd(root, true, false).perform(),
    ).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe(
      "- root\n\t- second\n\t\t- third\n\t\t\t- ```\n\t\t\t  before\n\t\t\t  ```",
    );
    expect(root.getCursor()).toEqual({ line: 4, ch: 11 });
  },
);

test("should merge current line with previous line when cursor is at start of line content", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
      cursor: { line: 2, ch: 6 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillPreviousLineContentEnd(root, true, false);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);

  expect(root.print()).toBe(
    "- item 1\n- item 2item 2.1\n    - item 2.2\n- item 3",
  );
  expect(root.getCursor().line).toBe(1);
  expect(root.getCursor().ch).toBe(8);
});

test("should merge with previous note line", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1\n  note for item 1\n  more notes\n- item 2\n",
      cursor: { line: 2, ch: 2 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillPreviousLineContentEnd(root, true, false);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);

  expect(root.print()).toBe("- item 1\n  note for item 1more notes\n- item 2");
  expect(root.getCursor().line).toBe(1);
  expect(root.getCursor().ch).toBe(17);
});

test.each(["", " ", "\t", "\t "])(
  "joins a blank fenced-code row with incomplete container %j",
  (blank) => {
    const text = `- parent\n\t- \`\`\`js\n\t  before\n${blank}\n\t  \`\`\``;
    const root = makeRoot({
      editor: makeEditor({ text, cursor: { line: 3, ch: blank.length } }),
    });
    expect(root.print()).toBe(text);
    expect(
      new DeleteTillPreviousLineContentEnd(root, true, false).perform(),
    ).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- parent\n\t- ```js\n\t  before\n\t  ```");
    expect(root.getCursor()).toEqual({ line: 2, ch: 9 });
  },
);

test.each([
  {
    name: "list-attached fence",
    text: "- parent\n\t- child\n\t\t- ```\n\t\t\tllo\n\t\t\t\n\t\t\t```",
    cursor: { line: 4, ch: 3 },
    joined: "- parent\n\t- child\n\t\t- ```\n\t\t\tllo\n\t\t\t```",
    joinCursor: { line: 3, ch: 6 },
  },
  {
    name: "continuation fence",
    text: "- title\n  ```\n\tllo\n\t\n  ```",
    cursor: { line: 3, ch: 1 },
    joined: "- title\n  ```\n\tllo\n  ```",
    joinCursor: { line: 2, ch: 4 },
  },
  {
    name: "continuation fence with existing trailing spaces",
    text: "- title\n  ```\n\tllo\n\t  \n  ```",
    cursor: { line: 3, ch: 1 },
    joined: "- title\n  ```\n\tllo  \n  ```",
    joinCursor: { line: 2, ch: 4 },
  },
])(
  "joins an autoindented blank code row without appending partial-tab spaces in a $name",
  ({ text, cursor, joined, joinCursor }) => {
    const root = makeRoot({ editor: makeEditor({ text, cursor }) });

    expect(
      new DeleteTillPreviousLineContentEnd(root, true, false).perform(),
    ).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe(joined);
    expect(root.getCursor()).toEqual(joinCursor);
  },
);

test("should merge empty bullets with previous bullet", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1\n- \n- item 3\n",
      cursor: { line: 1, ch: 2 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillPreviousLineContentEnd(root, true, false);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);

  expect(root.print()).toBe("- item 1\n- item 3");
  expect(root.getCursor().line).toBe(0);
  expect(root.getCursor().ch).toBe(8);
});

test("should merge child bullet with parent if child is empty", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1\n    - \n- item 3\n",
      cursor: { line: 1, ch: 6 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillPreviousLineContentEnd(root, true, false);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);

  expect(root.print()).toBe("- item 1\n- item 3");
  expect(root.getCursor().line).toBe(0);
  expect(root.getCursor().ch).toBe(8);
});

test("should not do anything if there are multiple selections", () => {
  const editor = makeEditor({
    text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
    cursor: { line: 2, ch: 6 },
  });

  // Mock multiple selections
  editor.listSelections = () => [
    { anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 3 } },
    { anchor: { line: 2, ch: 6 }, head: { line: 2, ch: 6 } },
  ];

  const root = makeRoot({
    editor,
    settings: makeSettings(),
  });

  const op = new DeleteTillPreviousLineContentEnd(root, true, false);
  expect(op.perform()).toEqual(NO_OP_OUTCOME);

  // Should not change the text
  expect(root.print()).toBe(
    "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3",
  );
});

test("should not merge the first item if it's the only one in the document", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1",
      cursor: { line: 0, ch: 2 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillPreviousLineContentEnd(root, true, false);
  expect(op.perform()).toEqual(NO_OP_OUTCOME);

  expect(root.print()).toBe("- item 1");
  expect(root.getCursor().line).toBe(0);
  expect(root.getCursor().ch).toBe(2);
});

test("should stop propagation and update editor when merging", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
      cursor: { line: 2, ch: 6 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillPreviousLineContentEnd(root, true, false);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);
});

describe("empty leaf item removal", () => {
  test("removes the only empty root item when enforcement is enabled", () => {
    const root = makeRoot({
      editor: makeEditor({ text: "- ", cursor: { line: 0, ch: 2 } }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("");
    expect(root.getCursor()).toEqual({ line: 0, ch: 0 });
  });

  test("removes the first empty root item and moves to the next content start", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- \n- next",
        cursor: { line: 0, ch: 2 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- next");
    expect(root.getCursor()).toEqual({ line: 0, ch: 2 });
  });

  test("removes a middle empty root item and moves to the previous content end", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- previous\n- \n- next",
        cursor: { line: 1, ch: 2 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- previous\n- next");
    expect(root.getCursor()).toEqual({ line: 0, ch: 10 });
  });

  test("removes the last empty root item and moves to the previous content end", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- previous\n- ",
        cursor: { line: 1, ch: 2 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- previous");
    expect(root.getCursor()).toEqual({ line: 0, ch: 10 });
  });

  test("removes a nested empty item and moves to the previous visible item end", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n  - \n  - sibling",
        cursor: { line: 1, ch: 4 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- parent\n  - sibling");
    expect(root.getCursor()).toEqual({ line: 0, ch: 8 });
  });

  test("removes a nested empty item whose marker ends the line", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n  -",
        cursor: { line: 1, ch: 3 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- parent");
    expect(root.getCursor()).toEqual({ line: 0, ch: 8 });
  });

  test("removes an empty checkbox item", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- previous\n- [ ] ",
        cursor: { line: 1, ch: 6 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- previous");
    expect(root.getCursor()).toEqual({ line: 0, ch: 10 });
  });

  test("reveals a folded item before removing its following empty sibling", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n  - hidden child\n- ",
        cursor: { line: 2, ch: 2 },
        getAllFoldedLines: () => [0],
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- parent\n  - hidden child\n- ");
    expect(root.getCursor()).toEqual({ line: 2, ch: 2 });
    expect(root.getChildren()[0].isFoldRoot()).toBe(false);
    expect(
      new DeleteTillPreviousLineContentEnd(root, true, true).perform(),
    ).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- parent\n  - hidden child");
    expect(root.getCursor()).toEqual({ line: 1, ch: 16 });
  });

  test("recalculates ordered markers after removing the first item", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "1. \n2. next",
        cursor: { line: 0, ch: 3 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("1. next");
    expect(root.getCursor()).toEqual({ line: 0, ch: 3 });
  });

  test("does not remove an empty item with children", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- \n  - child",
        cursor: { line: 0, ch: 2 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(STOP_ONLY_OUTCOME);
    expect(root.print()).toBe("- \n  - child");
    expect(root.getCursor()).toEqual({ line: 0, ch: 2 });
  });

  test("does not remove an item with a continuation line", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- \n  continuation",
        cursor: { line: 0, ch: 2 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(NO_OP_OUTCOME);
    expect(root.print()).toBe("- \n  continuation");
    expect(root.getCursor()).toEqual({ line: 0, ch: 2 });
  });

  test("does not merge an empty checkbox with a continuation from its checkbox end", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- previous\n- [ ] \n  continuation",
        cursor: { line: 1, ch: 6 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(NO_OP_OUTCOME);
    expect(root.print()).toBe("- previous\n- [ ] \n  continuation");
    expect(root.getCursor()).toEqual({ line: 1, ch: 6 });
  });

  test("does not merge an empty checkbox with a child from its checkbox end", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- previous\n- [ ] \n  - child",
        cursor: { line: 1, ch: 6 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(NO_OP_OUTCOME);
    expect(root.print()).toBe("- previous\n- [ ] \n  - child");
    expect(root.getCursor()).toEqual({ line: 1, ch: 6 });
  });

  test("preserves legacy behavior when enforcement is disabled", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- ",
        cursor: { line: 0, ch: 2 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      false,
    ).perform();

    expect(outcome).toEqual(NO_OP_OUTCOME);
    expect(root.print()).toBe("- ");
    expect(root.getCursor()).toEqual({ line: 0, ch: 2 });
  });

  test("preserves empty checkbox behavior when enforcement is disabled", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- previous\n- [ ] ",
        cursor: { line: 1, ch: 6 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      false,
    ).perform();

    expect(outcome).toEqual(NO_OP_OUTCOME);
    expect(root.print()).toBe("- previous\n- [ ] ");
    expect(root.getCursor()).toEqual({ line: 1, ch: 6 });
  });
});

test("keeps a partial tab and the insertion point when joining code rows", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- ```js\n\tfoo\n  BAR\n  ```",
      cursor: { line: 2, ch: 2 },
    }),
  });
  expect(
    new DeleteTillPreviousLineContentEnd(root, true, false).perform(),
  ).toEqual(UPDATED_OUTCOME);
  expect(root.print()).toBe("- ```js\n\tfooBAR\n  ```");
  expect(root.getCursor()).toEqual({ line: 1, ch: 4 });
  const rows = root.print().split("\n");
  const { line, ch } = root.getCursor();
  rows[line] = rows[line].slice(0, ch) + "X" + rows[line].slice(ch);
  expect(rows.join("\n")).toBe("- ```js\n\tfooXBAR\n  ```");
});

test("preserves partial tabs and physical blank rows when merging items", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- prev\n- title\n  ```js\n\tfoo\n\n  ```",
      cursor: { line: 1, ch: 2 },
    }),
  });
  expect(
    new DeleteTillPreviousLineContentEnd(root, true, true).perform(),
  ).toEqual(UPDATED_OUTCOME);
  expect(root.print()).toBe("- prevtitle\n  ```js\n\tfoo\n\n  ```");
  expect(root.getCursor()).toEqual({ line: 0, ch: 6 });
});

test.each([
  {
    text: "- parent\n\t- child\n\t  ```js\n\t\tfoo\n\n\t  ```",
    ch: 3,
    want: "- parentchild\n  ```js\n\tfoo\n\n  ```",
  },
  {
    text: "- parent\n  prior\n10. child\n    ```js\n\t\tfoo\n\n    ```",
    ch: 4,
    want: "- parent\n  priorchild\n  ```js\n\t  foo\n\n  ```",
  },
])(
  "keeps code columns when merging different containers: $text",
  ({ text, ch, want }) => {
    const line = text.startsWith("- parent\n  prior") ? 2 : 1;
    const root = makeRoot({
      editor: makeEditor({ text, cursor: { line, ch } }),
    });
    expect(
      new DeleteTillPreviousLineContentEnd(root, true, true).perform(),
    ).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe(want);
    expect(root.getCursor()).toEqual(
      line === 2 ? { line: 1, ch: 7 } : { line: 0, ch: 8 },
    );
  },
);

test("retains code columns when merging into a wider ordered continuation", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "10. parent\n    prior\n- child\n  ```js\n\tfoo\n\n  ```",
      cursor: { line: 2, ch: 2 },
    }),
  });
  expect(
    new DeleteTillPreviousLineContentEnd(root, false, true).perform(),
  ).toEqual(UPDATED_OUTCOME);
  expect(root.print()).toBe(
    "10. parent\n    priorchild\n    ```js\n\t  foo\n\n    ```",
  );
  expect(root.getCursor()).toEqual({ line: 1, ch: 9 });
});

test.each([
  {
    text: "- parent\n  - child\n- next",
    joined: "- parent\n  - childnext",
    ch: 9,
  },
  { text: "- parent\n  note\n- next", joined: "- parent\n  notenext", ch: 6 },
])(
  "reveals the hidden previous row before joining: $text",
  ({ text, joined, ch }) => {
    const root = makeRoot({
      editor: makeEditor({
        text,
        cursor: { line: 2, ch: 2 },
        getAllFoldedLines: () => [0],
      }),
    });
    const op = new DeleteTillPreviousLineContentEnd(root, true, true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe(text);
    expect(root.getCursor()).toEqual({ line: 2, ch: 2 });
    expect(root.getChildren()[0].isFoldRoot()).toBe(false);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe(joined);
    expect(root.getCursor()).toEqual({ line: 1, ch });
  },
);

test("reveals nested folds separately before joining hidden descendants", () => {
  const text = "- parent\n  - child\n    - grandchild\n- next";
  const root = makeRoot({
    editor: makeEditor({
      text,
      cursor: { line: 3, ch: 2 },
      getAllFoldedLines: () => [0, 1],
    }),
  });
  const op = new DeleteTillPreviousLineContentEnd(root, true, true);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);
  expect(root.print()).toBe(text);
  expect(root.getCursor()).toEqual({ line: 3, ch: 2 });
  expect(root.getChildren()[0].isFoldRoot()).toBe(false);
  expect(root.getChildren()[0].getChildren()[0].isFoldRoot()).toBe(true);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);
  expect(root.print()).toBe(text);
  expect(root.getCursor()).toEqual({ line: 3, ch: 2 });
  expect(root.getChildren()[0].getChildren()[0].isFoldRoot()).toBe(false);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);
  expect(root.print()).toBe("- parent\n  - child\n    - grandchildnext");
  expect(root.getCursor()).toEqual({ line: 2, ch: 16 });
});

test("does not reveal a previous fold for deletion inside visible text", () => {
  const text = "- parent\n  - child\n- next";
  const root = makeRoot({
    editor: makeEditor({
      text,
      cursor: { line: 2, ch: 4 },
      getAllFoldedLines: () => [0],
    }),
  });
  expect(
    new DeleteTillPreviousLineContentEnd(root, true, true).perform(),
  ).toEqual(NO_OP_OUTCOME);
  expect(root.print()).toBe(text);
  expect(root.getCursor()).toEqual({ line: 2, ch: 4 });
  expect(root.getChildren()[0].isFoldRoot()).toBe(true);
});

test("joins a visible previous header without treating the header itself as hidden", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- parent\n- next",
      cursor: { line: 1, ch: 2 },
      getAllFoldedLines: () => [0],
    }),
  });
  expect(
    new DeleteTillPreviousLineContentEnd(root, true, true).perform(),
  ).toEqual(UPDATED_OUTCOME);
  expect(root.print()).toBe("- parentnext");
  expect(root.getCursor()).toEqual({ line: 0, ch: 8 });
});

test("reveals a hidden previous row before removing a bare empty marker", () => {
  const text = "- parent\n  - child\n-";
  const root = makeRoot({
    editor: makeEditor({
      text,
      cursor: { line: 2, ch: 1 },
      getAllFoldedLines: () => [0],
    }),
  });
  const op = new DeleteTillPreviousLineContentEnd(root, true, true);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);
  expect(root.print()).toBe(text);
  expect(root.getCursor()).toEqual({ line: 2, ch: 1 });
  expect(root.getChildren()[0].isFoldRoot()).toBe(false);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);
  expect(root.print()).toBe("- parent\n  - child");
  expect(root.getCursor()).toEqual({ line: 1, ch: 9 });
});

test.each([
  {
    name: "unordered partial tab",
    text: "- ```js\n  foo\n\tBAR\n  ```",
    cursor: { line: 2, ch: 1 },
    joined: "- ```js\n  foo  BAR\n  ```",
    joinCursor: { line: 1, ch: 5 },
  },
  {
    name: "unordered equivalent spaces",
    text: "- ```js\n  foo\n    BAR\n  ```",
    cursor: { line: 2, ch: 2 },
    joined: "- ```js\n  foo  BAR\n  ```",
    joinCursor: { line: 1, ch: 5 },
  },
  {
    name: "ordered partial tab",
    text: "1. ```js\n   foo\n\tBAR\n   ```",
    cursor: { line: 2, ch: 1 },
    joined: "1. ```js\n   foo BAR\n   ```",
    joinCursor: { line: 1, ch: 6 },
  },
  {
    name: "ordered equivalent spaces",
    text: "1. ```js\n   foo\n    BAR\n   ```",
    cursor: { line: 2, ch: 3 },
    joined: "1. ```js\n   foo BAR\n   ```",
    joinCursor: { line: 1, ch: 6 },
  },
  {
    name: "nested partial tab",
    text: "- parent\n\t- ```js\n\t  foo\n\t\tBAR\n\t  ```",
    cursor: { line: 3, ch: 2 },
    joined: "- parent\n\t- ```js\n\t  foo  BAR\n\t  ```",
    joinCursor: { line: 2, ch: 6 },
  },
  {
    name: "nested equivalent spaces",
    text: "- parent\n\t- ```js\n\t  foo\n\t    BAR\n\t  ```",
    cursor: { line: 3, ch: 3 },
    joined: "- parent\n\t- ```js\n\t  foo  BAR\n\t  ```",
    joinCursor: { line: 2, ch: 6 },
  },
])(
  "preserves literal code indentation when joining $name",
  ({ text, cursor, joined, joinCursor }) => {
    const root = makeRoot({
      editor: makeEditor({ text, cursor: cursor }),
    });
    expect(
      new DeleteTillPreviousLineContentEnd(root, true, false).perform(),
    ).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe(joined);
    expect(root.getCursor()).toEqual(joinCursor);
  },
);
