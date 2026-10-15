import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import { InsertNewLineWithoutBullet } from "../InsertNewLineWithoutBullet";
import { UPDATED_OUTCOME } from "../Operation";

describe("InsertNewLineWithoutBullet operation", () => {
  describe.each([false, true])("reversed selection: %s", (reversed) => {
    test.each([
      { text: "- abcdef", line: 0, from: 4, to: 6, want: "- ab\n  ef", ch: 2 },
      {
        text: "-\tabcdef",
        line: 0,
        from: 4,
        to: 6,
        want: "-\tab\n    ef",
        ch: 4,
      },
      {
        text: "\t -\tabcdef",
        line: 0,
        from: 6,
        to: 8,
        want: "\t -\tab\n\t    ef",
        ch: 5,
      },
      {
        text: "1. abcdef",
        line: 0,
        from: 5,
        to: 7,
        want: "1. ab\n   ef",
        ch: 3,
      },
      {
        text: "- [x] abcdef",
        line: 0,
        from: 8,
        to: 10,
        want: "- [x] ab\n  ef",
        ch: 2,
      },
      {
        text: "- item\n  abcdef",
        line: 1,
        from: 4,
        to: 6,
        want: "- item\n  ab\n  ef",
        ch: 2,
      },
    ])(
      "replaces selected text in $text",
      ({ text, line, from, to, want, ch }) => {
        const root = makeRoot({
          editor: makeEditor({ text, cursor: { line, ch: from } }),
        });
        root.replaceSelections([
          {
            anchor: { line, ch: reversed ? to : from },
            head: { line, ch: reversed ? from : to },
          },
        ]);

        expect(new InsertNewLineWithoutBullet(root).perform()).toEqual(
          UPDATED_OUTCOME,
        );
        expect(root.print()).toBe(want);
        expect(root.getCursor()).toEqual({ line: line + 1, ch });
      },
    );
  });

  test.each([
    { text: "-\talpha", want: "-\talpha\n    ", ch: 4 },
    { text: "\t-\talpha", want: "\t-\talpha\n\t    ", ch: 5 },
    { text: " \t-\talpha", want: " \t-\talpha\n \t    ", ch: 6 },
    { text: "\t -\talpha", want: "\t -\talpha\n\t    ", ch: 5 },
    { text: "9.\talpha", want: "9.\talpha\n    ", ch: 4 },
    { text: "10.\talpha", want: "10.\talpha\n    ", ch: 4 },
    { text: " 9.\talpha", want: " 9.\talpha\n    ", ch: 4 },
    { text: " 10.\talpha", want: " 10.\talpha\n        ", ch: 8 },
  ])(
    "aligns the continuation with the content in $text",
    ({ text, want, ch }) => {
      const root = makeRoot({
        editor: makeEditor({ text, cursor: { line: 0, ch: text.length } }),
      });

      expect(new InsertNewLineWithoutBullet(root).perform()).toEqual(
        UPDATED_OUTCOME,
      );
      expect(root.print()).toBe(want);
      expect(root.getCursor()).toEqual({ line: 1, ch });
    },
  );

  test.each([
    {
      text: "-\talpha\n\tnote text",
      line: 0,
      ch: 7,
      want: "-\talpha\n\t\n\tnote text",
    },
    {
      text: "-\talpha\n\tnote text",
      line: 1,
      ch: 6,
      want: "-\talpha\n\tnote \n\ttext",
    },
  ])(
    "reuses existing continuation indentation from row $line",
    ({ text, line, ch, want }) => {
      const root = makeRoot({
        editor: makeEditor({ text, cursor: { line, ch } }),
      });

      expect(new InsertNewLineWithoutBullet(root).perform()).toEqual(
        UPDATED_OUTCOME,
      );
      expect(root.print()).toBe(want);
      expect(root.getCursor()).toEqual({ line: line + 1, ch: 1 });
    },
  );

  test("should create a note line below the current list item", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n",
        cursor: { line: 0, ch: 8 },
      }),
      settings: makeSettings(),
    });

    const op = new InsertNewLineWithoutBullet(root);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- item 1\n  \n- item 2");
    expect(root.getCursor().line).toBe(1);
    expect(root.getCursor().ch).toBe(2);
  });

  test("should split the current list line into a note line", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n",
        cursor: { line: 0, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new InsertNewLineWithoutBullet(root);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- ite\n  m 1");
    expect(root.getCursor().line).toBe(1);
    expect(root.getCursor().ch).toBe(2);
  });

  test("should preserve existing note indentation when splitting a note line", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n  note line\n- item 2\n",
        cursor: { line: 1, ch: 7 },
      }),
      settings: makeSettings(),
    });

    const op = new InsertNewLineWithoutBullet(root);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- item 1\n  note \n  line\n- item 2");
    expect(root.getCursor().line).toBe(2);
    expect(root.getCursor().ch).toBe(2);
  });
});

test.each([
  {
    text: "- ```js\n\tfooBAR\n  ```",
    ch: 4,
    want: "- ```js\n\tfoo\n  BAR\n  ```",
  },
  {
    text: "- ```js\n\tfoo\n  foo\n  ```",
    ch: 1,
    want: "- ```js\n\t\n  foo\n  foo\n  ```",
  },
])("retains the split source row prefix in $text", ({ text, ch, want }) => {
  const root = makeRoot({
    editor: makeEditor({ text, cursor: { line: 1, ch } }),
  });
  expect(new InsertNewLineWithoutBullet(root).perform()).toEqual(
    UPDATED_OUTCOME,
  );
  expect(root.print()).toBe(want);
  expect(root.getCursor()).toEqual({ line: 2, ch: 2 });
});
