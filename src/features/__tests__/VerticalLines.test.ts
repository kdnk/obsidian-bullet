import { makeEditor, makeRoot } from "../../__mocks__";
import {
  VerticalLines,
  VerticalLinesPluginValue,
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

function makeFoldEditor() {
  return {
    foldEnsuringCursorVisible: jest.fn(),
    unfold: jest.fn(),
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
  test("maps the native indent guide to the immediate list ancestor", () => {
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

    expect(
      resolveVerticalGuideTarget(grandchild)?.getFirstLineContentStart().line,
    ).toBe(1);
  });

  test("maps a child guide when the list block has leading indentation", () => {
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

    expect(
      resolveVerticalGuideTarget(child)?.getFirstLineContentStart().line,
    ).toBe(0);
  });

  test("maps a note-line guide to the owning list's parent", () => {
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

    expect(
      resolveVerticalGuideTarget(child)?.getFirstLineContentStart().line,
    ).toBe(0);
  });

  test("ignores leading indentation on a root list item", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "  - root item",
        cursor: { line: 0, ch: 2 },
      }),
    });
    const rootItem = root.getListUnderLine(0);
    if (!rootItem) {
      throw new Error("Expected a root list item");
    }

    expect(resolveVerticalGuideTarget(rootItem)).toBeNull();
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

  test("folds each direct non-empty child when any branch is open", () => {
    const root = makeRoot({
      editor: makeEditor({
        text,
        cursor: { line: 0, ch: 0 },
        getAllFoldedLines: () => [1],
      }),
    });
    const parent = root.getListUnderLine(0);
    if (!parent) {
      throw new Error("Expected a parent list");
    }
    const editor = makeFoldEditor();

    expect(toggleVerticalGuideTarget(editor, parent)).toBe(true);
    expect(editor.foldEnsuringCursorVisible).toHaveBeenNthCalledWith(1, 1, {
      line: 1,
      ch: 4,
    });
    expect(editor.foldEnsuringCursorVisible).toHaveBeenNthCalledWith(2, 4, {
      line: 4,
      ch: 4,
    });
    expect(editor.foldEnsuringCursorVisible).toHaveBeenCalledTimes(2);
    expect(editor.unfold).not.toHaveBeenCalled();
  });

  test("unfolds each direct non-empty child when every branch is folded", () => {
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
    expect(editor.unfold).toHaveBeenCalledTimes(2);
    expect(editor.foldEnsuringCursorVisible).not.toHaveBeenCalled();
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
    expect(editor.foldEnsuringCursorVisible).not.toHaveBeenCalled();
    expect(editor.unfold).not.toHaveBeenCalled();
  });
});

