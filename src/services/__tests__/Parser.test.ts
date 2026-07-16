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
