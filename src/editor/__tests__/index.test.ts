import {
  foldEffect,
  foldable,
  foldedRanges,
  unfoldEffect,
} from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";

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

describe("MyEditor.setFoldedPreservingScroll", () => {
  const mockedFoldable = jest.mocked(foldable);
  const mockedFoldedRanges = jest.mocked(foldedRanges);
  // eslint-disable-next-line @typescript-eslint/unbound-method -- CodeMirror's mocked effect factory is intentionally stored for test setup.
  const mockedFoldEffectOf = jest.mocked(foldEffect.of);
  // eslint-disable-next-line @typescript-eslint/unbound-method -- CodeMirror's mocked effect factory is intentionally stored for test setup.
  const mockedUnfoldEffectOf = jest.mocked(unfoldEffect.of);
  const between = jest.fn();

  function makeBatchFoldingEditor(selectionHead: number, devicePixelRatio = 1) {
    const lines = [
      { from: 0, to: 8 },
      { from: 21, to: 29 },
    ];
    const scrollSnapshot = {
      value: {
        range: EditorSelection.cursor(0),
        yMargin: -12.875,
      },
    };
    const view = {
      contentDOM: { style: { paddingBottom: "1138.5px" } },
      defaultLineHeight: 24,
      documentPadding: { top: 0, bottom: 0 },
      documentTop: 0,
      dom: {
        ownerDocument: {
          defaultView: { devicePixelRatio },
        },
      },
      scaleY: 1,
      scrollDOM: {
        clientHeight: 1163,
        scrollTop: 100,
        getBoundingClientRect: jest.fn(() => ({ top: 50 })),
      },
      state: {
        doc: {
          line: jest.fn((number: number) => lines[number - 1]),
        },
        selection: { main: { head: selectionHead } },
      },
      lineBlockAt: jest.fn((from: number) =>
        from === lines[0].from ? lines[0] : lines[1],
      ),
      lineBlockAtHeight: jest.fn(() => ({ from: 0, top: 87.125 })),
      scrollSnapshot: jest.fn().mockReturnValue(scrollSnapshot),
      dispatch: jest.fn(),
    };
    const editor = new MyEditor({ cm: view } as never);

    return { editor, scrollSnapshot, view };
  }

  function setPaddingBottom(
    view: ReturnType<typeof makeBatchFoldingEditor>["view"],
    value: string,
  ) {
    Object.defineProperty(view.contentDOM.style, "paddingBottom", {
      configurable: true,
      value,
      writable: true,
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFoldedRanges.mockReturnValue({
      iter: () => ({ value: null, from: 0, next: jest.fn() }),
      between,
    } as never);
  });

  test("folds every target with one scroll snapshot and a safe selection", () => {
    mockedFoldable
      .mockReturnValueOnce({ from: 8, to: 20 })
      .mockReturnValueOnce({ from: 29, to: 40 });
    mockedFoldEffectOf
      .mockReturnValueOnce("fold-8" as never)
      .mockReturnValueOnce("fold-29" as never);
    const { editor, scrollSnapshot, view } = makeBatchFoldingEditor(32);

    expect(
      editor.setFoldedPreservingScroll(
        [
          { line: 0, fallbackCursor: { line: 0, ch: 2 } },
          { line: 1, fallbackCursor: { line: 1, ch: 2 } },
        ],
        true,
      ),
    ).toBe(true);

    expect(view.scrollSnapshot).toHaveBeenCalledTimes(1);
    expect(view.dispatch).toHaveBeenCalledWith({
      selection: { anchor: 23, head: 23 },
      effects: [scrollSnapshot, "fold-8", "fold-29"],
    });
    expect(scrollSnapshot.value.yMargin).toBe(-13);
    expect(view.dispatch).toHaveBeenCalledTimes(1);
  });

  test("keeps an outside selection while folding every target", () => {
    mockedFoldable
      .mockReturnValueOnce({ from: 8, to: 20 })
      .mockReturnValueOnce({ from: 29, to: 40 });
    mockedFoldEffectOf
      .mockReturnValueOnce("fold-8" as never)
      .mockReturnValueOnce("fold-29" as never);
    const { editor, scrollSnapshot, view } = makeBatchFoldingEditor(5);

    editor.setFoldedPreservingScroll(
      [
        { line: 0, fallbackCursor: { line: 0, ch: 2 } },
        { line: 1, fallbackCursor: { line: 1, ch: 2 } },
      ],
      true,
    );

    expect(view.dispatch).toHaveBeenCalledWith({
      effects: [scrollSnapshot, "fold-8", "fold-29"],
    });
  });

  test("unfolds every target with one scroll snapshot", () => {
    between.mockImplementation(
      (
        from: number,
        _to: number,
        callback: (from: number, to: number) => void,
      ) => {
        if (from === 0) callback(8, 20);
        if (from === 21) callback(29, 40);
      },
    );
    mockedUnfoldEffectOf
      .mockReturnValueOnce("unfold-8" as never)
      .mockReturnValueOnce("unfold-29" as never);
    const { editor, scrollSnapshot, view } = makeBatchFoldingEditor(5);

    expect(
      editor.setFoldedPreservingScroll(
        [
          { line: 0, fallbackCursor: { line: 0, ch: 2 } },
          { line: 1, fallbackCursor: { line: 1, ch: 2 } },
        ],
        false,
      ),
    ).toBe(true);

    expect(view.scrollSnapshot).toHaveBeenCalledTimes(1);
    expect(view.dispatch).toHaveBeenCalledWith({
      effects: [scrollSnapshot, "unfold-8", "unfold-29"],
    });
    expect(view.dispatch).toHaveBeenCalledTimes(1);
  });

  test("does not snapshot or dispatch when no target has a range", () => {
    mockedFoldable.mockReturnValue(null);
    const { editor, view } = makeBatchFoldingEditor(5);
    setPaddingBottom(view, "100px");

    expect(
      editor.setFoldedPreservingScroll(
        [{ line: 0, fallbackCursor: { line: 0, ch: 2 } }],
        true,
      ),
    ).toBe(false);

    expect(view.scrollSnapshot).not.toHaveBeenCalled();
    expect(view.dispatch).not.toHaveBeenCalled();
    expect(view.contentDOM.style.paddingBottom).toBe("100px");
  });

  test("anchors the snapshot to the visible document below properties", () => {
    mockedFoldable.mockReturnValue({ from: 8, to: 20 });
    mockedFoldEffectOf.mockReturnValue("fold-8" as never);
    const { editor, scrollSnapshot, view } = makeBatchFoldingEditor(5);
    view.documentTop = -537.5625;
    view.scrollDOM.scrollTop = 1400;
    view.scrollDOM.getBoundingClientRect.mockReturnValue({ top: 78.75 });
    view.lineBlockAtHeight.mockReturnValue({ from: 848, top: 614.34375 });
    scrollSnapshot.value.range = EditorSelection.cursor(1570);
    scrollSnapshot.value.yMargin = -17.34375;

    editor.setFoldedPreservingScroll(
      [{ line: 0, fallbackCursor: { line: 0, ch: 2 } }],
      true,
    );

    expect(view.lineBlockAtHeight).toHaveBeenCalledWith(624.3125);
    expect(scrollSnapshot.value.range.from).toBe(848);
    expect(scrollSnapshot.value.range.to).toBe(848);
    expect(scrollSnapshot.value.yMargin).toBe(-786);
  });

  test("keeps line-block lookup in screen coordinates when the editor is scaled", () => {
    mockedFoldable.mockReturnValue({ from: 8, to: 20 });
    mockedFoldEffectOf.mockReturnValue("fold-8" as never);
    const { editor, view } = makeBatchFoldingEditor(5);
    view.documentTop = -537.5625;
    view.scaleY = 2;
    view.scrollDOM.scrollTop = 1400;
    view.scrollDOM.getBoundingClientRect.mockReturnValue({ top: 78.75 });

    editor.setFoldedPreservingScroll(
      [{ line: 0, fallbackCursor: { line: 0, ch: 2 } }],
      true,
    );

    expect(view.lineBlockAtHeight).toHaveBeenCalledWith(624.3125);
  });

  test("falls back to the native snapshot when viewport geometry is invalid", () => {
    mockedFoldable.mockReturnValue({ from: 8, to: 20 });
    mockedFoldEffectOf.mockReturnValue("fold-8" as never);
    const { editor, scrollSnapshot, view } = makeBatchFoldingEditor(5);
    view.scaleY = 0;
    scrollSnapshot.value.range = EditorSelection.cursor(1570);
    scrollSnapshot.value.yMargin = -17.34375;

    editor.setFoldedPreservingScroll(
      [{ line: 0, fallbackCursor: { line: 0, ch: 2 } }],
      true,
    );

    expect(view.lineBlockAtHeight).not.toHaveBeenCalled();
    expect(scrollSnapshot.value.range.from).toBe(1570);
    expect(scrollSnapshot.value.yMargin).toBe(-17);
  });

  test("restores the standard scroll reserve before folding", () => {
    mockedFoldable.mockReturnValue({ from: 8, to: 20 });
    mockedFoldEffectOf.mockReturnValue("fold-8" as never);
    const { editor, view } = makeBatchFoldingEditor(5);
    setPaddingBottom(view, "100px");

    editor.setFoldedPreservingScroll(
      [{ line: 0, fallbackCursor: { line: 0, ch: 2 } }],
      true,
    );

    expect(view.contentDOM.style.paddingBottom).toBe("1138.5px");
    expect(view.dispatch).toHaveBeenCalledTimes(1);
  });

  test("keeps a scroll reserve that already exceeds the standard value", () => {
    mockedFoldable.mockReturnValue({ from: 8, to: 20 });
    mockedFoldEffectOf.mockReturnValue("fold-8" as never);
    const { editor, view } = makeBatchFoldingEditor(5);
    setPaddingBottom(view, "1200px");

    editor.setFoldedPreservingScroll(
      [{ line: 0, fallbackCursor: { line: 0, ch: 2 } }],
      true,
    );

    expect(view.contentDOM.style.paddingBottom).toBe("1200px");
  });

  test("snaps the scroll margin to the physical-pixel grid", () => {
    mockedFoldable.mockReturnValue({ from: 8, to: 20 });
    mockedFoldEffectOf.mockReturnValue("fold-8" as never);
    const { editor, scrollSnapshot, view } = makeBatchFoldingEditor(5, 2);
    view.scaleY = 0;
    scrollSnapshot.value.yMargin = -12.74;

    editor.setFoldedPreservingScroll(
      [{ line: 0, fallbackCursor: { line: 0, ch: 2 } }],
      true,
    );

    expect(scrollSnapshot.value.yMargin).toBe(-12.5);
  });

  test("keeps single-line fold and unfold free of scroll snapshots", () => {
    mockedFoldable.mockReturnValue({ from: 8, to: 20 });
    between.mockImplementation(
      (
        _from: number,
        _to: number,
        callback: (from: number, to: number) => void,
      ) => callback(8, 20),
    );
    const { editor, view } = makeBatchFoldingEditor(5);

    editor.fold(0);
    editor.unfold(0);

    expect(view.scrollSnapshot).not.toHaveBeenCalled();
  });
});
