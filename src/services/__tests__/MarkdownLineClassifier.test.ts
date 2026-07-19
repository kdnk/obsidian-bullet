import { EditorState } from "@codemirror/state";

import {
  MarkdownLineClassifier,
  MarkdownLineKind,
} from "../MarkdownLineClassifier";

function inspect(source: string, lineNumber: number) {
  const classifier = new MarkdownLineClassifier();
  const state = EditorState.create({
    doc: source,
    extensions: classifier.extension,
  });
  return classifier.inspect(state, lineNumber);
}

describe("MarkdownLineClassifier", () => {
  test.each<[string, number, MarkdownLineKind]>([
    ["", 1, "blank"],
    ["   ", 1, "blank"],
    ["plain", 1, "body"],
    ["- item", 1, "list-item"],
    ["1. item", 1, "list-item"],
    ["- item\n  continuation", 2, "list-continuation"],
    ["# heading", 1, "structure"],
    ["> quote", 1, "structure"],
    ["---", 1, "structure"],
    ["`", 1, "structure-prefix"],
    ["``", 1, "structure-prefix"],
    ["--", 1, "structure-prefix"],
  ])("classifies %p line %i as %s", (source, lineNumber, kind) => {
    expect(inspect(source, lineNumber).kind).toBe(kind);
  });

  test.each<[string, number, MarkdownLineKind]>([
    ["---\ntitle: Example\n---\nplain", 2, "structure"],
    ["---\n- list-looking value\n---", 2, "structure"],
    ["---\ntitle: Example\n---\nplain", 4, "body"],
    ["```ts\nconst answer = 42;\n```\nplain", 2, "structure"],
    ["```\n- list-looking code\n```", 2, "structure"],
    ["```ts\nconst answer = 42;\n```\nplain", 4, "body"],
    ["  orphaned indent", 1, "body"],
    ["- item\n\n  orphaned indent", 3, "body"],
    ["- item\n# heading\n  orphaned indent", 3, "body"],
  ])(
    "tracks structural boundaries in %p line %i",
    (source, lineNumber, kind) => {
      expect(inspect(source, lineNumber).kind).toBe(kind);
    },
  );

  test.each<[string, number]>([
    ["Title\n===", 2],
    ["| heading | value |", 1],
    ["<section>", 1],
    ["    indented code", 1],
  ])(
    "keeps unsupported Markdown as body in %p line %i",
    (source, lineNumber) => {
      expect(inspect(source, lineNumber).kind).toBe("body");
    },
  );

  test("reports the physical line range and text", () => {
    expect(inspect("first\n- item\nlast", 2)).toMatchObject({
      kind: "list-item",
      from: 6,
      to: 12,
      text: "- item",
    });
  });

  test("reports root empty bullet metadata", () => {
    expect(inspect("- ", 1).listItem).toMatchObject({
      prefix: "- ",
      contentStart: 2,
      isRoot: true,
      isPlainEmpty: true,
      hasOwnedFollowingLine: false,
    });
  });

  test("reports nested empty bullet metadata", () => {
    expect(inspect("- parent\n  - \n    - child", 2).listItem).toMatchObject({
      prefix: "  - ",
      contentStart: 4,
      isRoot: false,
      isPlainEmpty: true,
      hasOwnedFollowingLine: true,
    });
  });

  test.each([
    { marker: "-", contentStart: 3 },
    { marker: "*", contentStart: 3 },
    { marker: "+", contentStart: 3 },
    { marker: "12.", contentStart: 5 },
  ])(
    "reports a nested empty $marker bullet whose marker ends the line",
    ({ marker, contentStart }) => {
      expect(inspect(`- parent\n  ${marker}`, 2).listItem).toMatchObject({
        prefix: `  ${marker}`,
        contentStart,
        isRoot: false,
        isPlainEmpty: true,
        hasOwnedFollowingLine: false,
      });
    },
  );

  test("treats an indented list item without a lexical parent as root", () => {
    expect(inspect("  - ", 1).listItem).toMatchObject({
      isRoot: true,
      isPlainEmpty: true,
    });
  });

  test("treats four spaces and space-tab indentation as the same root column", () => {
    expect(inspect("    - sibling\n \t- ", 2).listItem).toMatchObject({
      isRoot: true,
    });
  });

  test("distinguishes an empty task from a plain empty bullet", () => {
    expect(inspect("- [ ] ", 1).listItem).toMatchObject({
      prefix: "- ",
      contentStart: 2,
      isRoot: true,
      isPlainEmpty: false,
      hasOwnedFollowingLine: false,
    });
  });

  test.each([
    ["- \n  continuation"],
    ["- \n  - child"],
    ["- parent\n  - \n    continuation", 2],
  ])("detects an owned following line in %p", (source, lineNumber = 1) => {
    expect(inspect(source, lineNumber).listItem).toMatchObject({
      hasOwnedFollowingLine: true,
    });
  });

  test.each([["- \n- sibling"], ["- \n\n  detached"], ["- \n# heading"]])(
    "does not claim an unowned following line in %p",
    (source) => {
      expect(inspect(source, 1).listItem).toMatchObject({
        hasOwnedFollowingLine: false,
      });
    },
  );

  test("does not own a same-column space-tab sibling", () => {
    expect(inspect("    - \n \t- sibling", 1).listItem).toMatchObject({
      hasOwnedFollowingLine: false,
    });
  });

  test("only exposes list metadata for list item lines", () => {
    expect(inspect("- item\n  continuation", 2).listItem).toBeNull();
    expect(inspect("plain", 1).listItem).toBeNull();
  });

  test("does not rescan prior root items during inspection", () => {
    const classifier = new MarkdownLineClassifier();
    const state = EditorState.create({
      doc: Array.from({ length: 1_000 }, () => "- item").join("\n"),
      extensions: classifier.extension,
    });
    const line = jest.spyOn(state.doc, "line");

    expect(classifier.inspect(state, state.doc.lines).listItem).toMatchObject({
      isRoot: true,
    });
    expect(line).toHaveBeenCalledTimes(2);
  });

  test("classifies a nested item without scanning same-level siblings", () => {
    const classifier = new MarkdownLineClassifier();
    const state = EditorState.create({
      doc: ["- root", ...Array.from({ length: 999 }, () => "  - item")].join(
        "\n",
      ),
      extensions: classifier.extension,
    });
    const line = jest.spyOn(state.doc, "line");

    expect(classifier.classify(state, state.doc.lines)).toBe("list-item");
    expect(line).toHaveBeenCalledTimes(1);
  });

  test("reuses structural blocks for an ordinary same-line edit", () => {
    const classifier = new MarkdownLineClassifier();
    let state = EditorState.create({
      doc: Array.from({ length: 1_000 }, () => "- item").join("\n"),
      extensions: classifier.extension,
    });
    const line = jest.spyOn(
      Object.getPrototypeOf(state.doc) as EditorState["doc"],
      "line",
    );

    state = state.update({
      changes: { from: state.doc.length, insert: "x" },
    }).state;

    expect(line).not.toHaveBeenCalled();
    line.mockRestore();
    expect(classifier.classify(state, state.doc.lines)).toBe("list-item");
  });

  test("rebuilds structural blocks when a fence delimiter changes", () => {
    const classifier = new MarkdownLineClassifier();
    let state = EditorState.create({
      doc: "``\ninside\n```",
      extensions: classifier.extension,
    });

    expect(classifier.inspect(state, 2).kind).toBe("body");

    state = state.update({ changes: { from: 2, insert: "`" } }).state;
    expect(classifier.inspect(state, 2).kind).toBe("structure");

    state = state.update({ changes: { from: 2, to: 3 } }).state;
    expect(classifier.inspect(state, 2).kind).toBe("body");
  });
});
