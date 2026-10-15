import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import { MoveListDown } from "../MoveListDown";
import { MoveListUp } from "../MoveListUp";
import {
  NO_OP_OUTCOME,
  STOP_ONLY_OUTCOME,
  UPDATED_OUTCOME,
} from "../Operation";

describe("MoveListDown operation", () => {
  test("preserves both owners when renumbering changes their marker widths", () => {
    const prefix = Array.from(
      { length: 8 },
      (_, index) => `${index + 1}. before`,
    ).join("\n");
    const head = { line: 8, ch: 3 };
    const anchor = { line: 9, ch: 6 };
    const editor = makeEditor({
      text: `${prefix}\n9. first\n10. second`,
      cursor: head,
    });
    editor.listSelections = () => [{ anchor, head }];
    const root = makeRoot({ editor });

    expect(new MoveListDown(root, true).perform()).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe(`${prefix}\n9. second\n10. first`);
    expect(root.getSelections()).toEqual([
      { anchor: { line: 8, ch: 5 }, head: { line: 9, ch: 4 } },
    ]);
  });

  test("keeps a spanning selection unchanged when the item cannot move", () => {
    const head = { line: 1, ch: 2 };
    const anchor = { line: 0, ch: 4 };
    const editor = makeEditor({ text: "- first\n- second", cursor: head });
    editor.listSelections = () => [{ anchor, head }];
    const root = makeRoot({ editor });

    expect(new MoveListDown(root, true).perform()).toEqual(STOP_ONLY_OUTCOME);
    expect(root.print()).toBe("- first\n- second");
    expect(root.getSelections()).toEqual([{ anchor, head }]);
  });

  test.each([
    {
      name: "anchor below the moved item",
      text: "- first\n- second\n- third",
      head: { line: 0, ch: 2 },
      anchor: { line: 2, ch: 7 },
      expectedText: "- second\n- first\n- third",
      expectedHead: { line: 1, ch: 2 },
      expectedAnchor: { line: 2, ch: 7 },
    },
    {
      name: "anchor above the moved item",
      text: "- first\n- second\n- third",
      head: { line: 1, ch: 2 },
      anchor: { line: 0, ch: 5 },
      expectedText: "- first\n- third\n- second",
      expectedHead: { line: 2, ch: 2 },
      expectedAnchor: { line: 0, ch: 5 },
    },
    {
      name: "anchor on a sibling continuation row",
      text: "- first\n- second\n\tcontinued",
      head: { line: 0, ch: 2 },
      anchor: { line: 2, ch: 4 },
      expectedText: "- second\n\tcontinued\n- first",
      expectedHead: { line: 2, ch: 2 },
      expectedAnchor: { line: 1, ch: 4 },
    },
    {
      name: "anchor before the parsed root",
      text: "before\n\n- first\n- second\n\nafter",
      head: { line: 2, ch: 2 },
      anchor: { line: 0, ch: 4 },
      expectedText: "- second\n- first",
      expectedHead: { line: 3, ch: 2 },
      expectedAnchor: { line: 0, ch: 4 },
    },
    {
      name: "anchor after the parsed root",
      text: "before\n\n- first\n- second\n\nafter",
      head: { line: 2, ch: 2 },
      anchor: { line: 5, ch: 4 },
      expectedText: "- second\n- first",
      expectedHead: { line: 3, ch: 2 },
      expectedAnchor: { line: 5, ch: 4 },
    },
  ])(
    "preserves $name",
    ({ text, head, anchor, expectedText, expectedHead, expectedAnchor }) => {
      const editor = makeEditor({ text, cursor: head });
      editor.listSelections = () => [{ anchor, head }];
      const root = makeRoot({ editor });

      expect(new MoveListDown(root, true).perform()).toEqual(UPDATED_OUTCOME);
      expect(root.print()).toBe(expectedText);
      expect(root.getSelections()).toEqual([
        { anchor: expectedAnchor, head: expectedHead },
      ]);
    },
  );

  test.each([1, 2])(
    "keeps a selection endpoint on unchanged descendant row %i",
    (offset) => {
      const prefix = Array.from(
        { length: 8 },
        (_, index) => `${index + 1}. before`,
      ).join("\n");
      const editor = makeEditor({
        text: `${prefix}\n9. parent\n\tcontinued\n\t- child\n10. next`,
        cursor: { line: 8, ch: 3 },
      });
      editor.listSelections = () => [
        {
          anchor: { line: 8 + offset, ch: offset === 1 ? 2 : 4 },
          head: { line: 8, ch: 3 },
        },
      ];
      const root = makeRoot({ editor });

      new MoveListDown(root, true).perform();
      expect(root.print()).toBe(
        `${prefix}\n9. next\n10. parent\n\tcontinued\n\t- child`,
      );
      expect(root.getSelections()).toEqual([
        {
          anchor: { line: 9 + offset, ch: offset === 1 ? 2 : 4 },
          head: { line: 9, ch: 4 },
        },
      ]);
      new MoveListUp(root, true).perform();
      expect(root.getSelections()).toEqual(editor.listSelections());
    },
  );

  test.each([9, 99])(
    "keeps both selection ends on content across %i",
    (last) => {
      const movingNumber = last;
      const targetNumber = last + 1;
      const editor = makeEditor({
        text: Array.from(
          { length: last + 1 },
          (_, index) => `${index + 1}. content`,
        ).join("\n"),
        cursor: { line: last - 1, ch: String(movingNumber).length + 2 },
      });
      editor.listSelections = () => [
        {
          anchor: { line: last - 1, ch: String(movingNumber).length + 6 },
          head: { line: last - 1, ch: String(movingNumber).length + 2 },
        },
      ];
      const root = makeRoot({ editor });

      expect(new MoveListDown(root, true).perform()).toEqual(UPDATED_OUTCOME);
      expect(root.getSelections()).toEqual([
        {
          anchor: { line: last, ch: String(targetNumber).length + 6 },
          head: { line: last, ch: String(targetNumber).length + 2 },
        },
      ]);
    },
  );

  test.each([
    { lastSingleWidth: 9, bodyIndent: "   ", codeIndent: "     " },
    { lastSingleWidth: 9, bodyIndent: "\t", codeIndent: "\t  " },
    { lastSingleWidth: 99, bodyIndent: "    ", codeIndent: "      " },
    { lastSingleWidth: 99, bodyIndent: "\t", codeIndent: "\t  " },
  ])(
    "preserves fenced code across $lastSingleWidth and the next number with $bodyIndent",
    ({ lastSingleWidth, bodyIndent, codeIndent }) => {
      const prefix = Array.from(
        { length: lastSingleWidth - 1 },
        (_, index) => `${index + 1}. before`,
      ).join("\n");
      const text = `${prefix}\n${lastSingleWidth}. \`\`\`js\n${codeIndent}code\n\n${bodyIndent}\`\`\`\n${lastSingleWidth + 1}. next`;
      const root = makeRoot({
        editor: makeEditor({
          text,
          cursor: { line: lastSingleWidth - 1, ch: 3 },
        }),
      });

      expect(new MoveListDown(root, true).perform()).toEqual(UPDATED_OUTCOME);
      const moved = `${prefix}\n${lastSingleWidth}. next\n${lastSingleWidth + 1}. \`\`\`js\n${codeIndent} code\n\n${bodyIndent} \`\`\``;
      expect(root.print()).toBe(moved);
      const reparsed = makeRoot({
        editor: makeEditor({ text: moved, cursor: root.getCursor() }),
      });
      expect(reparsed.print()).toBe(moved);

      expect(new MoveListUp(reparsed, true).perform()).toEqual(UPDATED_OUTCOME);
      expect(reparsed.print()).toBe(text);
    },
  );

  test("should move a list item down below its next sibling", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n- item 3\n",
        cursor: { line: 1, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new MoveListDown(root, true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- item 1\n- item 3\n- item 2");
    expect(root.getCursor().line).toBe(2);
    expect(root.getCursor().ch).toBe(5);
  });

  test("should move a list with children down below its next sibling", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n  - item 1.1\n  - item 1.2\n- item 2\n",
        cursor: { line: 0, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new MoveListDown(root, true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- item 2\n- item 1\n  - item 1.1\n  - item 1.2");
    expect(root.getCursor().line).toBe(1);
    expect(root.getCursor().ch).toBe(5);
  });

  test("should move root items down even when they have shared leading whitespace", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: " - item 1\n - item 2\n - item 3\n",
        cursor: { line: 0, ch: 6 },
      }),
      settings: makeSettings(),
    });

    const op = new MoveListDown(root, true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe(" - item 2\n - item 1\n - item 3");
    expect(root.getCursor().line).toBe(1);
    expect(root.getCursor().ch).toBe(6);
  });

  test("should move a mixed-indentation sibling down without corrupting the list", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n    - item 1.1\n\t- item 1.2\n",
        cursor: { line: 1, ch: 7 },
      }),
      settings: makeSettings(),
    });

    const op = new MoveListDown(root, true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- item 1\n\t- item 1.2\n    - item 1.1");
    expect(root.getCursor().line).toBe(2);
    expect(root.getCursor().ch).toBe(7);
  });

  test("should move a list item to the next parent level if it's the last sibling", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n  - item 1.1\n  - item 1.2\n- item 2\n",
        cursor: { line: 2, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new MoveListDown(root, true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- item 1\n  - item 1.1\n- item 2\n  - item 1.2");
    expect(root.getCursor().line).toBe(3);
    expect(root.getCursor().ch).toBe(5);
  });

  test("should not move a list item if it's the last item in the document", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n- item 3\n",
        cursor: { line: 2, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new MoveListDown(root, true);
    expect(op.perform()).toEqual(STOP_ONLY_OUTCOME);

    expect(root.print()).toBe("- item 1\n- item 2\n- item 3");
    expect(root.getCursor().line).toBe(2);
    expect(root.getCursor().ch).toBe(5);
  });

  test("should not move a list item if it has no parent and no siblings", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n",
        cursor: { line: 0, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new MoveListDown(root, true);
    expect(op.perform()).toEqual(STOP_ONLY_OUTCOME);

    expect(root.print()).toBe("- item 1");
    expect(root.getCursor().line).toBe(0);
    expect(root.getCursor().ch).toBe(5);
  });

  test("should recalculate numeric bullets after move", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "1. item 1\n2. item 2\n3. item 3\n",
        cursor: { line: 0, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new MoveListDown(root, true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("1. item 2\n2. item 1\n3. item 3");
    expect(root.getCursor().line).toBe(1);
    expect(root.getCursor().ch).toBe(5);
  });

  test("should not do anything if there are multiple selections", () => {
    const editor = makeEditor({
      text: "- item 1\n- item 2\n- item 3\n",
      cursor: { line: 0, ch: 5 },
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

    const op = new MoveListDown(root, true);
    expect(op.perform()).toEqual(NO_OP_OUTCOME);

    expect(root.print()).toBe("- item 1\n- item 2\n- item 3");
  });

  test("should move a list item down when a single line has a text selection", () => {
    const editor = makeEditor({
      text: "- item 1\n- item 2\n- item 3\n",
      cursor: { line: 1, ch: 7 },
    });

    editor.listSelections = () => [
      { anchor: { line: 1, ch: 3 }, head: { line: 1, ch: 7 } },
    ];

    const root = makeRoot({
      editor,
      settings: makeSettings(),
    });

    const op = new MoveListDown(root, true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- item 1\n- item 3\n- item 2");
    expect(root.getSelections()).toEqual([
      { anchor: { line: 2, ch: 3 }, head: { line: 2, ch: 7 } },
    ]);
  });

  test("should move a list item down when a single selection spans multiple lines", () => {
    const editor = makeEditor({
      text: "- item 1\n- item 2\n- item 3\n",
      cursor: { line: 1, ch: 5 },
    });

    editor.listSelections = () => [
      { anchor: { line: 2, ch: 5 }, head: { line: 1, ch: 2 } },
    ];

    const root = makeRoot({
      editor,
      settings: makeSettings(),
    });

    const op = new MoveListDown(root, true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- item 1\n- item 3\n- item 2");
    expect(root.getSelections()).toEqual([
      { anchor: { line: 1, ch: 5 }, head: { line: 2, ch: 2 } },
    ]);
  });

  test("should stop propagation and update editor when successful", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n- item 3\n",
        cursor: { line: 0, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new MoveListDown(root, true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);
  });
});
