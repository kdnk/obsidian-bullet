import { Plugin, editorEditorField } from "obsidian";

import { history, insertNewline, redo, undo } from "@codemirror/commands";
import {
  Annotation,
  EditorSelection,
  EditorState,
  Extension,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";

import { makeLogger } from "../../__mocks__";
import { KeepCursorWithinContent, Settings } from "../../services/Settings";
import { BulletTypingGuard } from "../BulletTypingGuard";

jest.mock(
  "obsidian",
  () => {
    const { StateField } =
      jest.requireActual<typeof import("@codemirror/state")>(
        "@codemirror/state",
      );
    return {
      editorEditorField: StateField.define({
        create: () => null,
        update: (value: null) => value,
      }),
    };
  },
  { virtual: true },
);

interface GuardOptions {
  keepBodyTextInBullets?: boolean;
  keepCursorWithinContent?: KeepCursorWithinContent;
}

async function loadGuard(options: GuardOptions = {}) {
  const registerEditorExtension = jest.fn<void, [Extension]>();
  const plugin = {
    app: { workspace: { updateOptions: jest.fn() } },
    registerEditorExtension,
  } as unknown as Plugin;
  const settings = {
    keepBodyTextInBullets: true,
    keepCursorWithinContent: "bullet-and-checkbox",
    onChange: jest.fn(),
    removeCallback: jest.fn(),
    ...options,
  } as unknown as Settings;
  const feature = new BulletTypingGuard(plugin, settings, makeLogger());

  await feature.load();

  expect(registerEditorExtension).toHaveBeenCalledTimes(1);
  const extension = registerEditorExtension.mock.calls[0]?.[0];
  if (!extension) {
    throw new Error("BulletTypingGuard did not register an editor extension");
  }

  return extension;
}

function captureInputTransaction() {
  let transaction: Transaction | null = null;
  const extension = EditorState.transactionFilter.of((candidate) => {
    transaction = candidate;
    return candidate;
  });

  return {
    extension,
    get transaction() {
      return transaction;
    },
  };
}

describe("BulletTypingGuard", () => {
  test.each([
    { name: "empty document", doc: "", from: 0 },
    { name: "blank code row", doc: "- ```\n\n  ```", from: 6 },
  ])(
    "preserves native provisional composition in $name",
    async ({ doc, from }) => {
      const guard = await loadGuard();
      let state = EditorState.create({
        doc,
        selection: { anchor: from },
        extensions: guard,
      });
      let previousLength = 0;
      for (const text of ["に", "日本", "日本語"]) {
        state = state.update({
          changes: { from, to: from + previousLength, insert: text },
          selection: { anchor: from + text.length },
          userEvent:
            previousLength === 0
              ? "input.type.compose.start"
              : "input.type.compose",
        }).state;
        expect(state.doc.toString()).toBe(
          doc.slice(0, from) + text + doc.slice(from),
        );
        expect(state.selection.main.head).toBe(from + text.length);
        previousLength = text.length;
      }
    },
  );

  test.each(["abc", "", "- literal"])(
    "leaves embedded table input unchanged in %p",
    async (doc) => {
      const guard = await loadGuard();
      const state = EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [
          guard,
          editorEditorField.init(
            () =>
              ({
                dom: {
                  closest: (selector: string) =>
                    selector === ".table-cell-wrapper" ? {} : null,
                },
              }) as unknown as import("@codemirror/view").EditorView,
          ),
        ],
      });
      const typed = state.update({
        ...state.replaceSelection("X"),
        userEvent: "input.type",
      }).state;
      expect(typed.doc.toString()).toBe(doc + "X");
      expect(typed.selection.main.head).toBe(doc.length + 1);
      const deleted = typed.update({
        changes: { from: doc.length, to: doc.length + 1 },
        userEvent: "delete.backward",
      }).state;
      expect(deleted.doc.toString()).toBe(doc);
    },
  );

  describe.each(["", "- "])("incremental Markdown input from %p", (doc) => {
    test.each([
      "~~~js",
      "~~~~ python",
      "***",
      "**** ",
      "___",
      "____ ",
      "* * *",
      "_ _ _",
      "*\t*\t*",
    ])("keeps %p as a root structure", async (input) => {
      const guard = await loadGuard();
      let state = EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: guard,
      });
      for (const character of input) {
        state = state.update({
          ...state.replaceSelection(character),
          userEvent: "input.type",
        }).state;
      }
      expect(state.doc.toString()).toBe(input);
      expect(state.selection.main.head).toBe(input.length);
    });

    test.each(["*word*", "**word**", "_word_", "__word__", "~~word~~"])(
      "keeps inline formatting %p in a bullet",
      async (input) => {
        const guard = await loadGuard();
        let state = EditorState.create({
          doc,
          selection: { anchor: doc.length },
          extensions: guard,
        });
        for (const character of input) {
          state = state.update({
            ...state.replaceSelection(character),
            userEvent: "input.type",
          }).state;
        }
        expect(state.doc.toString()).toBe("- " + input);
        expect(state.selection.main.head).toBe(input.length + 2);
      },
    );
  });

  test.each([
    { doc: "- existing ", input: "***" },
    { doc: "- existing ", input: "___" },
    { doc: "- existing ", input: "~~~" },
    { doc: "- parent\n\t- ", input: "***" },
    { doc: "- parent\n\t- ", input: "___" },
    { doc: "- parent\n\t- ", input: "~~~js" },
    { doc: "- [ ] ", input: "***" },
    { doc: "```\n- ", input: "***" },
    { doc: "```\n- ", input: "___" },
    { doc: "```\n- ", input: "~~~js" },
    { doc: "- ~~~", input: "~" },
    { doc: "- ***", input: " " },
  ])(
    "preserves the container when typing $input in $doc",
    async ({ doc, input }) => {
      const guard = await loadGuard();
      let state = EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: guard,
      });
      for (const character of input) {
        state = state.update({
          ...state.replaceSelection(character),
          userEvent: "input.type",
        }).state;
      }
      expect(state.doc.toString()).toBe(doc + input);
      expect(state.selection.main.head).toBe(doc.length + input.length);
    },
  );

  test.each(["*", "_", "~"])(
    "promotes only the completed %p structure and undoes the promotion with its input",
    async (marker) => {
      const guard = await loadGuard();
      let state = EditorState.create({
        doc: "- ",
        selection: { anchor: 2 },
        extensions: [guard, history()],
      });
      for (let count = 1; count <= 2; count++) {
        state = state.update({
          ...state.replaceSelection(marker),
          userEvent: "input.type",
        }).state;
        expect(state.doc.toString()).toBe("- " + marker.repeat(count));
        expect(state.selection.main.head).toBe(count + 2);
      }
      state = state.update({
        ...state.replaceSelection(marker),
        userEvent: "input.type",
      }).state;
      expect(state.doc.toString()).toBe(marker.repeat(3));
      expect(state.selection.main.head).toBe(3);
      const editor = {
        get state() {
          return state;
        },
        dispatch(transaction: Transaction) {
          state = transaction.state;
        },
      };
      expect(undo(editor)).toBe(true);
      expect(state.doc.toString()).toBe("- ");
      expect(state.selection.main.head).toBe(2);
      expect(redo(editor)).toBe(true);
      expect(state.doc.toString()).toBe(marker.repeat(3));
      expect(state.selection.main.head).toBe(3);
    },
  );

  test.each(["* * *", "- - -", "_ _ _"])(
    "does not turn a thematic break into the following fence's list owner: %p",
    async (rule) => {
      const guard = await loadGuard();
      const doc = [rule, "  ```js", "code", "  ```"].join("\n");
      const state = EditorState.create({ doc, extensions: guard });
      const end = state.doc.line(3).to;
      const transaction = state.update({
        changes: { from: end, insert: "x" },
        selection: { anchor: end + 1 },
        userEvent: "input.type",
      });
      expect(transaction.newDoc.toString()).toBe(
        [rule, "  ```js", "codex", "  ```"].join("\n"),
      );
      expect(transaction.newSelection.main.head).toBe(end + 1);
    },
  );

  test.each(["***", "___", "* * *", "_ _ _"])(
    "keeps an existing thematic break literal when appending whitespace to %p",
    async (doc) => {
      const guard = await loadGuard();
      const state = EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: guard,
      });
      const transaction = state.update({
        changes: { from: doc.length, insert: " " },
        selection: { anchor: doc.length + 1 },
        userEvent: "input.type",
      });
      expect(transaction.newDoc.toString()).toBe(doc + " ");
      expect(transaction.newSelection.main.head).toBe(doc.length + 1);
    },
  );

  test.each([
    "- parent\n  ```js\n  code\n  ```\n  note",
    "- parent\n\n  ```js\n  code\n  ```\n  note",
    "- parent\n\n  paragraph\n\n  ```js\n  code\n  ```\n  note",
    "- ```js\n\tcode\n  ```\n  note",
    "- parent\n\t~~~js\n\tcode\n\t~~~\n\tnote",
    "- parent\n  ```js\n  code\n  ```\n  - ",
  ])(
    "preserves list ownership when typing after a fence in %p",
    async (doc) => {
      const guard = await loadGuard();
      const state = EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: guard,
      });
      const transaction = state.update({
        changes: { from: doc.length, insert: "#" },
        selection: { anchor: doc.length + 1 },
        userEvent: "input.type",
      });
      expect(transaction.newDoc.toString()).toBe(doc + "#");
      expect(transaction.newSelection.main.head).toBe(doc.length + 1);
    },
  );

  test.each(["- \n  ```js\n  code\n  ```", "- \n\n  ```js\n  code\n  ```"])(
    "preserves an empty parent's marker when it owns fenced code in %p",
    async (doc) => {
      const guard = await loadGuard();
      const state = EditorState.create({
        doc,
        selection: { anchor: 2 },
        extensions: guard,
      });
      const typed = state.update({
        changes: { from: 2, insert: "#" },
        selection: { anchor: 3 },
        userEvent: "input.type",
      });
      expect(typed.newDoc.toString()).toBe("- #" + doc.slice(2));
      const deleted = state.update({
        changes: { from: 0, to: 1 },
        selection: { anchor: 0 },
        userEvent: "delete.backward",
      });
      expect(deleted.newDoc.toString()).toBe(doc);
    },
  );

  test("allows deleting a literal hyphen inside a list-attached fenced code block", async () => {
    const guard = await loadGuard();
    const doc = "- ```js\n  - code\n  ```";
    const state = EditorState.create({
      doc,
      selection: { anchor: 11 },
      extensions: guard,
    });
    const transaction = state.update({
      changes: { from: 10, to: 11 },
      selection: { anchor: 10 },
      userEvent: "delete.backward",
    });

    expect(transaction.newDoc.toString()).toBe("- ```js\n   code\n  ```");
    expect(transaction.newSelection.main.head).toBe(10);
  });

  test("keeps Space literal on a physical blank inside a list-attached fenced code block", async () => {
    const guard = await loadGuard();
    const state = EditorState.create({
      doc: "- ```js\n\n  ```",
      selection: { anchor: 8 },
      extensions: guard,
    });
    const transaction = state.update({
      changes: { from: 8, insert: " " },
      selection: { anchor: 9 },
      userEvent: "input.type",
    });

    expect(transaction.newDoc.toString()).toBe("- ```js\n \n  ```");
    expect(transaction.newSelection.main.head).toBe(9);
  });

  test("keeps Enter and following input literal after a blank in a list-attached fenced code block", async () => {
    const guard = await loadGuard();
    let state = EditorState.create({
      doc: "- ```js\n\n  code\n  ```",
      selection: { anchor: 15 },
      extensions: guard,
    });
    state = state.update({
      changes: { from: 15, insert: "\n  " },
      selection: { anchor: 18 },
      userEvent: "input",
    }).state;

    expect(state.doc.toString()).toBe("- ```js\n\n  code\n  \n  ```");
    expect(state.selection.main.head).toBe(18);

    state = state.update({
      changes: { from: 18, insert: "x" },
      selection: { anchor: 19 },
      userEvent: "input.type",
    }).state;

    expect(state.doc.toString()).toBe("- ```js\n\n  code\n  x\n  ```");
    expect(state.selection.main.head).toBe(19);
  });

  test("returns the original typed transaction while disabled", async () => {
    const guard = await loadGuard({ keepBodyTextInBullets: false });
    const capture = captureInputTransaction();
    const state = EditorState.create({
      extensions: [guard, capture.extension],
    });

    const transaction = state.update({
      changes: { from: 0, insert: "a" },
      userEvent: "input.type",
    });

    expect(transaction).toBe(capture.transaction);
    expect(transaction.newDoc.toString()).toBe("a");
  });

  test("leaves Space unchanged while body ownership is disabled", async () => {
    const guard = await loadGuard({ keepBodyTextInBullets: false });
    const state = EditorState.create({ extensions: guard });

    const transaction = state.update({
      changes: { from: 0, insert: " " },
      userEvent: "input.type",
    });

    expect(transaction.newDoc.toString()).toBe(" ");
  });

  test("returns the original transaction when the policy passes", async () => {
    const guard = await loadGuard();
    const capture = captureInputTransaction();
    const state = EditorState.create({
      extensions: [guard, capture.extension],
    });

    const transaction = state.update({
      changes: { from: 0, insert: "a" },
      userEvent: "input.paste",
    });

    expect(transaction).toBe(capture.transaction);
    expect(transaction.newDoc.toString()).toBe("a");
  });

  test.each([
    {
      doc: "-   `upstream`: fork 元。更新の取得元",
      from: 3,
      to: 4,
      event: "delete.backward",
      expected: "-  `upstream`: fork 元。更新の取得元",
    },
    {
      doc: "-   item",
      from: 2,
      to: 4,
      event: "delete.selection",
      expected: "- item",
    },
    {
      doc: "-   item",
      from: 1,
      to: 3,
      event: "delete.forward",
      expected: "- item",
    },
    {
      doc: "- \t item",
      from: 2,
      to: 3,
      event: "input.type",
      expected: "-  item",
    },
    {
      doc: "- \t item",
      from: 1,
      to: 2,
      event: "delete.cut",
      expected: "-\t item",
    },
    {
      doc: "- parent\n\t12.   item",
      from: 14,
      to: 16,
      event: "delete.selection",
      expected: "- parent\n\t12. item",
    },
    {
      doc: "-   [ ] task",
      from: 2,
      to: 4,
      event: "delete.selection",
      expected: "- [ ] task",
    },
  ])(
    "allows surplus marker whitespace deletion: $doc ($event)",
    async ({ doc, from, to, event, expected }) => {
      const guard = await loadGuard();
      const state = EditorState.create({ doc, extensions: guard });
      const transaction = state.update({
        changes: { from, to },
        selection: { anchor: from },
        userEvent: event,
      });

      expect(transaction.newDoc.toString()).toBe(expected);
      expect(transaction.newSelection.main).toEqual(
        EditorSelection.cursor(from),
      );
    },
  );

  test("prefixes directly typed body text", async () => {
    const guard = await loadGuard();
    const state = EditorState.create({ extensions: guard });

    const transaction = state.update({
      changes: { from: 0, insert: "a" },
      userEvent: "input.type",
    });

    expect(transaction.newDoc.toString()).toBe("- a");
  });

  test("maps the typed cursor through the correction", async () => {
    const guard = await loadGuard();
    const state = EditorState.create({ extensions: guard });

    const transaction = state.update({
      changes: { from: 0, insert: "a" },
      selection: { anchor: 1 },
      userEvent: "input.type",
    });

    expect(transaction.newSelection.main).toEqual(EditorSelection.cursor(3));
  });

  test("maps Space past the empty bullet correction", async () => {
    const guard = await loadGuard();
    const state = EditorState.create({ extensions: guard });

    const transaction = state.update({
      changes: { from: 0, insert: " " },
      selection: { anchor: 1 },
      userEvent: "input.type",
    });

    expect(transaction.newDoc.toString()).toBe("- ");
    expect(transaction.newSelection.main).toEqual(EditorSelection.cursor(2));
  });

  test("preserves reverse ranges and the main selection", async () => {
    const guard = await loadGuard();
    const state = EditorState.create({
      doc: "one\ntwo",
      extensions: [EditorState.allowMultipleSelections.of(true), guard],
    });

    const transaction = state.update({
      changes: { from: 3, insert: "!" },
      selection: EditorSelection.create(
        [EditorSelection.range(3, 1), EditorSelection.range(8, 5)],
        1,
      ),
      userEvent: "input.type",
    });

    expect(transaction.newSelection.mainIndex).toBe(1);
    expect(transaction.newSelection.ranges).toEqual([
      EditorSelection.range(5, 3),
      EditorSelection.range(10, 7),
    ]);
  });

  test("maps effects and preserves annotations", async () => {
    const guard = await loadGuard();
    const positionEffect = StateEffect.define<number>({
      map: (position, changes) => changes.mapPos(position),
    });
    const sourceAnnotation = Annotation.define<string>();
    const state = EditorState.create({
      doc: "one",
      extensions: guard,
    });

    const transaction = state.update({
      annotations: sourceAnnotation.of("original"),
      changes: { from: 3, insert: "!" },
      effects: positionEffect.of(4),
      userEvent: "input.type",
    });

    expect(transaction.effects).toHaveLength(1);
    expect(transaction.effects[0]?.value).toBe(6);
    expect(transaction.annotation(sourceAnnotation)).toBe("original");
    expect(transaction.isUserEvent("input.type")).toBe(true);
  });

  test("exposes the correction as one history-bearing transaction", async () => {
    const guard = await loadGuard();
    const historyEventCount = StateField.define<number>({
      create: () => 0,
      update: (count, transaction) =>
        transaction.docChanged &&
        transaction.annotation(Transaction.addToHistory) !== false
          ? count + 1
          : count,
    });
    const state = EditorState.create({
      extensions: [historyEventCount, guard],
    });

    const transaction = state.update({
      annotations: Transaction.addToHistory.of(true),
      changes: { from: 0, insert: "a" },
      userEvent: "input.type",
    });

    expect(transaction).toBeInstanceOf(Transaction);
    expect(transaction.newDoc.toString()).toBe("- a");
    expect(transaction.annotation(Transaction.addToHistory)).toBe(true);
    expect(transaction.state.field(historyEventCount)).toBe(1);
  });

  test("keeps Space and its empty bullet in one history event", async () => {
    const guard = await loadGuard();
    const historyEventCount = StateField.define<number>({
      create: () => 0,
      update: (count, transaction) =>
        transaction.docChanged &&
        transaction.annotation(Transaction.addToHistory) !== false
          ? count + 1
          : count,
    });
    const state = EditorState.create({
      extensions: [historyEventCount, guard],
    });

    const transaction = state.update({
      annotations: Transaction.addToHistory.of(true),
      changes: { from: 0, insert: " " },
      userEvent: "input.type",
    });

    expect(transaction.newDoc.toString()).toBe("- ");
    expect(transaction.state.field(historyEventCount)).toBe(1);
  });

  test("rejects an unsafe document change without changing selection", async () => {
    const guard = await loadGuard();
    const selection = EditorSelection.single(7, 5);
    const state = EditorState.create({
      doc: "plain\n- item",
      selection,
      extensions: guard,
    });

    const transaction = state.update({
      changes: { from: 5, to: 7 },
      userEvent: "delete.selection",
    });

    expect(transaction.docChanged).toBe(false);
    expect(transaction.newDoc.toString()).toBe("plain\n- item");
    expect(transaction.selection).toBeUndefined();
    expect(transaction.newSelection.eq(selection)).toBe(true);
  });

  test("keeps document correction independent of cursor settings", async () => {
    const documents = await Promise.all(
      (["never", "bullet-and-checkbox"] as const).map(async (setting) => {
        const guard = await loadGuard({ keepCursorWithinContent: setting });
        const state = EditorState.create({ extensions: guard });

        return state
          .update({
            changes: { from: 0, insert: "a" },
            userEvent: "input.type",
          })
          .newDoc.toString();
      }),
    );

    expect(documents).toEqual(["- a", "- a"]);
  });

  test("installs analysis only while body ownership is enabled", async () => {
    const registerEditorExtension = jest.fn<void, [Extension]>();
    const updateOptions = jest.fn();
    let settingsCallback: (() => void) | undefined;
    const onChange = jest.fn((_keys, callback: () => void) => {
      settingsCallback = callback;
    });
    const removeCallback = jest.fn();
    const plugin = {
      app: { workspace: { updateOptions } },
      registerEditorExtension,
    } as unknown as Plugin;
    const settings = {
      keepBodyTextInBullets: false,
      onChange,
      removeCallback,
    } as unknown as Settings;
    const feature = new BulletTypingGuard(plugin, settings, makeLogger());

    await feature.load();

    const extensions = registerEditorExtension.mock.calls[0]?.[0];
    if (!extensions) {
      throw new Error("BulletTypingGuard did not register extensions");
    }
    expect(onChange).toHaveBeenCalledWith(
      ["keepBodyTextInBullets"],
      expect.any(Function),
    );
    expect(
      EditorState.create({ extensions })
        .update({
          changes: { from: 0, insert: "a" },
          userEvent: "input.type",
        })
        .newDoc.toString(),
    ).toBe("a");

    settings.keepBodyTextInBullets = true;
    settingsCallback?.();

    expect(updateOptions).toHaveBeenCalledTimes(1);
    expect(
      EditorState.create({ extensions })
        .update({
          changes: { from: 0, insert: "a" },
          userEvent: "input.type",
        })
        .newDoc.toString(),
    ).toBe("- a");

    settings.keepBodyTextInBullets = false;
    settingsCallback?.();

    expect(updateOptions).toHaveBeenCalledTimes(2);
    expect(
      EditorState.create({ extensions })
        .update({
          changes: { from: 0, insert: "a" },
          userEvent: "input.type",
        })
        .newDoc.toString(),
    ).toBe("a");

    await feature.unload();
    expect(removeCallback).toHaveBeenCalledWith(settingsCallback);
  });
});

