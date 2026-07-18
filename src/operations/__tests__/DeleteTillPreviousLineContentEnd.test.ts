import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import { DeleteTillPreviousLineContentEnd } from "../DeleteTillPreviousLineContentEnd";
import {
  NO_OP_OUTCOME,
  STOP_ONLY_OUTCOME,
  UPDATED_OUTCOME,
} from "../Operation";

test("should merge current line with previous line when cursor is at start of line content", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
      cursor: { line: 2, ch: 6 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillPreviousLineContentEnd(root, true, false);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);

  expect(root.print()).toBe(
    "- item 1\n- item 2item 2.1\n    - item 2.2\n- item 3",
  );
  expect(root.getCursor().line).toBe(1);
  expect(root.getCursor().ch).toBe(8);
});

test("should merge with previous note line", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1\n  note for item 1\n  more notes\n- item 2\n",
      cursor: { line: 2, ch: 2 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillPreviousLineContentEnd(root, true, false);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);

  expect(root.print()).toBe("- item 1\n  note for item 1more notes\n- item 2");
  expect(root.getCursor().line).toBe(1);
  expect(root.getCursor().ch).toBe(17);
});

test("should merge empty bullets with previous bullet", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1\n- \n- item 3\n",
      cursor: { line: 1, ch: 2 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillPreviousLineContentEnd(root, true, false);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);

  expect(root.print()).toBe("- item 1\n- item 3");
  expect(root.getCursor().line).toBe(0);
  expect(root.getCursor().ch).toBe(8);
});

test("should merge child bullet with parent if child is empty", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1\n    - \n- item 3\n",
      cursor: { line: 1, ch: 6 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillPreviousLineContentEnd(root, true, false);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);

  expect(root.print()).toBe("- item 1\n- item 3");
  expect(root.getCursor().line).toBe(0);
  expect(root.getCursor().ch).toBe(8);
});

test("should not do anything if there are multiple selections", () => {
  const editor = makeEditor({
    text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
    cursor: { line: 2, ch: 6 },
  });

  // Mock multiple selections
  editor.listSelections = () => [
    { anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 3 } },
    { anchor: { line: 2, ch: 6 }, head: { line: 2, ch: 6 } },
  ];

  const root = makeRoot({
    editor,
    settings: makeSettings(),
  });

  const op = new DeleteTillPreviousLineContentEnd(root, true, false);
  expect(op.perform()).toEqual(NO_OP_OUTCOME);

  // Should not change the text
  expect(root.print()).toBe(
    "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3",
  );
});

test("should not merge the first item if it's the only one in the document", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1",
      cursor: { line: 0, ch: 2 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillPreviousLineContentEnd(root, true, false);
  expect(op.perform()).toEqual(NO_OP_OUTCOME);

  expect(root.print()).toBe("- item 1");
  expect(root.getCursor().line).toBe(0);
  expect(root.getCursor().ch).toBe(2);
});

test("should stop propagation and update editor when merging", () => {
  const root = makeRoot({
    editor: makeEditor({
      text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
      cursor: { line: 2, ch: 6 },
    }),
    settings: makeSettings(),
  });

  const op = new DeleteTillPreviousLineContentEnd(root, true, false);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);
});

describe("empty leaf item removal", () => {
  test("removes the only empty root item when enforcement is enabled", () => {
    const root = makeRoot({
      editor: makeEditor({ text: "- ", cursor: { line: 0, ch: 2 } }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("");
    expect(root.getCursor()).toEqual({ line: 0, ch: 0 });
  });

  test("removes the first empty root item and moves to the next content start", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- \n- next",
        cursor: { line: 0, ch: 2 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- next");
    expect(root.getCursor()).toEqual({ line: 0, ch: 2 });
  });

  test("removes a middle empty root item and moves to the previous content end", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- previous\n- \n- next",
        cursor: { line: 1, ch: 2 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- previous\n- next");
    expect(root.getCursor()).toEqual({ line: 0, ch: 10 });
  });

  test("removes the last empty root item and moves to the previous content end", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- previous\n- ",
        cursor: { line: 1, ch: 2 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- previous");
    expect(root.getCursor()).toEqual({ line: 0, ch: 10 });
  });

  test("removes a nested empty item and moves to the previous visible item end", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n  - \n  - sibling",
        cursor: { line: 1, ch: 4 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- parent\n  - sibling");
    expect(root.getCursor()).toEqual({ line: 0, ch: 8 });
  });

  test("removes an empty checkbox item", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- previous\n- [ ] ",
        cursor: { line: 1, ch: 6 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- previous");
    expect(root.getCursor()).toEqual({ line: 0, ch: 10 });
  });

  test("moves to a visible folded item instead of its hidden descendant", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n  - hidden child\n- ",
        cursor: { line: 2, ch: 2 },
        getAllFoldedLines: () => [0],
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- parent\n  - hidden child");
    expect(root.getCursor()).toEqual({ line: 0, ch: 8 });
  });

  test("recalculates ordered markers after removing the first item", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "1. \n2. next",
        cursor: { line: 0, ch: 3 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("1. next");
    expect(root.getCursor()).toEqual({ line: 0, ch: 3 });
  });

  test("does not remove an empty item with children", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- \n  - child",
        cursor: { line: 0, ch: 2 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(STOP_ONLY_OUTCOME);
    expect(root.print()).toBe("- \n  - child");
    expect(root.getCursor()).toEqual({ line: 0, ch: 2 });
  });

  test("does not remove an item with a continuation line", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- \n  continuation",
        cursor: { line: 0, ch: 2 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(NO_OP_OUTCOME);
    expect(root.print()).toBe("- \n  continuation");
    expect(root.getCursor()).toEqual({ line: 0, ch: 2 });
  });

  test("does not merge an empty checkbox with a continuation from its checkbox end", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- previous\n- [ ] \n  continuation",
        cursor: { line: 1, ch: 6 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(NO_OP_OUTCOME);
    expect(root.print()).toBe("- previous\n- [ ] \n  continuation");
    expect(root.getCursor()).toEqual({ line: 1, ch: 6 });
  });

  test("does not merge an empty checkbox with a child from its checkbox end", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- previous\n- [ ] \n  - child",
        cursor: { line: 1, ch: 6 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      true,
    ).perform();

    expect(outcome).toEqual(NO_OP_OUTCOME);
    expect(root.print()).toBe("- previous\n- [ ] \n  - child");
    expect(root.getCursor()).toEqual({ line: 1, ch: 6 });
  });

  test("preserves legacy behavior when enforcement is disabled", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- ",
        cursor: { line: 0, ch: 2 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      false,
    ).perform();

    expect(outcome).toEqual(NO_OP_OUTCOME);
    expect(root.print()).toBe("- ");
    expect(root.getCursor()).toEqual({ line: 0, ch: 2 });
  });

  test("preserves empty checkbox behavior when enforcement is disabled", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- previous\n- [ ] ",
        cursor: { line: 1, ch: 6 },
      }),
    });

    const outcome = new DeleteTillPreviousLineContentEnd(
      root,
      true,
      false,
    ).perform();

    expect(outcome).toEqual(NO_OP_OUTCOME);
    expect(root.print()).toBe("- previous\n- [ ] ");
    expect(root.getCursor()).toEqual({ line: 1, ch: 6 });
  });
});
