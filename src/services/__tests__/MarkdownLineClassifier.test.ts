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
  test("recognizes BOM and trailing whitespace on frontmatter delimiters", () => {
    const classifier = new MarkdownLineClassifier();
    const state = EditorState.create({
      doc: "\uFEFF---  \n```\n---\t\nBody",
      extensions: classifier.extension,
    });

    expect(classifier.getCodeFence(state, 4)).toBeNull();
    expect(classifier.classify(state, 4)).toBe("body");
  });

  test("recognizes an ellipsis frontmatter closer before fenced code", () => {
    const classifier = new MarkdownLineClassifier();
    const state = EditorState.create({
      doc: "---\ntitle: Example\n...\n```js\ncode\n```",
      extensions: classifier.extension,
    });

    expect(classifier.getCodeFence(state, 5)).toEqual({
      openingLineNumber: 4,
      containerIndent: "",
    });
  });

  test.each([
    "- parent\n  ```js\n  code\n  ```\n  note",
    "- ```js\n\tcode\n  ```\n  note",
    "- parent\n\t~~~js\n\tcode\n\t~~~\n\tnote",
  ])("retains the list owner after a fence in %p", (source) => {
    expect(inspect(source, source.split("\n").length).kind).toBe(
      "list-continuation",
    );
  });

  test("retains a child item's parent after a fenced continuation", () => {
    expect(
      inspect("- parent\n  ```js\n  code\n  ```\n  - ", 5).listItem?.isRoot,
    ).toBe(false);
  });

  test.each([
    "- \n  ```js\n  code\n  ```",
    "- \n\t~~~js\n\tcode\n\t~~~",
    "- \n\n  ```js\n  code\n  ```",
  ])("recognizes fenced content owned by an empty parent in %p", (source) => {
    expect(inspect(source, 1).listItem?.hasOwnedFollowingLine).toBe(true);
  });

  test.each([
    "- parent\n```js\ncode\n```\n  note",
    "- parent\n  ```js\n  code\n  ```\nplain\n  note",
    "- parent\n  ```js\n  code\n  ```\n\n  note",
  ])("does not cross an unowned boundary in %p", (source) => {
    expect(inspect(source, source.split("\n").length).kind).toBe("body");
  });

  test.each([
    "- \n- ```js\n  code\n  ```",
    "- \n\n- ```js\n  code\n  ```",
    "  - \n  - ```js\n    code\n    ```",
  ])("does not claim a sibling's attached fence in %p", (source) => {
    expect(inspect(source, 1).listItem?.hasOwnedFollowingLine).toBe(false);
  });

  test("recognizes blank-separated fenced ownership without its extension", () => {
    const classifier = new MarkdownLineClassifier();
    const state = EditorState.create({ doc: "- \n\n  ```js\n  code\n  ```" });
    expect(classifier.inspect(state, 1).listItem?.hasOwnedFollowingLine).toBe(
      true,
    );
  });

  test.each<[string, number, MarkdownLineKind]>([
    ["", 1, "blank"],
    ["   ", 1, "blank"],
    ["plain", 1, "body"],
    ["- item", 1, "list-item"],
    ["1. item", 1, "list-item"],
    ["- item\n  continuation", 2, "list-continuation"],
    [
      "- parent\n    - child\n      \n      continuation\n    - sibling",
      4,
      "list-continuation",
    ],
    ["# heading", 1, "structure"],
    ["> quote", 1, "structure"],
    ["---", 1, "structure"],
    ["***", 1, "structure"],
    ["___", 1, "structure"],
    ["* * *", 1, "structure"],
    ["  _ _ _\t", 1, "structure"],
    ["**", 1, "body"],
    ["__", 1, "body"],
    ["*-*", 1, "body"],
    ["* item", 1, "list-item"],
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

describe("code fence ownership", () => {
  test.each([false, true])(
    "queries the semantic fence with cached index %s",
    (cached) => {
      const classifier = new MarkdownLineClassifier();
      for (const { doc, opening, closing, prefix } of [
        {
          doc: "- ```js\n\n  ```\n- after",
          opening: 1,
          closing: 3,
          prefix: "  ",
        },
        {
          doc: "- item\n  ```js\n\tcode\n  ```\n- after",
          opening: 2,
          closing: 4,
          prefix: "  ",
        },
        {
          doc: "- [ ] item\n  ```js\n\n  ```\n- after",
          opening: 2,
          closing: 4,
          prefix: "  ",
        },
        { doc: "```js\ncode\n```\nafter", opening: 1, closing: 3, prefix: "" },
        { doc: "- ```js\n- after", opening: 1, closing: 1, prefix: "  " },
      ]) {
        const state = EditorState.create({
          doc,
          extensions: cached ? classifier.extension : [],
        });
        for (let line = opening; line <= closing; line++) {
          expect(classifier.getCodeFence(state, line)).toEqual({
            openingLineNumber: opening,
            containerIndent: prefix,
          });
        }
        expect(classifier.getCodeFence(state, closing + 1)).toBeNull();
        expect(classifier.classify(state, opening)).toBe(
          doc.startsWith("- ```") ? "list-item" : "structure",
        );
      }
    },
  );
});

test("queries distant fences and refreshes ownership after source changes without an installed field", () => {
  const classifier = new MarkdownLineClassifier();
  const state = EditorState.create({
    doc: "- ```js\n  one\n  ```\n- other\n  ```ts\n  two\n  ```",
  });
  expect(classifier.getCodeFence(state, 2)).toEqual({
    openingLineNumber: 1,
    containerIndent: "  ",
  });
  expect(classifier.getCodeFence(state, 6)).toEqual({
    openingLineNumber: 5,
    containerIndent: "  ",
  });
  const changed = state.update({
    changes: {
      from: state.doc.line(5).from,
      to: state.doc.line(5).to,
      insert: "  prose",
    },
  }).state;
  expect(classifier.getCodeFence(changed, 6)).toBeNull();
  expect(classifier.getCodeFence(changed, 2)).toEqual({
    openingLineNumber: 1,
    containerIndent: "  ",
  });
});

describe("pipe tables", () => {
  test.each([
    "| Name | Value |\n| --- | --- |\n| Sample | abc |",
    "Name | Value\n:--- | ---:\nSample | abc",
    "| Name | Value\n| :---: | ---\n| Sample | abc",
    "Name | Value |\n--- | --- |\nSample | abc |",
    "| Name |\n| --- |\n| Sample |",
    "Name \\| literal | Value\n--- | ---\nSample \\| text | abc",
    "Name \\\\| Value\n--- | ---\nSample | abc",
  ])("preserves every row of %p", (doc) => {
    const classifier = new MarkdownLineClassifier();
    for (const extensions of [[], classifier.extension]) {
      const state = EditorState.create({ doc, extensions });
      expect([1, 2, 3].map((line) => classifier.classify(state, line))).toEqual(
        ["structure", "structure", "structure"],
      );
      expect(classifier.getCodeFence(state, 2)).toBeNull();
    }
  });

  test.each([
    "Name | Value\nnot a delimiter\nSample | abc",
    "Name | Value\n--- | --- | ---\nSample | abc",
    "Name \\| Value\n--- | ---\nSample | abc",
    "| Name | Value |\n| --- | invalid |\n| Sample | abc |",
    "    Name | Value\n    --- | ---\n    Sample | abc",
  ])("does not infer a table from %p", (doc) => {
    expect(inspect(doc, 1).kind).toBe("body");
    expect(inspect(doc, 3).kind).toBe("body");
  });

  test.each([
    ["", "blank"],
    ["# heading", "structure"],
    ["- sibling", "list-item"],
    ["```js", "structure"],
  ] as const)("ends before %p", (boundary, kind) => {
    const doc =
      "| Name | Value |\n| --- | --- |\n| Sample | abc |\n" + boundary;
    expect(inspect(doc, 3).kind).toBe("structure");
    expect(inspect(doc, 4).kind).toBe(kind);
  });

  test.each([
    "- parent\n\t| Name | Value |\n\t| --- | --- |\n\t| Sample | abc |\n\tnote",
    "- | Name | Value |\n  | --- | --- |\n  | Sample | abc |\n  note",
  ])("retains a nested table's list owner in %p", (doc) => {
    const lines = doc.split("\n");
    expect(inspect(doc, lines.length - 1).kind).toBe("structure");
    expect(inspect(doc, lines.length).kind).toBe("list-continuation");
    expect(inspect(doc, 1).kind).toBe("list-item");
  });

  test("does not interpret table rows inside fenced code as table boundaries", () => {
    const doc = "```\n| H | V |\n| --- | --- |\n```\nplain";
    expect(inspect(doc, 3).kind).toBe("structure");
    expect(inspect(doc, 5).kind).toBe("body");
  });

  test.each([
    {
      before: "- parent\n\tH | V\n\t--- | ---\n\tA | B",
      line: 2,
      replacement: "\tH | V | X",
      target: 4,
      beforeKind: "structure",
      afterKind: "list-continuation",
    },
    {
      before: "H | V\n--- | ---\nA | B\nC | D",
      line: 3,
      replacement: "A \\| B",
      target: 4,
      beforeKind: "structure",
      afterKind: "body",
    },
    {
      before: "H | V\n--- | invalid\nA | B",
      line: 2,
      replacement: "--- | ---",
      target: 3,
      beforeKind: "body",
      afterKind: "structure",
    },
    {
      before: "H | V\n--- | ---\nA | B",
      line: 2,
      replacement: "--- | invalid",
      target: 3,
      beforeKind: "structure",
      afterKind: "body",
    },
    {
      before: "H | V\n--- | ---\nA | B",
      line: 1,
      replacement: "H | V | X",
      target: 3,
      beforeKind: "structure",
      afterKind: "body",
    },
    {
      before: "H | V\n--- | ---\nA | B\n\nC | D",
      line: 4,
      replacement: "E | F",
      target: 5,
      beforeKind: "body",
      afterKind: "structure",
    },
  ])(
    "refreshes table membership after editing line $line",
    ({ before, line, replacement, target, beforeKind, afterKind }) => {
      const classifier = new MarkdownLineClassifier();
      let state = EditorState.create({
        doc: before,
        extensions: classifier.extension,
      });
      expect(classifier.classify(state, target)).toBe(beforeKind);
      const changed = state.doc.line(line);
      state = state.update({
        changes: { from: changed.from, to: changed.to, insert: replacement },
      }).state;
      expect(classifier.classify(state, target)).toBe(afterKind);
    },
  );
});

test("reuses table ranges during ordinary cell typing", () => {
  const classifier = new MarkdownLineClassifier();
  let state = EditorState.create({
    doc: "H | V\n--- | ---\nA | B",
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
  expect(classifier.classify(state, 3)).toBe("structure");
  expect(state.doc.toString()).toBe("H | V\n--- | ---\nA | Bx");
});

test.each(["#", "-", "*"])(
  "refreshes attached table membership when its header changes to and from %p syntax",
  (marker) => {
    const classifier = new MarkdownLineClassifier();
    let state = EditorState.create({
      doc: "- | h | a |\n  | --- | --- |\n  | x | y |",
      extensions: classifier.extension,
    });
    expect(classifier.classify(state, 3)).toBe("structure");
    state = state.update({ changes: { from: 2, to: 3, insert: marker } }).state;
    expect(classifier.classify(state, 3)).toBe("list-continuation");
    state = state.update({ changes: { from: 2, to: 3, insert: "|" } }).state;
    expect(classifier.classify(state, 3)).toBe("structure");
  },
);
