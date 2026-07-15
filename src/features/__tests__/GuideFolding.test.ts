import { Text } from "@codemirror/state";
import { Decoration, DecorationSet } from "@codemirror/view";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  makeEditor,
  makeLogger,
  makeRoot,
  makeSettings,
} from "../../__mocks__";
import { Parser } from "../../services/Parser";
import { GuideFoldingPluginValue } from "../GuideFolding";

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
function makeFoldEditor() {
  return {
    setFoldedPreservingScroll: jest.fn().mockReturnValue(true),
    lastLine: jest.fn().mockReturnValue(9),
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

type HoverMeasurement = {
  indentGuides: Element[];
  outerGuides: Element[];
};

type MeasureRequest = {
  read?: () => HoverMeasurement;
  write?: (measurement: HoverMeasurement) => void;
};

function makeHoverFixture(options: {
  editor: ReturnType<typeof makeEditor>;
  root: ReturnType<typeof makeRoot>;
  hoveredGuide: ReturnType<typeof makeGuideLine>["guides"][number];
  candidates: Array<ReturnType<typeof makeGuideLine>["guides"][number]>;
  lineByElement: Map<unknown, number>;
}) {
  type CapturedListener = (event: Event) => void;
  const addEventListener = jest.fn<void, [string, CapturedListener, boolean]>();
  const querySelector = jest.fn((selector: string) =>
    selector ===
    ".cm-indent:hover, .cm-hmd-list-indent > .cm-indent-spacing:hover"
      ? options.hoveredGuide
      : null,
  );
  const querySelectorAll = jest.fn((selector: string) => {
    if (
      selector ===
      ".cm-hmd-list-indent > .cm-indent, .cm-hmd-list-indent > .cm-indent-spacing"
    ) {
      return options.candidates;
    }
    if (selector === ".bullet-plugin-hovered-indent-guide") {
      return options.candidates.filter((guide) =>
        guide.classList.contains("bullet-plugin-hovered-indent-guide"),
      );
    }
    return [];
  });
  const contentDOM = {
    addEventListener,
    removeEventListener: jest.fn(),
    querySelector,
    querySelectorAll,
  };
  const requests: MeasureRequest[] = [];
  const view = {
    contentDOM,
    state: {
      doc: {
        lineAt: jest.fn((offset: number) => ({ number: offset + 1 })),
      },
    },
    posAtDOM: jest.fn((element: unknown) => {
      const line = options.lineByElement.get(element);
      if (line === undefined) {
        throw new Error("Expected a mapped line element");
      }
      return line;
    }),
    requestMeasure: jest.fn((request: MeasureRequest) => {
      requests.push(request);
    }),
  };
  const settings = {
    verticalLines: true,
    verticalLinesAction: "toggle-folding",
    onChange: jest.fn(),
    removeCallback: jest.fn(),
  };
  mockGetEditorFromState.mockReturnValue(options.editor);
  const PluginValueWithView = GuideFoldingPluginValue as unknown as new (
    settings: unknown,
    parser: unknown,
    view: unknown,
  ) => { destroy(): void };
  const pluginValue = new PluginValueWithView(
    settings,
    { parse: jest.fn().mockReturnValue(options.root) },
    view,
  );

  return {
    addEventListener,
    pluginValue,
    requests,
  };
}

describe("GuideFoldingPluginValue hover measurement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("groups only segments resolving to the same outer list", () => {
    const editor = makeEditor({
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
    const root = makeRoot({ editor });
    const childA = makeGuideLine(["    "]);
    const leafA = makeGuideLine(["    ", "    "]);
    const childB = makeGuideLine(["    "]);
    const leafB = makeGuideLine(["    ", "    "]);
    const fixture = makeHoverFixture({
      editor,
      root,
      hoveredGuide: leafA.guides[0],
      candidates: [
        ...childA.guides,
        ...leafA.guides,
        ...childB.guides,
        ...leafB.guides,
      ],
      lineByElement: new Map([
        [childA.line, 1],
        [leafA.line, 2],
        [childB.line, 4],
        [leafB.line, 5],
      ]),
    });

    const measurement = fixture.requests[0]?.read?.();

    expect(measurement?.indentGuides).toEqual([
      childA.guides[0],
      leafA.guides[0],
    ]);
    fixture.pluginValue.destroy();
  });

  test("groups inner and persistent segments without adjacent outer guides", () => {
    const editor = makeEditor({
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
    const root = makeRoot({ editor });
    const branchAlpha = makeGuideLine(["    ", "    "]);
    const leafAlpha = makeGuideLine(["    ", "    ", "    "]);
    const branchBeta = makeGuideLine(["    ", "    "]);
    const leafBeta = makeGuideLine(["    ", "    ", "    "]);
    branchBeta.guides[1]?.classList.add(
      "bullet-plugin-persistent-indent-guide",
    );
    const fixture = makeHoverFixture({
      editor,
      root,
      hoveredGuide: leafAlpha.guides[1],
      candidates: [
        ...branchAlpha.guides,
        ...leafAlpha.guides,
        ...branchBeta.guides,
        ...leafBeta.guides,
      ],
      lineByElement: new Map([
        [branchAlpha.line, 2],
        [leafAlpha.line, 3],
        [branchBeta.line, 4],
        [leafBeta.line, 5],
      ]),
    });

    const measurement = fixture.requests[0]?.read?.();

    expect(measurement?.indentGuides).toEqual([
      branchAlpha.guides[1],
      leafAlpha.guides[1],
      branchBeta.guides[1],
      leafBeta.guides[1],
    ]);
    fixture.pluginValue.destroy();
  });

  test("returns no group for an unmatched guide", () => {
    const editor = makeEditor({
      text: "  - parent\n      - child",
      cursor: { line: 1, ch: 6 },
    });
    const root = makeRoot({ editor });
    const child = makeGuideLine(["    "]);
    const fixture = makeHoverFixture({
      editor,
      root,
      hoveredGuide: child.guides[0],
      candidates: child.guides,
      lineByElement: new Map([[child.line, 1]]),
    });

    const measurement = fixture.requests[0]?.read?.();

    expect(measurement?.indentGuides).toEqual([]);
    fixture.pluginValue.destroy();
  });

  test("replaces the previous logical group and clears it on pointer leave", () => {
    const editor = makeEditor({
      text: "- parent A\n    - child A\n- parent B\n    - child B",
      cursor: { line: 1, ch: 4 },
    });
    const root = makeRoot({ editor });
    const selectedLine = makeGuideLine(["    "]);
    const staleLine = makeGuideLine(["    "]);
    const selected = selectedLine.guides[0];
    const stale = staleLine.guides[0];
    stale.classList.add("bullet-plugin-hovered-indent-guide");
    const fixture = makeHoverFixture({
      editor,
      root,
      hoveredGuide: selected,
      candidates: [selected, stale],
      lineByElement: new Map([
        [selectedLine.line, 1],
        [staleLine.line, 3],
      ]),
    });
    const measurement = fixture.requests[0]?.read?.();
    if (!measurement) {
      throw new Error("Expected a hover measurement");
    }

    fixture.requests[0]?.write?.(measurement);

    expect(stale.classList.contains("bullet-plugin-hovered-indent-guide")).toBe(
      false,
    );
    expect(
      selected.classList.contains("bullet-plugin-hovered-indent-guide"),
    ).toBe(true);

    const pointerLeave = fixture.addEventListener.mock.calls.find(
      ([eventName]) => eventName === "pointerleave",
    )?.[1];
    pointerLeave?.({} as Event);
    expect(
      selected.classList.contains("bullet-plugin-hovered-indent-guide"),
    ).toBe(false);
    fixture.pluginValue.destroy();
  });
});

describe("GuideFoldingPluginValue decorations", () => {
  function positions(decorations: ReturnType<typeof Decoration.set>) {
    const result: number[] = [];
    for (let cursor = decorations.iter(); cursor.value; cursor.next()) {
      result.push(cursor.from);
    }
    return result;
  }

  function makeFixture(
    text: string,
    visibility: { verticalLines: boolean; outerVerticalLines: boolean } = {
      verticalLines: true,
      outerVerticalLines: true,
    },
  ) {
    const settingsCallbacks: Array<() => void> = [];
    const settings = {
      ...visibility,
      verticalLinesAction: "none",
      onChange: jest.fn((callback: () => void) => {
        settingsCallbacks.push(callback);
      }),
      removeCallback: jest.fn(),
    };
    const contentDOM = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      querySelector: jest.fn().mockReturnValue(null),
      querySelectorAll: jest.fn().mockReturnValue([]),
    };
    const view = {
      state: { doc: Text.of(text.split("\n")) },
      contentDOM,
      dispatch: jest.fn(),
      requestMeasure: jest.fn(),
    };
    const parser = new Parser(makeLogger(), makeSettings());
    let editor = makeEditor({ text, cursor: { line: 0, ch: 0 } });
    mockGetEditorFromState.mockImplementation(() => editor);
    const PluginValueWithView = GuideFoldingPluginValue as unknown as new (
      settings: unknown,
      parser: unknown,
      view: unknown,
    ) => {
      decorations: ReturnType<typeof Decoration.set>;
      destroy(): void;
      update(update: unknown): void;
    };
    const pluginValue = new PluginValueWithView(settings, parser, view);

    return {
      pluginValue,
      settings,
      settingsCallback: settingsCallbacks[0],
      view,
      replaceText(nextText: string) {
        editor = makeEditor({ text: nextText, cursor: { line: 0, ch: 0 } });
        view.state.doc = Text.of(nextText.split("\n"));
      },
    };
  }

  function renderOuterSegments(decorations: DecorationSet) {
    const segments: Array<{
      className: string;
      dataset: Record<string, string>;
      setAttribute: jest.Mock;
    }> = [];

    for (let cursor = decorations.iter(); cursor.value; cursor.next()) {
      const element = {
        className: "",
        dataset: {} as Record<string, string>,
        setAttribute: jest.fn(),
      };
      const widget = (
        cursor.value.spec as {
          widget: {
            toDOM(view: unknown): typeof element;
            ignoreEvent(): boolean;
          };
        }
      ).widget;
      const createElement = jest.fn(() => element);

      expect(widget.toDOM({ dom: { ownerDocument: { createElement } } })).toBe(
        element,
      );
      expect(createElement).toHaveBeenCalledWith("span");
      expect(widget.ignoreEvent()).toBe(false);
      segments.push(element);
    }

    return segments;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("builds outer decorations on construction when both settings are visible", () => {
    const fixture = makeFixture("- parent\n    - child");

    expect(positions(fixture.pluginValue.decorations)).toEqual([0, 9]);
    fixture.pluginValue.destroy();
  });

  test.each([
    ["empty line", "- a\n    - child\n\n- b\n    - child"],
    ["spaces-only line", "- a\n    - child\n   \n- b\n    - child"],
    ["heading", "- a\n    - child\n# Heading\n- b\n    - child"],
    ["paragraph", "- a\n    - child\ntext\n- b\n    - child"],
  ])("splits outer decoration chunks at a %s", (_name, text) => {
    const fixture = makeFixture(text);

    expect(fixture.pluginValue.decorations.size).toBe(4);
    expect(
      renderOuterSegments(fixture.pluginValue.decorations).map(
        ({ dataset }) => [
          dataset.chunkId,
          dataset.chunkStart,
          dataset.chunkEnd,
        ],
      ),
    ).toEqual([
      ["0:1", "0", "1"],
      ["0:1", "0", "1"],
      ["3:4", "3", "4"],
      ["3:4", "3", "4"],
    ]);
    fixture.pluginValue.destroy();
  });

  test("renders preserved widget metadata and current chunk actionability", () => {
    const fixture = makeFixture(
      "- leaf A\n- leaf B\n\n- parent\n    continuation\n- sibling",
    );

    expect(fixture.pluginValue.decorations.size).toBe(5);
    const segments = renderOuterSegments(fixture.pluginValue.decorations);
    expect(
      segments.map(({ className, dataset }) => ({ className, dataset })),
    ).toEqual([
      {
        className: "bullet-plugin-outer-list-guide",
        dataset: {
          actionable: "false",
          chunkEnd: "1",
          chunkId: "0:1",
          chunkStart: "0",
        },
      },
      {
        className: "bullet-plugin-outer-list-guide",
        dataset: {
          actionable: "false",
          chunkEnd: "1",
          chunkId: "0:1",
          chunkStart: "0",
        },
      },
      ...Array.from({ length: 3 }, () => ({
        className: "bullet-plugin-outer-list-guide",
        dataset: {
          actionable: "true",
          chunkEnd: "5",
          chunkId: "3:5",
          chunkStart: "3",
        },
      })),
    ]);
    for (const segment of segments) {
      expect(segment.setAttribute).toHaveBeenCalledWith("aria-hidden", "true");
    }
    fixture.pluginValue.destroy();
  });

  test.each([
    { verticalLines: false, outerVerticalLines: true },
    { verticalLines: true, outerVerticalLines: false },
  ])("builds no outer decorations when visibility is %o", (visibility) => {
    const fixture = makeFixture("- parent\n    - child", visibility);

    expect(fixture.pluginValue.decorations).toBe(Decoration.none);
    fixture.pluginValue.destroy();
  });

  test("rebuilds outer decorations at new line positions after a document change", () => {
    const fixture = makeFixture("- parent\n    - child");
    fixture.replaceText("# Heading\n- parent\n    - child");

    fixture.pluginValue.update({ docChanged: true });

    expect(positions(fixture.pluginValue.decorations)).toEqual([10, 19]);
    fixture.pluginValue.destroy();
  });

  test("refreshes decorations only when an outer visibility setting changes", () => {
    const fixture = makeFixture("- parent\n    - child");
    if (!fixture.settingsCallback) {
      throw new Error("Expected settings callback to be registered");
    }

    fixture.settings.outerVerticalLines = false;
    fixture.settingsCallback();

    expect(fixture.pluginValue.decorations).toBe(Decoration.none);
    expect(fixture.view.dispatch).toHaveBeenLastCalledWith({});

    fixture.settings.verticalLinesAction = "toggle-folding";
    fixture.settingsCallback();
    expect(fixture.view.dispatch).toHaveBeenCalledTimes(1);

    fixture.settings.outerVerticalLines = true;
    fixture.settingsCallback();
    expect(positions(fixture.pluginValue.decorations)).toEqual([0, 9]);
    expect(fixture.view.dispatch).toHaveBeenCalledTimes(2);
    fixture.pluginValue.destroy();
  });
});

describe("GuideFoldingPluginValue persistent guides", () => {
  test("promotes only unclaimed list indentation spacing spans", () => {
    const promoted = makeGuideElement(["cm-indent-spacing"]);
    const nativeGuide = makeGuideElement(["cm-indent-spacing", "cm-indent"]);
    const outsideListIndent = makeGuideElement(["cm-indent-spacing"], {
      insideListIndent: false,
    });
    const { contentDOM: guideDOM, querySelectorAll } = makeGuideDOM([
      promoted,
      nativeGuide,
      outsideListIndent,
    ]);
    const requests: Array<{
      write?: (measurement: unknown) => void;
    }> = [];
    const contentDOM = {
      ...guideDOM,
      querySelector: jest.fn().mockReturnValue(null),
    };
    const pluginValue = new GuideFoldingPluginValue(
      {
        verticalLines: true,
        verticalLinesAction: "none",
        onChange: jest.fn(),
        removeCallback: jest.fn(),
      } as never,
      {} as never,
      {
        contentDOM,
        requestMeasure: jest.fn(
          (request: { write?: (measurement: unknown) => void }) =>
            requests.push(request),
        ),
      } as never,
    );

    requests[0]?.write?.(undefined);

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
    pluginValue.destroy();
  });

  test("removes both guide classes only from plugin-owned spans", () => {
    const promoted = makeGuideElement([
      "cm-indent-spacing",
      "cm-indent",
      "bullet-plugin-persistent-indent-guide",
    ]);
    const nativeGuide = makeGuideElement(["cm-indent-spacing", "cm-indent"]);
    const { contentDOM: guideDOM, querySelectorAll } = makeGuideDOM([
      promoted,
      nativeGuide,
    ]);
    const contentDOM = {
      ...guideDOM,
      querySelector: jest.fn().mockReturnValue(null),
    };
    const pluginValue = new GuideFoldingPluginValue(
      {
        verticalLines: false,
        verticalLinesAction: "none",
        onChange: jest.fn(),
        removeCallback: jest.fn(),
      } as never,
      {} as never,
      {
        contentDOM,
        requestMeasure: jest.fn(),
      } as never,
    );

    pluginValue.destroy();

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
});

describe("GuideFolding persistent guide styles", () => {
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

  test("hides list chevrons while vertical guides toggle folding", () => {
    const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
    const declarations = styles.match(
      /\.bullet-plugin-vertical-lines-action-toggle-folding\s+\.markdown-source-view\.mod-cm6\s+\.HyperMD-list-line\s+\.cm-fold-indicator\s+\.collapse-indicator\s*\{([^}]*)\}/,
    )?.[1];

    expect(declarations?.replace(/\s+/g, " ").trim()).toBe(
      "visibility: hidden; pointer-events: none;",
    );
    expect(declarations).not.toContain("display:");
    expect(styles).not.toMatch(
      /\.bullet-plugin-vertical-lines-action-toggle-folding\s+\.markdown-source-view\.mod-cm6\s+\.cm-fold-indicator\s+\.collapse-indicator\s*\{/,
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

describe("GuideFolding outer guide styles", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");

  test("positions a zero-content segment one list indent outside the native guide", () => {
    const declarations = styles.match(
      /\.bullet-plugin-vertical-lines\s+\.markdown-source-view\.mod-cm6\s+\.bullet-plugin-outer-list-guide\s*\{([^}]*)\}/,
    )?.[1];

    expect(declarations).toContain("position: absolute;");
    expect(declarations).toContain("inset-block: 0;");
    expect(declarations).toContain(
      "inset-inline-start: calc(-1 * var(--list-indent));",
    );
    expect(declarations).toContain("width: var(--list-indent);");
    expect(declarations).toContain("pointer-events: none;");
  });

  test("draws normal and hovered segments with native theme variables", () => {
    const normal = styles.match(
      /\.bullet-plugin-vertical-lines\s+\.markdown-source-view\.mod-cm6\s+\.bullet-plugin-outer-list-guide::before\s*\{([^}]*)\}/,
    )?.[1];
    const hovered = styles.match(
      /\.bullet-plugin-vertical-lines-action-toggle-folding\s+\.markdown-source-view\.mod-cm6\s+\.bullet-plugin-outer-list-guide\[data-actionable="true"\]\.bullet-plugin-hovered-outer-list-guide::before\s*\{([^}]*)\}/,
    )?.[1];

    expect(normal?.replace(/\s+/g, " ")).toContain(
      "border-inline-end: var(--indentation-guide-width) solid var(--indentation-guide-color);",
    );
    expect(hovered?.replace(/\s+/g, " ")).toContain(
      "border-inline-end: var(--indentation-guide-width-active) solid var(--indentation-guide-color-active);",
    );
  });

  test("enables pointer interaction only for actionable widgets under the action class", () => {
    const actionable = styles.match(
      /\.bullet-plugin-vertical-lines-action-toggle-folding\s+\.markdown-source-view\.mod-cm6\s+\.bullet-plugin-outer-list-guide\[data-actionable="true"\]\s*\{([^}]*)\}/,
    )?.[1];

    expect(actionable).toContain("pointer-events: auto;");
    expect(actionable).toContain("cursor: pointer;");
    expect(actionable).toContain("z-index: 2;");
    expect(styles).not.toMatch(
      /\.bullet-plugin-vertical-lines\s+\.markdown-source-view\.mod-cm6\s+\.bullet-plugin-outer-list-guide\[data-actionable="true"\]\s*\{[^}]*cursor:/,
    );
  });

  test("introduces no custom paint, overlay, or scroll correction", () => {
    const outerRules = Array.from(
      styles.matchAll(
        /[^{}]*\.bullet-plugin-outer-list-guide[^{}]*\{([^}]*)\}/g,
      ),
      (match) => match[1] ?? "",
    ).join("\n");

    expect(outerRules).not.toMatch(/\bbackground(?:-color)?\s*:/);
    expect(outerRules).not.toMatch(/(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i);
    expect(outerRules).not.toMatch(/\btransform\s*:/);
    expect(styles).not.toContain("bullet-plugin-outer-list-guide-overlay");
  });
});

describe("GuideFoldingPluginValue guide interactions", () => {
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
          lines: 10,
          lineAt: jest.fn().mockReturnValue({ number: lineNumber + 1 }),
        },
      },
      posAtDOM: jest.fn().mockReturnValue(10),
    };
  }

  function makePluginValue(settings: unknown, parser: unknown) {
    return Object.assign(Object.create(GuideFoldingPluginValue.prototype), {
      settings,
      parser,
    }) as {
      handleMouseDown(event: MouseEvent, view: unknown): boolean;
      handleClick(event: MouseEvent, view: unknown): boolean;
    };
  }

  function makeOuterGuideTarget(
    attributes: Record<string, string> = {
      "data-actionable": "true",
      "data-chunk-start": "0",
      "data-chunk-end": "2",
    },
  ) {
    return {
      matches: jest.fn(
        (selector: string) => selector === ".bullet-plugin-outer-list-guide",
      ),
      closest: jest.fn(),
      getAttribute: jest.fn((name: string) => attributes[name] ?? null),
    };
  }

  test("maps each standard indent guide to its exact real ancestor", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: [
          "- parent",
          "    - child",
          "        - grandchild",
          "            - leaf",
          "                - twig",
        ].join("\n"),
        cursor: { line: 4, ch: 16 },
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
    const { guides } = makeGuideLine(["    ", "    ", "    ", "    "]);

    for (const guide of guides.slice(0, 3)) {
      expect(pluginValue.handleClick(makeEvent(guide).event, makeView(4))).toBe(
        true,
      );
    }

    expect(editor.setFoldedPreservingScroll).toHaveBeenNthCalledWith(
      1,
      [expect.objectContaining({ line: 1 })],
      true,
    );
    expect(editor.setFoldedPreservingScroll).toHaveBeenNthCalledWith(
      2,
      [expect.objectContaining({ line: 2 })],
      true,
    );
    expect(editor.setFoldedPreservingScroll).toHaveBeenNthCalledWith(
      3,
      [expect.objectContaining({ line: 3 })],
      true,
    );
  });

  test("uses the painted boundary when native indentation is combined", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: [
          "- parent",
          "  - child",
          "    - grandchild",
          "      - leaf",
          "        - twig",
        ].join("\n"),
        cursor: { line: 4, ch: 8 },
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
    const { guides } = makeGuideLine(["    ", "  ", "  "]);

    expect(
      pluginValue.handleClick(makeEvent(guides[0]).event, makeView(4)),
    ).toBe(true);
    expect(
      pluginValue.handleClick(makeEvent(guides[1]).event, makeView(4)),
    ).toBe(true);

    expect(editor.setFoldedPreservingScroll).toHaveBeenNthCalledWith(
      1,
      [expect.objectContaining({ line: 1 })],
      true,
    );
    expect(editor.setFoldedPreservingScroll).toHaveBeenNthCalledWith(
      2,
      [expect.objectContaining({ line: 3 })],
      true,
    );
  });

  test("ignores guide boundaries that match only shared leading indentation", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "  - parent\n      - child\n          - leaf",
        cursor: { line: 2, ch: 10 },
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
    const { guides } = makeGuideLine(["    ", "    "]);

    expect(
      pluginValue.handleClick(makeEvent(guides[0]).event, makeView(2)),
    ).toBe(false);
    expect(
      pluginValue.handleClick(makeEvent(guides[1]).event, makeView(2)),
    ).toBe(false);
    expect(editor.setFoldedPreservingScroll).not.toHaveBeenCalled();
  });

  test("ignores a guide outside a list-indent container", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n    - child\n        - leaf",
        cursor: { line: 2, ch: 8 },
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
    const { guides, indentContainer } = makeGuideLine(["    ", "    "]);
    indentContainer.matches.mockReturnValue(false);

    expect(
      pluginValue.handleClick(makeEvent(guides[0]).event, makeView(2)),
    ).toBe(false);
    expect(editor.setFoldedPreservingScroll).not.toHaveBeenCalled();
  });

  test("folds each direct non-empty child when any branch is open", () => {
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
        getAllFoldedLines: () => [1],
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
    const { guides } = makeGuideLine(["    "]);

    expect(
      pluginValue.handleClick(makeEvent(guides[0]).event, makeView(2)),
    ).toBe(true);
    expect(editor.setFoldedPreservingScroll).toHaveBeenCalledWith(
      [
        { line: 1, fallbackCursor: { line: 1, ch: 4 } },
        { line: 4, fallbackCursor: { line: 4, ch: 4 } },
      ],
      true,
    );
  });

  test("unfolds each direct non-empty child when every branch is folded", () => {
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
        getAllFoldedLines: () => [1, 4],
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
    const { guides } = makeGuideLine(["    "]);

    expect(
      pluginValue.handleClick(makeEvent(guides[0]).event, makeView(2)),
    ).toBe(true);
    expect(editor.setFoldedPreservingScroll).toHaveBeenCalledWith(
      [
        { line: 1, fallbackCursor: { line: 1, ch: 4 } },
        { line: 4, fallbackCursor: { line: 4, ch: 4 } },
      ],
      false,
    );
  });

  test("does nothing when the target has no non-empty children", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n  - leaf",
        cursor: { line: 1, ch: 2 },
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
    const { guides } = makeGuideLine(["  "]);

    expect(
      pluginValue.handleClick(makeEvent(guides[0]).event, makeView(1)),
    ).toBe(false);
    expect(editor.setFoldedPreservingScroll).not.toHaveBeenCalled();
  });

  test("returns false when no fold range can be updated", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n  - branch\n    - leaf",
        cursor: { line: 2, ch: 4 },
      }),
    });
    const editor = makeFoldEditor();
    editor.setFoldedPreservingScroll.mockReturnValue(false);
    mockGetEditorFromState.mockReturnValue(editor);
    const pluginValue = makePluginValue(
      {
        verticalLines: true,
        verticalLinesAction: "toggle-folding",
      },
      { parse: jest.fn().mockReturnValue(root) },
    );
    const { guides } = makeGuideLine(["    "]);
    const { event, preventDefault } = makeEvent(guides[0]);

    expect(pluginValue.handleClick(event, makeView(2))).toBe(false);
    expect(editor.setFoldedPreservingScroll).toHaveBeenCalledTimes(1);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  test("observes mousedown and click during capture and removes both listeners", () => {
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
    const PluginValueWithView = GuideFoldingPluginValue as unknown as new (
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
      "click",
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
    const clickListener = addEventListener.mock.calls.find(
      ([eventName]) => eventName === "click",
    )?.[1];
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
      "click",
      clickListener,
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
      selector ===
      ".cm-indent:hover, .cm-hmd-list-indent > .cm-indent-spacing:hover"
        ? hoveredGuide
        : null,
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
    const PluginValueWithView = GuideFoldingPluginValue as unknown as new (
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

  test("measures and synchronizes whole outer chunks across DOM replacement and cleanup", () => {
    type CapturedListener = (event: Event) => void;
    type HoverMeasurement = {
      indentGuides: Element[];
      outerGuides: Element[];
    };
    type Measurement = {
      read?: () => HoverMeasurement;
      write?: (measure: HoverMeasurement, view: unknown) => void;
    };
    const addEventListener = jest.fn<
      void,
      [string, CapturedListener, boolean]
    >();
    const settingsCallbacks: Array<() => void> = [];
    const settings = {
      verticalLines: true,
      outerVerticalLines: true,
      verticalLinesAction: "toggle-folding",
      onChange: jest.fn((callback: () => void) => {
        settingsCallbacks.push(callback);
      }),
      removeCallback: jest.fn(),
    };
    const makeOuterSegment = (chunkId: string, actionable = true) => {
      const attributes = { "data-actionable": String(actionable) };
      return {
        dataset: { chunkId, actionable: String(actionable) },
        classList: makeClassList(),
        matches: jest.fn(
          (selector: string) => selector === ".bullet-plugin-outer-list-guide",
        ),
        closest: jest.fn(),
        getAttribute: jest.fn(
          (name: string) => attributes[name as keyof typeof attributes] ?? null,
        ),
      };
    };
    let outerGuides = [
      makeOuterSegment("0:2"),
      makeOuterSegment("0:2"),
      makeOuterSegment("4:5"),
    ];
    let hoveredOuter: (typeof outerGuides)[number] | null = outerGuides[0];
    const querySelector = jest.fn((selector: string) => {
      if (
        selector ===
        '.bullet-plugin-outer-list-guide[data-actionable="true"]:hover'
      ) {
        return hoveredOuter;
      }
      return null;
    });
    const querySelectorAll = jest.fn((selector: string) => {
      if (selector === ".bullet-plugin-outer-list-guide") return outerGuides;
      if (selector === ".bullet-plugin-hovered-outer-list-guide") {
        return outerGuides.filter((guide) =>
          guide.classList.contains("bullet-plugin-hovered-outer-list-guide"),
        );
      }
      return [];
    });
    const contentDOM = {
      addEventListener,
      removeEventListener: jest.fn(),
      querySelector,
      querySelectorAll,
    };
    const requests: Measurement[] = [];
    const sourceEditor = makeEditor({
      text: "- parent\n    - child\n- leaf",
      cursor: { line: 0, ch: 0 },
    });
    mockGetEditorFromState.mockReturnValue(sourceEditor);
    const view = {
      contentDOM,
      state: { doc: Text.of(["- parent", "    - child", "- leaf"]) },
      dispatch: jest.fn(),
      requestMeasure: jest.fn((request: Measurement) => requests.push(request)),
    };
    const PluginValueWithView = GuideFoldingPluginValue as unknown as new (
      settings: unknown,
      parser: unknown,
      view: unknown,
    ) => {
      decorations: DecorationSet;
      destroy(): void;
      update(update: unknown): void;
    };
    const pluginValue = new PluginValueWithView(
      settings,
      new Parser(makeLogger(), makeSettings()),
      view,
    );
    const executeLatestMeasurement = () => {
      const request = requests[requests.length - 1];
      const measurement = request?.read?.();
      if (!measurement) throw new Error("Expected hover measurement");
      expect(measurement.indentGuides).toEqual([]);
      request?.write?.(measurement, view);
      return measurement;
    };

    const firstMeasurement = requests[0]?.read?.();
    expect(firstMeasurement).toEqual({
      indentGuides: [],
      outerGuides: outerGuides.slice(0, 2),
    });
    expect(
      outerGuides.some((guide) =>
        guide.classList.contains("bullet-plugin-hovered-outer-list-guide"),
      ),
    ).toBe(false);
    requests[0]?.write?.(firstMeasurement!, view);
    expect(
      outerGuides
        .slice(0, 2)
        .every((guide) =>
          guide.classList.contains("bullet-plugin-hovered-outer-list-guide"),
        ),
    ).toBe(true);

    const oldGuides = outerGuides;
    const decorationSet = pluginValue.decorations;
    outerGuides = [makeOuterSegment("0:2"), makeOuterSegment("0:2")];
    hoveredOuter = outerGuides[1]!;
    pluginValue.update({ docChanged: false });
    expect(pluginValue.decorations).toBe(decorationSet);
    expect(executeLatestMeasurement().outerGuides).toEqual(outerGuides);
    expect(
      outerGuides.every((guide) =>
        guide.classList.contains("bullet-plugin-hovered-outer-list-guide"),
      ),
    ).toBe(true);

    const pointerMove = addEventListener.mock.calls.find(
      ([eventName]) => eventName === "pointermove",
    )?.[1];
    const pointerLeave = addEventListener.mock.calls.find(
      ([eventName]) => eventName === "pointerleave",
    )?.[1];
    pointerMove?.({ target: outerGuides[0] } as unknown as Event);
    expect(requests).toHaveLength(3);
    pointerMove?.({
      target: makeOuterSegment("6:6", false),
    } as unknown as Event);
    expect(requests).toHaveLength(3);
    expect(
      outerGuides.some((guide) =>
        guide.classList.contains("bullet-plugin-hovered-outer-list-guide"),
      ),
    ).toBe(false);
    pointerLeave?.({} as Event);
    expect(
      outerGuides.some((guide) =>
        guide.classList.contains("bullet-plugin-hovered-outer-list-guide"),
      ),
    ).toBe(false);

    hoveredOuter = outerGuides[0]!;
    pluginValue.update({ docChanged: false });
    executeLatestMeasurement();
    const settingsCallback = settingsCallbacks[0];
    settings.verticalLinesAction = "none";
    settingsCallback();
    expect(
      outerGuides.some((guide) =>
        guide.classList.contains("bullet-plugin-hovered-outer-list-guide"),
      ),
    ).toBe(false);

    settings.verticalLinesAction = "toggle-folding";
    settingsCallback();
    executeLatestMeasurement();
    settings.outerVerticalLines = false;
    settingsCallback();
    expect(
      outerGuides.some((guide) =>
        guide.classList.contains("bullet-plugin-hovered-outer-list-guide"),
      ),
    ).toBe(false);

    settings.outerVerticalLines = true;
    settingsCallback();
    executeLatestMeasurement();
    pluginValue.destroy();
    expect(
      outerGuides.some((guide) =>
        guide.classList.contains("bullet-plugin-hovered-outer-list-guide"),
      ),
    ).toBe(false);
    // Detached replacements are outside contentDOM, so scoped cleanup cannot reach them.
    expect(
      oldGuides
        .slice(0, 2)
        .every((guide) =>
          guide.classList.contains("bullet-plugin-hovered-outer-list-guide"),
        ),
    ).toBe(true);
  });

  test("promotes and highlights a hovered spacing guide in one measurement", () => {
    type Measurement = {
      read?: () => unknown;
      write?: (measure: unknown, view: unknown) => void;
    };
    const editor = makeEditor({
      text: ["- parent", "    - child"].join("\n"),
      cursor: { line: 1, ch: 4 },
    });
    const root = makeRoot({ editor });
    const { guides, line } = makeGuideLine(["    "]);
    const hoveredSpacing = guides[0];
    if (!hoveredSpacing) {
      throw new Error("Expected a spacing guide");
    }
    hoveredSpacing.classList.add("cm-indent-spacing");

    const querySelector = jest.fn((selector: string) =>
      selector ===
      ".cm-indent:hover, .cm-hmd-list-indent > .cm-indent-spacing:hover"
        ? hoveredSpacing
        : null,
    );
    const querySelectorAll = jest.fn((selector: string) => {
      if (
        selector === ".cm-hmd-list-indent > .cm-indent-spacing:not(.cm-indent)"
      ) {
        return hoveredSpacing.classList.contains("cm-indent")
          ? []
          : [hoveredSpacing];
      }
      if (
        selector ===
        ".cm-hmd-list-indent > .cm-indent, .cm-hmd-list-indent > .cm-indent-spacing"
      ) {
        return [hoveredSpacing];
      }
      if (selector === ".bullet-plugin-hovered-indent-guide") {
        return hoveredSpacing.classList.contains(
          "bullet-plugin-hovered-indent-guide",
        )
          ? [hoveredSpacing]
          : [];
      }
      return [];
    });
    const requests: Measurement[] = [];
    const contentDOM = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      querySelector,
      querySelectorAll,
    };
    const view = {
      contentDOM,
      state: {
        doc: {
          lineAt: jest.fn((offset: number) => ({ number: offset + 1 })),
        },
      },
      posAtDOM: jest.fn((element: unknown) => {
        if (element !== line) {
          throw new Error("Expected the hovered guide line");
        }
        return 1;
      }),
      requestMeasure: jest.fn((request: Measurement) => {
        requests.push(request);
      }),
    };
    const settings = {
      verticalLines: true,
      verticalLinesAction: "toggle-folding",
      onChange: jest.fn(),
      removeCallback: jest.fn(),
    };
    mockGetEditorFromState.mockReturnValue(editor);
    const PluginValueWithView = GuideFoldingPluginValue as unknown as new (
      settings: unknown,
      parser: unknown,
      view: unknown,
    ) => unknown;

    new PluginValueWithView(settings, { parse: jest.fn(() => root) }, view);

    const request = requests[0];
    const measurement = request?.read?.();
    request?.write?.(measurement, view);

    expect(querySelector).toHaveBeenCalledWith(
      ".cm-indent:hover, .cm-hmd-list-indent > .cm-indent-spacing:hover",
    );
    expect(hoveredSpacing.classList.contains("cm-indent")).toBe(true);
    expect(
      hoveredSpacing.classList.contains(
        "bullet-plugin-persistent-indent-guide",
      ),
    ).toBe(true);
    expect(
      hoveredSpacing.classList.contains("bullet-plugin-hovered-indent-guide"),
    ).toBe(true);
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
      dispatch: jest.fn(),
      requestMeasure: jest.fn(
        (request: {
          key?: unknown;
          write?: (measure: unknown, view: unknown) => void;
        }) => {
          requests.push(request);
        },
      ),
    };
    const PluginValueWithView = GuideFoldingPluginValue as unknown as new (
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
    const PluginValueWithView = GuideFoldingPluginValue as unknown as new (
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

  test("toggles only the root parsed from an actionable outer widget range", () => {
    const sourceEditor = makeEditor({
      text: "- parent\n    - child\n- leaf",
      cursor: { line: 0, ch: 0 },
    });
    const root = makeRoot({ editor: sourceEditor });
    const editor = makeFoldEditor();
    mockGetEditorFromState.mockReturnValue(editor);
    const parser = {
      parse: jest.fn(),
      parseRange: jest.fn().mockReturnValue([root]),
    };
    const pluginValue = makePluginValue(
      {
        verticalLines: true,
        outerVerticalLines: true,
        verticalLinesAction: "toggle-folding",
      },
      parser,
    );
    const target = makeOuterGuideTarget();
    const { event, preventDefault } = makeEvent(target);
    const view = makeView(1);

    expect(pluginValue.handleClick(event, view)).toBe(true);
    expect(parser.parseRange).toHaveBeenCalledTimes(1);
    expect(parser.parseRange).toHaveBeenCalledWith(editor, 0, 2);
    expect(parser.parse).not.toHaveBeenCalled();
    expect(view.posAtDOM).not.toHaveBeenCalled();
    expect(editor.setFoldedPreservingScroll).toHaveBeenCalledWith(
      [{ line: 0, fallbackCursor: { line: 0, ch: 2 } }],
      true,
    );
    expect(editor.setFoldedPreservingScroll).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  test("unfolds every foldable top-level item when the current chunk is closed", () => {
    const sourceEditor = makeEditor({
      text: "- parent A\n    - child A\n- leaf\n- parent B\n    - child B",
      cursor: { line: 0, ch: 0 },
      getAllFoldedLines: () => [0, 3],
    });
    const root = makeRoot({ editor: sourceEditor });
    const editor = makeFoldEditor();
    mockGetEditorFromState.mockReturnValue(editor);
    const pluginValue = makePluginValue(
      {
        verticalLines: true,
        outerVerticalLines: true,
        verticalLinesAction: "toggle-folding",
      },
      { parseRange: jest.fn().mockReturnValue([root]) },
    );
    const { event, preventDefault } = makeEvent(
      makeOuterGuideTarget({
        "data-actionable": "true",
        "data-chunk-start": "0",
        "data-chunk-end": "4",
      }),
    );

    expect(pluginValue.handleClick(event, makeView(1))).toBe(true);
    expect(editor.setFoldedPreservingScroll).toHaveBeenCalledWith(
      [
        { line: 0, fallbackCursor: { line: 0, ch: 2 } },
        { line: 3, fallbackCursor: { line: 3, ch: 2 } },
      ],
      false,
    );
    expect(editor.setFoldedPreservingScroll).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  test("mousedown suppresses selection without toggling before click", () => {
    const sourceEditor = makeEditor({
      text: "- parent\n    - child\n- leaf",
      cursor: { line: 0, ch: 0 },
    });
    const root = makeRoot({ editor: sourceEditor });
    const editor = makeFoldEditor();
    mockGetEditorFromState.mockReturnValue(editor);
    const parser = {
      parse: jest.fn(),
      parseRange: jest.fn().mockReturnValue([root]),
    };
    const pluginValue = makePluginValue(
      {
        verticalLines: true,
        outerVerticalLines: true,
        verticalLinesAction: "toggle-folding",
      },
      parser,
    );
    const { event, preventDefault } = makeEvent(makeOuterGuideTarget());

    expect(pluginValue.handleMouseDown(event, makeView(1))).toBe(true);
    expect(parser.parseRange).toHaveBeenCalledWith(editor, 0, 2);
    expect(editor.setFoldedPreservingScroll).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  test("mousedown suppresses selection on a native guide without toggling", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n    - child\n        - leaf",
        cursor: { line: 2, ch: 8 },
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
    const { guides } = makeGuideLine(["    ", "    "]);
    const { event, preventDefault } = makeEvent(guides[0]);

    expect(pluginValue.handleMouseDown(event, makeView(2))).toBe(true);
    expect(parser.parse).toHaveBeenCalledWith(editor, { line: 2, ch: 0 });
    expect(editor.setFoldedPreservingScroll).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  test.each([
    [
      "non-actionable widget",
      { verticalLines: true, outerVerticalLines: true },
      {
        "data-actionable": "false",
        "data-chunk-start": "0",
        "data-chunk-end": "2",
      },
    ],
    [
      "malformed range",
      { verticalLines: true, outerVerticalLines: true },
      {
        "data-actionable": "true",
        "data-chunk-start": "not-a-line",
        "data-chunk-end": "2",
      },
    ],
    [
      "missing range",
      { verticalLines: true, outerVerticalLines: true },
      { "data-actionable": "true" },
    ],
    [
      "blank range",
      { verticalLines: true, outerVerticalLines: true },
      {
        "data-actionable": "true",
        "data-chunk-start": " ",
        "data-chunk-end": "2",
      },
    ],
    [
      "out-of-bounds range",
      { verticalLines: true, outerVerticalLines: true },
      {
        "data-actionable": "true",
        "data-chunk-start": "0",
        "data-chunk-end": "99",
      },
    ],
    [
      "disabled action",
      {
        verticalLines: true,
        outerVerticalLines: true,
        verticalLinesAction: "none",
      },
      undefined,
    ],
    [
      "master visibility off",
      { verticalLines: false, outerVerticalLines: true },
      undefined,
    ],
    [
      "outer visibility off",
      { verticalLines: true, outerVerticalLines: false },
      undefined,
    ],
  ])("does not consume a %s outer widget", (_name, visibility, attributes) => {
    const parser = { parse: jest.fn(), parseRange: jest.fn() };
    mockGetEditorFromState.mockReturnValue(makeFoldEditor());
    const pluginValue = makePluginValue(
      {
        verticalLinesAction: "toggle-folding",
        ...visibility,
      },
      parser,
    );
    const { event, preventDefault } = makeEvent(
      makeOuterGuideTarget(attributes),
    );

    expect(pluginValue.handleClick(event, makeView(1))).toBe(false);
    expect(parser.parseRange).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  test("does not consume an actionable outer widget when the chunk has no fold targets", () => {
    const sourceEditor = makeEditor({
      text: "- leaf A\n- leaf B",
      cursor: { line: 0, ch: 0 },
    });
    const editor = makeFoldEditor();
    mockGetEditorFromState.mockReturnValue(editor);
    const parser = {
      parseRange: jest
        .fn()
        .mockReturnValue([makeRoot({ editor: sourceEditor })]),
    };
    const pluginValue = makePluginValue(
      {
        verticalLines: true,
        outerVerticalLines: true,
        verticalLinesAction: "toggle-folding",
      },
      parser,
    );
    const { event, preventDefault } = makeEvent(
      makeOuterGuideTarget({
        "data-actionable": "true",
        "data-chunk-start": "0",
        "data-chunk-end": "1",
      }),
    );

    expect(pluginValue.handleClick(event, makeView(1))).toBe(false);
    expect(parser.parseRange).toHaveBeenCalledWith(editor, 0, 1);
    expect(editor.setFoldedPreservingScroll).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  test("does not consume an outer widget when no planned fold range can be updated", () => {
    const sourceEditor = makeEditor({
      text: "- parent\n    - child",
      cursor: { line: 0, ch: 0 },
    });
    const editor = makeFoldEditor();
    editor.setFoldedPreservingScroll.mockReturnValue(false);
    mockGetEditorFromState.mockReturnValue(editor);
    const pluginValue = makePluginValue(
      {
        verticalLines: true,
        outerVerticalLines: true,
        verticalLinesAction: "toggle-folding",
      },
      {
        parseRange: jest
          .fn()
          .mockReturnValue([makeRoot({ editor: sourceEditor })]),
      },
    );
    const { event, preventDefault } = makeEvent(
      makeOuterGuideTarget({
        "data-actionable": "true",
        "data-chunk-start": "0",
        "data-chunk-end": "1",
      }),
    );

    expect(pluginValue.handleClick(event, makeView(1))).toBe(false);
    expect(editor.setFoldedPreservingScroll).toHaveBeenCalledTimes(1);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  test("capture listeners suppress mousedown selection and toggle on click", () => {
    type CapturedListener = (event: Event) => void;
    const addEventListener = jest.fn<
      void,
      [string, CapturedListener, boolean]
    >();
    const sourceEditor = makeEditor({
      text: "- parent\n    - child",
      cursor: { line: 0, ch: 0 },
    });
    const editor = makeFoldEditor();
    mockGetEditorFromState.mockReturnValue(editor);
    const settings = {
      verticalLines: false,
      outerVerticalLines: true,
      verticalLinesAction: "toggle-folding",
      onChange: jest.fn(),
      removeCallback: jest.fn(),
    };
    const contentDOM = {
      addEventListener,
      removeEventListener: jest.fn(),
      querySelector: jest.fn().mockReturnValue(null),
      querySelectorAll: jest.fn().mockReturnValue([]),
    };
    const PluginValueWithView = GuideFoldingPluginValue as unknown as new (
      settings: unknown,
      parser: unknown,
      view: unknown,
    ) => unknown;
    const root = makeRoot({ editor: sourceEditor });
    const parseRange = jest.fn().mockReturnValue([root]);
    new PluginValueWithView(
      settings,
      { parseRange },
      {
        contentDOM,
        state: { doc: Text.of(["- parent", "    - child"]) },
        requestMeasure: jest.fn(),
      },
    );
    const mouseDownListener = addEventListener.mock.calls.find(
      ([eventName]) => eventName === "mousedown",
    )?.[1];
    const clickListener = addEventListener.mock.calls.find(
      ([eventName]) => eventName === "click",
    )?.[1];
    settings.verticalLines = true;
    const mouseDownStopPropagation = jest.fn();
    const mouseDownPreventDefault = jest.fn();
    const clickStopPropagation = jest.fn();
    const clickPreventDefault = jest.fn();
    const target = makeOuterGuideTarget({
      "data-actionable": "true",
      "data-chunk-start": "0",
      "data-chunk-end": "1",
    });

    mouseDownListener?.({
      target,
      preventDefault: mouseDownPreventDefault,
      stopPropagation: mouseDownStopPropagation,
    } as unknown as Event);
    expect(editor.setFoldedPreservingScroll).not.toHaveBeenCalled();

    clickListener?.({
      target,
      preventDefault: clickPreventDefault,
      stopPropagation: clickStopPropagation,
    } as unknown as Event);
    for (const start of ["0x1", "1e0", "+1", "1.0"]) {
      clickListener?.({
        target: makeOuterGuideTarget({
          "data-actionable": "true",
          "data-chunk-start": start,
          "data-chunk-end": "1",
        }),
        preventDefault: clickPreventDefault,
        stopPropagation: clickStopPropagation,
      } as unknown as Event);
    }
    clickListener?.({
      target: makeOuterGuideTarget({
        "data-actionable": "true",
        "data-chunk-start": "1",
        "data-chunk-end": "1",
      }),
      preventDefault: clickPreventDefault,
      stopPropagation: clickStopPropagation,
    } as unknown as Event);

    expect(parseRange).toHaveBeenCalledTimes(3);
    expect(parseRange).toHaveBeenNthCalledWith(1, editor, 0, 1);
    expect(parseRange).toHaveBeenNthCalledWith(2, editor, 0, 1);
    expect(parseRange).toHaveBeenNthCalledWith(3, editor, 1, 1);
    expect(editor.setFoldedPreservingScroll).toHaveBeenCalledTimes(1);
    expect(mouseDownPreventDefault).toHaveBeenCalledTimes(1);
    expect(mouseDownStopPropagation).toHaveBeenCalledTimes(1);
    expect(clickPreventDefault).toHaveBeenCalledTimes(1);
    expect(clickStopPropagation).toHaveBeenCalledTimes(1);
  });

  test("does not consume an outer widget when parsing returns multiple roots", () => {
    const sourceEditor = makeEditor({
      text: "- parent\n    - child",
      cursor: { line: 0, ch: 0 },
    });
    const root = makeRoot({ editor: sourceEditor });
    const editor = makeFoldEditor();
    mockGetEditorFromState.mockReturnValue(editor);
    const parser = { parseRange: jest.fn().mockReturnValue([root, root]) };
    const pluginValue = makePluginValue(
      {
        verticalLines: true,
        outerVerticalLines: true,
        verticalLinesAction: "toggle-folding",
      },
      parser,
    );
    const { event, preventDefault } = makeEvent(
      makeOuterGuideTarget({
        "data-actionable": "true",
        "data-chunk-start": "0",
        "data-chunk-end": "1",
      }),
    );

    expect(pluginValue.handleClick(event, makeView(1))).toBe(false);
    expect(editor.setFoldedPreservingScroll).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
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

    expect(pluginValue.handleClick(event, view)).toBe(true);
    expect(view.posAtDOM).toHaveBeenCalledWith(line);
    expect(parser.parse).toHaveBeenCalledWith(editor, { line: 2, ch: 0 });
    expect(editor.setFoldedPreservingScroll).toHaveBeenCalledWith(
      [
        { line: 1, fallbackCursor: { line: 1, ch: 4 } },
        { line: 4, fallbackCursor: { line: 4, ch: 4 } },
      ],
      true,
    );
    expect(editor.setFoldedPreservingScroll).toHaveBeenCalledTimes(1);
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

    expect(pluginValue.handleClick(event, view)).toBe(true);
    expect(view.posAtDOM).toHaveBeenCalledWith(line);
    expect(parser.parse).toHaveBeenCalledWith(editor, { line: 3, ch: 0 });
    expect(editor.setFoldedPreservingScroll).toHaveBeenCalledWith(
      [
        { line: 2, fallbackCursor: { line: 2, ch: 10 } },
        { line: 4, fallbackCursor: { line: 4, ch: 10 } },
      ],
      true,
    );
    expect(editor.setFoldedPreservingScroll).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  test.each([
    [{ verticalLines: false, verticalLinesAction: "toggle-folding" }],
    [{ verticalLines: true, verticalLinesAction: "none" }],
  ])("ignores guides when settings disable interaction", (settings) => {
    const pluginValue = makePluginValue(settings, { parse: jest.fn() });
    const { guides } = makeGuideLine();
    const { event, preventDefault } = makeEvent(guides[0]);

    expect(pluginValue.handleClick(event, makeView(1))).toBe(false);
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

    expect(pluginValue.handleClick(event, makeView(1))).toBe(false);
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

    expect(pluginValue.handleClick(event, makeView(1))).toBe(false);
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

    expect(pluginValue.handleClick(event, makeView(1))).toBe(false);
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

    expect(pluginValue.handleClick(event, makeView(0))).toBe(false);
    expect(editor.setFoldedPreservingScroll).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
