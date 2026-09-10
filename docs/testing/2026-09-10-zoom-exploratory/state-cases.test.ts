/**
 * Exploratory evidence, intentionally outside normal Jest discovery.
 * Run from the repository root:
 * SKIP_OBSIDIAN=1 n exec 22.23.1 npx jest --testRegex 'state-cases.test.ts$' --runTestsByPath docs/testing/2026-09-10-zoom-exploratory/state-cases.test.ts --runInBand
 * Observed on 2026-09-10: 10 passed, 3 failed (exit 1).
 * Failures: subtree replacement, whole-document replacement, mixed indentation.
 * The failing expectations describe the desired behavior; no fixes are included.
 */
import { EditorSelection, EditorState } from "@codemirror/state";

import { makeLogger, makeSettings } from "../../../src/__mocks__";
import { ListZoomState, setListZoom } from "../../../src/features/ListZoom";
import { Parser } from "../../../src/services/Parser";

jest.mock(
  "obsidian",
  () => ({
    editorInfoField: jest
      .requireActual<typeof import("@codemirror/state")>("@codemirror/state")
      .StateField.define({
        create: () => null,
        update: (value: unknown) => value,
      }),
  }),
  { virtual: true },
);

const document = "- work\n\t- project\n\t\t- task\n\t- other\n- personal";

function focus(text = document, target = "\t- project") {
  const zoom = new ListZoomState(new Parser(makeLogger(), makeSettings()));
  const from = text.indexOf(target);
  const state = EditorState.create({
    doc: text,
    extensions: zoom.extension,
  }).update({
    effects: setListZoom.of(from),
    selection: { anchor: from + target.length },
  }).state;
  expect(zoom.range(state)).not.toBeNull();
  return { zoom, state };
}

function visible(zoom: ListZoomState, state: EditorState) {
  const range = zoom.range(state);
  return range ? state.doc.sliceString(range.from, range.to) : null;
}

test.each(["undo", "redo", "set"])(
  "intended: %s affecting hidden text reveals the document",
  (userEvent) => {
    const { zoom, state } = focus();
    const next = state.update({
      changes: { from: 2, to: 6, insert: "office" },
      userEvent,
      filter: false,
    }).state;
    expect(zoom.range(next)).toBeNull();
  },
);

test("programmatic simultaneous prefix and suffix edits preserve zoom and cursor", () => {
  const { zoom, state } = focus();
  const prefix = "---\nmodified: now\n---\n";
  const next = state.update({
    changes: [
      { from: 0, insert: prefix },
      { from: document.length, insert: "\n" },
    ],
    filter: false,
  }).state;
  expect(visible(zoom, next)).toBe("\t- project\n\t\t- task");
  expect(next.selection.main.head).toBe(
    state.selection.main.head + prefix.length,
  );
});

test("an inserted sibling before the focused root does not steal focus", () => {
  const { zoom, state } = focus();
  const next = state.update({
    changes: { from: 7, insert: "\t- preceding\n" },
    filter: false,
  }).state;
  expect(visible(zoom, next)).toBe("\t- project\n\t\t- task");
});

test("a child inserted at the visible end remains visible", () => {
  const { zoom, state } = focus();
  const next = state.update({
    changes: { from: 26, insert: "\n\t\t- another" },
  }).state;
  expect(visible(zoom, next)).toBe("\t- project\n\t\t- task\n\t\t- another");
});

test("a sibling inserted at the visible end stays outside the zoom", () => {
  const { zoom, state } = focus();
  const next = state.update({
    changes: { from: 26, insert: "\n\t- another" },
  }).state;
  expect(visible(zoom, next)).toBe("\t- project\n\t\t- task");
});

test("multiline continuation editing keeps the focused range", () => {
  const text =
    "- work\n\t- project\n\t  first paragraph\n\t  \n\t  second paragraph\n\t- other";
  const { zoom, state } = focus(text);
  const next = state.update({
    changes: { from: text.indexOf("second"), insert: "updated " },
  }).state;
  expect(visible(zoom, next)).toBe(
    "\t- project\n\t  first paragraph\n\t  \n\t  updated second paragraph",
  );
});

test("selection spanning hidden text is clamped to the focused root", () => {
  const { zoom, state } = focus();
  const next = state.update({
    selection: EditorSelection.single(0, document.length),
  }).state;
  expect(next.selection.main.from).toBe(8);
  expect(next.selection.main.to).toBe(zoom.range(next)!.to);
});

test("whole-subtree replacement preserving its root should keep zoom", () => {
  const { zoom, state } = focus();
  const next = state.update({
    changes: { from: 8, to: 26, insert: "- project\n\t\t- updated task" },
  }).state;
  expect(next.doc.toString()).toBe(document.replace("task", "updated task"));
  expect(visible(zoom, next)).toBe("\t- project\n\t\t- updated task");
});

test("unannotated whole-document replacement preserving its root should keep zoom", () => {
  const { zoom, state } = focus();
  const updated = document.replace("task", "updated task");
  const next = state.update({
    changes: { from: 0, to: document.length, insert: updated },
    filter: false,
  }).state;
  expect(next.doc.toString()).toBe(updated);
  expect(visible(zoom, next)).toBe("\t- project\n\t\t- updated task");
});

test("zoom removes the common visual indent from a child using equivalent spaces", () => {
  const text = "- work\n\t- project\n        - task\n\t- other";
  const { zoom, state } = focus(text);
  const range = zoom.range(state)!;
  expect(visible(zoom, state)).toBe("\t- project\n        - task");
  const hiddenIndents: [number, number][] = [];
  range.indents.between(0, state.doc.length, (from, to) => {
    hiddenIndents.push([from, to]);
  });
  // The parent starts at visual column 4 and the child at column 8.
  // Zoom must remove four columns from both, despite different raw prefixes.
  expect(hiddenIndents).toEqual([
    [7, 8],
    [18, 22],
  ]);
});

test("a multiline root with indented continuation keeps all paragraphs visible", () => {
  const text =
    "- work\n\t- project\n\t  first paragraph\n\t  \n\t  second paragraph\n\t- other";
  const { zoom, state } = focus(text);
  const visibleText =
    "\t- project\n\t  first paragraph\n\t  \n\t  second paragraph";
  expect(visible(zoom, state)).toBe(visibleText);
  const end = zoom.range(state)!.to;
  const next = state.update({ changes: { from: end, insert: "!" } }).state;
  expect(visible(zoom, next)).toBe(visibleText + "!");
});
