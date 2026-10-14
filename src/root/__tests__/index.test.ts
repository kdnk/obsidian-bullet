import { Position, isRangesIntersects, recalculateNumericBullets } from "..";

import { makeEditor, makeRoot } from "../../__mocks__";

function parseRanges(str: string): {
  a: [Position, Position];
  b: [Position, Position];
} {
  return {
    a: [
      { line: 0, ch: str.indexOf("[") },
      { line: 0, ch: str.indexOf("]") },
    ],
    b: [
      { line: 0, ch: str.indexOf("(") },
      { line: 0, ch: str.indexOf(")") },
    ],
  };
}

describe("isRangesIntersects", () => {
  const cases: [string, boolean][] = [
    ["[--(-]--)", true],
    ["(--[-)--]", true],
    ["[--(--)--]", true],
    ["(--[--]--)", true],
    ["[--](--)", false],
    ["(--)[--]", false],
  ];

  test.each(cases)(
    "when ranges are '%s' then result is %s",
    (ranges: string, result: boolean) => {
      const { a, b } = parseRanges(ranges);

      expect(isRangesIntersects(a, b)).toBe(result);
    },
  );
});

describe("recalculateNumericBullets", () => {
  test("should recalculate numeric bullets by default", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "4. one\n\t3. two\n\t2. three\n1. four",
        cursor: { line: 0, ch: 0 },
      }),
    });

    recalculateNumericBullets(root);

    expect(root.print()).toBe("1. one\n\t1. two\n\t2. three\n2. four");
  });

  test("should not recalculate numeric bullets when disabled", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "4. one\n\t3. two\n\t2. three\n1. four",
        cursor: { line: 0, ch: 0 },
      }),
    });

    recalculateNumericBullets(root, false);

    expect(root.print()).toBe("4. one\n\t3. two\n\t2. three\n1. four");
  });
});

describe("Root", () => {
  describe("renumbering a fenced-code item with a tab separator", () => {
    test.each([
      {
        before: "9.\t```js\n\t  code\n\t```\n11. next",
        bullet: "10.",
        after: "10.\t```js\n\t  code\n\t```\n11. next",
      },
      {
        before: "10.\t```js\n\t  code\n\t```\n11. next",
        bullet: "9.",
        after: "9.\t```js\n\t  code\n\t```\n11. next",
      },
      {
        before: "99.\t```js\n\t  code\n\t```\n101. next",
        bullet: "100.",
        after: "100.\t```js\n\t      code\n\t    ```\n101. next",
      },
      {
        before: "100.\t```js\n\t      code\n\t    ```\n101. next",
        bullet: "99.",
        after: "99.\t```js\n\t  code\n\t```\n101. next",
      },
      {
        before: " 9.\t```js\n\t  code\n\t```\n 11. next",
        bullet: "10.",
        after: " 10.\t```js\n\t      code\n\t    ```\n 11. next",
      },
    ])(
      "preserves code indentation when replacing the marker with $bullet",
      ({ before, bullet, after }) => {
        const root = makeRoot({
          editor: makeEditor({ text: before, cursor: { line: 0, ch: 0 } }),
        });
        const list = root.getChildren()[0];

        list.replateBullet(bullet);

        expect(root.print()).toBe(after);
        expect(list.getLinesForFenceParsing()).toEqual([
          "```js",
          "  code",
          "```",
        ]);
        const reparsed = makeRoot({
          editor: makeEditor({
            text: root.print(),
            cursor: { line: 0, ch: 0 },
          }),
        });
        expect(reparsed.getChildren()[0].getLinesForFenceParsing()).toEqual([
          "```js",
          "  code",
          "```",
        ]);
      },
    );
  });

  describe("getListUnderLine", () => {
    test("should return list under line", () => {
      const root = makeRoot({
        editor: makeEditor({
          text: "- one\n\t- two\n- three",
          cursor: { line: 0, ch: 0 },
        }),
      });

      const list = root.getListUnderLine(1);

      expect(list).toBeDefined();
      expect(list!.print()).toBe("\t- two\n");
    });

    test("should return list under line when line is note", () => {
      const root = makeRoot({
        editor: makeEditor({
          text: "- one\n\tnote1\n\t- two\n\t\tnote2\n- three",
          cursor: { line: 0, ch: 0 },
        }),
      });

      const list = root.getListUnderLine(3);

      expect(list).toBeDefined();
      expect(list!.print()).toBe("\t- two\n\t\tnote2\n");
    });
  });

  describe("getContentLinesRangeOf", () => {
    test("should return range of list", () => {
      const root = makeRoot({
        editor: makeEditor({
          text: "- one\n\t- two\n- three",
          cursor: { line: 0, ch: 0 },
        }),
      });

      const range = root.getContentLinesRangeOf(
        root.getChildren()[0].getChildren()[0],
      );

      expect(range).toStrictEqual([1, 1]);
    });

    test("should return range of list when list has notes", () => {
      const root = makeRoot({
        editor: makeEditor({
          text: "- one\n\tnote1\n\t- two\n\t\tnote2\n- three",
          cursor: { line: 0, ch: 0 },
        }),
      });

      const range = root.getContentLinesRangeOf(
        root.getChildren()[0].getChildren()[0],
      );

      expect(range).toStrictEqual([2, 3]);
    });
  });
});