describe("typing on a physical blank code row", () => {
  test("keeps simultaneous typing on an existing code row inside its fence", async () => {
    const guard = await loadGuard();
    const state = EditorState.create({
      doc: "- ```js\n\n  hello\n  ```",
      extensions: guard,
    });
    const transaction = state.update({
      changes: [
        { from: state.doc.line(2).from, insert: "x" },
        { from: state.doc.line(3).to, insert: "x" },
      ],
      userEvent: "input.type",
    });

    expect(transaction.newDoc.toString()).toBe("- ```js\n  x\n  hellox\n  ```");
  });

  test("repairs blank code rows and outside body typing in one undoable transaction", async () => {
    const guard = await loadGuard();
    const doc = "- ```js\n\n\n  ```\n\n";
    let state = EditorState.create({
      doc,
      extensions: [
        guard,
        history(),
        EditorState.allowMultipleSelections.of(true),
      ],
    });
    const positions = [8, 9, 17];
    state = state.update({
      changes: positions.map((from) => ({ from, insert: "x" })),
      selection: EditorSelection.create(
        positions.map((from, index) =>
          EditorSelection.cursor(from + index + 1),
        ),
      ),
      userEvent: "input.type",
    }).state;
    const expected = "- ```js\n  x\n  x\n  ```\n\n- x";
    expect(state.doc.toString()).toBe(expected);
    expect(state.selection.ranges.map(({ head }) => head)).toEqual([
      11, 15, 26,
    ]);

    const target = {
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = transaction.state;
      },
    };
    expect(undo(target)).toBe(true);
    expect(state.doc.toString()).toBe(doc);
    expect(redo(target)).toBe(true);
    expect(state.doc.toString()).toBe(expected);
    expect(state.selection.ranges.map(({ head }) => head)).toEqual([
      11, 15, 26,
    ]);
  });

  test.each([
    { doc: "- ```js\n\n  ```", line: 2, prefix: "  " },
    { doc: "- item\n  ```js\n\n  ```", line: 3, prefix: "  " },
    { doc: "- [ ] item\n  ```js\n\n  ```", line: 3, prefix: "  " },
    { doc: "\t- ```js\n\n\t  ```", line: 2, prefix: "\t  " },
    { doc: "```js\n\n```", line: 2, prefix: "" },
  ])(
    "retains code ownership through successive typing in $doc",
    async ({ doc, line, prefix }) => {
      const guard = await loadGuard();
      let state = EditorState.create({ doc, extensions: guard });
      const from = state.doc.line(line).from;
      for (const [index, value] of ["x", "y"].entries()) {
        const pos = index === 0 ? from : state.selection.main.head;
        state = state.update({
          changes: { from: pos, insert: value },
          selection: { anchor: pos + 1 },
          userEvent: "input.type",
        }).state;
        const expected = doc.split("\n");
        expected[line - 1] = prefix + (index === 0 ? "x" : "xy");
        expect(state.doc.toString()).toBe(expected.join("\n"));
        expect(state.selection.main.head).toBe(
          from + prefix.length + index + 1,
        );
      }
    },
  );

  test("corrects unrelated body typing while restoring a code container", async () => {
    const guard = await loadGuard();
    const doc = "- ```js\n\n  ```\n\n";
    const state = EditorState.create({
      doc,
      extensions: [guard, EditorState.allowMultipleSelections.of(true)],
    });
    const transaction = state.update({
      changes: [
        { from: 8, insert: "- x" },
        { from: doc.length, insert: "text" },
      ],
      userEvent: "input.type",
    });
    expect(transaction.newDoc.toString()).toBe(
      "- ```js\n  - x\n  ```\n\n- text",
    );
  });
});

