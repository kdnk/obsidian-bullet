import { readFileSync } from "node:fs";
import { join } from "node:path";

import { makeEditor, makeRoot } from "../../__mocks__";
import {
  VerticalLines,
  VerticalLinesPluginValue,
  collectVerticalGuideGroup,
  resolveVerticalGuideTarget,
  synchronizeHoveredIndentGuides,
  synchronizePersistentIndentGuides,
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
    add: jest.fn((...classes: string[]) => {
      for (const className of classes) {
        values.add(className);
      }
    }),
    remove: jest.fn((...classes: string[]) => {
      for (const className of classes) {
        values.delete(className);
      }
    }),
    contains: (value: string) => values.has(value),
  };
}

function makeGuideElement(
  classes: string[],
  options: { insideListIndent?: boolean } = {},
) {
  const classList = makeClassList();
  classList.add(...classes);

  return {
    classList,
    insideListIndent: options.insideListIndent ?? true,
  };
}

function makeGuideDOM(elements: Array<ReturnType<typeof makeGuideElement>>) {
  const querySelectorAll = jest.fn((selector: string) => {
    if (
      selector === ".cm-hmd-list-indent > .cm-indent-spacing:not(.cm-indent)"
    ) {
      return elements.filter(
        (element) =>
          element.insideListIndent &&
          element.classList.contains("cm-indent-spacing") &&
          !element.classList.contains("cm-indent"),
      );
    }

    if (selector === ".bullet-plugin-persistent-indent-guide") {
      return elements.filter((element) =>
        element.classList.contains("bullet-plugin-persistent-indent-guide"),
      );
    }

    if (selector === ".bullet-plugin-hovered-indent-guide") {
      return elements.filter((element) =>
        element.classList.contains("bullet-plugin-hovered-indent-guide"),
      );
    }

    return [];
  });

  return {
    contentDOM: {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      querySelectorAll,
    },
    elements,
    querySelectorAll,
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
  type WorkspaceHandler = (...args: never[]) => void;
  const eventHandlers = new Map<string, WorkspaceHandler[]>();
  const workspace = {
    on: jest.fn((eventName: string, handler: WorkspaceHandler) => {
      const handlers = eventHandlers.get(eventName) ?? [];
      handlers.push(handler);
      eventHandlers.set(eventName, handlers);
      return { eventName, handler };
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

function makeGuideLine(indentSegments: string[] = ["  "]) {
  const line = {};
  const indentContainer = {
    matches: jest.fn((selector: string) => selector === ".cm-hmd-list-indent"),
    childNodes: [] as Array<{ textContent: string | null }>,
  };
  const guides = indentSegments.map((textContent) => ({
    textContent,
    parentElement: indentContainer,
    classList: makeClassList(),
    matches: jest.fn((selector: string) => selector === ".cm-indent"),
    closest: jest.fn((selector: string) =>
      selector === ".cm-line" ? line : null,
    ),
  }));
  indentContainer.childNodes.push(...guides);

  return { guides, indentContainer, line };
}

function mapGuideLine(
  root: ReturnType<typeof makeRoot>,
  lineNumber: number,
  indentSegments: string[],
  listsByGuide: Map<unknown, ReturnType<typeof root.getListUnderLine>>,
) {
  const guideLine = makeGuideLine(indentSegments);
  for (const guide of guideLine.guides) {
    listsByGuide.set(guide, root.getListUnderLine(lineNumber));
  }
  return guideLine;
}

function resolveGuideTarget(
  list: Parameters<typeof resolveVerticalGuideTarget>[0],
  guide: unknown,
) {
  const resolver = resolveVerticalGuideTarget as unknown as (
    list: Parameters<typeof resolveVerticalGuideTarget>[0],
    guide: unknown,
  ) => ReturnType<typeof resolveVerticalGuideTarget>;
  return resolver(list, guide);
}

describe("VerticalLines", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("manages display and folding-action classes across documents", async () => {
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
      verticalLinesAction: "toggle-folding",
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
    expect(
      mainDocument.body.classList.contains(
        "bullet-plugin-vertical-lines-action-toggle-folding",
      ),
    ).toBe(true);

    for (const handler of eventHandlers.get("window-open") ?? []) {
      handler({} as never, { document: popoutDocument } as never);
    }
    expect(
      popoutDocument.body.classList.contains("bullet-plugin-vertical-lines"),
    ).toBe(true);
    expect(
      popoutDocument.body.classList.contains(
        "bullet-plugin-vertical-lines-action-toggle-folding",
      ),
    ).toBe(true);

    const settingsCallback = settingsCallbacks[0];
    if (!settingsCallback) {
      throw new Error("Expected settings callback to be registered");
    }

    settings.verticalLinesAction = "none";
    settingsCallback();

    expect(
      mainDocument.body.classList.contains("bullet-plugin-vertical-lines"),
    ).toBe(true);
    expect(
      mainDocument.body.classList.contains(
        "bullet-plugin-vertical-lines-action-toggle-folding",
      ),
    ).toBe(false);
    expect(
      popoutDocument.body.classList.contains("bullet-plugin-vertical-lines"),
    ).toBe(true);
    expect(
      popoutDocument.body.classList.contains(
        "bullet-plugin-vertical-lines-action-toggle-folding",
      ),
    ).toBe(false);

    settings.verticalLinesAction = "toggle-folding";
    settings.verticalLines = false;
    settingsCallback();

    expect(
      mainDocument.body.classList.contains("bullet-plugin-vertical-lines"),
    ).toBe(false);
    expect(
      mainDocument.body.classList.contains(
        "bullet-plugin-vertical-lines-action-toggle-folding",
      ),
    ).toBe(false);

    settings.verticalLines = true;
    settingsCallback();
    await feature.unload();

    expect(
      mainDocument.body.classList.contains("bullet-plugin-vertical-lines"),
    ).toBe(false);
    expect(
      mainDocument.body.classList.contains(
        "bullet-plugin-vertical-lines-action-toggle-folding",
      ),
    ).toBe(false);
    expect(
      popoutDocument.body.classList.contains("bullet-plugin-vertical-lines"),
    ).toBe(false);
    expect(
      popoutDocument.body.classList.contains(
        "bullet-plugin-vertical-lines-action-toggle-folding",
      ),
    ).toBe(false);
    expect(settings.removeCallback).toHaveBeenCalledWith(expect.any(Function));
  });
});

describe("resolveVerticalGuideTarget", () => {
  test("maps each standard indent guide to its exact real ancestor", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: [
          "- parent",
          "    - child",
          "        - grandchild",
          "            - leaf",
        ].join("\n"),
        cursor: { line: 3, ch: 12 },
      }),
    });
    const leaf = root.getListUnderLine(3);
    if (!leaf) {
      throw new Error("Expected a leaf list");
    }
    const { guides } = makeGuideLine(["    ", "    ", "    "]);

    expect(
      resolveGuideTarget(leaf, guides[0])?.getFirstLineContentStart().line,
    ).toBe(0);
    expect(
      resolveGuideTarget(leaf, guides[1])?.getFirstLineContentStart().line,
    ).toBe(1);
    expect(
      resolveGuideTarget(leaf, guides[2])?.getFirstLineContentStart().line,
    ).toBe(2);
  });

  test("uses the painted boundary when native indentation is combined", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: [
          "- parent",
          "  - child",
          "    - grandchild",
          "      - leaf",
        ].join("\n"),
        cursor: { line: 3, ch: 6 },
      }),
    });
    const leaf = root.getListUnderLine(3);
    if (!leaf) {
      throw new Error("Expected a leaf list");
    }
    const { guides } = makeGuideLine(["    ", "  "]);

    expect(
      resolveGuideTarget(leaf, guides[0])?.getFirstLineContentStart().line,
    ).toBe(0);
    expect(
      resolveGuideTarget(leaf, guides[1])?.getFirstLineContentStart().line,
    ).toBe(2);
  });

  test("ignores guide boundaries that match only shared leading indentation", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "  - parent\n      - child",
        cursor: { line: 1, ch: 6 },
      }),
    });
    const child = root.getListUnderLine(1);
    if (!child) {
      throw new Error("Expected a child list");
    }
    const { guides } = makeGuideLine(["    ", "  "]);

    expect(resolveGuideTarget(child, guides[0])).toBeNull();
    expect(resolveGuideTarget(child, guides[1])).toBeNull();
  });

  test("ignores a guide outside a list-indent container", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n    - child",
        cursor: { line: 1, ch: 4 },
      }),
    });
    const child = root.getListUnderLine(1);
    if (!child) {
      throw new Error("Expected a child list");
    }
    const guide = {
      parentElement: { matches: jest.fn().mockReturnValue(false) },
    };

    expect(resolveGuideTarget(child, guide)).toBeNull();
  });
});

