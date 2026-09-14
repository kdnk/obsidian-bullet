import { EditorState } from "@codemirror/state";

import { NodeType, Tree } from "@lezer/common";

import { taskBulletDecorations } from "../TaskBullets";

jest.mock("obsidian", () => ({ editorLivePreviewField: {} }), {
  virtual: true,
});

const documentType = NodeType.define({ id: 0, name: "Document", top: true });
const taskType = NodeType.define({
  id: 1,
  name: "HyperMD-list-line_HyperMD-task-line",
});
const codeType = NodeType.define({ id: 2, name: "HyperMD-codeblock" });

function decorate(
  textOrState: string | EditorState,
  taskLines: number[],
  live = true,
  ranges?: readonly { from: number; to: number }[],
) {
  const state =
    typeof textOrState === "string"
      ? EditorState.create({ doc: textOrState })
      : textOrState;
  const text = state.doc.toString();
  const tree = new Tree(
    documentType,
    Array.from({ length: state.doc.lines }, (_, i) => {
      const line = state.doc.line(i + 1);
      return new Tree(
        taskLines.includes(i + 1) ? taskType : codeType,
        [],
        [],
        line.length,
      );
    }),
    Array.from(
      { length: state.doc.lines },
      (_, i) => state.doc.line(i + 1).from,
    ),
    text.length,
  );
  const decorations = taskBulletDecorations(
    state,
    tree,
    ranges ?? [{ from: 0, to: text.length }],
    live,
  );
  const positions: number[] = [];
  decorations.between(0, text.length, (from) => {
    positions.push(from);
  });
  return positions;
}

test("adds a marker before unchecked, checked and custom-state task checkboxes", () => {
  expect(
    decorate(
      "- [ ] todo\n\t- [x] done\n  * [-] waiting\n+ [?] question",
      [1, 2, 3, 4],
    ),
  ).toEqual([2, 14, 27, 41]);
});

test("leaves normal lists and task-looking literal code untouched", () => {
  expect(decorate("- ordinary\n- [ ] literal\n- [ ] task", [3])).toEqual([27]);
});

test("source mode retains the original Markdown markers", () => {
  expect(decorate("- [ ] task", [1], false)).toEqual([]);
});

test("a task status edit keeps its bullet at the same source boundary", () => {
  const state = EditorState.create({ doc: "- ordinary\n\t- [ ] task" });
  const boundary = state.doc.line(2).from + 3;
  const transaction = state.update({
    changes: { from: boundary + 1, to: boundary + 2, insert: "x" },
  });

  expect(decorate(state, [2])).toEqual([boundary]);
  expect(decorate(transaction.state, [2])).toEqual([
    transaction.changes.mapPos(boundary),
  ]);
  expect(transaction.state.doc.sliceString(boundary, boundary + 3)).toBe("[x]");
});

test("clips widgets to visible source boundaries and deduplicates overlapping ranges", () => {
  const text = "- [ ] first\n- [x] second\n- [ ] third";
  const state = EditorState.create({ doc: text });
  const first = state.doc.line(1).from + 2;
  const second = state.doc.line(2).from + 2;
  const third = state.doc.line(3).from + 2;

  expect(
    decorate(state, [1, 2, 3], true, [
      { from: first + 1, to: third - 1 },
      { from: second, to: third - 1 },
    ]),
  ).toEqual([second]);
  expect(
    decorate(state, [1, 2, 3], true, [
      { from: second, to: third },
      { from: 0, to: second },
    ]),
  ).toEqual([first, second, third]);
});

test("ordered tasks retain their native marker without a synthetic bullet", () => {
  expect(
    decorate("1. [ ] first\n\t2. [x] second\n10. [?] custom", [1, 2, 3]),
  ).toEqual([]);
});

test("adds a bullet when a task checkbox ends the physical line", () => {
  expect(decorate("- [ ]\n\t* [x]\n  + [?]", [1, 2, 3])).toEqual([2, 9, 17]);
});
