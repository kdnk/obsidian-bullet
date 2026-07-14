import { Text } from "@codemirror/state";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { makeEditor, makeLogger, makeSettings } from "../../__mocks__";
import { Parser } from "../../services/Parser";
import {
  OuterListGuideWidget,
  buildOuterListGuideDecorations,
  collectHoveredOuterListGuides,
  collectOuterListChunks,
  synchronizeHoveredOuterListGuides,
  toggleOuterListChunk,
} from "../OuterListGuide";

const parser = new Parser(makeLogger(), makeSettings());

function makeOuterGuide(chunkId: string, actionable = true) {
  const classes = new Set(["bullet-plugin-outer-list-guide"]);
  return {
    dataset: { chunkId, actionable: String(actionable) },
    classList: {
      add: (...classNames: string[]) =>
        classNames.forEach((className) => classes.add(className)),
      remove: (...classNames: string[]) =>
        classNames.forEach((className) => classes.delete(className)),
      contains: (className: string) => classes.has(className),
    },
  };
}

function makeOuterGuideDOM(
  guides: Array<ReturnType<typeof makeOuterGuide>>,
  hovered: ReturnType<typeof makeOuterGuide> | null,
) {
  return {
    querySelector: jest.fn().mockReturnValue(hovered),
    querySelectorAll: jest.fn((selector: string) => {
      if (selector === ".bullet-plugin-outer-list-guide") return guides;
      if (selector === ".bullet-plugin-hovered-outer-list-guide") {
        return guides.filter((guide) =>
          guide.classList.contains("bullet-plugin-hovered-outer-list-guide"),
        );
      }
      return [];
    }),
  };
}

describe("outer list guide hover helpers", () => {
  test("collects every segment in the hovered actionable chunk", () => {
    const firstChunk = Array.from({ length: 3 }, () => makeOuterGuide("0:4"));
    const secondChunk = Array.from({ length: 2 }, () => makeOuterGuide("6:8"));
    const nonActionable = makeOuterGuide("10:10", false);
    const contentDOM = makeOuterGuideDOM(
      [...firstChunk, ...secondChunk, nonActionable],
      firstChunk[1] ?? null,
    );

    expect(
      collectHoveredOuterListGuides(contentDOM as never).map(
        (element) => element.dataset.chunkId,
      ),
    ).toEqual(["0:4", "0:4", "0:4"]);
    expect(contentDOM.querySelector).toHaveBeenCalledWith(
      '.bullet-plugin-outer-list-guide[data-actionable="true"]:hover',
    );
  });

  test("ignores a non-actionable or absent hovered widget", () => {
    const nonActionable = makeOuterGuide("0:0", false);
    const contentDOM = makeOuterGuideDOM([nonActionable], nonActionable);

    expect(collectHoveredOuterListGuides(contentDOM as never)).toEqual([]);
    contentDOM.querySelector.mockReturnValue(null);
    expect(collectHoveredOuterListGuides(contentDOM as never)).toEqual([]);
  });

  test("replaces stale markers with the selected whole chunk", () => {
    const stale = makeOuterGuide("6:8");
    stale.classList.add("bullet-plugin-hovered-outer-list-guide");
    const selected = [makeOuterGuide("0:4"), makeOuterGuide("0:4")];
    const contentDOM = makeOuterGuideDOM([stale, ...selected], selected[0]);

    synchronizeHoveredOuterListGuides(contentDOM as never, selected as never);

    expect(
      stale.classList.contains("bullet-plugin-hovered-outer-list-guide"),
    ).toBe(false);
    expect(
      selected.every((guide) =>
        guide.classList.contains("bullet-plugin-hovered-outer-list-guide"),
      ),
    ).toBe(true);
  });

  test("never groups segments from a separate editor DOM root", () => {
    const firstRootGuide = makeOuterGuide("0:4");
    const secondRootGuide = makeOuterGuide("0:4");
    const firstRoot = makeOuterGuideDOM([firstRootGuide], firstRootGuide);
    makeOuterGuideDOM([secondRootGuide], secondRootGuide);

    expect(collectHoveredOuterListGuides(firstRoot as never)).toEqual([
      firstRootGuide,
    ]);
  });
});

describe("OuterListGuideWidget", () => {
  test("renders a zero-content widget with chunk metadata", () => {
    const classes = new Set<string>();
    const element = {
      set className(value: string) {
        classes.clear();
        value.split(/\s+/).forEach((className) => classes.add(className));
      },
      classList: {
        contains: (className: string) => classes.has(className),
      },
      dataset: {} as Record<string, string>,
      setAttribute: jest.fn(),
    };
    const createElement = jest.fn(() => element);
    const widget = new OuterListGuideWidget({
      id: "0:4",
      startLine: 0,
      endLine: 4,
      actionable: true,
    });

    const rendered = widget.toDOM({
      dom: { ownerDocument: { createElement } },
    } as never);

    expect(createElement).toHaveBeenCalledWith("span");
    expect(rendered.classList.contains("bullet-plugin-outer-list-guide")).toBe(
      true,
    );
    expect(rendered.dataset.chunkId).toBe("0:4");
    expect(rendered.dataset.actionable).toBe("true");
    expect(widget.ignoreEvent()).toBe(false);
  });
});