describe("collectVerticalGuideGroup", () => {
  test("groups only segments resolving to the same outer list", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: [
          "- parent A",
          "    - child A",
          "        - leaf A",
          "- parent B",
          "    - child B",
          "        - leaf B",
        ].join("\n"),
        cursor: { line: 2, ch: 8 },
      }),
    });
    const listsByGuide = new Map<
      unknown,
      ReturnType<typeof root.getListUnderLine>
    >();
    const childA = mapGuideLine(root, 1, ["    "], listsByGuide);
    const leafA = mapGuideLine(root, 2, ["    ", "    "], listsByGuide);
    const childB = mapGuideLine(root, 4, ["    "], listsByGuide);
    const leafB = mapGuideLine(root, 5, ["    ", "    "], listsByGuide);
    const guides = [
      ...childA.guides,
      ...leafA.guides,
      ...childB.guides,
      ...leafB.guides,
    ];

    expect(
      collectVerticalGuideGroup(
        leafA.guides[0] as unknown as Element,
        guides as unknown as Element[],
        (guide) => listsByGuide.get(guide) ?? null,
      ),
    ).toEqual([childA.guides[0], leafA.guides[0]]);
  });

  test("groups inner and persistent segments without adjacent outer guides", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: [
          "- parent",
          "    - child",
          "        - branch alpha",
          "            - leaf alpha",
          "        - branch beta",
          "            - leaf beta",
          "    - outer sibling",
          "        - outer leaf",
        ].join("\n"),
        cursor: { line: 3, ch: 12 },
      }),
    });
    const listsByGuide = new Map<
      unknown,
      ReturnType<typeof root.getListUnderLine>
    >();
    const branchAlpha = mapGuideLine(root, 2, ["    ", "    "], listsByGuide);
    const leafAlpha = mapGuideLine(
      root,
      3,
      ["    ", "    ", "    "],
      listsByGuide,
    );
    const branchBeta = mapGuideLine(root, 4, ["    ", "    "], listsByGuide);
    const leafBeta = mapGuideLine(
      root,
      5,
      ["    ", "    ", "    "],
      listsByGuide,
    );
    branchBeta.guides[1]?.classList.add(
      "bullet-plugin-persistent-indent-guide",
    );
    const guides = [
      ...branchAlpha.guides,
      ...leafAlpha.guides,
      ...branchBeta.guides,
      ...leafBeta.guides,
    ];

    expect(
      collectVerticalGuideGroup(
        leafAlpha.guides[1] as unknown as Element,
        guides as unknown as Element[],
        (guide) => listsByGuide.get(guide) ?? null,
      ),
    ).toEqual([
      branchAlpha.guides[1],
      leafAlpha.guides[1],
      branchBeta.guides[1],
      leafBeta.guides[1],
    ]);
  });

  test("returns no group for an unmatched guide", () => {
    const guide = makeGuideLine(["  "]).guides[0];

    expect(
      collectVerticalGuideGroup(
        guide as unknown as Element,
        [guide] as unknown as Element[],
        () => null,
      ),
    ).toEqual([]);
  });
});

