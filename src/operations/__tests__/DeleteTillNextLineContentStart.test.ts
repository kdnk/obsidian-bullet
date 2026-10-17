import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import { DeleteTillNextLineContentStart } from "../DeleteTillNextLineContentStart";
import { NO_OP_OUTCOME, UPDATED_OUTCOME } from "../Operation";

test("should delete content from cursor to start of next line content when cursor is at end of a line", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
      cursor: { line: 0, ch: 8 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillNextLineContentStart(root, true);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);

  expect(root.print()).toBe(
    "- item 1item 2\n    - item 2.1\n    - item 2.2\n- item 3",
  );
  expect(root.getCursor().line).toBe(0);
  expect(root.getCursor().ch).toBe(8);
});

test("should not do anything if cursor is in the middle of a line", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
      cursor: { line: 0, ch: 5 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillNextLineContentStart(root, true);
  expect(op.perform()).toEqual(NO_OP_OUTCOME);

  // Since cursor is not at end of line, operation does nothing
  expect(root.print()).toBe(
    "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3",
  );
  expect(root.getCursor().line).toBe(0);
  expect(root.getCursor().ch).toBe(5);
});

test("should delete content from cursor to start of next sublist item content", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
      cursor: { line: 1, ch: 8 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillNextLineContentStart(root, true);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);

  expect(root.print()).toBe(
    "- item 1\n- item 2item 2.1\n    - item 2.2\n- item 3",
  );
  expect(root.getCursor().line).toBe(1);
  expect(root.getCursor().ch).toBe(8);
});

test("should delete content from cursor to start of next line when next line is at a different indent level", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
      cursor: { line: 3, ch: 14 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillNextLineContentStart(root, true);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);

  expect(root.print()).toBe(
    "- item 1\n- item 2\n    - item 2.1\n    - item 2.2item 3",
  );
  expect(root.getCursor().line).toBe(3);
  expect(root.getCursor().ch).toBe(14);
});

test("should do nothing when cursor is at the end of the last line", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3",
      cursor: { line: 4, ch: 8 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillNextLineContentStart(root, true);
  expect(op.perform()).toEqual(NO_OP_OUTCOME);

  expect(root.print()).toBe(
    "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3",
  );
  expect(root.getCursor().line).toBe(4);
  expect(root.getCursor().ch).toBe(8);
});

test("should not do anything if the cursor is not at the end of a line", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
      cursor: { line: 1, ch: 5 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillNextLineContentStart(root, true);
  expect(op.perform()).toEqual(NO_OP_OUTCOME);

  // In this case, cursor is not at the end of the line, so the operation does nothing
  // according to the implementation that checks for cursor.ch === l.to.ch
  expect(root.print()).toBe(
    "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3",
  );
  expect(root.getCursor().line).toBe(1);
  expect(root.getCursor().ch).toBe(5);
});

test("should not do anything if there are multiple selections", () => {
  const editor = makeEditor({
    text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
    cursor: { line: 0, ch: 8 },
  });

  // Mock multiple selections
  editor.listSelections = () => [
    { anchor: { line: 0, ch: 8 }, head: { line: 0, ch: 8 } },
    { anchor: { line: 1, ch: 8 }, head: { line: 1, ch: 8 } },
  ];

  const root = makeRoot({
    editor,
    settings: makeSettings(),
  });

  const op = new DeleteTillNextLineContentStart(root, true);
  expect(op.perform()).toEqual(NO_OP_OUTCOME);

  // Should not change the text
  expect(root.print()).toBe(
    "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3",
  );
});

test("should stop propagation and update editor", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
      cursor: { line: 0, ch: 8 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillNextLineContentStart(root, true);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);
});

test("preserves partial tabs and physical blank rows when merging items", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- prev\n- title\n  ```js\n\tfoo\n\n  ```",
      cursor: { line: 0, ch: 6 },
    }),
  });
  expect(new DeleteTillNextLineContentStart(root, true).perform()).toEqual(
    UPDATED_OUTCOME,
  );
  expect(root.print()).toBe("- prevtitle\n  ```js\n\tfoo\n\n  ```");
  expect(root.getCursor()).toEqual({ line: 0, ch: 6 });
});

test.each([
  { text: "- parent\n  - child\n- next", joined: "- parentchild\n- next" },
  { text: "- parent\n  note\n- next", joined: "- parentnote\n- next" },
])(
  "reveals hidden content before deleting its boundary: $text",
  ({ text, joined }) => {
    const root = makeRoot({
      editor: makeEditor({
        text,
        cursor: { line: 0, ch: 8 },
        getAllFoldedLines: () => [0],
      }),
    });
    const op = new DeleteTillNextLineContentStart(root, true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe(text);
    expect(root.getCursor()).toEqual({ line: 0, ch: 8 });
    expect(root.getChildren()[0].isFoldRoot()).toBe(false);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe(joined);
    expect(root.getCursor()).toEqual({ line: 0, ch: 8 });
  },
);

test("preserves independent child folds when revealing a parent", () => {
  const text = "- parent\n  - child\n    - grandchild\n- next";
  const root = makeRoot({
    editor: makeEditor({
      text,
      cursor: { line: 0, ch: 8 },
      getAllFoldedLines: () => [0, 1],
    }),
  });
  expect(new DeleteTillNextLineContentStart(root, true).perform()).toEqual(
    UPDATED_OUTCOME,
  );
  expect(root.print()).toBe(text);
  expect(root.getCursor()).toEqual({ line: 0, ch: 8 });
  expect(root.getChildren()[0].isFoldRoot()).toBe(false);
  expect(root.getChildren()[0].getChildren()[0].isFoldRoot()).toBe(true);
});

test("does not reveal a fold for deletion inside visible text", () => {
  const text = "- parent\n  - child";
  const root = makeRoot({
    editor: makeEditor({
      text,
      cursor: { line: 0, ch: 4 },
      getAllFoldedLines: () => [0],
    }),
  });
  expect(new DeleteTillNextLineContentStart(root, true).perform()).toEqual(
    NO_OP_OUTCOME,
  );
  expect(root.print()).toBe(text);
  expect(root.getCursor()).toEqual({ line: 0, ch: 4 });
  expect(root.getChildren()[0].isFoldRoot()).toBe(true);
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
  ({ text, joined, joinCursor }) => {
    const root = makeRoot({
      editor: makeEditor({ text, cursor: joinCursor }),
    });
    expect(new DeleteTillNextLineContentStart(root, true).perform()).toEqual(
      UPDATED_OUTCOME,
    );
    expect(root.print()).toBe(joined);
    expect(root.getCursor()).toEqual(joinCursor);
  },
);
