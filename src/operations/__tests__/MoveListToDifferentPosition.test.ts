import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import { MoveListToDifferentPosition } from "../MoveListToDifferentPosition";
import { NO_OP_OUTCOME, UPDATED_OUTCOME } from "../Operation";

describe("MoveListToDifferentPosition operation", () => {
  test("keeps the cursor inside a moved descendant below its parent's own rows", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- target\n- parent\n\t- child",
        cursor: { line: 2, ch: 4 },
      }),
    });
    const moved = root.getChildren()[1];
    const target = root.getChildren()[0];

    new MoveListToDifferentPosition(
      root,
      moved,
      target,
      "before",
      "\t",
      false,
    ).perform();
    expect(root.print()).toBe("- parent\n\t- child\n- target");
    expect(root.getCursor()).toEqual({ line: 1, ch: 4 });
  });

  test.each([9, 99])(
    "keeps a moved cursor on content across %i in both directions",
    (last) => {
      const text = Array.from(
        { length: last + 1 },
        (_, index) => `${index + 1}. content`,
      ).join("\n");
      const root = makeRoot({
        editor: makeEditor({
          text,
          cursor: { line: last, ch: String(last + 1).length + 2 },
        }),
      });
      const moved = root.getChildren()[last];
      const target = root.getChildren()[last - 1];

      new MoveListToDifferentPosition(
        root,
        moved,
        target,
        "before",
        "\t",
        true,
      ).perform();
      expect(root.getCursor()).toEqual({
        line: last - 1,
        ch: String(last).length + 2,
      });
      new MoveListToDifferentPosition(
        root,
        moved,
        target,
        "after",
        "\t",
        true,
      ).perform();
      expect(root.getCursor()).toEqual({
        line: last,
        ch: String(last + 1).length + 2,
      });
      expect(root.print()).toBe(text);
    },
  );

  test("keeps a physical blank code row cursor at column zero when nesting", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n- ```js\n\n\tcode\n\t```",
        cursor: { line: 2, ch: 0 },
      }),
    });
    const moved = root.getChildren()[1];
    const target = root.getChildren()[0];

    new MoveListToDifferentPosition(
      root,
      moved,
      target,
      "inside",
      "\t",
      false,
    ).perform();
    expect(root.print()).toBe("- parent\n\t- ```js\n\n\t\tcode\n\t\t```");
    expect(root.getCursor()).toEqual({ line: 2, ch: 0 });
  });

  test("should move list before another list", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n- item 3\n",
        cursor: { line: 2, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const listToMove = root.getListUnderLine(2)!; // item 3
    const placeToMove = root.getListUnderLine(0)!; // item 1

    const op = new MoveListToDifferentPosition(
      root,
      listToMove,
      placeToMove,
      "before",
      "  ",
      true,
    );
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- item 3\n- item 1\n- item 2");
  });

  test("should move list after another list", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n- item 3\n",
        cursor: { line: 0, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const listToMove = root.getListUnderLine(0)!; // item 1
    const placeToMove = root.getListUnderLine(1)!; // item 2

    const op = new MoveListToDifferentPosition(
      root,
      listToMove,
      placeToMove,
      "after",
      "  ",
      true,
    );
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- item 2\n- item 1\n- item 3");
  });

  test("should move list inside another list", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n- item 3\n",
        cursor: { line: 2, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const listToMove = root.getListUnderLine(2)!; // item 3
    const placeToMove = root.getListUnderLine(0)!; // item 1

    const op = new MoveListToDifferentPosition(
      root,
      listToMove,
      placeToMove,
      "inside",
      "  ",
      true,
    );
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- item 1\n  - item 3\n- item 2");
  });

  test("should adjust indentation correctly when moving a list", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n  - item 1.1\n- item 2\n",
        cursor: { line: 2, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const listToMove = root.getListUnderLine(2)!; // item 2
    const placeToMove = root.getListUnderLine(1)!; // item 1.1

    const op = new MoveListToDifferentPosition(
      root,
      listToMove,
      placeToMove,
      "inside",
      "  ",
      true,
    );
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- item 1\n  - item 1.1\n    - item 2");
  });

  test("should move list with all its children", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n  - item 2.1\n  - item 2.2\n- item 3\n",
        cursor: { line: 1, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const listToMove = root.getListUnderLine(1)!; // item 2 with children
    const placeToMove = root.getListUnderLine(4)!; // item 3

    const op = new MoveListToDifferentPosition(
      root,
      listToMove,
      placeToMove,
      "after",
      "  ",
      true,
    );
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe(
      "- item 1\n- item 3\n- item 2\n  - item 2.1\n  - item 2.2",
    );
  });

  test("preserves child depth when a mixed-indent subtree moves to the root", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n  - move\n\t- child\n- target",
        cursor: { line: 1, ch: 4 },
      }),
      settings: makeSettings(),
    });

    const listToMove = root.getListUnderLine(1)!;
    const placeToMove = root.getListUnderLine(3)!;

    const op = new MoveListToDifferentPosition(
      root,
      listToMove,
      placeToMove,
      "before",
      "  ",
      true,
    );
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- parent\n- move\n  - child\n- target");
    expect(root.getCursor()).toEqual({ line: 1, ch: 2 });
  });

  test("preserves a tab-indented child's depth when its mixed-indent parent moves to the root", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n \t- move\n\t\t- child\n- target",
        cursor: { line: 2, ch: 4 },
      }),
      settings: makeSettings(),
    });

    const listToMove = root.getListUnderLine(1)!;
    const placeToMove = root.getListUnderLine(3)!;

    expect(
      new MoveListToDifferentPosition(
        root,
        listToMove,
        placeToMove,
        "before",
        "\t",
        true,
      ).perform(),
    ).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- parent\n- move\n\t- child\n- target");
    expect(root.getCursor()).toEqual({ line: 2, ch: 3 });
  });

  test("preserves fenced-code columns when a mixed-indent subtree moves to the root", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n  - ```js\n\tcode\n    ```\n- target",
        cursor: { line: 2, ch: 2 },
      }),
      settings: makeSettings(),
    });

    const listToMove = root.getListUnderLine(1)!;
    const placeToMove = root.getListUnderLine(4)!;

    expect(
      new MoveListToDifferentPosition(
        root,
        listToMove,
        placeToMove,
        "before",
        "  ",
        true,
      ).perform(),
    ).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- parent\n- ```js\n  code\n  ```\n- target");
    expect(root.getCursor()).toEqual({ line: 2, ch: 3 });
  });

  test("should do nothing if attempting to move a list to itself", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n- item 3\n",
        cursor: { line: 1, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const listToMove = root.getListUnderLine(1)!; // item 2
    const placeToMove = listToMove; // same list

    const op = new MoveListToDifferentPosition(
      root,
      listToMove,
      placeToMove,
      "after",
      "  ",
      true,
    );
    expect(op.perform()).toEqual(NO_OP_OUTCOME);

    expect(root.print()).toBe("- item 1\n- item 2\n- item 3");
  });

  test("should recalculate numeric bullets after moving a list", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "1. item 1\n2. item 2\n3. item 3\n",
        cursor: { line: 0, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const listToMove = root.getListUnderLine(0)!; // item 1
    const placeToMove = root.getListUnderLine(2)!; // item 3

    const op = new MoveListToDifferentPosition(
      root,
      listToMove,
      placeToMove,
      "after",
      "  ",
      true,
    );
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("1. item 2\n2. item 3\n3. item 1");
  });

  test("should keep cursor with moved list if cursor was inside the moved list", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n- item 3\n",
        cursor: { line: 2, ch: 5 }, // cursor inside item 3
      }),
      settings: makeSettings(),
    });

    const listToMove = root.getListUnderLine(2)!; // item 3
    const placeToMove = root.getListUnderLine(0)!; // item 1

    const op = new MoveListToDifferentPosition(
      root,
      listToMove,
      placeToMove,
      "before",
      "  ",
      true,
    );
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.getCursor().line).toBe(0); // cursor now at first line (moved with item 3)
    expect(root.getCursor().ch).toBe(5); // ch position maintained
  });
});
