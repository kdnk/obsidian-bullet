import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import { CreateNewRootItemAfterEmpty } from "../CreateNewRootItemAfterEmpty";
import { NO_OP_OUTCOME, UPDATED_OUTCOME } from "../Operation";

describe("CreateNewRootItemAfterEmpty operation", () => {
  test("keeps an empty root item and creates a sibling below its subtree", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- \n  - child\n- after",
        cursor: { line: 0, ch: 2 },
      }),
    });

    const outcome = new CreateNewRootItemAfterEmpty(root, true).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- \n  - child\n- \n- after");
    expect(root.getCursor()).toEqual({ line: 2, ch: 2 });
  });

  test("preserves an alternative unordered marker and marker spacing", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "*\t\n- after",
        cursor: { line: 0, ch: 2 },
      }),
    });

    const outcome = new CreateNewRootItemAfterEmpty(root, true).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("*\t\n*\t\n- after");
    expect(root.getCursor()).toEqual({ line: 1, ch: 2 });
  });

  test("recalculates ordered markers after creating the sibling", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "1. \n2. after",
        cursor: { line: 0, ch: 3 },
      }),
    });

    const outcome = new CreateNewRootItemAfterEmpty(root, true).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("1. \n2. \n3. after");
    expect(root.getCursor()).toEqual({ line: 1, ch: 3 });
  });

  test("inherits an empty checkbox and moves the cursor after it", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- [ ] \n- after",
        cursor: { line: 0, ch: 6 },
      }),
    });

    const outcome = new CreateNewRootItemAfterEmpty(root, true).perform();

    expect(outcome).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe("- [ ] \n- [ ] \n- after");
    expect(root.getCursor()).toEqual({ line: 1, ch: 6 });
  });

  test("does nothing for a non-empty item", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item\n- after",
        cursor: { line: 0, ch: 6 },
      }),
    });

    const outcome = new CreateNewRootItemAfterEmpty(root, true).perform();

    expect(outcome).toEqual(NO_OP_OUTCOME);
    expect(root.print()).toBe("- item\n- after");
  });

  test("does nothing for a nested empty item", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n  - \n- after",
        cursor: { line: 1, ch: 4 },
      }),
    });

    const outcome = new CreateNewRootItemAfterEmpty(root, true).perform();

    expect(outcome).toEqual(NO_OP_OUTCOME);
    expect(root.print()).toBe("- parent\n  - \n- after");
  });

  test("does nothing for an item with multiple content lines", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- \n  note\n- after",
        cursor: { line: 0, ch: 2 },
      }),
    });

    const outcome = new CreateNewRootItemAfterEmpty(root, true).perform();

    expect(outcome).toEqual(NO_OP_OUTCOME);
    expect(root.print()).toBe("- \n  note\n- after");
  });

  test("does nothing for a multiline selection", () => {
    const editor = makeEditor({
      text: "- \n- after",
      cursor: { line: 1, ch: 2 },
    });
    editor.listSelections = () => [
      {
        anchor: { line: 0, ch: 2 },
        head: { line: 1, ch: 2 },
      },
    ];
    const root = makeRoot({ editor, settings: makeSettings() });

    const outcome = new CreateNewRootItemAfterEmpty(root, true).perform();

    expect(outcome).toEqual(NO_OP_OUTCOME);
    expect(root.print()).toBe("- \n- after");
  });

  test("does nothing for multiple selections", () => {
    const editor = makeEditor({
      text: "- \n- after",
      cursor: { line: 0, ch: 2 },
    });
    editor.listSelections = () => [
      {
        anchor: { line: 0, ch: 2 },
        head: { line: 0, ch: 2 },
      },
      {
        anchor: { line: 1, ch: 2 },
        head: { line: 1, ch: 2 },
      },
    ];
    const root = makeRoot({ editor, settings: makeSettings() });

    const outcome = new CreateNewRootItemAfterEmpty(root, true).perform();

    expect(outcome).toEqual(NO_OP_OUTCOME);
    expect(root.print()).toBe("- \n- after");
  });
});
