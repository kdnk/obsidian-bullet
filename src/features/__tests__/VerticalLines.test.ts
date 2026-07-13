import { makeEditor, makeRoot } from "../../__mocks__";
import {
  VerticalLines,
  resolveVerticalGuideTarget,
  toggleVerticalGuideTarget,
} from "../VerticalLines";

const mockGetEditorFromState = jest.fn<unknown, unknown[]>();

jest.mock(
  "../../editor",
  () => ({
    getEditorFromState: (...args: unknown[]) => {
      return mockGetEditorFromState(...args);
    },
  }),
  { virtual: true },
);

function makeClassList() {
  const values = new Set<string>();

  return {
    add: jest.fn((value: string) => {
      values.add(value);
    }),
    remove: jest.fn((value: string) => {
      values.delete(value);
    }),
    contains: (value: string) => values.has(value),
  };
}

function makeDocument() {
  return {
    body: {
      classList: makeClassList(),
    },
  };
}

function makePlugin() {
  const eventHandlers = new Map<string, (...args: never[]) => void>();
  const workspace = {
    on: jest.fn((eventName: string, handler: (...args: never[]) => void) => {
      eventHandlers.set(eventName, handler);
      return { eventName };
    }),
  };

  return {
    eventHandlers,
    plugin: {
      app: { workspace },
      registerEditorExtension: jest.fn(),
      registerEvent: jest.fn(),
    },
    workspace,
  };
}

describe("VerticalLines", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("manages the body class for pop-out windows", async () => {
    const mainDocument = makeDocument();
    const popoutDocument = makeDocument();
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: mainDocument,
    });

    const { eventHandlers, plugin, workspace } = makePlugin();
    const settingsCallbacks: Array<() => void> = [];
    const settings = {
      verticalLines: true,
      onChange: jest.fn((callback: () => void) => {
        settingsCallbacks.push(callback);
      }),
      removeCallback: jest.fn(),
    };

    const feature = new VerticalLines(
      plugin as never,
      settings as never,
      {} as never,
    );

    await feature.load();

    expect(plugin.registerEditorExtension).toHaveBeenCalled();
    expect(workspace.on).toHaveBeenCalledWith(
      "window-open",
      expect.any(Function),
    );
    expect(workspace.on).toHaveBeenCalledWith(
      "window-close",
      expect.any(Function),
    );
    expect(
      mainDocument.body.classList.contains("bullet-plugin-vertical-lines"),
    ).toBe(true);

    eventHandlers.get("window-open")?.(
      {} as never,
      { document: popoutDocument } as never,
    );
    expect(
      popoutDocument.body.classList.contains("bullet-plugin-vertical-lines"),
    ).toBe(true);

    settings.verticalLines = false;
    const settingsCallback = settingsCallbacks[0];
    if (!settingsCallback) {
      throw new Error("Expected settings callback to be registered");
    }
    settingsCallback();

    expect(
      mainDocument.body.classList.contains("bullet-plugin-vertical-lines"),
    ).toBe(false);
    expect(
      popoutDocument.body.classList.contains("bullet-plugin-vertical-lines"),
    ).toBe(false);

    eventHandlers.get("window-close")?.(
      {} as never,
      { document: popoutDocument } as never,
    );
    await feature.unload();

    expect(
      mainDocument.body.classList.contains("bullet-plugin-vertical-lines"),
    ).toBe(false);
    expect(settings.removeCallback).toHaveBeenCalledWith(expect.any(Function));
  });
});

