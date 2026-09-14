import { insertPlainLine } from "../../utils/insertPlainLine";

interface MockEditor {
  getCursor(): { line: number; ch: number };
  getLine(line: number): string;
  replaceRange: jest.Mock;
  setSelections: jest.Mock;
}

describe("insertPlainLine", () => {
  test.each([
    [true, "first\n\t  second\n\t  ", { line: 2, ch: 3 }],
    [false, "first\n\t  \n\t  second", { line: 1, ch: 3 }],
  ])(
    "preserves explicit code indentation with after=%s",
    (after, expected, expectedCursor) => {
      let text = "first\n\t  second";
      let cursor = { line: 1, ch: 5 };
      const editor = {
        getCursor: () => cursor,
        getLine: (line: number) => text.split("\n")[line],
        replaceRange: (insert: string, from: { line: number; ch: number }) => {
          const lines = text.split("\n");
          lines[from.line] =
            lines[from.line].slice(0, from.ch) +
            insert +
            lines[from.line].slice(from.ch);
          text = lines.join("\n");
        },
        setSelections: (
          selections: { head: { line: number; ch: number } }[],
        ) => {
          cursor = selections[0].head;
        },
      };

      insertPlainLine(editor, after, "\t  ");

      expect(text).toBe(expected);
      expect(cursor).toEqual(expectedCursor);
    },
  );

  test("should insert a line below the current line", () => {
    const replaceRange = jest.fn();
    const setSelections = jest.fn();
    const editor: MockEditor = {
      getCursor: () => ({ line: 1, ch: 2 }),
      getLine: (line: number) => ["first", "second"][line],
      replaceRange,
      setSelections,
    };

    insertPlainLine(editor, true);

    expect(replaceRange).toHaveBeenCalledWith(
      "\n",
      { line: 1, ch: 6 },
      { line: 1, ch: 6 },
    );
    expect(setSelections).toHaveBeenCalledWith([
      {
        anchor: { line: 2, ch: 0 },
        head: { line: 2, ch: 0 },
      },
    ]);
  });

  test("should insert a line above the current line", () => {
    const replaceRange = jest.fn();
    const setSelections = jest.fn();
    const editor: MockEditor = {
      getCursor: () => ({ line: 1, ch: 4 }),
      getLine: (line: number) => ["first", "second"][line],
      replaceRange,
      setSelections,
    };

    insertPlainLine(editor, false);

    expect(replaceRange).toHaveBeenCalledWith(
      "\n",
      { line: 1, ch: 0 },
      { line: 1, ch: 0 },
    );
    expect(setSelections).toHaveBeenCalledWith([
      {
        anchor: { line: 1, ch: 0 },
        head: { line: 1, ch: 0 },
      },
    ]);
  });
});
