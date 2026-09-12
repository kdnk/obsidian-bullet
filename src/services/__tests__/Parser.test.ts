import { makeEditor, makeLogger, makeSettings } from "../../__mocks__";
import { LogSink, Logger } from "../Logger";
import { Parser } from "../Parser";
import { Settings } from "../Settings";

function makeParser(
  options: {
    logger?: Logger;
    settings?: Settings;
  } = {},
) {
  const { logger, settings } = {
    logger: makeLogger(),
    settings: makeSettings(),
    ...options,
  };

  return new Parser(logger, settings);
}

function makeLogSink() {
  return jest.fn<void, Parameters<LogSink>>();
}

describe("parseList", () => {
  test("should parse list with notes and sublists", () => {
    const parser = makeParser();
    const editor = makeEditor({
      text: `
- one
  side
\t- two
\t\t- three
\t\t\tnote
\t- four
`.trim(),
      cursor: { line: 0, ch: 0 },
    });

    const list = parser.parse(editor);

    expect(list).toBeDefined();
    const [one] = list!.getChildren();
    const [two, four] = one.getChildren();
    const [three] = two.getChildren();
    expect(one.getFirstLineIndent()).toBe("");
    expect(one.getBullet()).toBe("-");
    expect(one.getNotesIndent()).toBe("  ");
    expect(one.getLines()).toStrictEqual(["one", "side"]);
    expect(two.getFirstLineIndent()).toBe("\t");
    expect(two.getBullet()).toBe("-");
    expect(two.getNotesIndent()).toBeNull();
    expect(two.getLines()).toStrictEqual(["two"]);
    expect(three.getFirstLineIndent()).toBe("\t\t");
    expect(three.getBullet()).toBe("-");
    expect(three.getNotesIndent()).toBe("\t\t\t");
    expect(three.getLines()).toStrictEqual(["three", "note"]);
    expect(four.getFirstLineIndent()).toBe("\t");
    expect(four.getBullet()).toBe("-");
    expect(four.getNotesIndent()).toBeNull();
    expect(four.getLines()).toStrictEqual(["four"]);
    expect(list!.print()).toBe(
      "- one\n  side\n\t- two\n\t\t- three\n\t\t\tnote\n\t- four",
    );
  });

  test("should parse second list", () => {
    const parser = makeParser();
    const editor = makeEditor({
      text: `
- one
- two

- three
- four
`.trim(),
      cursor: { line: 3, ch: 3 },
    });

    const list = parser.parse(editor);

    expect(list).toBeDefined();
    expect(list!.print()).toBe("- three\n- four");
  });

  test("should parse root items with leading whitespace", () => {
    const parser = makeParser();
    const editor = makeEditor({
      text: " - one\n - two\n     - three",
      cursor: { line: 0, ch: 0 },
    });

    const list = parser.parse(editor);

    expect(list).toBeTruthy();
    expect(list!.print()).toBe(" - one\n - two\n     - three");
  });

  test.each([
    { marker: "-", contentStart: 3 },
    { marker: "*", contentStart: 3 },
    { marker: "+", contentStart: 3 },
    { marker: "12.", contentStart: 5 },
  ])(
    "should parse an empty $marker child whose marker ends the line",
    ({ marker, contentStart }) => {
      const parser = makeParser();
      const editor = makeEditor({
        text: `- parent\n  ${marker}`,
        cursor: { line: 1, ch: contentStart },
      });

      const root = parser.parse(editor);

      expect(root).toBeTruthy();
      const [child] = root!.getChildren()[0].getChildren();
      expect(child.getBullet()).toBe(marker);
      expect(child.getFirstLineContentStart()).toEqual({
        line: 1,
        ch: contentStart,
      });
      expect(root!.getCursor()).toEqual({ line: 1, ch: contentStart });
      expect(root!.print()).toBe(`- parent\n  ${marker}`);
    },
  );

  test("should parse mixed spaces and tabs without failing", () => {
    const log = makeLogSink();
    const logger = makeLogger(log);
    const parser = makeParser({ logger });
    const editor = makeEditor({
      text: "- one\n  - two\n\t- three",
      cursor: { line: 0, ch: 0 },
    });

    const list = parser.parse(editor);

    expect(list).toBeTruthy();
    expect(log).not.toHaveBeenCalled();
    expect(list!.print()).toBe("- one\n  - two\n\t- three");
  });

  test.each([
    { indent: "  ", extraIndent: "    " },
    { indent: "\t", extraIndent: "\t" },
    { indent: "\t", extraIndent: "  " },
  ])(
    "should preserve deeper fenced-code indentation with $indent and $extraIndent",
    ({ indent, extraIndent }) => {
      const parser = makeParser();
      const text = [
        "- code",
        `${indent}\`\`\`js`,
        `${indent}if (ready) {`,
        `${indent}${extraIndent}run();`,
        `${indent}}`,
        `${indent}\`\`\``,
        "- next",
      ].join("\n");
      const editor = makeEditor({ text, cursor: { line: 3, ch: 0 } });

      const root = parser.parse(editor);

      expect(root).toBeTruthy();
      expect(root!.getChildren()[0].getLines()).toEqual([
        "code",
        "```js",
        "if (ready) {",
        `${extraIndent}run();`,
        "}",
        "```",
      ]);
      expect(root!.print()).toBe(text);
    },
  );

  test("preserves a physical blank line at EOF inside an unclosed fence", () => {
    const parser = makeParser();
    const text = ["- parent", "\t- ```go", "\t  code", ""].join("\n");
    const editor = makeEditor({ text, cursor: { line: 3, ch: 0 } });

    const root = parser.parse(editor);

    expect(root).toBeTruthy();
    const code = root!.getChildren()[0].getChildren()[0];
    expect(code.getLines()).toEqual(["```go", "code", ""]);
    expect(code.getLastLineContentEnd()).toEqual({ line: 3, ch: 0 });
    expect(root!.print()).toBe(text);
  });

  test("does not treat a fence-looking code line as the owner of a later blank", () => {
    const parser = makeParser();
    const text = [
      "- parent",
      "\t- ~~~",
      "\t  before",
      "",
      "\t  - ```js",
      "\t    literal code",
      "",
      "\t  after",
    ].join("\n");
    const editor = makeEditor({ text, cursor: { line: 6, ch: 0 } });

    const root = parser.parse(editor);

    expect(root).toBeTruthy();
    const code = root!.getChildren()[0].getChildren()[0];
    expect(code.getLines()).toEqual([
      "~~~",
      "before",
      "",
      "- ```js",
      "  literal code",
      "",
      "after",
    ]);
    expect(root!.print()).toBe(text);
  });

  test("round-trips a fenced code block used directly as a nested list item", () => {
    const parser = makeParser();
    const text = ["- aaa", "\t- ```go", "\t  aaa", "\t  ", "\t  ```", "-"].join(
      "\n",
    );
    const editor = makeEditor({ text, cursor: { line: 2, ch: 4 } });

    const root = parser.parse(editor);

    expect(root).toBeTruthy();
    expect(root!.getChildren()[0].getChildren()[0].getLines()).toEqual([
      "```go",
      "aaa",
      "",
      "```",
    ]);
    expect(root!.print()).toBe(text);
  });

  test("treats list-looking lines inside a nested fenced code block as code", () => {
    const parser = makeParser();
    const text = [
      "- aaa",
      "\t- ```go",
      "\t  const  value = 1;  ",
      "\t  - literal list marker",
      "\t  ```",
      "\t- next",
      "- after",
    ].join("\n");
    const editor = makeEditor({ text, cursor: { line: 3, ch: 8 } });

    const root = parser.parse(editor);

    expect(root).toBeTruthy();
    const code = root!.getChildren()[0].getChildren()[0];
    expect(code.getLines()).toEqual([
      "```go",
      "const  value = 1;  ",
      "- literal list marker",
      "```",
    ]);
    expect(root!.print()).toBe(text);
  });

  test.each([
    { opening: "```go", closing: "```" },
    { opening: "~~~~go", closing: "~~~~~" },
  ])(
    "preserves extra code indentation and physical blank lines inside $opening",
    ({ opening, closing }) => {
      const parser = makeParser();
      const text = [
        "- aaa",
        `\t- ${opening}`,
        "\t    additionally indented",
        "",
        "\t  - literal list marker",
        `\t  ${closing}`,
        "\t- next",
        "- after",
      ].join("\n");
      const editor = makeEditor({ text, cursor: { line: 4, ch: 8 } });

      const root = parser.parse(editor);

      expect(root).toBeTruthy();
      const code = root!.getChildren()[0].getChildren()[0];
      expect(code.getLines()).toEqual([
        opening,
        "  additionally indented",
        "",
        "- literal list marker",
        closing,
      ]);
      expect(root!.print()).toBe(text);
    },
  );

  test("should retain equal-width mixed note indentation normalization", () => {
    const parser = makeParser();
    const editor = makeEditor({
      text: "- one\n\tnote\n    more",
      cursor: { line: 0, ch: 0 },
    });

    expect(parser.parse(editor)!.print()).toBe("- one\n\tnote\n\tmore");
  });

  test("should preserve nested code and deeper whitespace-only continuation lines", () => {
    const parser = makeParser();
    const text = [
      "- one",
      "\t- two",
      "\t  ```plain text",
      "\t  allData() -> {",
      "\t    annotations",
      "\t    ",
      "\t  }",
      "\t  ```",
    ].join("\n");
    const editor = makeEditor({ text, cursor: { line: 4, ch: 0 } });

    const root = parser.parse(editor);

    expect(root).toBeTruthy();
    expect(root!.print()).toBe(text);
    expect(root!.getChildren()[0].getChildren()[0].getLines()).toEqual([
      "two",
      "```plain text",
      "allData() -> {",
      "  annotations",
      "  ",
      "}",
      "```",
    ]);
  });

  test.each([
    { indent: "    ", nextIndent: "  " },
    { indent: "\t", nextIndent: "     " },
    { indent: "    ", nextIndent: "\t " },
  ])(
    "should reject shallower or incompatible deeper note indentation $indent to $nextIndent",
    ({ indent, nextIndent }) => {
      const parser = makeParser();
      const editor = makeEditor({
        text: `- one\n${indent}note\n${nextIndent}more`,
        cursor: { line: 0, ch: 0 },
      });

      expect(parser.parse(editor)).toBeNull();
    },
  );

  test("should error if note indent is not match", () => {
    const log = makeLogSink();
    const logger = makeLogger(log);
    const parser = makeParser({ logger });
    const editor = makeEditor({
      text: "- one\n\t- two\n  three",
      cursor: { line: 0, ch: 0 },
    });

    const list = parser.parse(editor);

    expect(list).toBeNull();
    expect(log).toHaveBeenCalledWith(
      "parseList",
      `Unable to parse list: expected some indent, got no indent`,
    );
  });

  test("should parse list with tab just after the list", () => {
    const log = makeLogSink();
    const logger = makeLogger(log);
    const parser = makeParser({ logger });
    const editor = makeEditor({
      text: "- one\n\t- two\n\t\n",
      cursor: { line: 0, ch: 0 },
    });

    const list = parser.parse(editor);

    expect(log).not.toHaveBeenCalled();
    expect(list).toBeTruthy();
  });

  test("should preserve checkbox markup information when cursor setting excludes checkbox", () => {
    const settings = makeSettings();
    settings.keepCursorWithinContent = "bullet-only";
    const parser = makeParser({ settings });
    const editor = makeEditor({
      text: "- [ ] parent\n  - child",
      cursor: { line: 0, ch: 0 },
    });

    const list = parser.parse(editor);
    const parent = list?.getRootList().getChildren()[0];

    expect(parent).toBeTruthy();
    expect(parent!.getCheckboxLength()).toBe(0);
    expect(parent!.hasCheckbox()).toBe(true);
  });
});
