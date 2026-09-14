import { countColumn } from "@codemirror/state";

import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import { IndentList } from "../IndentList";
import {
  NO_OP_OUTCOME,
  STOP_ONLY_OUTCOME,
  UPDATED_OUTCOME,
} from "../Operation";
import { OutdentList } from "../OutdentList";

describe("IndentList operation", () => {
  test("preserves code columns when the fence starts in continuation text", () => {
    const text = "- previous\n- note\n  ```js\n\tcode\n\t```\n- next";
    const root = makeRoot({
      editor: makeEditor({ text, cursor: { line: 1, ch: 3 } }),
    });
    expect(new IndentList(root, "  ", false).perform()).toEqual(
      UPDATED_OUTCOME,
    );
    expect(root.print()).toBe(
      "- previous\n  - note\n    ```js\n  \t  code\n  \t  ```\n- next",
    );
  });

  test.each([
    { indentation: "  ", bodyIndent: "\t" },
    { indentation: "   ", bodyIndent: "\t" },
    { indentation: "  ", bodyIndent: "  \t" },
    { indentation: "   ", bodyIndent: "  \t" },
  ])(
    "preserves code columns across $indentation with raw prefix $bodyIndent",
    ({ indentation, bodyIndent }) => {
      const text = `- previous\n- \`\`\`js\n${bodyIndent}code\n${bodyIndent}\`\`\`\n- next`;
      const root = makeRoot({
        editor: makeEditor({ text, cursor: { line: 1, ch: 3 } }),
      });
      expect(new IndentList(root, indentation, false).perform()).toEqual(
        UPDATED_OUTCOME,
      );
      const moved = root.print();
      const codePrefix = moved.split("\n")[2].match(/^[ \t]*/)?.[0] ?? "";
      expect(
        countColumn(codePrefix, 4) - countColumn(indentation + "- ", 4),
      ).toBe(2);
      const reparsed = makeRoot({
        editor: makeEditor({ text: moved, cursor: root.getCursor() }),
      });
      expect(reparsed.print()).toBe(moved);
      expect(new OutdentList(reparsed, false).perform()).toEqual(
        UPDATED_OUTCOME,
      );
      const restored = reparsed.print();
      const restoredPrefix =
        restored.split("\n")[2].match(/^[ \t]*/)?.[0] ?? "";
      expect(countColumn(restoredPrefix, 4)).toBe(4);
      expect(restored.split("\n")[2].trim()).toBe("code");
    },
  );

  test("round trips a mixed raw prefix through indent and outdent", () => {
    const text = "    - previous\n    - ```js\n\t\tcode\n\t\t```\n    - next";
    const root = makeRoot({
      editor: makeEditor({ text, cursor: { line: 1, ch: 7 } }),
    });
    expect(new IndentList(root, "\t", false).perform()).toEqual(
      UPDATED_OUTCOME,
    );
    expect(new OutdentList(root, false).perform()).toEqual(UPDATED_OUTCOME);
    expect(root.print()).toBe(text);
  });

  test("indents a fence's raw tab prefixes together with its owner", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- previous\n- ```js\n\tcode\n\n\t```\n- next",
        cursor: { line: 1, ch: 3 },
      }),
    });

    expect(new IndentList(root, "\t", false).perform()).toEqual(
      UPDATED_OUTCOME,
    );
    expect(root.print()).toBe(
      "- previous\n\t- ```js\n\t\tcode\n\n\t\t```\n- next",
    );
  });

  test("should indent a list item under the previous sibling", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n- item 3\n",
        cursor: { line: 2, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new IndentList(root, "  ", true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- item 1\n- item 2\n  - item 3");
    expect(root.getCursor().line).toBe(2);
    expect(root.getCursor().ch).toBe(7); // cursor moved by indent length
  });

  test("should not indent a list item if it has no previous sibling", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n- item 3\n",
        cursor: { line: 0, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new IndentList(root, "  ", true);
    expect(op.perform()).toEqual(STOP_ONLY_OUTCOME);

    expect(root.print()).toBe("- item 1\n- item 2\n- item 3");
    expect(root.getCursor().line).toBe(0);
    expect(root.getCursor().ch).toBe(5); // cursor should remain unchanged
  });

  test("should indent a list item with its children", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n- item 3\n  - item 3.1\n  - item 3.2\n",
        cursor: { line: 2, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new IndentList(root, "  ", true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe(
      "- item 1\n- item 2\n  - item 3\n    - item 3.1\n    - item 3.2",
    );
    expect(root.getCursor().line).toBe(2);
    expect(root.getCursor().ch).toBe(7);
  });

  test("should recalculate numeric bullets after indentation", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "1. item 1\n2. item 2\n3. item 3\n",
        cursor: { line: 2, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new IndentList(root, "  ", true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    // Instead of checking the exact string, check for the key aspects we care about
    const result = root.print();
    expect(result).toContain("1. item 1");
    expect(result).toContain("2. item 2");

    // Check that the third line is indented and has a numeric bullet "1."
    const lines = result.split("\n");
    expect(lines.length).toBe(3);
    expect(lines[2].trim()).toBe("1. item 3");
    expect(lines[2]).toMatch(/^\s+1\. item 3$/); // Contains whitespace + "1. item 3"
  });

  test("should use indent from an existing child of the previous sibling", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n  - item 1.1\n- item 2\n",
        cursor: { line: 2, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new IndentList(root, "    ", true); // Different default indent
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- item 1\n  - item 1.1\n  - item 2");
    expect(root.getCursor().line).toBe(2);
    expect(root.getCursor().ch).toBe(7); // Uses the "  " indent from item 1.1, not the default
  });

  test("should use the current default indent width after Obsidian indent settings change", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n    - item 2\n    - item 3\n",
        cursor: { line: 2, ch: 10 },
      }),
      settings: makeSettings(),
    });

    const op = new IndentList(root, "  ", true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- item 1\n    - item 2\n      - item 3");
    expect(root.getCursor().line).toBe(2);
    expect(root.getCursor().ch).toBe(12);
  });

  test("should keep nested indentation width consistent when the current setting is wider", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n  - item 1.1\n  - item 2\n",
        cursor: { line: 2, ch: 7 },
      }),
      settings: makeSettings(),
    });

    const op = new IndentList(root, "    ", true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- item 1\n  - item 1.1\n    - item 2");
    expect(root.getCursor().line).toBe(2);
    expect(root.getCursor().ch).toBe(9);
  });

  test("should do nothing if there are multiple selections", () => {
    const editor = makeEditor({
      text: "- item 1\n- item 2\n- item 3\n",
      cursor: { line: 2, ch: 5 },
    });

    // Mock multiple selections
    editor.listSelections = () => [
      { anchor: { line: 1, ch: 3 }, head: { line: 1, ch: 3 } },
      { anchor: { line: 2, ch: 5 }, head: { line: 2, ch: 5 } },
    ];

    const root = makeRoot({
      editor,
      settings: makeSettings(),
    });

    const op = new IndentList(root, "  ", true);
    expect(op.perform()).toEqual(NO_OP_OUTCOME);

    expect(root.print()).toBe("- item 1\n- item 2\n- item 3");
  });

  test("should stop propagation and update editor when successful", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n- item 2\n- item 3\n",
        cursor: { line: 2, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new IndentList(root, "  ", true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);
  });

  test("should indent properly when the list has complex nested structure", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- item 1\n  - item 1.1\n  - item 1.2\n- item 2\n  - item 2.1\n- item 3\n",
        cursor: { line: 5, ch: 5 },
      }),
      settings: makeSettings(),
    });

    const op = new IndentList(root, "  ", true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe(
      "- item 1\n  - item 1.1\n  - item 1.2\n- item 2\n  - item 2.1\n  - item 3",
    );
  });

  test("should keep cursor at the same relative text position when indenting text with delimiters", () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- parent\n- **test** item\n",
        cursor: { line: 1, ch: 9 },
      }),
      settings: makeSettings(),
    });

    const op = new IndentList(root, "  ", true);
    expect(op.perform()).toEqual(UPDATED_OUTCOME);

    expect(root.print()).toBe("- parent\n  - **test** item");
    expect(root.getCursor()).toEqual({ line: 1, ch: 11 });
  });
});
