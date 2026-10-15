import { editorEditorField, editorInfoField } from "obsidian";

import {
  foldEffect,
  foldable,
  foldedRanges,
  unfoldEffect,
} from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { MyEditor, getEditorFromState, getFoldedLinesFromState } from "..";

jest.mock(
  "obsidian",
  () => ({
    Editor: class {},
    editorInfoField: jest
      .requireActual<typeof import("@codemirror/state")>("@codemirror/state")
      .StateField.define({
        create: () => null,
        update: (value: unknown) => value,
      }),
    editorEditorField: jest
      .requireActual<typeof import("@codemirror/state")>("@codemirror/state")
      .StateField.define({
        create: () => null,
        update: (value: unknown) => value,
      }),
  }),
  { virtual: true },
);

jest.mock("@codemirror/language", () => ({
  foldEffect: { of: jest.fn() },
  foldable: jest.fn(),
  foldedRanges: jest.fn(() => ({
    iter: (): { value: null; from: number; next: jest.Mock } => ({
      value: null,
      from: 0,
      next: jest.fn(),
    }),
  })),
  unfoldEffect: { of: jest.fn() },
}));

describe("getEditorFromState", () => {
  function makeState(includeView = true) {
    const view = { state: EditorState.create() };
    const editor = {
      cm: view,
      getLine: () => "- Main document",
    };
    const state = EditorState.create({
      doc: "- Main document",
      extensions: [
        editorInfoField.init(() => ({ editor }) as never),
        includeView ? editorEditorField.init(() => view as EditorView) : [],
      ],
    });
    view.state = state;
    return { state, view, editor };
  }

  test("returns null when editor info field is not initialized yet", () => {
    const state = {
      field: jest.fn().mockReturnValue(undefined),
    };

    expect(getEditorFromState(state as never)).toBeNull();
  });

  test("does not use a parent document editor for an embedded editor state", () => {
    const { state, editor } = makeState();
    const cellView = {} as EditorView;
    const cellState = EditorState.create({
      doc: "cell",
      extensions: [
        editorInfoField.init(() => ({ editor }) as never),
        editorEditorField.init(() => cellView),
      ],
    });

    expect(getEditorFromState(state)?.getLine(0)).toBe("- Main document");
    expect(getEditorFromState(cellState)).toBeNull();
  });

  test("keeps the adapter for a new state owned by the same editor view", () => {
    const { state, view } = makeState();
    const nextState = state.update({ selection: { anchor: 2 } }).state;

    expect(nextState).not.toBe(view.state);
    expect(getEditorFromState(nextState)?.getLine(0)).toBe("- Main document");
    expect(getEditorFromState(nextState)?.getCodeMirrorView()).toBe(view);
  });

  test("keeps the adapter when the state has no editor view field", () => {
    const { state } = makeState(false);

    expect(getEditorFromState(state)?.getLine(0)).toBe("- Main document");
  });
});

describe("getFoldedLinesFromState", () => {
  test("returns an empty array when editor info field is not initialized yet", () => {
    const state = {
      field: jest.fn().mockReturnValue(undefined),
    };

    expect(getFoldedLinesFromState(state as never)).toEqual([]);
  });
});

describe("MyEditor.foldEnsuringCursorVisible", () => {
  const mockedFoldable = jest.mocked(foldable);
  // eslint-disable-next-line @typescript-eslint/unbound-method -- CodeMirror's mocked effect factory is intentionally stored for test setup.
  const mockedFoldEffectOf = jest.mocked(foldEffect.of);

  function makeFoldingEditor(selectionHead: number) {
    const line = { from: 0, to: 8 };
    const view = {
      state: {
        doc: {
          line: jest.fn().mockReturnValue(line),
        },
        selection: {
          main: { head: selectionHead },
        },
      },
      lineBlockAt: jest.fn().mockReturnValue(line),
      dispatch: jest.fn(),
    };
    const editor = new MyEditor({ cm: view } as never);

    return { editor, view };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFoldable.mockReturnValue({ from: 8, to: 20 });
    mockedFoldEffectOf.mockReturnValue("fold-effect" as never);
  });

  test("moves an inside selection and folds in one transaction", () => {
    const { editor, view } = makeFoldingEditor(12);

    editor.foldEnsuringCursorVisible(0, { line: 0, ch: 2 });

    expect(view.dispatch).toHaveBeenCalledWith({
      selection: { anchor: 2, head: 2 },
      effects: ["fold-effect"],
    });
    expect(view.dispatch).toHaveBeenCalledTimes(1);
  });

  test("preserves a selection outside the fold range", () => {
    const { editor, view } = makeFoldingEditor(8);

    editor.foldEnsuringCursorVisible(0, { line: 0, ch: 2 });

    expect(view.dispatch).toHaveBeenCalledWith({
      effects: ["fold-effect"],
    });
    expect(view.dispatch).toHaveBeenCalledTimes(1);
  });

  test("does nothing when the line has no foldable range", () => {
    mockedFoldable.mockReturnValue(null);
    const { editor, view } = makeFoldingEditor(12);

    editor.foldEnsuringCursorVisible(0, { line: 0, ch: 2 });

    expect(view.dispatch).not.toHaveBeenCalled();
  });
});

describe("MyEditor native fold commands", () => {
  const mockedFoldable = jest.mocked(foldable);
  const mockedFoldedRanges = jest.mocked(foldedRanges);
  // eslint-disable-next-line @typescript-eslint/unbound-method -- CodeMirror's mocked effect factory is intentionally stored for test setup.
  const mockedFoldEffectOf = jest.mocked(foldEffect.of);
  // eslint-disable-next-line @typescript-eslint/unbound-method -- CodeMirror's mocked effect factory is intentionally stored for test setup.
  const mockedUnfoldEffectOf = jest.mocked(unfoldEffect.of);

  test("keeps single-line fold and unfold free of scroll snapshots", () => {
    const line = { from: 0, to: 8 };
    const scrollSnapshot = jest.fn();
    const dispatch = jest.fn();
    const view = {
      state: { doc: { line: jest.fn().mockReturnValue(line) } },
      lineBlockAt: jest.fn().mockReturnValue(line),
      scrollSnapshot,
      dispatch,
    };
    mockedFoldable.mockReturnValue({ from: 8, to: 20 });
    mockedFoldedRanges.mockReturnValue({
      between: (
        _from: number,
        _to: number,
        callback: (from: number, to: number) => void,
      ) => callback(8, 20),
    } as never);
    mockedFoldEffectOf.mockReturnValue("fold-effect" as never);
    mockedUnfoldEffectOf.mockReturnValue("unfold-effect" as never);
    const editor = new MyEditor({ cm: view } as never);

    editor.fold(0);
    editor.unfold(0);

    expect(dispatch).toHaveBeenNthCalledWith(1, { effects: ["fold-effect"] });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      effects: ["unfold-effect"],
    });
    expect(scrollSnapshot).not.toHaveBeenCalled();
  });
});
