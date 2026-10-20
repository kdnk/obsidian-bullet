import { Plugin } from "obsidian";

import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { EditorState, Transaction, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { FormatMarkdownRequest } from "../../formatting/types";
import { Settings } from "../../services/Settings";
import { Formatting } from "../Formatting";

const mockNotices: string[] = [];
const mockFormat = jest.fn<Promise<string>, [FormatMarkdownRequest]>();
const mockPaste = jest.fn<string, [string]>();

jest.mock(
  "obsidian",
  () => ({
    Notice: class {
      constructor(message: string) {
        mockNotices.push(message);
      }
    },
    htmlToMarkdown: (html: string) => html.replace(/<[^>]+>/g, ""),
    normalizePath: (path: string) => path,
  }),
  { virtual: true },
);
jest.mock("../../formatting/formatMarkdown", () => ({
  formatMarkdown: (request: FormatMarkdownRequest) => mockFormat(request),
  formatPastedText: (text: string) => mockPaste(text),
}));

function deferred() {
  let resolve!: (text: string) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function target(doc = "- hello") {
  let state = EditorState.create({ doc, extensions: history() });
  const transactions: Transaction[] = [];
  const cm = {
    dom: { isConnected: true, ownerDocument: { defaultView: globalThis } },
    get state() {
      return state;
    },
    dispatch(...specs: (Transaction | TransactionSpec)[]) {
      const first = specs[0];
      const transaction =
        first instanceof Transaction
          ? first
          : state.update(...(specs as TransactionSpec[]));
      state = transaction.state;
      transactions.push(transaction);
    },
  };
  const editor = {
    cm,
    getValue: () => state.doc.toString(),
    replaceSelection: jest.fn(),
  };
  return { editor, cm, transactions };
}

async function setup(options: { command?: boolean; onSave?: boolean } = {}) {
  const initial = target();
  const file = {
    path: "note.md",
    basename: "note",
    stat: { ctime: 1, mtime: 2 },
  };
  const saved: string[] = [];
  const persisted = new Map<string, string>();
  const owner = {
    editor: initial.editor,
    file,
    save: jest.fn(async () => {
      const text = owner.editor.getValue();
      saved.push(text);
      persisted.set(owner.file.path, text);
    }),
  };

  const events = new Map<string, (...args: unknown[]) => void>();
  const settings = new Settings({
    loadData: async () => null,
    saveData: async () => undefined,
  });
  await settings.load();
  settings.formatting = {
    ...settings.formatting,
    onSave: options.onSave !== false,
  };
  const workspace = {
    activeEditor: owner,
    onLayoutReady: (callback: () => void) => callback(),
    on: (name: string, callback: (...args: unknown[]) => void) => {
      events.set(name, callback);
      return {};
    },
  };
  const original = jest.fn((checking: boolean) => {
    if (!checking) void workspace.activeEditor.save();
    return true;
  });
  const command: { checkCallback: (checking: boolean) => boolean | void } = {
    checkCallback: original,
  };
  const commands =
    options.command === false ? {} : { "editor:save-file": command };
  const plugins: Record<string, unknown> = {};
  const plugin = {
    app: {
      commands: { commands },
      workspace,
      plugins: { plugins },
      vault: { getConfig: (key: string) => (key === "tabSize" ? 4 : true) },
    },
    addCommand: jest.fn(),
    registerEvent: jest.fn(),
  } as unknown as Plugin;
  const feature = new Formatting(plugin, settings);
  await feature.load();
  return {
    ...initial,
    feature,
    settings,
    file,
    owner,
    workspace,
    events,
    saved,
    persisted,
    original,
    command,
    plugins,
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  mockNotices.length = 0;
  mockFormat.mockReset().mockImplementation(async ({ text }) => text + "\n");
  mockPaste
    .mockReset()
    .mockImplementation((text) => text.replace(/\[\d+\]/g, ""));
});

test("formats explicit saves in one undoable edit and maps the latest backward selection", async () => {
  const gate = deferred();
  mockFormat.mockReturnValue(gate.promise);
  const test = await setup();
  expect(test.command.checkCallback(true)).toBe(true);
  expect(mockFormat).toHaveBeenCalledTimes(0);
  test.command.checkCallback(false);
  test.cm.dispatch({ selection: { anchor: 7, head: 2 } });
  gate.resolve("- greeting hello\n");
  await settle();
  expect(test.saved).toEqual(["- greeting hello\n"]);
  expect(test.cm.state.selection.main.anchor).toBe(16);
  expect(test.cm.state.selection.main.head).toBe(11);
  expect(undoDepth(test.cm.state)).toBe(1);
  const changes = test.transactions.filter(
    (transaction) => transaction.docChanged,
  );
  expect(
    changes.map((transaction) => transaction.annotation(Transaction.userEvent)),
  ).toEqual([undefined]);
  expect(undo(test.cm as unknown as EditorView)).toBe(true);
  expect(test.editor.getValue()).toBe("- hello");
  expect(redo(test.cm as unknown as EditorView)).toBe(true);
  expect(test.editor.getValue()).toBe("- greeting hello\n");
  await test.feature.unload();
});

test.each(["typing", "switch", "rename", "detach", "settings", "unload"])(
  "discards stale output after %s and saves only a retained target",
  async (action) => {
    const gate = deferred();
    mockFormat.mockReturnValue(gate.promise);
    const test = await setup();
    test.command.checkCallback(false);
    if (action === "typing")
      test.cm.dispatch({ changes: { from: 7, insert: " typed" } });
    if (action === "switch")
      test.owner.file = { ...test.file, path: "other.md" };
    if (action === "rename") test.file.path = "renamed.md";
    if (action === "detach") test.cm.dom.isConnected = false;
    if (action === "settings")
      test.settings.formatting = { ...test.settings.formatting, onSave: false };
    if (action === "unload") await test.feature.unload();
    gate.resolve("- stale formatter result\n");
    await settle();
    const expected = action === "typing" ? "- hello typed" : "- hello";
    expect(test.editor.getValue()).toBe(expected);
    expect(test.saved).toEqual(
      action === "switch" || action === "detach" ? [] : [expected],
    );
    await test.feature.unload();
  },
);

test("a delayed save persists its source pane while another note is active", async () => {
  const gate = deferred();
  mockFormat.mockReturnValue(gate.promise);
  const test = await setup();
  const destination = target("- destination unsaved");
  const destinationFile = { ...test.file, path: "destination.md" };
  const saveDestination = jest.fn(async () => {
    test.persisted.set(destinationFile.path, destination.editor.getValue());
  });
  test.command.checkCallback(false);
  test.workspace.activeEditor = {
    editor: destination.editor,
    file: destinationFile,
    save: saveDestination,
  };
  gate.resolve("- source formatted");
  await settle();
  expect([...test.persisted]).toEqual([["note.md", "- source formatted"]]);
  expect(destination.editor.getValue()).toBe("- destination unsaved");
  expect(test.original).not.toHaveBeenCalled();
  await test.feature.unload();
});

test("queued save intents retain their note after the same view navigates", async () => {
  const gate = deferred();
  mockFormat.mockReturnValueOnce(gate.promise);
  const test = await setup();
  test.command.checkCallback(false);
  test.command.checkCallback(false);
  // Obsidian flushes the departing note before reusing its view.
  await test.owner.save();
  test.owner.file = { ...test.file, path: "destination.md" };
  test.cm.dispatch({
    changes: { from: 0, to: 7, insert: "- destination unsaved" },
  });
  test.command.checkCallback(false);
  gate.resolve("- stale source output");
  await settle();
  expect([...test.persisted]).toEqual([
    ["note.md", "- hello"],
    ["destination.md", "- destination unsaved"],
  ]);
  expect(test.saved).toEqual(["- hello", "- destination unsaved"]);
  await test.feature.unload();
});

test.each(["failure", "unload"])(
  "retains source save ownership after %s",
  async (action) => {
    const gate = deferred();
    mockFormat.mockReturnValueOnce(gate.promise);
    const test = await setup();
    test.command.checkCallback(false);
    const destination = target("- destination unsaved");
    test.workspace.activeEditor = {
      editor: destination.editor,
      file: { ...test.file, path: "destination.md" },
      save: jest.fn(async () => undefined),
    };
    if (action === "unload") await test.feature.unload();
    else gate.reject(new Error("script failed"));
    await settle();
    expect([...test.persisted]).toEqual([["note.md", "- hello"]]);
    expect(destination.editor.getValue()).toBe("- destination unsaved");
    await test.feature.unload();
  },
);

test("reports a failed background source save and drains queued intents", async () => {
  const gate = deferred();
  mockFormat.mockReturnValueOnce(gate.promise);
  const test = await setup();
  test.owner.save.mockRejectedValueOnce(new Error("disk full"));
  test.command.checkCallback(false);
  test.command.checkCallback(false);
  const destination = target("- destination unsaved");
  test.workspace.activeEditor = {
    editor: destination.editor,
    file: { ...test.file, path: "destination.md" },
    save: jest.fn(async () => undefined),
  };
  gate.resolve("- source formatted");
  await settle();
  expect([...test.persisted]).toEqual([["note.md", "- source formatted\n"]]);
  expect(mockNotices).toEqual(["Bullet could not save note.md. disk full"]);
  await test.feature.unload();
});

test("a failing stage keeps the original document and reaches native save", async () => {
  mockFormat.mockRejectedValue(new Error("Save script failed"));
  const test = await setup();
  test.command.checkCallback(false);
  await settle();
  expect(test.saved).toEqual(["- hello"]);
  expect(test.editor.getValue()).toBe("- hello");
  expect(mockNotices).toEqual([
    "Bullet formatting skipped. Save script failed",
  ]);
  await test.feature.unload();
});

test("a hung asynchronous stage times out and cannot apply its late result", async () => {
  jest.useFakeTimers();
  try {
    const gate = deferred();
    mockFormat.mockReturnValue(gate.promise);
    const test = await setup();
    test.command.checkCallback(false);
    await jest.advanceTimersByTimeAsync(15_001);
    expect(test.saved).toEqual(["- hello"]);
    gate.resolve("late text");
    await jest.advanceTimersByTimeAsync(0);
    expect(test.editor.getValue()).toBe("- hello");
    await test.feature.unload();
  } finally {
    jest.useRealTimers();
  }
});

test("repeated saves coalesce trailing formatting and preserve every native save intent", async () => {
  const gate = deferred();
  mockFormat.mockReturnValueOnce(gate.promise);
  const test = await setup();
  test.command.checkCallback(false);
  test.command.checkCallback(false);
  test.command.checkCallback(false);
  test.cm.dispatch({ changes: { from: 7, insert: " current" } });
  gate.resolve("stale");
  await settle();
  expect(test.editor.getValue()).toBe("- hello current\n");
  expect(test.saved).toEqual([
    "- hello current",
    "- hello current\n",
    "- hello current\n",
  ]);
  expect(mockFormat.mock.calls.map(([request]) => request.text)).toEqual([
    "- hello",
    "- hello current",
  ]);
  await test.feature.unload();
});

test("different panes format independently and keep their own captured editor", async () => {
  const first = deferred();
  const second = deferred();
  mockFormat
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const test = await setup();
  const other = target("- second");
  const one = test.feature.formatActiveEditor();
  test.workspace.activeEditor = {
    editor: other.editor,
    file: { ...test.file, path: "second.md" },
    save: jest.fn(async () => undefined),
  };
  const two = test.feature.formatActiveEditor();
  second.resolve("- second done");
  await two;
  expect(other.editor.getValue()).toBe("- second done");
  expect(test.editor.getValue()).toBe("- hello");
  first.resolve("- first done");
  await one;
  expect(test.editor.getValue()).toBe("- first done");
  await test.feature.unload();
});

test("disabled formatting delegates directly and unsupported hosts do not claim ownership", async () => {
  const disabled = await setup({ onSave: false });
  disabled.command.checkCallback(false);
  expect(disabled.saved).toEqual(["- hello"]);
  expect(disabled.feature.ownsExplicitSaveFormatting()).toBe(false);
  const unsupported = await setup({ command: false });
  expect(unsupported.feature.ownsExplicitSaveFormatting()).toBe(false);
  await disabled.feature.unload();
  await unsupported.feature.unload();
});

test("unloaded wrappers delegate even when a later plugin keeps its wrapper installed", async () => {
  const test = await setup();
  const bullet = test.command.checkCallback;
  const later = (checking: boolean) => bullet(checking);
  test.command.checkCallback = later;
  await test.feature.unload();
  test.command.checkCallback(false);
  expect(test.saved).toEqual(["- hello"]);
  expect(test.command.checkCallback).toBe(later);
});

test("legacy Linker save hooks retain sole ownership until upgraded or disabled", async () => {
  const test = await setup();
  const legacy = { settings: { formatOnSave: true } };
  test.plugins["automatic-linker"] = legacy;
  test.command.checkCallback(false);
  expect(test.saved).toEqual(["- hello"]);
  expect(test.feature.ownsExplicitSaveFormatting()).toBe(false);
  expect(mockFormat.mock.calls).toEqual([]);
  expect(mockNotices).toEqual([
    "Bullet save formatting requires the updated Automatic Linker. Update Automatic Linker or disable its format-on-save setting.",
  ]);
  legacy.settings.formatOnSave = false;
  test.command.checkCallback(false);
  await settle();
  expect(test.saved).toEqual(["- hello", "- hello\n"]);
  expect(test.feature.ownsExplicitSaveFormatting()).toBe(true);
  await test.feature.unload();
});

test.each(["switch", "disable"])(
  "queued saves do not restart formatting after %s",
  async (action) => {
    const gate = deferred();
    mockFormat.mockReturnValueOnce(gate.promise);
    const test = await setup();
    test.command.checkCallback(false);
    test.command.checkCallback(false);
    if (action === "switch")
      test.owner.file = { ...test.file, path: "other.md" };
    else
      test.settings.formatting = { ...test.settings.formatting, onSave: false };
    gate.resolve("stale output");
    await settle();
    expect(test.saved).toEqual(
      action === "switch" ? [] : ["- hello", "- hello"],
    );
    expect(mockFormat.mock.calls.map(([request]) => request.text)).toEqual([
      "- hello",
    ]);
    await test.feature.unload();
  },
);

describe.each(["explicit save", "manual format"])(
  "%s linking",
  (entrypoint) => {
    test.each([
      { automaticLinker: true, linkerOnSave: true },
      { automaticLinker: true, linkerOnSave: false },
      { automaticLinker: false, linkerOnSave: true },
      { automaticLinker: false, linkerOnSave: false },
    ])(
      "Bullet integration $automaticLinker controls linking with Linker save setting $linkerOnSave",
      async ({ automaticLinker, linkerOnSave }) => {
        mockFormat.mockImplementation(async (request) => {
          const linked = request.linker
            ? await request.linker(request.text, {
                file: request.file,
                signal: request.signal,
              })
            : request.text;
          return `${linked} formatted`;
        });
        const test = await setup();
        test.settings.formatting = {
          ...test.settings.formatting,
          automaticLinker,
        };
        const linker = {
          isFormatOnSaveEnabled: jest.fn(() => linkerOnSave),
          formatText: jest.fn(async (text: string) => `${text} linked`),
        };
        test.plugins["automatic-linker"] = linker;

        expect(test.feature.ownsExplicitSaveFormatting()).toBe(true);
        if (entrypoint === "explicit save") {
          test.command.checkCallback(false);
          await settle();
        } else {
          await test.feature.formatActiveEditor();
        }

        const expected = automaticLinker
          ? "- hello linked formatted"
          : "- hello formatted";
        expect(test.editor.getValue()).toBe(expected);
        expect(test.saved).toEqual(
          entrypoint === "explicit save" ? [expected] : [],
        );
        expect(mockFormat).toHaveBeenCalledTimes(1);
        expect(linker.formatText).toHaveBeenCalledTimes(
          automaticLinker ? 1 : 0,
        );
        if (automaticLinker) {
          expect(linker.formatText).toHaveBeenCalledWith("- hello", test.file);
        }
        expect(linker.isFormatOnSaveEnabled).not.toHaveBeenCalled();
        await test.feature.unload();
      },
    );
  },
);

test("supports a Linker API with only formatText while explicit save formatting is disabled", async () => {
  mockFormat.mockImplementation(async (request) =>
    request.linker
      ? await request.linker(request.text, {
          file: request.file,
          signal: request.signal,
        })
      : request.text,
  );
  const test = await setup({ onSave: false });
  test.plugins["automatic-linker"] = {
    formatText: async (text: string) => `${text} linked`,
  };
  expect(test.feature.ownsExplicitSaveFormatting()).toBe(false);
  test.command.checkCallback(false);
  expect(test.saved).toEqual(["- hello"]);
  await test.feature.formatActiveEditor();
  expect(test.editor.getValue()).toBe("- hello linked");
  expect(test.saved).toEqual(["- hello"]);
  await test.feature.unload();
});

test("paste cleanup preserves HTML conversion and skips already handled or pure URL pastes", async () => {
  const test = await setup();
  test.settings.formatting = {
    ...test.settings.formatting,
    pasteFootnoteCleanup: true,
  };
  function paste(plain: string, html: string, prevented = false) {
    const event = {
      defaultPrevented: prevented,
      clipboardData: {
        getData: (type: string) => (type === "text/plain" ? plain : html),
      },
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
    };
    test.events.get("editor-paste")?.(event, test.editor);
  }
  paste("quote[12]", "<p>quote[12]</p>");
  paste("handled[1]", "", true);
  paste("https://example.com", "");
  expect(test.editor.replaceSelection.mock.calls).toEqual([["quote"]]);
  await test.feature.unload();
});
