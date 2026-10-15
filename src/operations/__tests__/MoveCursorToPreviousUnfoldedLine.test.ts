import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import { MoveCursorToPreviousUnfoldedLine } from "../MoveCursorToPreviousUnfoldedLine";
import { NO_OP_OUTCOME, UPDATED_OUTCOME } from "../Operation";

test("should move cursor to end of previous note line in the same list", () => {
  const editor = makeEditor({
    text: "- item 1\n  note for item 1\n  more notes\n- item 2\n",
    cursor: { line: 2, ch: 2 },
  });

  const root = makeRoot({
    editor,
    settings: makeSettings(),
  });

  const op = new MoveCursorToPreviousUnfoldedLine(root, editor);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);
  expect(root.getCursor().line).toBe(1);
  expect(root.getCursor().ch).toBe(17);
});

test("should move cursor to end of previous list item", () => {
  const editor = makeEditor({
    text: "- item 1\n- item 2\n- item 3\n",
    cursor: { line: 1, ch: 2 },
  });

  const root = makeRoot({
    editor,
    settings: makeSettings(),
  });

  // Make sure cursor is at content start + checkbox length
  root.getListUnderCursor().getCheckboxLength = () => 0;

  const op = new MoveCursorToPreviousUnfoldedLine(root, editor);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);
  expect(root.getCursor().line).toBe(0);
  expect(root.getCursor().ch).toBe(8);
});

test("should move cursor to end of first line in previous folded list", () => {
  const editor = makeEditor({
    text: "- item 1\n  - item 1.1\n  - item 1.2\n- item 2\n",
    cursor: { line: 3, ch: 2 },
    getAllFoldedLines: () => [0],
  });

  const root = makeRoot({
    editor,
    settings: makeSettings(),
  });

  // Setup previous list as folded
  const prevList = root.getListUnderLine(0);
  prevList!.isFolded = () => true;

  const foldRoot = prevList;
  foldRoot!.getLinesInfo = () => [
    {
      text: "- item 1",
      from: { line: 0, ch: 0 },
      to: { line: 0, ch: 8 },
    },
  ];

  prevList!.getTopFoldRoot = () => foldRoot;

  // Setup current list for correct cursor check
  root.getListUnderCursor().getCheckboxLength = () => 0;

  const op = new MoveCursorToPreviousUnfoldedLine(root, editor);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);
  expect(root.getCursor().line).toBe(0);
  expect(root.getCursor().ch).toBe(8);
});

test("should do nothing when cursor is not at the beginning of content", () => {
  const editor = makeEditor({
    text: "- item 1\n- item 2\n- item 3\n",
    cursor: { line: 1, ch: 5 },
  });

  const root = makeRoot({
    editor,
    settings: makeSettings(),
  });

  const op = new MoveCursorToPreviousUnfoldedLine(root, editor);
  expect(op.perform()).toEqual(NO_OP_OUTCOME);
  expect(root.getCursor().line).toBe(1);
  expect(root.getCursor().ch).toBe(5);
});

test("should do nothing when there is no previous line", () => {
  const editor = makeEditor({
    text: "- item 1\n- item 2\n- item 3\n",
    cursor: { line: 0, ch: 2 },
  });

  const root = makeRoot({
    editor,
    settings: makeSettings(),
  });

  root.getListUnderCursor().getCheckboxLength = () => 0;

  const op = new MoveCursorToPreviousUnfoldedLine(root, editor);
  expect(op.perform()).toEqual(NO_OP_OUTCOME);
  expect(root.getCursor().line).toBe(0);
  expect(root.getCursor().ch).toBe(2);
});

test("should move cursor to the end of a previous non-list line", () => {
  const editor = makeEditor({
    text: "intro paragraph\n- item 1\n- item 2\n",
    cursor: { line: 1, ch: 2 },
  });

  const root = makeRoot({
    editor,
    settings: makeSettings(),
  });

  root.getListUnderCursor().getCheckboxLength = () => 0;

  const op = new MoveCursorToPreviousUnfoldedLine(root, editor);
  expect(op.perform()).toEqual(UPDATED_OUTCOME);
  expect(root.getCursor().line).toBe(0);
  expect(root.getCursor().ch).toBe("intro paragraph".length);
});

