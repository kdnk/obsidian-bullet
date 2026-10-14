import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import { InsertNewLineWithoutBullet } from "../InsertNewLineWithoutBullet";
import { UPDATED_OUTCOME } from "../Operation";

describe("InsertNewLineWithoutBullet operation", () => {
  describe.each([false, true])("reversed selection: %s", (reversed) => {
    test.each([
      { text: "- abcdef", line: 0, from: 4, to: 6, want: "- ab\n  ef", ch: 2 },
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