describe("resolveVerticalGuideTarget", () => {
  test("maps nested guides from the outermost to the nearest ancestor", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n  - child\n    - grandchild",
        cursor: { line: 2, ch: 4 },
      }),
    });
    const grandchild = root.getListUnderLine(2);
    if (!grandchild) {
      throw new Error("Expected a grandchild list");
    }
    const outerGuide = {} as Element;
    const innerGuide = {} as Element;

    expect(
      resolveVerticalGuideTarget(
        grandchild,
        [outerGuide, innerGuide],
        outerGuide,
      )?.getFirstLineContentStart().line,
    ).toBe(0);
    expect(
      resolveVerticalGuideTarget(
        grandchild,
        [outerGuide, innerGuide],
        innerGuide,
      )?.getFirstLineContentStart().line,
    ).toBe(1);
  });

  test("ignores a shared leading indentation guide", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "  - parent\n    - child",
        cursor: { line: 1, ch: 4 },
      }),
    });
    const child = root.getListUnderLine(1);
    if (!child) {
      throw new Error("Expected a child list");
    }
    const leadingGuide = {} as Element;
    const parentGuide = {} as Element;

    expect(
      resolveVerticalGuideTarget(
        child,
        [leadingGuide, parentGuide],
        leadingGuide,
      ),
    ).toBeNull();
    expect(
      resolveVerticalGuideTarget(
        child,
        [leadingGuide, parentGuide],
        parentGuide,
      )?.getFirstLineContentStart().line,
    ).toBe(0);
  });

  test("ignores an extra indentation guide on a note line", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n  - child\n    note",
        cursor: { line: 2, ch: 4 },
      }),
    });
    const child = root.getListUnderLine(2);
    if (!child) {
      throw new Error("Expected the note line to belong to child");
    }
    const noteIndentGuide = {} as Element;
    const parentGuide = {} as Element;

    expect(
      resolveVerticalGuideTarget(
        child,
        [noteIndentGuide, parentGuide],
        noteIndentGuide,
      ),
    ).toBeNull();
    expect(
      resolveVerticalGuideTarget(
        child,
        [noteIndentGuide, parentGuide],
        parentGuide,
      )?.getFirstLineContentStart().line,
    ).toBe(0);
  });

  test("ignores an element outside the line guide collection", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n  - child",
        cursor: { line: 1, ch: 2 },
      }),
    });
    const child = root.getListUnderLine(1);
    if (!child) {
      throw new Error("Expected a child list");
    }

    expect(
      resolveVerticalGuideTarget(child, [{} as Element], {} as Element),
    ).toBeNull();
  });
});

describe("toggleVerticalGuideTarget", () => {
  const text = [
    "- parent",
    "  - branch one",
    "    - leaf one",
    "  - leaf sibling",
    "  - branch two",
    "    - leaf two",
  ].join("\n");

  function makeFoldEditor() {
    return {
      fold: jest.fn(),
      unfold: jest.fn(),
    };
  }

  test("folds each non-empty direct child when any branch is unfolded", () => {
    const root = makeRoot({
      editor: makeEditor({ text, cursor: { line: 0, ch: 0 } }),
    });
    const parent = root.getListUnderLine(0);
    if (!parent) {
      throw new Error("Expected a parent list");
    }
    const editor = makeFoldEditor();

    expect(toggleVerticalGuideTarget(editor, parent)).toBe(true);
    expect(editor.fold).toHaveBeenNthCalledWith(1, 1);
    expect(editor.fold).toHaveBeenNthCalledWith(2, 4);
    expect(editor.unfold).not.toHaveBeenCalled();
  });

  test("unfolds each non-empty direct child when every branch is folded", () => {
    const root = makeRoot({
      editor: makeEditor({
        text,
        cursor: { line: 0, ch: 0 },
        getAllFoldedLines: () => [1, 4],
      }),
    });
    const parent = root.getListUnderLine(0);
    if (!parent) {
      throw new Error("Expected a parent list");
    }
    const editor = makeFoldEditor();

    expect(toggleVerticalGuideTarget(editor, parent)).toBe(true);
    expect(editor.unfold).toHaveBeenNthCalledWith(1, 1);
    expect(editor.unfold).toHaveBeenNthCalledWith(2, 4);
    expect(editor.fold).not.toHaveBeenCalled();
  });

  test("does nothing when the target has no non-empty children", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n  - leaf",
        cursor: { line: 1, ch: 2 },
      }),
    });
    const leaf = root.getListUnderLine(1);
    if (!leaf) {
      throw new Error("Expected a leaf list");
    }
    const editor = makeFoldEditor();

    expect(toggleVerticalGuideTarget(editor, leaf)).toBe(false);
    expect(editor.fold).not.toHaveBeenCalled();
    expect(editor.unfold).not.toHaveBeenCalled();
  });
});
