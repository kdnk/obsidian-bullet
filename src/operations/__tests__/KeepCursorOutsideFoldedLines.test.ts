import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import { KeepCursorOutsideFoldedLines } from "../KeepCursorOutsideFoldedLines";
import { NO_OP_OUTCOME, UPDATED_OUTCOME } from "../Operation";

test("should move cursor to the end of the first line if cursor is inside folded content", () => {
  const editor = makeEditor({
    text: "- item 1\n    - item 1.1\n    - item 1.2\n- item 2",
    cursor: { line: 2, ch: 5 },
    getAllFoldedLines: () => [0],
  });

  const root = makeRoot({
    editor,
    settings: makeSettings(),
  });

  // Mock fold state
  const listUnderCursor = root.getListUnderCursor();
  listUnderCursor.isFolded = () => true;

  const foldRoot = listUnderCursor;
  foldRoot.getLinesInfo = () => [
    {
      text: "- item 1",
      from: { line: 0, ch: 0 },
      to: { line: 0, ch: 7 },
    },
  ];

  listUnderCursor.getTopFoldRoot = () => foldRoot;

  const op = new KeepCursorOutsideFoldedLines(root);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);
  expect(root.getCursor().line).toBe(0);
  expect(root.getCursor().ch).toBe(7);
});

test("should not move cursor if it's not inside folded content", () => {
  const editor = makeEditor({
    text: "- item 1\n    - item 1.1\n    - item 1.2\n- item 2",
    cursor: { line: 0, ch: 5 },
    getAllFoldedLines: () => [0],
  });

  const root = makeRoot({
    editor,
    settings: makeSettings(),
  });

  // Mock fold state
  const listUnderCursor = root.getListUnderCursor();
  listUnderCursor.isFolded = () => true;

  const foldRoot = listUnderCursor;
  foldRoot.getLinesInfo = () => [
    {
      text: "- item 1",
      from: { line: 0, ch: 0 },
      to: { line: 0, ch: 7 },
    },
  ];

  listUnderCursor.getTopFoldRoot = () => foldRoot;

  const op = new KeepCursorOutsideFoldedLines(root);
  expect(op.perform()).toEqual(NO_OP_OUTCOME);
  expect(root.getCursor().line).toBe(0);
  expect(root.getCursor().ch).toBe(5);
});

test("should not do anything if list is not folded", () => {
  const editor = makeEditor({
    text: "- item 1\n    - item 1.1\n    - item 1.2\n- item 2",
    cursor: { line: 2, ch: 5 },
  });

  const root = makeRoot({
    editor,
    settings: makeSettings(),
  });

  // Mock fold state
  const listUnderCursor = root.getListUnderCursor();
  listUnderCursor.isFolded = () => false;

  const op = new KeepCursorOutsideFoldedLines(root);
  expect(op.perform()).toEqual(NO_OP_OUTCOME);
});

test("should not do anything if there are multiple cursors", () => {
  const editor = makeEditor({
    text: "- item 1\n    - item 1.1\n    - item 1.2\n- item 2",
    cursor: { line: 2, ch: 5 },
  });

  // Mock multiple cursors
  editor.listSelections = () => [
    { anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 3 } },
    { anchor: { line: 2, ch: 5 }, head: { line: 2, ch: 5 } },
  ];

  const root = makeRoot({
    editor,
    settings: makeSettings(),
  });

  const op = new KeepCursorOutsideFoldedLines(root);
  expect(op.perform()).toEqual(NO_OP_OUTCOME);
});