describe("synchronizeHoveredIndentGuides", () => {
  test("replaces the previous logical group and clears it", () => {
    const stale = makeGuideElement([
      "cm-indent",
      "bullet-plugin-hovered-indent-guide",
    ]);
    const first = makeGuideElement(["cm-indent"]);
    const second = makeGuideElement([
      "cm-indent",
      "bullet-plugin-persistent-indent-guide",
    ]);
    const { contentDOM } = makeGuideDOM([stale, first, second]);

    synchronizeHoveredIndentGuides(contentDOM as never, [
      first as never,
      second as never,
    ]);

    expect(stale.classList.contains("bullet-plugin-hovered-indent-guide")).toBe(
      false,
    );
    expect(first.classList.contains("bullet-plugin-hovered-indent-guide")).toBe(
      true,
    );
    expect(
      second.classList.contains("bullet-plugin-hovered-indent-guide"),
    ).toBe(true);

    synchronizeHoveredIndentGuides(contentDOM as never, []);
    expect(first.classList.contains("bullet-plugin-hovered-indent-guide")).toBe(
      false,
    );
    expect(
      second.classList.contains("bullet-plugin-hovered-indent-guide"),
    ).toBe(false);
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

describe("synchronizePersistentIndentGuides", () => {
  test("promotes only unclaimed list indentation spacing spans", () => {
    const promoted = makeGuideElement(["cm-indent-spacing"]);
    const nativeGuide = makeGuideElement(["cm-indent-spacing", "cm-indent"]);
    const outsideListIndent = makeGuideElement(["cm-indent-spacing"], {
      insideListIndent: false,
    });
    const { contentDOM, querySelectorAll } = makeGuideDOM([
      promoted,
      nativeGuide,
      outsideListIndent,
    ]);

    synchronizePersistentIndentGuides(contentDOM as never, true);

    expect(querySelectorAll).toHaveBeenCalledWith(
      ".cm-hmd-list-indent > .cm-indent-spacing:not(.cm-indent)",
    );
    expect(promoted.classList.contains("cm-indent")).toBe(true);
    expect(
      promoted.classList.contains("bullet-plugin-persistent-indent-guide"),
    ).toBe(true);
    expect(nativeGuide.classList.contains("cm-indent")).toBe(true);
    expect(
      nativeGuide.classList.contains("bullet-plugin-persistent-indent-guide"),
    ).toBe(false);
    expect(outsideListIndent.classList.contains("cm-indent")).toBe(false);
  });

  test("removes both guide classes only from plugin-owned spans", () => {
    const promoted = makeGuideElement([
      "cm-indent-spacing",
      "cm-indent",
      "bullet-plugin-persistent-indent-guide",
    ]);
    const nativeGuide = makeGuideElement(["cm-indent-spacing", "cm-indent"]);
    const { contentDOM, querySelectorAll } = makeGuideDOM([
      promoted,
      nativeGuide,
    ]);

    synchronizePersistentIndentGuides(contentDOM as never, false);

    expect(querySelectorAll).toHaveBeenCalledWith(
      ".bullet-plugin-persistent-indent-guide",
    );
    expect(promoted.classList.contains("cm-indent-spacing")).toBe(true);
    expect(promoted.classList.contains("cm-indent")).toBe(false);
    expect(
      promoted.classList.contains("bullet-plugin-persistent-indent-guide"),
    ).toBe(false);
    expect(nativeGuide.classList.contains("cm-indent")).toBe(true);
  });

  test("preserves promoted spacing layout with marker-scoped styles", () => {
    const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
    const declarations = styles.match(
      /\.bullet-plugin-vertical-lines\s+\.markdown-source-view\.mod-cm6\s+\.cm-indent-spacing\.bullet-plugin-persistent-indent-guide\s*\{([^}]*)\}/,
    )?.[1];

    expect(declarations).toContain("min-width: 0;");
    expect(declarations).toContain("display: inline;");
  });

  test("stacks the promoted native guide above folded branch indicators", () => {
    const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
    const declarations = styles.match(
      /\.bullet-plugin-vertical-lines\s+\.markdown-source-view\.mod-cm6\s+\.cm-indent-spacing\.bullet-plugin-persistent-indent-guide::before\s*\{([^}]*)\}/,
    )?.[1];

    expect(declarations?.trim()).toBe("z-index: 2;");
  });

  test("shows a pointer only for actionable vertical guides", () => {
    const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
    const declarations = styles.match(
      /\.bullet-plugin-vertical-lines-action-toggle-folding\s+\.markdown-source-view\.mod-cm6\s+\.cm-hmd-list-indent\s+\.cm-indent\s*\{([^}]*)\}/,
    )?.[1];

    expect(declarations?.trim()).toBe("cursor: pointer;");
    expect(styles).not.toMatch(
      /\.bullet-plugin-vertical-lines\s+\.markdown-source-view\.mod-cm6\s+\.cm-hmd-list-indent\s+\.cm-indent\s*\{[^}]*cursor:\s*pointer/,
    );
  });

  test("uses the native active style on the complete marked logical guide", () => {
    const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
    const declarations = styles.match(
      /\.bullet-plugin-vertical-lines-action-toggle-folding\s+\.markdown-source-view\.mod-cm6\s+\.cm-hmd-list-indent\s+\.cm-indent\.bullet-plugin-hovered-indent-guide::before\s*\{([^}]*)\}/,
    )?.[1];

    expect(declarations?.replace(/\s+/g, " ").trim()).toBe(
      "border-inline-end: var(--indentation-guide-width-active) solid var(--indentation-guide-color-active);",
    );
    expect(styles).not.toMatch(/\.cm-indent:hover::before/);
  });
});

