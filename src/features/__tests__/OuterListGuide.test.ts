import { Text } from "@codemirror/state";

import { makeEditor, makeLogger, makeSettings } from "../../__mocks__";
import { Parser } from "../../services/Parser";
import {
  OuterListGuideWidget,
  buildOuterListGuideDecorations,
  collectOuterListChunks,
  toggleOuterListChunk,
} from "../OuterListGuide";

const parser = new Parser(makeLogger(), makeSettings());

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
    foldEnsuringCursorVisible: jest.fn<
      void,
      [number, { line: number; ch: number }]
    >(),
    unfold: jest.fn<void, [number]>(),
  };

  expect(toggleOuterListChunk(foldEditor, chunk.root)).toBe(true);
  expect(foldEditor.foldEnsuringCursorVisible).toHaveBeenCalledTimes(2);
  expect(
    foldEditor.foldEnsuringCursorVisible.mock.calls.map(([line]) => line),
  ).toEqual([0, 3]);
});

test("unfolds all foldable top-level items when all are folded", () => {
  const editor = makeEditor({
    text: "- parent A\n    - child A\n- leaf\n- parent B\n    - child B",
    cursor: { line: 0, ch: 0 },
    getAllFoldedLines: () => [0, 3],
  });
  const [chunk] = collectOuterListChunks(parser, editor);
  const foldEditor = {
    foldEnsuringCursorVisible: jest.fn<
      void,
      [number, { line: number; ch: number }]
    >(),
    unfold: jest.fn<void, [number]>(),
  };

  expect(toggleOuterListChunk(foldEditor, chunk.root)).toBe(true);
  expect(foldEditor.unfold.mock.calls.map(([line]) => line)).toEqual([0, 3]);
  expect(foldEditor.foldEnsuringCursorVisible).not.toHaveBeenCalled();
});