test("should do nothing when there are multiple selections", () => {
  const editor = makeEditor({
    text: "- item 1\n- item 2\n- item 3\n",
    cursor: { line: 1, ch: 2 },
  });

  // Mock multiple selections
  editor.listSelections = () => [
    { anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 3 } },
    { anchor: { line: 1, ch: 2 }, head: { line: 1, ch: 2 } },
  ];

  const root = makeRoot({
    editor,
    settings: makeSettings(),
  });

  root.getListUnderCursor().getCheckboxLength = () => 0;

  const op = new MoveCursorToPreviousUnfoldedLine(root, editor);
  expect(op.perform()).toEqual(NO_OP_OUTCOME);
});

test.each([
  {
    text: "- [ ] task\n  notes",
    ch: 2,
    expected: { line: 0, ch: 10 },
    outcome: UPDATED_OUTCOME,
  },
  {
    text: "- [x] task\n  notes",
    ch: 2,
    expected: { line: 0, ch: 10 },
    outcome: UPDATED_OUTCOME,
  },
  {
    text: "12. [x] task\n    notes",
    ch: 4,
    expected: { line: 0, ch: 12 },
    outcome: UPDATED_OUTCOME,
  },
  {
    text: "- [ ] task\n  notes",
    ch: 6,
    expected: { line: 1, ch: 6 },
    outcome: NO_OP_OUTCOME,
  },
  {
    text: "12. [x] task\n    notes",
    ch: 8,
    expected: { line: 1, ch: 8 },
    outcome: NO_OP_OUTCOME,
  },
  {
    text: "- [ ] task\n  notes\n  more",
    ch: 2,
    line: 2,
    expected: { line: 1, ch: 7 },
    outcome: UPDATED_OUTCOME,
  },
])(
  "uses the continuation's actual text boundary in $text at $ch",
  ({ text, ch, line = 1, expected, outcome }) => {
    const editor = makeEditor({ text, cursor: { line, ch } });
    const root = makeRoot({ editor });
    expect(
      new MoveCursorToPreviousUnfoldedLine(root, editor).perform(),
    ).toEqual(outcome);
    expect(root.getCursor()).toEqual(expected);
    expect(root.print()).toBe(text);
  },
);

test.each([
  { protection: "bullet-and-checkbox", ch: 6 },
  { protection: "bullet-only", ch: 2 },
  { protection: "never", ch: 2 },
] as const)(
  "retains first-row boundary behavior with $protection",
  ({ protection, ch }) => {
    const text = "- previous\n- [x] task";
    const editor = makeEditor({ text, cursor: { line: 1, ch } });
    const settings = makeSettings();
    settings.keepCursorWithinContent = protection;
    const root = makeRoot({ editor, settings });
    expect(
      new MoveCursorToPreviousUnfoldedLine(root, editor).perform(),
    ).toEqual(UPDATED_OUTCOME);
    expect(root.getCursor()).toEqual({ line: 0, ch: 10 });
    expect(root.print()).toBe(text);
  },
);

test("leaves a noncollapsed continuation selection unchanged", () => {
  const text = "- [x] task\n  notes";
  const editor = makeEditor({ text, cursor: { line: 1, ch: 2 } });
  editor.listSelections = () => [
    { anchor: { line: 1, ch: 5 }, head: { line: 1, ch: 2 } },
  ];
  const root = makeRoot({ editor });
  expect(new MoveCursorToPreviousUnfoldedLine(root, editor).perform()).toEqual(
    NO_OP_OUTCOME,
  );
  expect(root.print()).toBe(text);
  expect(root.getSelections()).toEqual([
    { anchor: { line: 1, ch: 5 }, head: { line: 1, ch: 2 } },
  ]);
});