test("fills only missing container columns after a tab on a blank row", async () => {
  const guard = await loadGuard();
  const doc = "\t- ```js\n\t\n\t  ```";
  let state = EditorState.create({ doc, extensions: guard });
  const from = state.doc.line(2).to;
  state = state.update({
    changes: { from, insert: "x" },
    selection: { anchor: from + 1 },
    userEvent: "input.type",
  }).state;
  expect(state.doc.toString()).toBe("\t- ```js\n\t  x\n\t  ```");
  const next = state.selection.main.head;
  state = state.update({
    changes: { from: next, insert: "y" },
    selection: { anchor: next + 1 },
    userEvent: "input.type",
  }).state;
  expect(state.doc.toString()).toBe("\t- ```js\n\t  xy\n\t  ```");
});

describe("BulletTypingGuard multiple carets", () => {
  async function createState(doc: string, positions: number[], mainIndex = 0) {
    return EditorState.create({
      doc,
      selection: EditorSelection.create(
        positions.map((position) => EditorSelection.cursor(position)),
        mainIndex,
      ),
      extensions: [
        await loadGuard(),
        EditorState.allowMultipleSelections.of(true),
        history(),
      ],
    });
  }

  function type(state: EditorState, text: string, userEvent = "input.type") {
    return state.update({ ...state.replaceSelection(text), userEvent }).state;
  }

  function carets(state: EditorState) {
    return state.selection.ranges.map(({ head }) => {
      const line = state.doc.lineAt(head);
      return [line.number, head - line.from];
    });
  }

  test.each([0, 1])(
    "starts two empty bullets with main caret %i",
    async (mainIndex) => {
      let state = await createState("\n", [0, 1], mainIndex);
      state = type(state, " ");
      expect(state.doc.toString()).toBe("- \n- ");
      expect(carets(state)).toEqual([
        [1, 2],
        [2, 2],
      ]);
      expect(state.selection.mainIndex).toBe(mainIndex);
      state = type(state, "x");
      expect(state.doc.toString()).toBe("- x\n- x");
      expect(carets(state)).toEqual([
        [1, 3],
        [2, 3],
      ]);
    },
  );

  test.each(["#", ">", "`", "-"])(
    "promotes both empty roots with %p",
    async (input) => {
      let state = await createState("- \n\n- ", [2, 6]);
      state = type(state, input);
      expect(state.doc.toString()).toBe(`${input}\n\n${input}`);
      expect(carets(state)).toEqual([
        [1, 1],
        [3, 1],
      ]);
      if (input === "`") {
        state = type(state, "`");
        state = type(state, "`");
        expect(state.doc.toString()).toBe("```\n\n```");
        expect(carets(state)).toEqual([
          [1, 3],
          [3, 3],
        ]);
      } else {
        state = type(state, " ");
        expect(state.doc.toString()).toBe(`${input} \n\n${input} `);
        expect(carets(state)).toEqual([
          [1, 2],
          [3, 2],
        ]);
      }
    },
  );

  test.each(["~~~", "***", "___", "* * *", "_ _ _"])(
    "promotes two completed %p structures",
    async (input) => {
      let state = await createState("- \n\n- ", [2, 6], 1);
      for (const character of input) state = type(state, character);
      expect(state.doc.toString()).toBe(`${input}\n\n${input}`);
      expect(carets(state)).toEqual([
        [1, input.length],
        [3, input.length],
      ]);
      expect(state.selection.mainIndex).toBe(1);
    },
  );

  test.each([
    {
      doc: "- \n\t- child\n\n- ",
      positions: [2, 15],
      expected: "- #\n\t- child\n\n#",
      expectedCarets: [
        [1, 3],
        [4, 1],
      ],
    },
    {
      doc: "- root\n\t- \n\n- ",
      positions: [10, 14],
      expected: "- root\n\t- #\n\n#",
      expectedCarets: [
        [2, 4],
        [4, 1],
      ],
    },
    {
      doc: "- [ ] \n\n- ",
      positions: [6, 10],
      expected: "- [ ] #\n\n#",
      expectedCarets: [
        [1, 7],
        [3, 1],
      ],
    },
    {
      doc: "- ```\n\n  ```\n\n- ",
      positions: [6, 16],
      expected: "- ```\n  #\n  ```\n\n#",
      expectedCarets: [
        [2, 3],
        [5, 1],
      ],
    },
    {
      doc: "body\n\n- ",
      positions: [4, 8],
      expected: "- body#\n\n#",
      expectedCarets: [
        [1, 7],
        [3, 1],
      ],
    },
    {
      doc: "- \n\nbody",
      positions: [2, 8],
      expected: "#\n\n- body#",
      expectedCarets: [
        [1, 1],
        [3, 7],
      ],
    },
  ])(
    "keeps row context in $doc",
    async ({ doc, positions, expected, expectedCarets }) => {
      let state = await createState(doc, positions);
      state = type(state, "#");
      expect(state.doc.toString()).toBe(expected);
      expect(carets(state)).toEqual(expectedCarets);
    },
  );

  test("classifies a changed body row after promoting a fence", async () => {
    let state = await createState("- ~~\n\nbody", [4, 10]);
    state = type(state, "~");
    expect(state.doc.toString()).toBe("~~~\n\nbody~");
    expect(carets(state)).toEqual([
      [1, 3],
      [3, 5],
    ]);
  });

  test("starts an empty bullet and corrects another body row together", async () => {
    let state = await createState("\nbody", [0, 5]);
    state = type(state, " ");
    expect(state.doc.toString()).toBe("- \n- body ");
    expect(carets(state)).toEqual([
      [1, 2],
      [2, 7],
    ]);
  });

  test("corrects one prefix for multiple carets in a body row", async () => {
    let state = await createState("abcd", [1, 3]);
    state = type(state, "#");
    expect(state.doc.toString()).toBe("- a#bc#d");
    expect(carets(state)).toEqual([
      [1, 4],
      [1, 7],
    ]);
  });

  test("does not remove the prefix twice for carets in a structure candidate", async () => {
    let state = await createState("- **", [3, 4]);
    state = type(state, "*");
    expect(state.doc.toString()).toBe("****");
    expect(carets(state)).toEqual([
      [1, 2],
      [1, 4],
    ]);
  });

  test("promotes a caret insertion while preserving a replacement selection", async () => {
    let state = await createState("- \n\n- old", [2, 9]);
    state = state.update({
      selection: EditorSelection.create([
        EditorSelection.cursor(2),
        EditorSelection.range(6, 9),
      ]),
    }).state;
    state = type(state, "#");
    expect(state.doc.toString()).toBe("#\n\n- #");
    expect(carets(state)).toEqual([
      [1, 1],
      [3, 3],
    ]);
  });

  test.each(["input.paste", "input.type.compose"])(
    "does not promote %p input",
    async (userEvent) => {
      let state = await createState("- \n\n- ", [2, 6]);
      state = type(state, "#", userEvent);
      expect(state.doc.toString()).toBe("- #\n\n- #");
      expect(carets(state)).toEqual([
        [1, 3],
        [3, 3],
      ]);
    },
  );

  test("does not promote a multi-character insertion", async () => {
    let state = await createState("- \n\n- ", [2, 6]);
    state = type(state, "##");
    expect(state.doc.toString()).toBe("- ##\n\n- ##");
    expect(carets(state)).toEqual([
      [1, 4],
      [3, 4],
    ]);
  });

  test("restores every caret and both promotions through Undo and Redo", async () => {
    let state = await createState("- \n\n- ", [2, 6], 1);
    state = type(state, "#");
    expect(state.doc.toString()).toBe("#\n\n#");
    const editor = {
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = transaction.state;
      },
    };
    expect(undo(editor)).toBe(true);
    expect(state.doc.toString()).toBe("- \n\n- ");
    expect(carets(state)).toEqual([
      [1, 2],
      [3, 2],
    ]);
    expect(state.selection.mainIndex).toBe(1);
    expect(redo(editor)).toBe(true);
    expect(state.doc.toString()).toBe("#\n\n#");
    expect(carets(state)).toEqual([
      [1, 1],
      [3, 1],
    ]);
    state = type(state, " ");
    state = type(state, "x");
    expect(state.doc.toString()).toBe("# x\n\n# x");
    expect(carets(state)).toEqual([
      [1, 3],
      [3, 3],
    ]);
  });
});

