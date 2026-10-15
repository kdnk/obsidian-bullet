import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import { DeleteTillCurrentLineContentStart } from "../DeleteTillCurrentLineContentStart";
import {
  NO_OP_OUTCOME,
  STOP_ONLY_OUTCOME,
  UPDATED_OUTCOME,
} from "../Operation";

test("should delete content from cursor to start of the line content and move cursor to content start", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
      cursor: { line: 1, ch: 5 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillCurrentLineContentStart(root);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);

  expect(root.print()).toBe(
    "- item 1\n- m 2\n    - item 2.1\n    - item 2.2\n- item 3",
  );
  expect(root.getCursor().line).toBe(1);
  expect(root.getCursor().ch).toBe(2);
});

test("should delete all content when cursor is at the end of line", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
      cursor: { line: 1, ch: 8 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillCurrentLineContentStart(root);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);

  expect(root.print()).toBe(
    "- item 1\n- \n    - item 2.1\n    - item 2.2\n- item 3",
  );
  expect(root.getCursor().line).toBe(1);
  expect(root.getCursor().ch).toBe(2);
});

test("should do nothing if cursor is already at the start of line content", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
      cursor: { line: 1, ch: 2 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillCurrentLineContentStart(root);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);

  expect(root.print()).toBe(
    "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3",
  );
  expect(root.getCursor().line).toBe(1);
  expect(root.getCursor().ch).toBe(2);
});

test("should not do anything if there are multiple selections", () => {
  const editor = makeEditor({
    text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
    cursor: { line: 1, ch: 5 },
  });

  // Mock multiple selections
  editor.listSelections = () => [
    { anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 3 } },
    { anchor: { line: 1, ch: 5 }, head: { line: 1, ch: 5 } },
  ];

  const root = makeRoot({
    editor,
    settings: makeSettings(),
  });

  const op = new DeleteTillCurrentLineContentStart(root);
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
      cursor: { line: 1, ch: 5 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillCurrentLineContentStart(root);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);
});

test("retains the source prefix when deleting code text to its start", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- ```js\n\tfooBAR\n  ```",
      cursor: { line: 1, ch: 4 },
    }),
  });
  expect(new DeleteTillCurrentLineContentStart(root).perform()).toEqual(
    UPDATED_OUTCOME,
  );
  expect(root.print()).toBe("- ```js\n\tBAR\n  ```");
  expect(root.getCursor()).toEqual({ line: 1, ch: 1 });
});

test.each([
  { text: "- abcdef", line: 0, ch: 1 },
  { text: "- abc😀", line: 0, ch: 1 },
  { text: "10. abcdef", line: 0, ch: 2 },
  { text: "- ```js\n  abcdef\n  ```", line: 1, ch: 1 },
])(
  "protects text after a cursor inside the container prefix: $text",
  ({ text, line, ch }) => {
    const root = makeRoot({
      editor: makeEditor({ text, cursor: { line, ch } }),
    });
    expect(new DeleteTillCurrentLineContentStart(root).perform()).toEqual(
      STOP_ONLY_OUTCOME,
    );
    expect(root.print()).toBe(text);
    expect(root.getCursor()).toEqual({ line, ch });
  },
);

test.each([
  { text: "- [x] abcDEF", ch: 6, expected: "- [x] abcDEF", start: 6 },
  { text: "- [x] abcDEF", ch: 9, expected: "- [x] DEF", start: 6 },
  { text: "- [ ] abcDEF", ch: 9, expected: "- [ ] DEF", start: 6 },
  { text: "12. [x] abcDEF", ch: 11, expected: "12. [x] DEF", start: 8 },
  { text: "12. [ ] abcDEF", ch: 14, expected: "12. [ ] ", start: 8 },
])(
  "preserves the protected task prefix at $ch in $text",
  ({ text, ch, expected, start }) => {
    const root = makeRoot({
      editor: makeEditor({ text, cursor: { line: 0, ch } }),
    });
    expect(new DeleteTillCurrentLineContentStart(root).perform()).toEqual(
      UPDATED_OUTCOME,
    );
    expect(root.print()).toBe(expected);
    expect(root.getCursor()).toEqual({ line: 0, ch: start });
  },
);

test.each([0, 1, 2, 3, 4, 5])(
  "stops deletion inside a protected task prefix at %i",
  (ch) => {
    const text = "- [x] abcDEF";
    const root = makeRoot({
      editor: makeEditor({ text, cursor: { line: 0, ch } }),
    });
    expect(new DeleteTillCurrentLineContentStart(root).perform()).toEqual(
      STOP_ONLY_OUTCOME,
    );
    expect(root.print()).toBe(text);
    expect(root.getCursor()).toEqual({ line: 0, ch });
  },
);

test.each(["bullet-only", "never"] as const)(
  "allows deleting the checkbox with %s protection",
  (protection) => {
    const settings = makeSettings();
    settings.keepCursorWithinContent = protection;
    const root = makeRoot({
      editor: makeEditor({ text: "- [x] abcDEF", cursor: { line: 0, ch: 9 } }),
      settings,
    });
    expect(new DeleteTillCurrentLineContentStart(root).perform()).toEqual(
      UPDATED_OUTCOME,
    );
    expect(root.print()).toBe("- DEF");
    expect(root.getCursor()).toEqual({ line: 0, ch: 2 });
  },
);

test("deletes continuation text without reserving checkbox width", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- [x] task\n  notes",
      cursor: { line: 1, ch: 5 },
    }),
  });
  expect(new DeleteTillCurrentLineContentStart(root).perform()).toEqual(
    UPDATED_OUTCOME,
  );
  expect(root.print()).toBe("- [x] task\n  es");
  expect(root.getCursor()).toEqual({ line: 1, ch: 2 });
});

test("leaves a task text selection to the native deletion command", () => {
  const text = "- [x] abcDEF";
  const editor = makeEditor({ text, cursor: { line: 0, ch: 9 } });
  editor.listSelections = () => [
    { anchor: { line: 0, ch: 6 }, head: { line: 0, ch: 9 } },
  ];
  const root = makeRoot({ editor });
  expect(new DeleteTillCurrentLineContentStart(root).perform()).toEqual(
    NO_OP_OUTCOME,
  );
  expect(root.print()).toBe(text);
  expect(root.getSelections()).toEqual([
    { anchor: { line: 0, ch: 6 }, head: { line: 0, ch: 9 } },
  ]);
});
