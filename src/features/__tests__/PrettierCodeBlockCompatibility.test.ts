import { Plugin } from "obsidian";

import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { EditorState, Transaction, TransactionSpec } from "@codemirror/state";

import { PrettierCodeBlockCompatibility } from "../PrettierCodeBlockCompatibility";

const before = "- \n\t- ```js\n\t  code\n\t  ```\n- after";
const compatible = "- \n    - ```js\n      code\n      ```\n- after\n";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

function makeEditor(doc = before) {
  let state = EditorState.create({
    doc,
    selection: { anchor: 2 },
    extensions: [history(), EditorState.tabSize.of(4)],
  });
  const documents: string[] = [];
  const cm = {
    dom: { isConnected: true },
    get state() {
      return state;
    },
    dispatch(...specs: (Transaction | TransactionSpec)[]) {
      const transaction =
        specs[0] instanceof Transaction
          ? specs[0]
          : state.update(...(specs as TransactionSpec[]));
      state = transaction.state;
      if (transaction.docChanged) documents.push(state.doc.toString());
    },
  };
  const editor = {
    cm,
    getValue: () => state.doc.toString(),
    posToOffset: ({ line, ch }: { line: number; ch: number }) =>
      state.doc.line(line + 1).from + ch,
  };
  return { editor, cm, documents };
}

async function setup(
  options: {
    doc?: string;
    output?: string;
    gate?: ReturnType<typeof deferred>;
    installed?: boolean;
    reject?: boolean;
    gates?: ReturnType<typeof deferred>[];
  } = {},
) {
  const target = makeEditor(options.doc);
  const file = { path: "test.md" };
  const workspace = {
    activeEditor: { editor: target.editor, file },
    getActiveFile: () => file,
    onLayoutReady: (callback: () => void) => callback(),
  };
  const original = async function (this: {
    app: { workspace: typeof workspace };
  }) {
    const editor = this.app.workspace.activeEditor.editor;
    let source = editor.getValue();
    await (options.gates?.shift() ?? options.gate)?.promise;
    if (options.reject) throw new Error("formatter failed");
    const write = (from: number, to: number, insert = "") => {
      editor.cm.dispatch({ changes: { from, to, insert }, filter: false });
      source = source.slice(0, from) + insert + source.slice(to);
    };
    if (options.output !== undefined) {
      write(0, source.length);
      write(editor.posToOffset({ line: 0, ch: 0 }), 0, options.output);
      return;
    }
    // These are the actual formatter's sequential diff shapes for this
    // fixture. Keep the marker characters intact to exercise cursor mapping.
    const childIndent = /^- \n([ \t]*)-/.exec(source)![1];
    write(2, 3 + childIndent.length);
    write(2, 2, "  ");
    for (let line = 1; line < source.split("\n").length; line++) {
      if (!source.split("\n")[line].startsWith("\t")) continue;
      const from = editor.posToOffset({ line, ch: 0 });
      write(from, from + 1);
      write(from, from, "    ");
    }
    if (!source.endsWith("\n")) write(source.length, source.length, "\n");
  };
  const formatter = {
    manifest: { id: "prettier-format", version: "0.2.0" },
    settings: { useTabs: true, tabWidth: 4 },
    app: { workspace },
    format: original,
  };
  const changed = new Set<() => void>();
  const manager = {
    plugins: {} as Record<string, typeof formatter>,
    on: (_event: string, callback: () => void) => {
      changed.add(callback);
      return { callback };
    },
    offref: (reference: { callback: () => void }) =>
      changed.delete(reference.callback),
  };
  if (options.installed !== false)
    manager.plugins["prettier-format"] = formatter;
  const plugin = {
    app: { workspace, plugins: manager, vault: { getConfig: () => true } },
    registerEvent: () => {},
  } as unknown as Plugin;
  const feature = new PrettierCodeBlockCompatibility(plugin);
  await feature.load();
  return {
    ...target,
    feature,
    formatter,
    original,
    manager,
    workspace,
    file,
    changed: () => [...changed].forEach((callback) => callback()),
  };
}

test("keeps formatted nested fences on separate rows in one undoable edit", async () => {
  const test = await setup();

  await test.formatter.format();

  expect(test.editor.getValue()).toBe(compatible);
  expect(test.documents).toEqual([compatible]);
  expect(test.cm.state.selection.main.head).toBe(2);
  expect(undoDepth(test.cm.state)).toBe(1);
  expect(undo(test.cm)).toBe(true);
  expect(test.editor.getValue()).toBe(before);
  expect(redo(test.cm)).toBe(true);
  expect(test.editor.getValue()).toBe(compatible);
});

test("keeps the real document untouched while formatting is pending", async () => {
  const gate = deferred();
  const test = await setup({ gate });
  const pending = test.formatter.format();

  expect(test.editor.getValue()).toBe(before);
  gate.resolve();
  await pending;
  expect(test.editor.getValue()).toBe(compatible);
});