describe("outer list guide styles", () => {
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

test("builds one widget at every line start in parsed chunks", () => {
  const lines = [
    "- parent",
    "    continuation",
    "    - child",
    "",
    "# Heading",
    "- sibling",
  ];
  const text = lines.join("\n");
  const doc = Text.of(lines);
  const chunks = collectOuterListChunks(
    parser,
    makeEditor({ text, cursor: { line: 0, ch: 0 } }),
  );

  const decorations = buildOuterListGuideDecorations(doc, chunks);
  const positions: number[] = [];
  for (let cursor = decorations.iter(); cursor.value; cursor.next()) {
    positions.push(cursor.from);
  }

  expect(positions).toEqual([
    doc.line(1).from,
    doc.line(2).from,
    doc.line(3).from,
    doc.line(6).from,
  ]);
});

test.each([
  [
    "empty line",
    "- a\n    - child\n\n- b\n    - child",
    [
      [0, 1],
      [3, 4],
    ],
  ],
  [
    "spaces-only line",
    "- a\n    - child\n   \n- b\n    - child",
    [
      [0, 1],
      [3, 4],
    ],
  ],
  [
    "heading",
    "- a\n    - child\n# Heading\n- b\n    - child",
    [
      [0, 1],
      [3, 4],
    ],
  ],
  [
    "paragraph",
    "- a\n    - child\ntext\n- b\n    - child",
    [
      [0, 1],
      [3, 4],
    ],
  ],
])("splits chunks at %s", (_name, text, expected) => {
  const editor = makeEditor({ text, cursor: { line: 0, ch: 0 } });

  const chunks = collectOuterListChunks(parser, editor);

  expect(chunks.map(({ startLine, endLine }) => [startLine, endLine])).toEqual(
    expected,
  );
});

test("keeps nested bullets and indented continuation text in one chunk", () => {
  const editor = makeEditor({
    text: "- parent\n    continuation\n    - child\n        - leaf\n- sibling",
    cursor: { line: 0, ch: 0 },
  });

  const chunks = collectOuterListChunks(parser, editor);

  expect(chunks.map((chunk) => [chunk.startLine, chunk.endLine])).toEqual([
    [0, 4],
  ]);
});

test("marks leaf-only chunks as non-actionable", () => {
  const [chunk] = collectOuterListChunks(
    parser,
    makeEditor({ text: "- a\n- b", cursor: { line: 0, ch: 0 } }),
  );
  expect(chunk?.actionable).toBe(false);
});

test("marks continuation content as actionable", () => {
  const [chunk] = collectOuterListChunks(
    parser,
    makeEditor({
      text: "- parent\n    continuation\n- sibling",
      cursor: { line: 0, ch: 0 },
    }),
  );

  expect(chunk?.actionable).toBe(true);
});

test("folds every foldable top-level item and preserves leaf items", () => {
  const editor = makeEditor({
    text: "- parent A\n    - child A\n- leaf\n- parent B\n    - child B",
    cursor: { line: 0, ch: 0 },
  });
  const [chunk] = collectOuterListChunks(parser, editor);
  const foldEditor = {
    setFoldedPreservingScroll: jest.fn().mockReturnValue(true),
  };

  expect(toggleOuterListChunk(foldEditor, chunk.root)).toBe(true);
  expect(foldEditor.setFoldedPreservingScroll).toHaveBeenCalledWith(
    [
      { line: 0, fallbackCursor: { line: 0, ch: 2 } },
      { line: 3, fallbackCursor: { line: 3, ch: 2 } },
    ],
    true,
  );
  expect(foldEditor.setFoldedPreservingScroll).toHaveBeenCalledTimes(1);
});

test("unfolds all foldable top-level items when all are folded", () => {
  const editor = makeEditor({
    text: "- parent A\n    - child A\n- leaf\n- parent B\n    - child B",
    cursor: { line: 0, ch: 0 },
    getAllFoldedLines: () => [0, 3],
  });
  const [chunk] = collectOuterListChunks(parser, editor);
  const foldEditor = {
    setFoldedPreservingScroll: jest.fn().mockReturnValue(true),
  };

  expect(toggleOuterListChunk(foldEditor, chunk.root)).toBe(true);
  expect(foldEditor.setFoldedPreservingScroll).toHaveBeenCalledWith(
    [
      { line: 0, fallbackCursor: { line: 0, ch: 2 } },
      { line: 3, fallbackCursor: { line: 3, ch: 2 } },
    ],
    false,
  );
  expect(foldEditor.setFoldedPreservingScroll).toHaveBeenCalledTimes(1);
});

test("returns false when no top-level fold range can be updated", () => {
  const editor = makeEditor({
    text: "- parent A\n    - child A\n- parent B\n    - child B",
    cursor: { line: 0, ch: 0 },
  });
  const [chunk] = collectOuterListChunks(parser, editor);
  const foldEditor = {
    setFoldedPreservingScroll: jest.fn().mockReturnValue(false),
  };

  expect(toggleOuterListChunk(foldEditor, chunk.root)).toBe(false);
});
