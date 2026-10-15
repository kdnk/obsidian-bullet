import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import { MoveListUp } from "../MoveListUp";
import {
  NO_OP_OUTCOME,
  STOP_ONLY_OUTCOME,
  UPDATED_OUTCOME,
} from "../Operation";

describe("MoveListUp operation", () => {
  test("preserves both owners when renumbering changes their marker widths", () => {
    const prefix = Array.from(
      { length: 8 },
      (_, index) => `${index + 1}. before`,
    ).join("\n");
    const head = { line: 9, ch: 4 };
    const anchor = { line: 8, ch: 5 };
    const editor = makeEditor({
      text: `${prefix}\n9. first\n10. second`,
      cursor: head,
    });
    editor.listSelections = () => [{ anchor, head }];
    const root = makeRoot({ editor });

    expect(new MoveListUp(root, true).perform()).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe(`${prefix}\n9. second\n10. first`);
    expect(root.getSelections()).toEqual([
      { anchor: { line: 9, ch: 6 }, head: { line: 8, ch: 3 } },
    ]);
  });

  test("keeps a spanning selection unchanged when the item cannot move", () => {
    const head = { line: 0, ch: 2 };
    const anchor = { line: 1, ch: 4 };
    const editor = makeEditor({ text: "- first\n- second", cursor: head });
    editor.listSelections = () => [{ anchor, head }];
    const root = makeRoot({ editor });

    expect(new MoveListUp(root, true).perform()).toEqual(STOP_ONLY_OUTCOME);
    expect(root.print()).toBe("- first\n- second");
    expect(root.getSelections()).toEqual([{ anchor, head }]);
  });

  test.each([
    {
      name: "anchor below the moved item",
      text: "- first\n- second\n- third",
      head: { line: 1, ch: 2 },
      anchor: { line: 2, ch: 7 },
      expectedText: "- second\n- first\n- third",
      expectedHead: { line: 0, ch: 2 },
      expectedAnchor: { line: 2, ch: 7 },
    },
    {
      name: "anchor above the moved item",
      text: "- first\n- second\n- third",
      head: { line: 1, ch: 2 },
      anchor: { line: 0, ch: 5 },
      expectedText: "- second\n- first\n- third",
      expectedHead: { line: 0, ch: 2 },
      expectedAnchor: { line: 1, ch: 5 },
    },
    {
      name: "anchor on a sibling continuation row",
      text: "- first\n\tcontinued\n- second",
      head: { line: 2, ch: 2 },
      anchor: { line: 1, ch: 4 },
      expectedText: "- second\n- first\n\tcontinued",
      expectedHead: { line: 0, ch: 2 },
      expectedAnchor: { line: 2, ch: 4 },
    },
    {
      name: "anchor before the parsed root",
      text: "before\n\n- first\n- second\n\nafter",
      head: { line: 3, ch: 2 },
      anchor: { line: 0, ch: 4 },
      expectedText: "- second\n- first",
      expectedHead: { line: 2, ch: 2 },
      expectedAnchor: { line: 0, ch: 4 },
    },
    {
      name: "anchor after the parsed root",
      text: "before\n\n- first\n- second\n\nafter",
      head: { line: 3, ch: 2 },
      anchor: { line: 5, ch: 4 },
      expectedText: "- second\n- first",
      expectedHead: { line: 2, ch: 2 },
      expectedAnchor: { line: 5, ch: 4 },
    },
  ])(
    "preserves $name",
    ({ text, head, anchor, expectedText, expectedHead, expectedAnchor }) => {
      const editor = makeEditor({ text, cursor: head });
      editor.listSelections = () => [{ anchor, head }];
      const root = makeRoot({ editor });

      expect(new MoveListUp(root, true).perform()).toEqual(UPDATED_OUTCOME);
      expect(root.print()).toBe(expectedText);
      expect(root.getSelections()).toEqual([
        { anchor: expectedAnchor, head: expectedHead },
      ]);
    },
  );

  test.each([9, 99])(
    "keeps both selection ends on content across %i",
    (last) => {
      const movingNumber = last + 1;
      const targetNumber = last;
      const editor = makeEditor({
        text: Array.from(
          { length: last + 1 },
          (_, index) => `${index + 1}. content`,
        ).join("\n"),
        cursor: { line: last, ch: String(movingNumber).length + 2 },
      });
      editor.listSelections = () => [
        {
          anchor: { line: last, ch: String(movingNumber).length + 6 },
          head: { line: last, ch: String(movingNumber).length + 2 },
        },
      ];
      const root = makeRoot({ editor });

      expect(new MoveListUp(root, true).perform()).toEqual(UPDATED_OUTCOME);
      expect(root.getSelections()).toEqual([
        {
          anchor: { line: last - 1, ch: String(targetNumber).length + 6 },
          head: { line: last - 1, ch: String(targetNumber).length + 2 },
        },
      ]);
    },
  );

  test("moves a fence with tab-indented content as one item", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- previous\n- ```js\n\tcode\n\t```\n- next",
        cursor: { line: 1, ch: 3 },
      }),
    });

    expect(new MoveListUp(root, false).perform()).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- ```js\n\tcode\n\t```\n- previous\n- next");
  });

  test("should move a list item up before its sibling", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n- item 3\n",
        cursor: { line: 2, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new MoveListUp(root, true);
    const outcome = op.perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- item 1\n- item 3\n- item 2");
    expect(root.getCursor().line).toBe(1);
    expect(root.getCursor().ch).toBe(5);
  });

  test("should move root items up even when they have shared leading whitespace", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: " - item 1\n - item 2\n - item 3\n",
        cursor: { line: 2, ch: 6 },
      }),
      settings: makeSettings(),
    });

    const op = new MoveListUp(root, true);
    const outcome = op.perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe(" - item 1\n - item 3\n - item 2");
    expect(root.getCursor().line).toBe(1);
    expect(root.getCursor().ch).toBe(6);
  });

  test("should move a list item up to previous parent's level if it's the first child", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n  - item 2.1\n  - item 2.2\n- item 3\n",
        cursor: { line: 3, ch: 7 },
      }),
      settings: makeSettings(),
    });

    const op = new MoveListUp(root, true);
    const outcome = op.perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe(
      "- item 1\n- item 2\n  - item 2.2\n  - item 2.1\n- item 3",
    );
    expect(root.getCursor().line).toBe(2);
    expect(root.getCursor().ch).toBe(7);
  });

  test("should not move a list item up if it's the first item in the list", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n- item 3\n",
        cursor: { line: 0, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new MoveListUp(root, true);
    const outcome = op.perform();

    expect(outcome).toEqual(STOP_ONLY_OUTCOME);
    expect(root.print()).toBe("- item 1\n- item 2\n- item 3");
    expect(root.getCursor().line).toBe(0);
    expect(root.getCursor().ch).toBe(5);
  });

  test("should move a list item up to the previous parent item if it's the first child", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n  - item 1.1\n- item 2\n  - item 2.1\n",
        cursor: { line: 3, ch: 7 },
      }),
      settings: makeSettings(),
    });

    const op = new MoveListUp(root, true);
    const outcome = op.perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- item 1\n  - item 1.1\n  - item 2.1\n- item 2");
    expect(root.getCursor().line).toBe(2);
    expect(root.getCursor().ch).toBe(7);
  });

  test("should recalculate numeric bullets after moving", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "1. item 1\n2. item 2\n3. item 3\n",
        cursor: { line: 2, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new MoveListUp(root, true);
    const outcome = op.perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("1. item 1\n2. item 3\n3. item 2");
    expect(root.getCursor().line).toBe(1);
    expect(root.getCursor().ch).toBe(5);
  });

  test("should not do anything if there are multiple selections", () => {
    const editor = makeEditor({
      text: "- item 1\n- item 2\n- item 3\n",
      cursor: { line: 2, ch: 5 },
    });

    // Mock multiple selections
    editor.listSelections = () => [
      { anchor: { line: 1, ch: 3 }, head: { line: 1, ch: 3 } },
      { anchor: { line: 2, ch: 5 }, head: { line: 2, ch: 5 } },
    ];

    const root = makeRoot({
      editor,
      settings: makeSettings(),
    });

    const op = new MoveListUp(root, true);
    const outcome = op.perform();

    expect(outcome).toEqual(NO_OP_OUTCOME);
    expect(root.print()).toBe("- item 1\n- item 2\n- item 3");
  });

  test("should move a list item up when a single line has a text selection", () => {
    const editor = makeEditor({
      text: "- item 1\n- item 2\n- item 3\n",
      cursor: { line: 2, ch: 7 },
    });

    editor.listSelections = () => [
      { anchor: { line: 2, ch: 3 }, head: { line: 2, ch: 7 } },
    ];

    const root = makeRoot({
      editor,
      settings: makeSettings(),
    });

    const op = new MoveListUp(root, true);
    const outcome = op.perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- item 1\n- item 3\n- item 2");
    expect(root.getSelections()).toEqual([
      { anchor: { line: 1, ch: 3 }, head: { line: 1, ch: 7 } },
    ]);
  });

  test("should move a list item up when a single selection spans multiple lines", () => {
    const editor = makeEditor({
      text: "- item 1\n- item 2\n- item 3\n",
      cursor: { line: 2, ch: 5 },
    });

    editor.listSelections = () => [
      { anchor: { line: 1, ch: 2 }, head: { line: 2, ch: 5 } },
    ];

    const root = makeRoot({
      editor,
      settings: makeSettings(),
    });

    const op = new MoveListUp(root, true);
    const outcome = op.perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- item 1\n- item 3\n- item 2");
    expect(root.getSelections()).toEqual([
      { anchor: { line: 2, ch: 2 }, head: { line: 1, ch: 5 } },
    ]);
  });

  test("should stop propagation and update editor when successful", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n- item 3\n",
        cursor: { line: 2, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new MoveListUp(root, true);
    const outcome = op.perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
  });

  test("should stop propagation but not update editor when operation fails", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n- item 3\n",
        cursor: { line: 0, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new MoveListUp(root, true);
    const outcome = op.perform();

    expect(outcome).toEqual(STOP_ONLY_OUTCOME);
  });
});