describe("VerticalLinesPluginValue.handleMouseDown", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEditorFromState.mockReturnValue(null);
  });

  function makeGuideLine(guideCount = 1) {
    const line = {
      querySelectorAll: jest.fn(),
    };
    const guides = Array.from({ length: guideCount }, () => ({
      matches: jest.fn((selector: string) => selector === ".cm-indent"),
      closest: jest.fn((selector: string) =>
        selector === ".cm-line" ? line : null,
      ),
    }));
    line.querySelectorAll.mockReturnValue(guides);

    return { guides, line };
  }

  function makeEvent(target: unknown) {
    const preventDefault = jest.fn();
    return {
      event: { target, preventDefault } as unknown as MouseEvent,
      preventDefault,
    };
  }

  function makeView(lineNumber: number) {
    return {
      state: {
        doc: {
          lineAt: jest.fn().mockReturnValue({ number: lineNumber + 1 }),
        },
      },
      posAtDOM: jest.fn().mockReturnValue(10),
    };
  }

  function makePluginValue(settings: unknown, parser: unknown) {
    return Object.assign(Object.create(VerticalLinesPluginValue.prototype), {
      settings,
      parser,
    }) as {
      handleMouseDown(event: MouseEvent, view: unknown): boolean;
    };
  }

  test("observes mousedown during capture and removes the listener", () => {
    type CapturedListener = (event: Event) => void;
    const addEventListener = jest.fn<
      void,
      [string, CapturedListener, boolean]
    >();
    const removeEventListener = jest.fn<
      void,
      [string, CapturedListener | undefined, boolean]
    >();
    const contentDOM = {
      addEventListener,
      removeEventListener,
    };
    const PluginValueWithView = VerticalLinesPluginValue as unknown as new (
      settings: unknown,
      parser: unknown,
      view: unknown,
    ) => { destroy(): void };
    const pluginValue = new PluginValueWithView(
      {
        verticalLines: true,
        verticalLinesAction: "toggle-folding",
      },
      { parse: jest.fn() },
      { contentDOM },
    );

    expect(contentDOM.addEventListener).toHaveBeenCalledWith(
      "mousedown",
      expect.any(Function),
      true,
    );
    const listener = addEventListener.mock.calls[0]?.[1];

    pluginValue.destroy();

    expect(contentDOM.removeEventListener).toHaveBeenCalledWith(
      "mousedown",
      listener,
      true,
    );
  });

  test("folds the ancestor represented by a native indentation guide", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n  - branch\n    - leaf",
        cursor: { line: 1, ch: 2 },
      }),
    });
    const editor = makeFoldEditor();
    mockGetEditorFromState.mockReturnValue(editor);
    const parser = { parse: jest.fn().mockReturnValue(root) };
    const pluginValue = makePluginValue(
      {
        verticalLines: true,
        verticalLinesAction: "toggle-folding",
      },
      parser,
    );
    const { guides, line } = makeGuideLine();
    const { event, preventDefault } = makeEvent(guides[0]);
    const view = makeView(1);

    expect(pluginValue.handleMouseDown(event, view)).toBe(true);
    expect(view.posAtDOM).toHaveBeenCalledWith(line);
    expect(parser.parse).toHaveBeenCalledWith(editor, { line: 1, ch: 0 });
    expect(editor.foldEnsuringCursorVisible).toHaveBeenCalledWith(1, {
      line: 1,
      ch: 4,
    });
    expect(editor.foldEnsuringCursorVisible).toHaveBeenCalledTimes(1);
    expect(editor.unfold).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  test.each([
    [{ verticalLines: false, verticalLinesAction: "toggle-folding" }],
    [{ verticalLines: true, verticalLinesAction: "none" }],
  ])("ignores guides when settings disable interaction", (settings) => {
    const pluginValue = makePluginValue(settings, { parse: jest.fn() });
    const { guides } = makeGuideLine();
    const { event, preventDefault } = makeEvent(guides[0]);

    expect(pluginValue.handleMouseDown(event, makeView(1))).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  test("ignores targets that are not native indentation guides", () => {
    const target = {
      matches: jest.fn().mockReturnValue(false),
      closest: jest.fn(),
    };
    const { event, preventDefault } = makeEvent(target);
    const pluginValue = makePluginValue(
      {
        verticalLines: true,
        verticalLinesAction: "toggle-folding",
      },
      { parse: jest.fn() },
    );

    expect(pluginValue.handleMouseDown(event, makeView(1))).toBe(false);
    expect(target.closest).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  test("ignores a guide while editor state is unavailable", () => {
    const pluginValue = makePluginValue(
      {
        verticalLines: true,
        verticalLinesAction: "toggle-folding",
      },
      { parse: jest.fn() },
    );
    const { guides } = makeGuideLine();
    const { event, preventDefault } = makeEvent(guides[0]);

    expect(pluginValue.handleMouseDown(event, makeView(1))).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  test("ignores a guide when the containing list cannot be parsed", () => {
    const editor = makeFoldEditor();
    mockGetEditorFromState.mockReturnValue(editor);
    const pluginValue = makePluginValue(
      {
        verticalLines: true,
        verticalLinesAction: "toggle-folding",
      },
      { parse: jest.fn().mockReturnValue(null) },
    );
    const { guides } = makeGuideLine();
    const { event, preventDefault } = makeEvent(guides[0]);

    expect(pluginValue.handleMouseDown(event, makeView(1))).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  test("ignores a guide that has no corresponding list ancestor", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "  - root item\n    - child",
        cursor: { line: 0, ch: 2 },
      }),
    });
    const editor = makeFoldEditor();
    mockGetEditorFromState.mockReturnValue(editor);
    const pluginValue = makePluginValue(
      {
        verticalLines: true,
        verticalLinesAction: "toggle-folding",
      },
      { parse: jest.fn().mockReturnValue(root) },
    );
    const { guides } = makeGuideLine();
    const { event, preventDefault } = makeEvent(guides[0]);

    expect(pluginValue.handleMouseDown(event, makeView(0))).toBe(false);
    expect(editor.foldEnsuringCursorVisible).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
