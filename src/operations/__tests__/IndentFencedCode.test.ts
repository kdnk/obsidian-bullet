import { makeEditor, makeRoot } from "../../__mocks__";
import { IndentList } from "../IndentList";
import { UPDATED_OUTCOME } from "../Operation";
import { OutdentList } from "../OutdentList";

describe("fenced code indentation", () => {
  test.each([false, true])(
    "moves selected code rows and retains direction, reversed=%s",
    (reverse) => {
      const text = "- owner\n  ```js\n  one\n  two\n  ```\n- next";
      const root = makeRoot({
        editor: makeEditor({ text, cursor: { line: 2, ch: 2 } }),
      });
      const from = { line: 2, ch: 2 };
      const to = { line: 3, ch: 5 };
      const selection = {
        anchor: reverse ? to : from,
        head: reverse ? from : to,
      };
      root.replaceSelections([selection]);

      expect(new IndentList(root, "  ", false).perform()).toEqual(
        UPDATED_OUTCOME,
      );
      expect(root.print()).toBe(
        "- owner\n  ```js\n    one\n    two\n  ```\n- next",
      );
      expect(root.getSelections()).toEqual([
        {
          anchor: { ...selection.anchor, ch: selection.anchor.ch + 2 },
          head: { ...selection.head, ch: selection.head.ch + 2 },
        },
      ]);
      expect(new OutdentList(root, false, "  ").perform()).toEqual(
        UPDATED_OUTCOME,
      );
      expect(root.print()).toBe(text);
      expect(root.getSelections()).toEqual([selection]);
    },
  );

  test.each([2, 3, 4, 5, 6])(
    "keeps a cursor at column %s inside the code container while outdenting",
    (ch) => {
      const root = makeRoot({
        editor: makeEditor({
          text: "- owner\n  ```\n      code\n  ```",
          cursor: { line: 2, ch },
        }),
      });
      expect(new OutdentList(root, false, "\t").perform()).toEqual(
        UPDATED_OUTCOME,
      );
      expect(root.print()).toBe("- owner\n  ```\n  code\n  ```");
      expect(root.getCursor()).toEqual({ line: 2, ch: 2 });
    },
  );

  test.each([false, true])(
    "clamps selection endpoints inside removed code indentation, reversed=%s",
    (reverse) => {
      const root = makeRoot({
        editor: makeEditor({
          text: "- owner\n  ```\n      code\n  ```",
          cursor: { line: 2, ch: 3 },
        }),
      });
      const from = { line: 2, ch: 3 },
        to = { line: 2, ch: 8 };
      root.replaceSelections([
        { anchor: reverse ? to : from, head: reverse ? from : to },
      ]);
      expect(new OutdentList(root, false, "\t").perform()).toEqual(
        UPDATED_OUTCOME,
      );
      expect(root.print()).toBe("- owner\n  ```\n  code\n  ```");
      expect(root.getSelections()).toEqual([
        {
          anchor: { line: 2, ch: reverse ? 4 : 2 },
          head: { line: 2, ch: reverse ? 2 : 4 },
        },
      ]);
    },
  );

  test("keeps an endpoint before removed code indentation in place", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- owner\n  ```\n        code\n  ```",
        cursor: { line: 2, ch: 3 },
      }),
    });
    expect(new OutdentList(root, false, "\t").perform()).toEqual(
      UPDATED_OUTCOME,
    );
    expect(root.print()).toBe("- owner\n  ```\n    code\n  ```");
    expect(root.getCursor()).toEqual({ line: 2, ch: 3 });
  });

  test("does not indent the closing fence at the end-exclusive selection boundary", () => {
    const text = "- ```js\n  one\n  ```";
    const root = makeRoot({
      editor: makeEditor({ text, cursor: { line: 1, ch: 2 } }),
    });
    root.replaceSelections([
      { anchor: { line: 1, ch: 2 }, head: { line: 2, ch: 0 } },
    ]);
    expect(new IndentList(root, "  ", false).perform()).toEqual(
      UPDATED_OUTCOME,
    );
    expect(root.print()).toBe("- ```js\n    one\n  ```");
    expect(root.getSelections()).toEqual([
      { anchor: { line: 1, ch: 4 }, head: { line: 2, ch: 0 } },
    ]);
  });
});
