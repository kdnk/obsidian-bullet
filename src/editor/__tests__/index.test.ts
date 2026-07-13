import { foldEffect, foldable } from "@codemirror/language";

import { MyEditor, getEditorFromState, getFoldedLinesFromState } from "..";

jest.mock(
  "obsidian",
  () => ({
    Editor: class {},
    editorInfoField: {},
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
  test("returns null when editor info field is not initialized yet", () => {
    const state = {
      field: jest.fn().mockReturnValue(undefined),
    };

    expect(getEditorFromState(state as never)).toBeNull();
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