test("discards a result after the captured editor document changes", async () => {
  const gate = deferred();
  const test = await setup({ gate });
  const pending = test.formatter.format();
  test.cm.dispatch({ changes: { from: before.length, insert: "x" } });

  gate.resolve();
  await pending;

  expect(test.editor.getValue()).toBe(before + "x");
});

test("keeps formatting scoped to the captured editor when another pane becomes active", async () => {
  const gate = deferred();
  const test = await setup({ gate });
  const other = makeEditor("- other");
  const pending = test.formatter.format();
  test.workspace.activeEditor = {
    editor: other.editor,
    file: { path: "other.md" },
  };

  gate.resolve();
  await pending;

  expect(other.editor.getValue()).toBe("- other");
  expect(test.editor.getValue()).toBe(compatible);
});

test("discards a result when its editor starts displaying another file", async () => {
  const gate = deferred();
  const test = await setup({ gate });
  const pending = test.formatter.format();
  test.workspace.activeEditor.file = { path: "other.md" };

  gate.resolve();
  await pending;

  expect(test.editor.getValue()).toBe(before);
});

test("unload restores the formatter and discards any pending result", async () => {
  const gate = deferred();
  const test = await setup({ gate });
  const pending = test.formatter.format();

  await test.feature.unload();
  gate.resolve();
  await pending;

  expect(test.formatter).toHaveProperty("format", test.original);
  expect(test.editor.getValue()).toBe(before);
});

test("does not replace a later wrapper when unloading", async () => {
  const test = await setup();
  const later = async () => {};
  test.formatter.format = later;

  await test.feature.unload();

  expect(test.formatter).toHaveProperty("format", later);
});

test("attaches when the formatter is enabled later and detaches on its removal", async () => {
  const test = await setup({ installed: false });
  test.manager.plugins["prettier-format"] = test.formatter;
  test.changed();

  expect(test.formatter).not.toHaveProperty("format", test.original);
  delete test.manager.plugins["prettier-format"];
  test.changed();
  expect(test.formatter).toHaveProperty("format", test.original);
});

test("rejects failed formatting without changing the editor", async () => {
  const test = await setup({ reject: true });

  await expect(test.formatter.format()).rejects.toThrow("formatter failed");

  expect(test.editor.getValue()).toBe(before);
  expect(undoDepth(test.cm.state)).toBe(0);
});

test("leaves unrelated formatter calls on their original editor path", async () => {
  const test = await setup({ doc: "paragraph", output: "paragraph\n" });

  await test.formatter.format();

  expect(test.editor.getValue()).toBe("paragraph\n");
  expect(test.documents).toEqual(["", "paragraph\n"]);
});

test("does not create a history event when formatting has no final change", async () => {
  const test = await setup({ doc: compatible });

  await test.formatter.format();

  expect(test.documents).toEqual([]);
  expect(undoDepth(test.cm.state)).toBe(0);
});

test("discards formatting after the captured editor is detached", async () => {
  const gate = deferred();
  const test = await setup({ gate });
  const pending = test.formatter.format();
  test.cm.dom.isConnected = false;

  gate.resolve();
  await pending;

  expect(test.editor.getValue()).toBe(before);
});

test("only the latest concurrent formatting invocation may commit", async () => {
  const first = deferred();
  const second = deferred();
  const test = await setup({ gates: [first, second] });
  const older = test.formatter.format();
  const newer = test.formatter.format();

  first.resolve();
  await older;
  expect(test.documents).toEqual([]);
  second.resolve();
  await newer;

  expect(test.documents).toEqual([compatible]);
  expect(undoDepth(test.cm.state)).toBe(1);
});

test("maps the current selection when the cursor moves during formatting", async () => {
  const gate = deferred();
  const test = await setup({ gate });
  const pending = test.formatter.format();
  const oldPosition = before.indexOf("code") + 2;
  test.cm.dispatch({ selection: { anchor: oldPosition } });

  gate.resolve();
  await pending;

  expect(test.cm.state.selection.main.head).toBe(
    compatible.indexOf("code") + 2,
  );
});

test("keeps deleting the parent text and formatting as separate undo steps", async () => {
  const original = before.replace("- \n", "- parent\n");
  const test = await setup({ doc: original });
  test.cm.dispatch({
    changes: { from: 2, to: 8 },
    userEvent: "delete.selection",
  });

  await test.formatter.format();

  expect(undoDepth(test.cm.state)).toBe(2);
  expect(undo(test.cm)).toBe(true);
  expect(test.editor.getValue()).toBe(before);
  expect(undo(test.cm)).toBe(true);
  expect(test.editor.getValue()).toBe(original);
});
