import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import { Position } from "../../root";
import { SelectAllContent } from "../SelectAllContent";

function performSelectAllCycle(root: ReturnType<typeof makeRoot>) {
  let cycleCursor: Position | null = null;

  return () => {
    const op = new SelectAllContent(root, cycleCursor);
    const result = op.perform();
    cycleCursor = op.getCycleCursor();
    return { op, result };
  };
}

describe("SelectAllContent operation", () => {
  test("when performed the first time, should select the whole line under cursor; when performed the second time, should select all sub-bullets of the cursor line if it is a parent-bullet", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
        cursor: { line: 1, ch: 2 },
      }),
      settings: makeSettings(),
    });

    const op = new SelectAllContent(root);

    op.perform();
    expect(root.getSelection().anchor.line).toBe(1);
    expect(root.getSelection().anchor.ch).toBe(2);
    expect(root.getSelection().head.line).toBe(1);
    expect(root.getSelection().head.ch).toBe(8);

    op.perform();
    expect(root.getSelection().anchor.line).toBe(1);
    expect(root.getSelection().anchor.ch).toBe(2);
    expect(root.getSelection().head.ch).toBe(14);
    expect(root.getSelection().head.line).toBe(3);

    op.perform();
    expect(root.getSelection().anchor.line).toBe(0);
    expect(root.getSelection().anchor.ch).toBe(0);
    expect(root.getSelection().head.line).toBe(4);
    expect(root.getSelection().head.ch).toBe(8);
  });

  test("when a whole line is selected and the selected line has no sub-bullets, should select the whole list", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
        cursor: { line: 4, ch: 2 },
      }),
      settings: makeSettings(),
    });

    const op = new SelectAllContent(root);

    op.perform();
    expect(root.getSelection().anchor.line).toBe(4);
    expect(root.getSelection().anchor.ch).toBe(2);
    expect(root.getSelection().head.line).toBe(4);
    expect(root.getSelection().head.ch).toBe(8);

    op.perform();
    expect(root.getSelection().anchor.line).toBe(0);
    expect(root.getSelection().anchor.ch).toBe(0);
    expect(root.getSelection().head.line).toBe(4);
    expect(root.getSelection().head.ch).toBe(8);
  });

  test("should not do anything if there are multiple selections", () => {
    const editor = makeEditor({
      text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
      cursor: { line: 1, ch: 2 },
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

    const op = new SelectAllContent(root);
    op.perform();

    // Should not update
    expect(op.shouldUpdate()).toBe(false);
    expect(op.shouldStopPropagation()).toBe(false);
  });

  test("should select list item content with a checkbox", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- [ ] task 1\n- [ ] task 2 with longer text\n",
        cursor: { line: 1, ch: 10 },
      }),
      settings: makeSettings(),
    });

    root.getListUnderCursor().getCheckboxLength = () => 4;

    const op = new SelectAllContent(root);
    op.perform();

    // Should select just the content after checkbox
    expect(root.getSelection().anchor.line).toBe(1);
    expect(root.getSelection().anchor.ch).toBe(6);
    expect(root.getSelection().head.line).toBe(1);
    expect(root.getSelection().head.ch).toBe(29);
  });

  test("should select note lines along with list item", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n  note for item 1\n  another note\n- item 2\n",
        cursor: { line: 0, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new SelectAllContent(root);
    op.perform();

    // Should select list item and its notes
    expect(root.getSelection().anchor.line).toBe(0);
    expect(root.getSelection().anchor.ch).toBe(2);
    expect(root.getSelection().head.line).toBe(2);
    expect(root.getSelection().head.ch).toBe(14);
  });

  test("should cycle parent item selection from content to subtree to root list and back to content", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
        cursor: { line: 1, ch: 2 },
      }),
      settings: makeSettings(),
    });
    const perform = performSelectAllCycle(root);

    perform();
    expect(root.getSelection().anchor).toEqual({ line: 1, ch: 2 });
    expect(root.getSelection().head).toEqual({ line: 1, ch: 8 });

    perform();
    expect(root.getSelection().anchor).toEqual({ line: 1, ch: 2 });
    expect(root.getSelection().head).toEqual({ line: 3, ch: 14 });

    perform();
    expect(root.getSelection().anchor).toEqual({ line: 0, ch: 0 });
    expect(root.getSelection().head).toEqual({ line: 4, ch: 8 });

    const { op, result } = perform();
    expect(result).toBe(true);
    expect(op.shouldStopPropagation()).toBe(true);
    expect(root.getSelection().anchor).toEqual({ line: 1, ch: 2 });
    expect(root.getSelection().head).toEqual({ line: 1, ch: 8 });
  });

  test("should cycle leaf item selection from content to root list and back to content", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
        cursor: { line: 4, ch: 2 },
      }),
      settings: makeSettings(),
    });
    const perform = performSelectAllCycle(root);

    perform();
    expect(root.getSelection().anchor).toEqual({ line: 4, ch: 2 });
    expect(root.getSelection().head).toEqual({ line: 4, ch: 8 });

    perform();
    expect(root.getSelection().anchor).toEqual({ line: 0, ch: 0 });
    expect(root.getSelection().head).toEqual({ line: 4, ch: 8 });

    const { op, result } = perform();
    expect(result).toBe(true);
    expect(op.shouldStopPropagation()).toBe(true);
    expect(root.getSelection().anchor).toEqual({ line: 4, ch: 2 });
    expect(root.getSelection().head).toEqual({ line: 4, ch: 8 });
  });

  test("should cycle nested item selection to its parent subtree instead of unrelated root siblings", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent 1\n  - child 1.1\n- parent 2\n  - child 2.1\n  - child 2.2\n- parent 3",
        cursor: { line: 3, ch: 13 },
      }),
      settings: makeSettings(),
    });
    const perform = performSelectAllCycle(root);

    perform();
    expect(root.getSelection().anchor).toEqual({ line: 3, ch: 4 });
    expect(root.getSelection().head).toEqual({ line: 3, ch: 13 });

    perform();
    expect(root.getSelection().anchor).toEqual({ line: 2, ch: 0 });
    expect(root.getSelection().head).toEqual({ line: 4, ch: 13 });

    const { op, result } = perform();
    expect(result).toBe(true);
    expect(op.shouldStopPropagation()).toBe(true);
    expect(root.getSelection().anchor).toEqual({ line: 3, ch: 4 });
    expect(root.getSelection().head).toEqual({ line: 3, ch: 13 });
  });

  test("should cycle root-list selection back to the current item content", () => {
    const editor = makeEditor({
      text: "- item 1\n- item 2\n",
      cursor: { line: 1, ch: 5 },
    });

    editor.listSelections = () => [
      { anchor: { line: 0, ch: 0 }, head: { line: 1, ch: 8 } },
    ];

    const root = makeRoot({
      editor,
      settings: makeSettings(),
    });

    const op = new SelectAllContent(root, { line: 1, ch: 2 });
    const result = op.perform();

    expect(result).toBe(true);
    expect(op.shouldUpdate()).toBe(true);
    expect(op.shouldStopPropagation()).toBe(true);
    expect(root.getSelection().anchor).toEqual({ line: 1, ch: 2 });
    expect(root.getSelection().head).toEqual({ line: 1, ch: 8 });
  });

  test("should cycle checkbox item back to content without selecting checkbox markup", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- [ ] task 1\n- [ ] task 2 with longer text\n",
        cursor: { line: 1, ch: 10 },
      }),
      settings: makeSettings(),
    });
    const perform = performSelectAllCycle(root);

    perform();
    expect(root.getSelection().anchor).toEqual({ line: 1, ch: 6 });
    expect(root.getSelection().head).toEqual({ line: 1, ch: 29 });

    perform();
    expect(root.getSelection().anchor).toEqual({ line: 0, ch: 0 });
    expect(root.getSelection().head).toEqual({ line: 1, ch: 29 });

    const { op } = perform();
    expect(op.shouldStopPropagation()).toBe(true);
    expect(root.getSelection().anchor).toEqual({ line: 1, ch: 6 });
    expect(root.getSelection().head).toEqual({ line: 1, ch: 29 });
  });

  test("should cycle note-line item back to its content range", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n  note for item 1\n  another note\n- item 2\n",
        cursor: { line: 0, ch: 5 },
      }),
      settings: makeSettings(),
    });
    const perform = performSelectAllCycle(root);

    perform();
    expect(root.getSelection().anchor).toEqual({ line: 0, ch: 2 });
    expect(root.getSelection().head).toEqual({ line: 2, ch: 14 });

    perform();
    expect(root.getSelection().anchor).toEqual({ line: 0, ch: 0 });
    expect(root.getSelection().head).toEqual({ line: 3, ch: 8 });

    const { op } = perform();
    expect(op.shouldStopPropagation()).toBe(true);
    expect(root.getSelection().anchor).toEqual({ line: 0, ch: 2 });
    expect(root.getSelection().head).toEqual({ line: 2, ch: 14 });
  });

  test("should properly handle empty list items", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- \n- item 2\n",
        cursor: { line: 0, ch: 2 },
      }),
      settings: makeSettings(),
    });

    const op = new SelectAllContent(root);
    op.perform();

    // Should select the empty content
    expect(root.getSelection().anchor.line).toBe(0);
    expect(root.getSelection().anchor.ch).toBe(0);
    expect(root.getSelection().head.line).toBe(1);
    expect(root.getSelection().head.ch).toBe(8);
  });

  test("should select content between the correct range when there is a partial selection", () => {
    const editor = makeEditor({
      text: "- long item text 1\n- long item text 2\n",
      cursor: { line: 0, ch: 5 },
    });

    // Mock a partial selection
    editor.listSelections = () => [
      { anchor: { line: 0, ch: 5 }, head: { line: 0, ch: 9 } },
    ];

    const root = makeRoot({
      editor,
      settings: makeSettings(),
    });

    const op = new SelectAllContent(root);
    op.perform();

    // Should extend to select the whole content
    expect(root.getSelection().anchor.line).toBe(0);
    expect(root.getSelection().anchor.ch).toBe(2);
    expect(root.getSelection().head.line).toBe(0);
    expect(root.getSelection().head.ch).toBe(18);
  });

  test("should stop propagation and update when successful", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n",
        cursor: { line: 0, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new SelectAllContent(root);
    op.perform();

    expect(op.shouldStopPropagation()).toBe(true);
    expect(op.shouldUpdate()).toBe(true);
  });
});