describe("BulletTypingGuard selected line joins", () => {
  describe.each([
    "delete.backward",
    "delete.forward",
    "delete.selection",
    "delete.cut",
    "input.type",
  ])("%s", (userEvent) => {
    test.each([
      { doc: "- alpha\n- beta", from: 4, to: 12, expected: "- alta", caret: 4 },
      { doc: "- \n- beta", from: 1, to: 7, expected: "- ta", caret: 2 },
      {
        doc: "10. alpha\n* beta",
        from: 6,
        to: 14,
        expected: "10. alta",
        caret: 6,
      },
      {
        doc: "10. alpha\n* beta",
        from: 1,
        to: 14,
        expected: "10. ta",
        caret: 4,
      },
      { doc: "10. alpha\n* beta", from: 0, to: 14, expected: "* ta", caret: 2 },
      {
        doc: "- alpha\n* middle\n+ beta",
        from: 4,
        to: 21,
        expected: "- alta",
        caret: 4,
      },
      {
        doc: "- parent\n\t- alpha\n\t- beta",
        from: 14,
        to: 23,
        expected: "- parent\n\t- alta",
        caret: 14,
      },
      { doc: "- alpha\n- beta", from: 0, to: 8, expected: "- beta", caret: 0 },
      { doc: "- alpha\n- beta", from: 0, to: 14, expected: "", caret: 0 },
    ])(
      "joins $doc from $from to $to",
      async ({ doc, from, to, expected, caret }) => {
        const guard = await loadGuard();
        for (const reverse of [false, true]) {
          const state = EditorState.create({
            doc,
            selection: EditorSelection.single(
              reverse ? to : from,
              reverse ? from : to,
            ),
            extensions: guard,
          });
          const result = state.update({
            ...state.replaceSelection(""),
            userEvent,
          }).state;
          expect(result.doc.toString()).toBe(expected);
          expect(result.selection).toEqual(EditorSelection.single(caret));
        }
      },
    );
  });

  test.each([
    {
      doc: "- alpha\n- beta",
      from: 4,
      to: 12,
      expected: "- al\n- ta",
      caret: 7,
    },
    { doc: "plain", from: 2, to: 2, expected: "- pl\n- ain", caret: 7 },
    { doc: "- alpha", from: 7, to: 7, expected: "- alpha\n", caret: 8 },
    {
      doc: "- alpha\n\t- beta",
      from: 4,
      to: 8,
      expected: "- al\n\t- beta",
      caret: 5,
    },
    {
      doc: "- alpha\n  continuation",
      from: 4,
      to: 8,
      expected: "- al\n  continuation",
      caret: 5,
    },
    {
      doc: "```\nalpha\n```",
      from: 6,
      to: 6,
      expected: "```\nal\npha\n```",
      caret: 7,
    },
    {
      doc: "---\nkey: value\n---",
      from: 8,
      to: 8,
      expected: "---\nkey:\n value\n---",
      caret: 9,
    },
    {
      doc: "- alpha\n# heading",
      from: 4,
      to: 8,
      expected: "- al\n# heading",
      caret: 5,
    },
    {
      doc: "- alpha\n> quote",
      from: 4,
      to: 8,
      expected: "- al\n> quote",
      caret: 5,
    },
    {
      doc: "- alpha\n| a |\n| - |",
      from: 4,
      to: 8,
      expected: "- al\n| a |\n| - |",
      caret: 5,
    },
  ])(
    "classifies the newline suffix in $doc",
    async ({ doc, from, to, expected, caret }) => {
      const guard = await loadGuard();
      for (const reverse of [false, true]) {
        const state = EditorState.create({
          doc,
          selection: EditorSelection.single(
            reverse ? to : from,
            reverse ? from : to,
          ),
          extensions: guard,
        });
        const result = state.update({
          ...state.replaceSelection("\n"),
          userEvent: "input",
        }).state;
        expect(result.doc.toString()).toBe(expected);
        expect(result.selection).toEqual(EditorSelection.single(caret));
      }
    },
  );

  test.each(["", "\n"])(
    "restores directional selection and corrected %p through history",
    async (insert) => {
      const guard = await loadGuard();
      const selection = EditorSelection.single(12, 4);
      let state = EditorState.create({
        doc: "- alpha\n- beta",
        selection,
        extensions: [guard, history()],
      });
      const editor = {
        get state() {
          return state;
        },
        dispatch(transaction: Transaction) {
          state = transaction.state;
        },
      };
      state = state.update({
        ...state.replaceSelection(insert),
        userEvent: insert ? "input" : "delete.cut",
      }).state;
      expect(state.doc.toString()).toBe(insert ? "- al\n- ta" : "- alta");
      expect(state.selection.main.head).toBe(insert ? 7 : 4);
      expect(undo(editor)).toBe(true);
      expect(state.doc.toString()).toBe("- alpha\n- beta");
      expect(state.selection).toEqual(selection);
      expect(redo(editor)).toBe(true);
      expect(state.doc.toString()).toBe(insert ? "- al\n- ta" : "- alta");
      state = state.update({
        ...state.replaceSelection("X"),
        userEvent: "input.type",
      }).state;
      expect(state.doc.toString()).toBe(insert ? "- al\n- Xta" : "- alXta");
      expect(state.selection.main.head).toBe(insert ? 8 : 5);
    },
  );

  test.each([
    { mainIndex: 0, insert: "" },
    { mainIndex: 1, insert: "" },
    { mainIndex: 0, insert: "\n" },
    { mainIndex: 1, insert: "\n" },
  ])(
    "keeps both selected joins and main range $mainIndex with $insert",
    async ({ mainIndex, insert }) => {
      const guard = await loadGuard();
      const state = EditorState.create({
        doc: "- alpha\n- beta\n- gamma\n- delta",
        selection: EditorSelection.create(
          [EditorSelection.range(12, 4), EditorSelection.range(28, 19)],
          mainIndex,
        ),
        extensions: [guard, EditorState.allowMultipleSelections.of(true)],
      });
      const result = state.update({
        ...state.replaceSelection(insert),
        userEvent: insert ? "input" : "delete.selection",
      }).state;
      expect(result.doc.toString()).toBe(
        insert ? "- al\n- ta\n- ga\n- ta" : "- alta\n- gata",
      );
      expect(result.selection.ranges.map(({ head }) => head)).toEqual(
        insert ? [7, 17] : [4, 11],
      );
      expect(result.selection.mainIndex).toBe(mainIndex);
    },
  );

  test("keeps an independent body deletion alongside a selected join", async () => {
    const guard = await loadGuard();
    const state = EditorState.create({
      doc: "- alpha\n- beta\n- gamma",
      selection: EditorSelection.create(
        [EditorSelection.range(4, 12), EditorSelection.range(18, 20)],
        1,
      ),
      extensions: [guard, EditorState.allowMultipleSelections.of(true)],
    });
    const result = state.update({
      ...state.replaceSelection(""),
      userEvent: "delete.backward",
    }).state;
    expect(result.doc.toString()).toBe("- alta\n- gma");
    expect(result.selection.ranges.map(({ head }) => head)).toEqual([4, 10]);
    expect(result.selection.mainIndex).toBe(1);
  });

  test("keeps native multiline Enter when the guard is disabled", async () => {
    const guard = await loadGuard({ keepBodyTextInBullets: false });
    const state = EditorState.create({
      doc: "- alpha\n- beta",
      selection: EditorSelection.single(4, 12),
      extensions: guard,
    });
    const result = state.update({
      ...state.replaceSelection("\n"),
      userEvent: "input.type",
    }).state;
    expect(result.doc.toString()).toBe("- al\nta");
    expect(result.selection.main.head).toBe(5);
  });
});

describe("BulletTypingGuard native newline command", () => {
  test.each([false, true])(
    "keeps the suffix editable with reverse selection %p",
    async (reverse) => {
      const guard = await loadGuard({ keepCursorWithinContent: "never" });
      let state = EditorState.create({
        doc: "- alpha\n- beta",
        selection: EditorSelection.single(reverse ? 12 : 4, reverse ? 4 : 12),
        extensions: guard,
      });
      expect(
        insertNewline({
          state,
          dispatch(transaction) {
            state = transaction.state;
          },
        }),
      ).toBe(true);
      expect(state.doc.toString()).toBe("- al\n- ta");
      expect(state.selection.main.head).toBe(7);
      state = state.update({
        ...state.replaceSelection("X"),
        userEvent: "input.type",
      }).state;
      expect(state.doc.toString()).toBe("- al\n- Xta");
      expect(state.selection.main.head).toBe(8);
    },
  );
});
