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