describe("VerticalLinesPluginValue.handleMouseDown", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEditorFromState.mockReturnValue(null);
  });

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
    const settingsCallbacks: Array<() => void> = [];
    const settings = {
      verticalLines: true,
      verticalLinesAction: "toggle-folding",
      onChange: jest.fn((callback: () => void) => {
        settingsCallbacks.push(callback);
      }),
      removeCallback: jest.fn(),
    };
    const hoveredGuide = makeGuideElement([
      "cm-indent",
      "bullet-plugin-hovered-indent-guide",
    ]);
    const { contentDOM: guideDOM } = makeGuideDOM([hoveredGuide]);
    const contentDOM = {
      ...guideDOM,
      addEventListener,
      removeEventListener,
      querySelector: jest.fn().mockReturnValue(null),
    };
    const requestMeasure = jest.fn();
    const PluginValueWithView = VerticalLinesPluginValue as unknown as new (
      settings: unknown,
      parser: unknown,
      view: unknown,
    ) => { destroy(): void };
    const pluginValue = new PluginValueWithView(
      settings,
      { parse: jest.fn() },
      { contentDOM, requestMeasure },
    );

    expect(contentDOM.addEventListener).toHaveBeenCalledWith(
      "mousedown",
      expect.any(Function),
      true,
    );
    expect(contentDOM.addEventListener).toHaveBeenCalledWith(
      "pointermove",
      expect.any(Function),
      true,
    );
    expect(contentDOM.addEventListener).toHaveBeenCalledWith(
      "pointerleave",
      expect.any(Function),
      true,
    );
    expect(settings.onChange).toHaveBeenCalledWith(expect.any(Function));
    expect(requestMeasure).toHaveBeenCalledTimes(1);
    const listener = addEventListener.mock.calls[0]?.[1];
    const pointerMoveListener = addEventListener.mock.calls.find(
      ([eventName]) => eventName === "pointermove",
    )?.[1];
    const pointerLeaveListener = addEventListener.mock.calls.find(
      ([eventName]) => eventName === "pointerleave",
    )?.[1];
    const settingsCallback = settingsCallbacks[0];

    pluginValue.destroy();

    expect(contentDOM.removeEventListener).toHaveBeenCalledWith(
      "mousedown",
      listener,
      true,
    );
    expect(contentDOM.removeEventListener).toHaveBeenCalledWith(
      "pointermove",
      pointerMoveListener,
      true,
    );
    expect(contentDOM.removeEventListener).toHaveBeenCalledWith(
      "pointerleave",
      pointerLeaveListener,
      true,
    );
    expect(
      hoveredGuide.classList.contains("bullet-plugin-hovered-indent-guide"),
    ).toBe(false);
    expect(settings.removeCallback).toHaveBeenCalledWith(settingsCallback);
  });

  test("synchronizes logical hover groups across the view lifecycle", () => {
    type CapturedListener = (event: Event) => void;
    type Measurement = {
      read?: () => unknown;
      write?: (measure: unknown, view: unknown) => void;
    };
    const addEventListener = jest.fn<
      void,
      [string, CapturedListener, boolean]
    >();
    const removeEventListener = jest.fn<
      void,
      [string, CapturedListener | undefined, boolean]
    >();
    const settingsCallbacks: Array<() => void> = [];
    const settings = {
      verticalLines: true,
      verticalLinesAction: "toggle-folding",
      onChange: jest.fn((callback: () => void) => {
        settingsCallbacks.push(callback);
      }),
      removeCallback: jest.fn(),
    };
    const outerEditor = makeEditor({
      text: [
        "- parent A",
        "    - child A",
        "        - leaf A",
        "- parent B",
        "    - child B",
        "        - leaf B",
      ].join("\n"),
      cursor: { line: 2, ch: 8 },
    });
    const outerRoot = makeRoot({ editor: outerEditor });
    const outerChildA = makeGuideLine(["    "]);
    const outerLeafA = makeGuideLine(["    ", "    "]);
    const outerChildB = makeGuideLine(["    "]);
    const outerLeafB = makeGuideLine(["    ", "    "]);
    let hoveredGuide:
      | ReturnType<typeof makeGuideLine>["guides"][number]
      | null = outerLeafA.guides[0];
    let candidates = [
      ...outerChildA.guides,
      ...outerLeafA.guides,
      ...outerChildB.guides,
      ...outerLeafB.guides,
    ];
    let lineByElement = new Map<unknown, number>([
      [outerChildA.line, 1],
      [outerLeafA.line, 2],
      [outerChildB.line, 4],
      [outerLeafB.line, 5],
    ]);
    let currentRoot = outerRoot;
    let currentEditor = outerEditor;
    const querySelector = jest.fn((selector: string) =>
      selector === ".cm-indent:hover" ? hoveredGuide : null,
    );
    const querySelectorAll = jest.fn((selector: string) => {
      if (
        selector ===
        ".cm-hmd-list-indent > .cm-indent, .cm-hmd-list-indent > .cm-indent-spacing"
      ) {
        return candidates;
      }
      if (selector === ".bullet-plugin-hovered-indent-guide") {
        return candidates.filter((guide) =>
          guide.classList.contains("bullet-plugin-hovered-indent-guide"),
        );
      }
      return [];
    });
    const contentDOM = {
      addEventListener,
      removeEventListener,
      querySelector,
      querySelectorAll,
    };
    const requests: Measurement[] = [];
    const view = {
      contentDOM,
      state: {
        doc: {
          lineAt: jest.fn((offset: number) => ({ number: offset + 1 })),
        },
      },
      posAtDOM: jest.fn((element: unknown) => {
        const line = lineByElement.get(element);
        if (line === undefined) {
          throw new Error("Expected a mapped line element");
        }
        return line;
      }),
      requestMeasure: jest.fn((request: Measurement) => {
        requests.push(request);
      }),
    };
    const parser = { parse: jest.fn(() => currentRoot) };
    mockGetEditorFromState.mockImplementation(() => currentEditor);
    const PluginValueWithView = VerticalLinesPluginValue as unknown as new (
      settings: unknown,
      parser: unknown,
      view: unknown,
    ) => { destroy(): void; update(update: unknown): void };
    const pluginValue = new PluginValueWithView(settings, parser, view);
    const executeLatestMeasurement = () => {
      const request = requests[requests.length - 1];
      const measurement = request?.read?.();
      request?.write?.(measurement, view);
    };

    executeLatestMeasurement();
    expect(
      outerChildA.guides[0]?.classList.contains(
        "bullet-plugin-hovered-indent-guide",
      ),
    ).toBe(true);
    expect(
      outerLeafA.guides[0]?.classList.contains(
        "bullet-plugin-hovered-indent-guide",
      ),
    ).toBe(true);
    expect(
      outerChildB.guides[0]?.classList.contains(
        "bullet-plugin-hovered-indent-guide",
      ),
    ).toBe(false);

    const innerEditor = makeEditor({
      text: [
        "- parent",
        "    - child",
        "        - branch alpha",
        "            - leaf alpha",
        "        - branch beta",
        "            - leaf beta",
        "    - outer sibling",
        "        - outer leaf",
      ].join("\n"),
      cursor: { line: 3, ch: 12 },
    });
    currentEditor = innerEditor;
    currentRoot = makeRoot({ editor: innerEditor });
    const branchAlpha = makeGuideLine(["    ", "    "]);
    const leafAlpha = makeGuideLine(["    ", "    ", "    "]);
    const branchBeta = makeGuideLine(["    ", "    "]);
    const leafBeta = makeGuideLine(["    ", "    ", "    "]);
    branchBeta.guides[1]?.classList.add(
      "bullet-plugin-persistent-indent-guide",
    );
    candidates = [
      ...branchAlpha.guides,
      ...leafAlpha.guides,
      ...branchBeta.guides,
      ...leafBeta.guides,
    ];
    hoveredGuide = leafAlpha.guides[1];
    lineByElement = new Map<unknown, number>([
      [branchAlpha.line, 2],
      [leafAlpha.line, 3],
      [branchBeta.line, 4],
      [leafBeta.line, 5],
    ]);

    pluginValue.update({});
    executeLatestMeasurement();
    const innerSegments = [
      branchAlpha.guides[1],
      leafAlpha.guides[1],
      branchBeta.guides[1],
      leafBeta.guides[1],
    ];
    for (const guide of innerSegments) {
      expect(
        guide?.classList.contains("bullet-plugin-hovered-indent-guide"),
      ).toBe(true);
    }

    const settingsCallback = settingsCallbacks[0];
    if (!settingsCallback) {
      throw new Error("Expected settings callback to be registered");
    }
    settings.verticalLinesAction = "none";
    settingsCallback();
    executeLatestMeasurement();
    for (const guide of innerSegments) {
      expect(
        guide?.classList.contains("bullet-plugin-hovered-indent-guide"),
      ).toBe(false);
    }

    settings.verticalLinesAction = "toggle-folding";
    settingsCallback();
    executeLatestMeasurement();
    expect(
      leafAlpha.guides[1]?.classList.contains(
        "bullet-plugin-hovered-indent-guide",
      ),
    ).toBe(true);
    const pointerMove = addEventListener.mock.calls.find(
      ([eventName]) => eventName === "pointermove",
    )?.[1];
    const pointerLeave = addEventListener.mock.calls.find(
      ([eventName]) => eventName === "pointerleave",
    )?.[1];
    pointerMove?.({ target: leafAlpha.guides[1] } as unknown as Event);
    hoveredGuide = null;
    pointerLeave?.({} as Event);
    executeLatestMeasurement();
    for (const guide of innerSegments) {
      expect(
        guide?.classList.contains("bullet-plugin-hovered-indent-guide"),
      ).toBe(false);
    }

    hoveredGuide = leafAlpha.guides[1];
    pluginValue.update({});
    executeLatestMeasurement();
    pluginValue.destroy();
    for (const guide of innerSegments) {
      expect(
        guide?.classList.contains("bullet-plugin-hovered-indent-guide"),
      ).toBe(false);
    }
    expect(removeEventListener).toHaveBeenCalledWith(
      "pointermove",
      pointerMove,
      true,
    );
    expect(removeEventListener).toHaveBeenCalledWith(
      "pointerleave",
      pointerLeave,
      true,
    );
  });

  test("schedules synchronization after construction, updates, and settings changes", () => {
    const guide = makeGuideElement(["cm-indent-spacing"]);
    const { contentDOM } = makeGuideDOM([guide]);
    const settingsCallbacks: Array<() => void> = [];
    const settings = {
      verticalLines: false,
      verticalLinesAction: "toggle-folding",
      onChange: jest.fn((callback: () => void) => {
        settingsCallbacks.push(callback);
      }),
      removeCallback: jest.fn(),
    };
    const requests: Array<{
      key?: unknown;
      write?: (measure: unknown, view: unknown) => void;
    }> = [];
    const view = {
      contentDOM,
      requestMeasure: jest.fn(
        (request: {
          key?: unknown;
          write?: (measure: unknown, view: unknown) => void;
        }) => {
          requests.push(request);
        },
      ),
    };
    const PluginValueWithView = VerticalLinesPluginValue as unknown as new (
      settings: unknown,
      parser: unknown,
      view: unknown,
    ) => { update(update: unknown): void };
    const pluginValue = new PluginValueWithView(
      settings,
      { parse: jest.fn() },
      view,
    );

    expect(requests).toHaveLength(1);
    settings.verticalLines = true;
    requests[0]?.write?.(undefined, view);
    expect(guide.classList.contains("cm-indent")).toBe(true);

    pluginValue.update({});
    expect(requests).toHaveLength(2);

    const settingsCallback = settingsCallbacks[0];
    if (!settingsCallback) {
      throw new Error("Expected settings callback to be registered");
    }
    settingsCallback();
    expect(requests).toHaveLength(3);
    expect(requests[1]?.key).toBe(requests[0]?.key);
    expect(requests[2]?.key).toBe(requests[0]?.key);
  });

  test("cleans up synchronously and ignores queued writes after destroy", () => {
    const promoted = makeGuideElement(["cm-indent-spacing"]);
    const elements = [promoted];
    const { contentDOM } = makeGuideDOM(elements);
    const settingsCallbacks: Array<() => void> = [];
    const settings = {
      verticalLines: true,
      verticalLinesAction: "toggle-folding",
      onChange: jest.fn((callback: () => void) => {
        settingsCallbacks.push(callback);
      }),
      removeCallback: jest.fn(),
    };
    const requests: Array<{
      write?: (measure: unknown, view: unknown) => void;
    }> = [];
    const view = {
      contentDOM,
      requestMeasure: jest.fn(
        (request: { write?: (measure: unknown, view: unknown) => void }) => {
          requests.push(request);
        },
      ),
    };
    const PluginValueWithView = VerticalLinesPluginValue as unknown as new (
      settings: unknown,
      parser: unknown,
      view: unknown,
    ) => { destroy(): void; update(update: unknown): void };
    const pluginValue = new PluginValueWithView(
      settings,
      { parse: jest.fn() },
      view,
    );

    requests[0]?.write?.(undefined, view);
    expect(promoted.classList.contains("cm-indent")).toBe(true);
    pluginValue.update({});
    const queuedWrite = requests[1]?.write;

    pluginValue.destroy();

    expect(promoted.classList.contains("cm-indent")).toBe(false);
    expect(
      promoted.classList.contains("bullet-plugin-persistent-indent-guide"),
    ).toBe(false);
    expect(settings.removeCallback).toHaveBeenCalledWith(settingsCallbacks[0]);

    const laterSpacing = makeGuideElement(["cm-indent-spacing"]);
    elements.push(laterSpacing);
    queuedWrite?.(undefined, view);
    expect(laterSpacing.classList.contains("cm-indent")).toBe(false);
  });

  test("folds the outermost ancestor represented by a native indentation guide", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: [
          "- parent",
          "  - branch one",
          "    - leaf one",
          "  - leaf sibling",
          "  - branch two",
          "    - leaf two",
        ].join("\n"),
        cursor: { line: 2, ch: 4 },
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
    const { guides, line } = makeGuideLine(["    "]);
    const { event, preventDefault } = makeEvent(guides[0]);
    const view = makeView(2);

    expect(pluginValue.handleMouseDown(event, view)).toBe(true);
    expect(view.posAtDOM).toHaveBeenCalledWith(line);
    expect(parser.parse).toHaveBeenCalledWith(editor, { line: 2, ch: 0 });
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
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  test("folds only the child branch represented by an inner guide", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: [
          "- parent",
          "    - child",
          "        - branch alpha",
          "            - leaf alpha",
          "        - branch beta",
          "            - leaf beta",
          "    - outer sibling",
          "        - outer leaf",
        ].join("\n"),
        cursor: { line: 3, ch: 12 },
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
    const { guides, line } = makeGuideLine(["    ", "    ", "    "]);
    const { event, preventDefault } = makeEvent(guides[1]);
    const view = makeView(3);

    expect(pluginValue.handleMouseDown(event, view)).toBe(true);
    expect(view.posAtDOM).toHaveBeenCalledWith(line);
    expect(parser.parse).toHaveBeenCalledWith(editor, { line: 3, ch: 0 });
    expect(editor.foldEnsuringCursorVisible).toHaveBeenNthCalledWith(1, 2, {
      line: 2,
      ch: 10,
    });
    expect(editor.foldEnsuringCursorVisible).toHaveBeenNthCalledWith(2, 4, {
      line: 4,
      ch: 10,
    });
    expect(editor.foldEnsuringCursorVisible).toHaveBeenCalledTimes(2);
    expect(editor.foldEnsuringCursorVisible).not.toHaveBeenCalledWith(
      6,
      expect.anything(),
    );
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
