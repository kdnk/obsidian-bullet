import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import {
  NO_OP_OUTCOME,
  STOP_ONLY_OUTCOME,
  UPDATED_OUTCOME,
} from "../Operation";
import { OutdentList } from "../OutdentList";

describe("OutdentList operation", () => {
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
