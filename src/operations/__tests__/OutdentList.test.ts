import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import {
  NO_OP_OUTCOME,
  STOP_ONLY_OUTCOME,
  UPDATED_OUTCOME,
} from "../Operation";
import { OutdentList } from "../OutdentList";

describe("OutdentList operation", () => {
  test.each([false, true])(
    "moves the selected item with its children, reversed=%s",
    (reversed) => {
      const root = makeRoot({
        editor: makeEditor({
          text: "- first\n\t- second\n\t\t- child",
          cursor: { line: 1, ch: 9 },
        }),
      });
      const anchor = { line: 1, ch: reversed ? 9 : 3 };
      const head = { line: 1, ch: reversed ? 3 : 9 };
      root.replaceSelections([{ anchor, head }]);

      expect(new OutdentList(root, false).perform()).toEqual(UPDATED_OUTCOME);
      expect(root.print()).toBe("- first\n- second\n\t- child");
      expect(root.getSelections()).toEqual([
        {
          anchor: { line: 1, ch: anchor.ch + -1 },
          head: { line: 1, ch: head.ch + -1 },
        },
      ]);
    },
  );

  test.each([
    {
      name: "nested code",
      text: "- parent\n\t- ```js\n\t\t  abc\n\t  ```",
      line: 2,
      ch: 5,
      expected: "- parent\n\t- ```js\n\t  abc\n\t  ```",
      expectedCh: 4,
    },
    {
      name: "container floor",
      text: "- parent\n\t- ```js\n\t    abc\n\t  ```",
      line: 2,
      ch: 6,
      expected: "- parent\n\t- ```js\n\t  abc\n\t  ```",
      expectedCh: 4,
    },
    {
      name: "crossing tab",
      text: "- ```js\n\tabc\n  ```",
      line: 1,
      ch: 2,
      expected: "- ```js\n  abc\n  ```",
      expectedCh: 3,
    },
  ])(
    "indents code without moving its owner: $name",
    ({ text, line, ch, expected, expectedCh }) => {
      const root = makeRoot({
        editor: makeEditor({ text, cursor: { line, ch } }),
      });
      expect(new OutdentList(root, false, "\t").perform()).toEqual(
        UPDATED_OUTCOME,
      );
      expect(root.print()).toBe(expected);
      expect(root.getCursor()).toEqual({ line, ch: expectedCh });
    },
  );

  test.each([false, true])(
    "keeps selected text through numeric marker width changes, reversed=%s",
    (reverse) => {
      const previous = Array.from(
        { length: 9 },
        (_, index) => `${index + 1}. previous`,
      ).join("\n");
      const root = makeRoot({
        editor: makeEditor({
          text: `${previous}\n\t1. abcdef`,
          cursor: { line: 9, ch: 7 },
        }),
      });
      const from = { line: 9, ch: 4 };
      const to = { line: 9, ch: 7 };
      const selection = {
        anchor: reverse ? to : from,
        head: reverse ? from : to,
      };
      root.replaceSelections([selection]);
      expect(new OutdentList(root, true, "\t").perform()).toEqual(
        UPDATED_OUTCOME,
      );
      expect(root.print()).toBe(`${previous}\n10. abcdef`);
      expect(root.getSelections()).toEqual([selection]);
    },
  );

  test("does not outdent the code container when code is flush", () => {
    const text = "- parent\n\t- ```js\n\t  abc\n\t  ```";
    const root = makeRoot({
      editor: makeEditor({ text, cursor: { line: 2, ch: 4 } }),
    });
    expect(new OutdentList(root, false, "\t").perform()).toEqual(
      STOP_ONLY_OUTCOME,
    );
    expect(root.print()).toBe(text);
  });

  test("keeps the closing fence and list hierarchy unchanged", () => {
    const text = "- parent\n\t- ```js\n\t  abc\n\t  ```";
    const root = makeRoot({
      editor: makeEditor({ text, cursor: { line: 3, ch: 5 } }),
    });
    expect(new OutdentList(root, false, "\t").perform()).toEqual(
      STOP_ONLY_OUTCOME,
    );
    expect(root.print()).toBe(text);
  });

  test("leaves multiline selections for native indentation", () => {
    const text = "- first\n\t- second\n\t\t- child";
    const root = makeRoot({
      editor: makeEditor({ text, cursor: { line: 1, ch: 9 } }),
    });
    const selection = {
      anchor: { line: 0, ch: 2 },
      head: { line: 1, ch: 9 },
    };
    root.replaceSelections([selection]);

    expect(new OutdentList(root, false).perform()).toEqual(NO_OP_OUTCOME);
    expect(root.print()).toBe(text);
    expect(root.getSelections()).toEqual([selection]);
  });

  test("should outdent a list item to its parent's level", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n  - child\n    - grandchild\n",
        cursor: { line: 2, ch: 9 },
      }),
      settings: makeSettings(),
    });

    const op = new OutdentList(root, true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- parent\n  - child\n  - grandchild");
    expect(root.getCursor().line).toBe(2);
    expect(root.getCursor().ch).toBe(7); // cursor moves back by the indent difference
  });

  test("should outdent a list item with its children", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n  - child\n    - grandchild\n      - great-grandchild\n",
        cursor: { line: 2, ch: 9 },
      }),
      settings: makeSettings(),
    });

    const op = new OutdentList(root, true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe(
      "- parent\n  - child\n  - grandchild\n    - great-grandchild",
    );
    expect(root.getCursor().line).toBe(2);
    expect(root.getCursor().ch).toBe(7);
  });

  test("should not outdent a list item at the root level", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n- item 3\n",
        cursor: { line: 1, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new OutdentList(root, true);
    expect(op.perform()).toEqual(STOP_ONLY_OUTCOME);

    expect(root.print()).toBe("- item 1\n- item 2\n- item 3");
    expect(root.getCursor().line).toBe(1);
    expect(root.getCursor().ch).toBe(5);
  });

  test("should recalculate numeric bullets after outdention", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "1. parent\n   1. child\n   2. second child\n      1. grandchild\n",
        cursor: { line: 3, ch: 11 },
      }),
      settings: makeSettings(),
    });

    const op = new OutdentList(root, true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    // The numeric bullet for the outdented item should be adjusted
    const result = root.print();
    const lines = result.split("\n");
    expect(lines[3].trim()).toMatch(/^3\. grandchild$/);
  });

  test("should do nothing if there are multiple selections", () => {
    const editor = makeEditor({
      text: "- parent\n  - child\n    - grandchild\n",
      cursor: { line: 2, ch: 9 },
    });

    // Mock multiple selections
    editor.listSelections = () => [
      { anchor: { line: 1, ch: 3 }, head: { line: 1, ch: 3 } },
      { anchor: { line: 2, ch: 9 }, head: { line: 2, ch: 9 } },
    ];

    const root = makeRoot({
      editor,
      settings: makeSettings(),
    });

    const op = new OutdentList(root, true);
    expect(op.perform()).toEqual(NO_OP_OUTCOME);

    expect(root.print()).toBe("- parent\n  - child\n    - grandchild");
  });

  test("should stop propagation and update editor when successful", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n  - child\n    - grandchild\n",
        cursor: { line: 2, ch: 9 },
      }),
      settings: makeSettings(),
    });

    const op = new OutdentList(root, true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);
  });

  test("should keep cursor at the same relative text position when outdenting text with delimiters", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n  - **test** item\n",
        cursor: { line: 1, ch: 11 },
      }),
      settings: makeSettings(),
    });

    const op = new OutdentList(root, true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- parent\n- **test** item");
    expect(root.getCursor()).toEqual({ line: 1, ch: 9 });
  });
});
