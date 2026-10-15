import { Plugin } from "obsidian";

import { history, redo, undo } from "@codemirror/commands";
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
