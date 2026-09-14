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

  test.each([
    {
      source: "- ```ts\n  - literal\n\n  ```\n- sibling",
      kinds: ["list-item", "structure", "structure", "structure", "list-item"],
    },
    {
      source: "- parent\n\t- ```ts\n\t\t-\n \n\t\t```\n\t- sibling",
      kinds: [
        "list-item",
        "list-item",
        "structure",
        "structure",
        "structure",
        "list-item",
      ],
    },
    {
      source: "- parent\n\t```ts\n\t- literal\n\n\t```\n- sibling",
      kinds: [
        "list-item",
        "structure",
        "structure",
        "structure",
        "structure",
        "list-item",
      ],
    },
    {
      source: "- parent\n  - child\n  ~~~\n  - literal\n  ~~~\n- sibling",
      kinds: [
        "list-item",
        "list-item",
        "structure",
        "structure",
        "structure",
        "list-item",
      ],
    },
    {
      source: "12. ~~~~text\n\t~~~\n\t```\n\t- literal\n\t~~~~~\nplain",
      kinds: [
        "list-item",
        "structure",
        "structure",
        "structure",
        "structure",
        "body",
      ],
    },
    {
      source: "~~~text\n- literal\n\n~~~~\nplain",
      kinds: ["structure", "structure", "structure", "structure", "body"],
    },
    {
      source: "- ```\n\n- sibling\nplain",
      kinds: ["list-item", "structure", "list-item", "body"],
    },
    {
      source: "- owner\n\t```\n\t- literal\nplain\n- sibling",
      kinds: ["list-item", "structure", "structure", "body", "list-item"],
    },
    {
      source: "- owner\n\t```\n - dedented sibling",
      kinds: ["list-item", "structure", "list-item"],
    },
    {
      source: "plain\n\t```\n\t- item",
      kinds: ["body", "body", "list-item"],
    },
  ])(
    "tracks list and tilde fence boundaries in $source",
    ({ source, kinds }) => {
      const classifier = new MarkdownLineClassifier();
      for (const extensions of [[], classifier.extension]) {
        const state = EditorState.create({ doc: source, extensions });
        expect(
          kinds.map((_, index) => classifier.classify(state, index + 1)),
        ).toEqual(kinds);
      }
    },
  );

  test.each([
    {
      source: "- owner\n ```js\n- literal\n ```\nplain",
      kinds: ["list-item", "structure", "structure", "structure", "body"],
    },
    {
      source: "10. owner\n   ```js\n- literal\n   ```\nplain",
      kinds: ["list-item", "structure", "structure", "structure", "body"],
    },
    {
      source: "- owner\n\n\t```js\n\t- literal\n\t```\n- sibling",
      kinds: [
        "list-item",
        "blank",
        "structure",
        "structure",
        "structure",
        "list-item",
      ],
    },
    {
      source: "- owner\n   ```js\n  - literal\n  ```\n- sibling",
      kinds: ["list-item", "structure", "structure", "structure", "list-item"],
    },
    {
      source: "- owner\n\t```js\n  - literal\n  ```\n- sibling",
      kinds: ["list-item", "structure", "structure", "structure", "list-item"],
    },
    {
      source: "10. owner\n     ```js\n\t- literal\n\t```\n- sibling",
      kinds: ["list-item", "structure", "structure", "structure", "list-item"],
    },
  ])(
    "uses the list content column for fences in $source",
    ({ source, kinds }) => {
      const classifier = new MarkdownLineClassifier();
      const state = EditorState.create({
        doc: source,
        extensions: classifier.extension,
      });
      expect(
        kinds.map((_, index) => classifier.classify(state, index + 1)),
      ).toEqual(kinds);
    },
  );

  test("preserves list metadata for a fence attached to a nested marker", () => {
    expect(
      inspect("- parent\n\t- ```\n\t\t- literal\n\t\t```", 2),
    ).toMatchObject({
      kind: "list-item",
      listItem: {
        prefix: "\t- ",
        contentStart: 3,
        isRoot: false,
        isPlainEmpty: false,
      },
    });
  });

  test.each([
    {
      before: "- owner\n\t``\n\t- literal",
      line: 2,
      text: "\t```",
      target: 3,
      beforeKind: "list-item",
      afterKind: "structure",
    },
    {
      before: "- ~~~\n  - literal",
      line: 1,
      text: "- ~~",
      target: 2,
      beforeKind: "structure",
      afterKind: "list-item",
    },
    {
      before: "owner\n\t```\n\t- literal",
      line: 1,
      text: "- owner",
      target: 3,
      beforeKind: "list-item",
      afterKind: "structure",
    },
    {
      before: "- owner\n\t```\n\t- literal",
      line: 1,
      text: "owner",
      target: 3,
      beforeKind: "structure",
      afterKind: "list-item",
    },
    {
      before: "- owner\n\t```\n\t- literal",
      line: 1,
      text: "\t- owner",
      target: 3,
      beforeKind: "structure",
      afterKind: "list-item",
    },
    {
      before: "- ```\n  code\n  - literal",
      line: 2,
      text: "code",
      target: 3,
      beforeKind: "structure",
      afterKind: "list-item",
    },
    {
      before: "- ```\n\n  - literal",
      line: 2,
      text: "code",
      target: 3,
      beforeKind: "structure",
      afterKind: "list-item",
    },
    {
      before: "- ```\n  ``\n  - literal",
      line: 2,
      text: "  ```",
      target: 3,
      beforeKind: "structure",
      afterKind: "list-item",
    },
  ])(
    "rebuilds fence ownership after replacing line $line of $before",
    ({ before, line, text, target, beforeKind, afterKind }) => {
      const classifier = new MarkdownLineClassifier();
      let state = EditorState.create({
        doc: before,
        extensions: classifier.extension,
      });
      expect(classifier.classify(state, target)).toBe(beforeKind);
      const changedLine = state.doc.line(line);
      state = state.update({
        changes: { from: changedLine.from, to: changedLine.to, insert: text },
      }).state;
      expect(classifier.classify(state, target)).toBe(afterKind);
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
