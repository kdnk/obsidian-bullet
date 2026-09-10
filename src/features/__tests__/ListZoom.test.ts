import { Command, editorInfoField } from "obsidian";

import { codeFolding, foldEffect, foldedRanges } from "@codemirror/language";
import {
  Compartment,
  EditorSelection,
  EditorState,
  Extension,
  StateEffect,
  Transaction,
  TransactionSpec,
  countColumn,
} from "@codemirror/state";
import { EditorView, showPanel } from "@codemirror/view";

import { makeLogger, makeSettings } from "../../__mocks__";
import { Parser } from "../../services/Parser";
import { ListZoom, ListZoomState, setListZoom } from "../ListZoom";

jest.mock(
  "obsidian",
  () => ({
    editorInfoField: jest
      .requireActual<typeof import("@codemirror/state")>("@codemirror/state")
      .StateField.define({
        create: () => null,
        update: (value: unknown) => value,
      }),
  }),
  { virtual: true },
);

const doc = "- work\n\t- project\n\t\t- task\n\t- other\n- personal";
function setup() {
  const zoom = new ListZoomState(new Parser(makeLogger(), makeSettings()));
  const state = EditorState.create({ doc, extensions: zoom.extension });
  return { zoom, state };
}

test("focuses a subtree without changing Markdown or another editor", () => {
  const { zoom, state } = setup();
  const focused = state.update({
    effects: setListZoom.of(7),
    selection: { anchor: 10 },
  }).state;
  expect(zoom.range(focused)).toMatchObject({ from: 7, to: 26, indent: "\t" });
  expect(focused.doc.toString()).toBe(doc);
  expect(zoom.range(state)).toBeNull();
});

test("recomputes the focused subtree after editing its children", () => {
  const { zoom, state } = setup();
  const focused = state.update({
    effects: setListZoom.of(7),
    selection: { anchor: 10 },
  }).state;
  const edited = focused.update({ changes: { from: 26, insert: "!" } }).state;
  expect(zoom.range(edited)?.to).toBe(27);
  expect(edited.doc.toString()).toBe(
    "- work\n\t- project\n\t\t- task!\n\t- other\n- personal",
  );
});

test("typing within a zoomed item does not scan thousands of hidden siblings", () => {
  const parser = new Parser(makeLogger(), makeSettings());
  const parse = parser.parse.bind(parser);
  let lineReads = 0;
  jest.spyOn(parser, "parse").mockImplementation((reader, cursor) =>
    parse(
      {
        ...reader,
        getLine: (line) => {
          lineReads++;
          return reader.getLine(line);
        },
      },
      cursor,
    ),
  );
  const zoom = new ListZoomState(parser);
  const text = [
    "- work",
    "\t- project",
    "\t\t- task",
    ...Array.from({ length: 1000 }, (_, i) => `\t- hidden ${i}`),
  ].join("\n");
  let state = EditorState.create({
    doc: text,
    extensions: zoom.extension,
  }).update({ effects: setListZoom.of(7) }).state;
  lineReads = 0;
  state = state.update({ changes: { from: 26, insert: "!" } }).state;
  state = state.update({ changes: { from: 17, insert: "!" } }).state;

  expect(state.doc.sliceString(7, zoom.range(state)!.to)).toBe(
    "\t- project!\n\t\t- task!",
  );
  expect(zoom.range(state)!.ancestors).toEqual([
    { from: 0, label: "work" },
    { from: 7, label: "project!" },
  ]);
  // A small fixed budget, independent of the number of hidden siblings.
  expect(lineReads).toBeLessThan(50);
});

test.each([true, false])(
  "typing at the visible end keeps new text outside hidden decorations (following text: %s)",
  (hasFollowingText) => {
    const zoom = new ListZoomState(new Parser(makeLogger(), makeSettings()));
    const state = EditorState.create({
      doc: hasFollowingText ? doc : doc.slice(0, 26),
      extensions: zoom.extension,
    }).update({ effects: setListZoom.of(7) }).state;
    const edited = state.update({
      changes: [
        { from: 17, insert: "!" },
        { from: 26, insert: " [done]" },
      ],
    }).state;
    const range = zoom.range(edited)!;
    const decorations: [number, number][] = [];
    range.decorations.between(0, edited.doc.length, (from, to) => {
      decorations.push([from, to]);
    });

    expect(range).toMatchObject({ from: 7, to: 34, indent: "\t" });
    expect(decorations).toEqual([
      [0, 7],
      [7, 8],
      [19, 20],
      ...(hasFollowingText ? [[34, 54]] : []),
    ]);
    const undone = edited.update({
      changes: { from: 29, to: 34 },
      filter: false,
    }).state;
    expect(zoom.range(undone)?.to).toBe(29);
  },
);

test("outdenting a child still recomputes the visible subtree", () => {
  const { zoom, state } = setup();
  const focused = state.update({ effects: setListZoom.of(7) }).state;
  const edited = focused.update({
    changes: { from: 18, to: 20, insert: "\t" },
  }).state;
  expect(zoom.range(edited)).toMatchObject({ from: 7, to: 17 });
  expect(edited.doc.sliceString(7, zoom.range(edited)!.to)).toBe("\t- project");
});

test("rejects edits that cross into hidden content", () => {
  const { state } = setup();
  const focused = state.update({
    effects: setListZoom.of(7),
    selection: { anchor: 10 },
  }).state;
  expect(
    focused
      .update({ changes: { from: 0, to: 10, insert: "oops" } })
      .state.doc.toString(),
  ).toBe(doc);
});

test("limits select-all to visible content", () => {
  const { state } = setup();
  const focused = state.update({
    effects: setListZoom.of(7),
    selection: { anchor: 10 },
  }).state;
  const selected = focused.update({
    selection: EditorSelection.single(0, doc.length),
  }).state;
  expect(selected.selection.main.from).toBe(8);
  expect(selected.selection.main.to).toBe(26);
});

test("exits zoom when the focused root is removed", () => {
  const { zoom, state } = setup();
  const focused = state.update({
    effects: setListZoom.of(7),
    selection: { anchor: 10 },
  }).state;
  const deleted = focused.update({
    changes: { from: 7, to: 26, insert: "" },
  }).state;
  expect(zoom.range(deleted)).toBeNull();
});

test("returning to the note leaves content unchanged", () => {
  const { zoom, state } = setup();
  const focused = state.update({
    effects: setListZoom.of(7),
    selection: { anchor: 10 },
  }).state;
  const restored = focused.update({ effects: setListZoom.of(null) }).state;
  expect(zoom.range(restored)).toBeNull();
  expect(restored.doc.toString()).toBe(doc);
});

test.each(["undo", "redo", "set"])(
  "reveals hidden changes from %s",
  (userEvent) => {
    const { zoom, state } = setup();
    const focused = state.update({
      effects: setListZoom.of(7),
      selection: { anchor: 10 },
    }).state;
    const changed = focused.update({
      changes: { from: 2, to: 6, insert: "office" },
      filter: false,
      userEvent,
    }).state;
    expect(zoom.range(changed)).toBeNull();
    expect(changed.doc.toString()).toContain("- office");
  },
);

test("adds another child at the visible end without absorbing the next sibling", () => {
  const { zoom, state } = setup();
  const focused = state.update({
    effects: setListZoom.of(7),
    selection: { anchor: 26 },
  }).state;
  const edited = focused.update({
    changes: { from: 26, insert: "\n\t\t- next" },
  }).state;
  const range = zoom.range(edited)!;
  expect(edited.doc.sliceString(range.from, range.to)).toBe(
    "\t- project\n\t\t- task\n\t\t- next",
  );
  expect(edited.doc.toString()).toContain("\n\t- other\n- personal");
});

test("the zoom command accepts an empty bare marker at EOF", async () => {
  const commands: Command[] = [];
  const extensions: Extension[] = [];
  const feature = new ListZoom(
    {
      addCommand: (command: Command) => commands.push(command),
      registerEditorExtension: (extension: Extension) =>
        extensions.push(extension),
    } as never,
    new Parser(makeLogger(), makeSettings()),
  );
  await feature.load();
  const view = {
    state: EditorState.create({ doc: "-", extensions }),
    scrollSnapshot: () => StateEffect.define<void>().of(),
    dispatch: (spec: Parameters<EditorState["update"]>[0]) => {
      view.state = view.state.update(spec).state;
    },
    focus: () => undefined,
  };
  const command = commands.find((entry) => entry.id === "zoom-in")!;
  expect(
    command.editorCheckCallback!(false, { cm: view } as never, {} as never),
  ).toBe(true);
  expect(view.state.selection.main.head).toBe(1);
  expect(view.state.doc.toString()).toBe("-");
});

test("restores the original viewport anchor after folding a zoomed branch below Properties", async () => {
  const commands: Command[] = [];
  const extensions: Extension[] = [codeFolding()];
  const feature = new ListZoom(
    {
      addCommand: (command: Command) => commands.push(command),
      registerEditorExtension: (extension: Extension) =>
        extensions.push(extension),
    } as never,
    new Parser(makeLogger(), makeSettings()),
  );
  await feature.load();
  const text = [
    "- before 1",
    "- before 2",
    "- before 3",
    "- parent",
    "\t- branch",
    "\t\t- leaf 1",
    "\t\t- leaf 2",
    "\t- sibling",
    "- after",
  ].join("\n");
  const transactions: Transaction[] = [];
  // Browser layout: 192px of Properties followed by 48px document lines.
  // At scrollTop=240 the viewport starts on before 2, but a raw snapshot
  // mistakes scrollTop for a document height and anchors inside leaf 1.
  const view = {
    state: EditorState.create({ doc: text, extensions }),
    dom: { ownerDocument: { defaultView: { devicePixelRatio: 2 } } },
    scaleY: 1,
    documentTop: -48,
    scrollDOM: {
      scrollTop: 240,
      scrollLeft: 0,
      getBoundingClientRect: () => ({ top: 0 }),
    },
    lineBlockAtHeight: (height: number) => {
      const index = Math.min(8, Math.max(0, Math.floor(height / 48)));
      return { from: view.state.doc.line(index + 1).from, top: index * 48 };
    },
    viewState: {
      scrollAnchorAt: (scrollTop: number) =>
        view.lineBlockAtHeight(scrollTop + 8),
    },
    // Use CodeMirror's real snapshot effect, including its mapping behavior.
    scrollSnapshot: () =>
      EditorView.prototype.scrollSnapshot.call(view as never),
    dispatch: (spec: TransactionSpec) => {
      const transaction = view.state.update(spec);
      view.state = transaction.state;
      transactions.push(transaction);
    },
    focus: () => undefined,
  };
  const run = (id: string) =>
    commands.find((entry) => entry.id === id)!.editorCheckCallback!(
      false,
      { cm: view } as never,
      {} as never,
    );
  view.dispatch({ selection: { anchor: view.state.doc.line(4).from } });
  expect(run("zoom-in")).toBe(true);
  const branch = {
    from: view.state.doc.line(5).to,
    to: view.state.doc.line(7).to,
  };
  view.dispatch({ effects: foldEffect.of(branch) });

  expect(run("zoom-reset")).toBe(true);

  const restored = transactions[transactions.length - 1];
  const snapshot = restored.effects.find((effect) => !effect.is(setListZoom));
  expect(snapshot?.value).toMatchObject({
    range: { anchor: 11, head: 11 },
    yMargin: -192,
    isSnapshot: true,
  });
  const remainingFolds: { from: number; to: number }[] = [];
  foldedRanges(restored.state).between(0, text.length, (from, to) => {
    remainingFolds.push({ from, to });
  });
  expect(remainingFolds).toEqual([branch]);
  expect(restored.state.doc.toString()).toBe(text);
});

test("accepts Obsidian set transactions from another pane and leaves zoom", () => {
  const { zoom, state } = setup();
  const focused = state.update({
    effects: setListZoom.of(7),
    selection: { anchor: 10 },
  }).state;
  const synced = focused.update({
    changes: {
      from: 0,
      to: doc.length,
      insert: "- office\n\t- project\n\t\t- task\n\t- other\n- personal",
    },
    userEvent: "set",
  }).state;
  expect(synced.doc.toString()).toBe(
    "- office\n\t- project\n\t\t- task\n\t- other\n- personal",
  );
  expect(zoom.range(synced)).toBeNull();
});

test.each([
  { from: doc.length, insert: "\n", wantFrom: 7, wantTo: 26 },
  { from: 0, insert: "---\nmodified: today\n---\n", wantFrom: 31, wantTo: 50 },
])(
  "keeps zoom when a formatter changes hidden text at $from",
  ({ from, insert, wantFrom, wantTo }) => {
    const { zoom, state } = setup();
    const focused = state.update({
      effects: setListZoom.of(7),
      selection: { anchor: 10 },
    }).state;
    const synced = focused.update({
      changes: { from, insert },
      filter: false,
    }).state;

    expect(synced.doc.toString()).toBe(
      doc.slice(0, from) + insert + doc.slice(from),
    );
    expect(zoom.range(synced)).toMatchObject({
      from: wantFrom,
      to: wantTo,
      indent: "\t",
    });
  },
);

test("keeps the focused item through sequential linter deletes and inserts", () => {
  const text = "---\nmodified: old\n---\n" + doc;
  const zoom = new ListZoomState(new Parser(makeLogger(), makeSettings()));
  let state = EditorState.create({
    doc: text,
    extensions: zoom.extension,
  }).update({ effects: setListZoom.of(text.indexOf("\t- project")) }).state;
  for (const changes of [
    { from: 14, to: 17, insert: "" },
    { from: 14, insert: "new timestamp" },
  ]) {
    state = state.update({ changes, filter: false }).state;
    const range = zoom.range(state);
    expect(range).not.toBeNull();
    expect(state.doc.sliceString(range!.from, range!.to)).toBe(
      "\t- project\n\t\t- task",
    );
    expect(
      range!.ancestors.map((ancestor) =>
        state.doc.lineAt(ancestor.from).text.trim(),
      ),
    ).toEqual(["- work", "- project"]);
  }
});

test("does not focus the next sibling when a formatter removes the entire zoomed subtree", () => {
  const { zoom, state } = setup();
  const focused = state.update({ effects: setListZoom.of(7) }).state;
  const deleted = focused.update({
    changes: { from: 7, to: 27 },
    filter: false,
  }).state;
  expect(deleted.doc.toString()).toBe("- work\n\t- other\n- personal");
  expect(zoom.range(deleted)).toBeNull();
});

test.each([
  { marker: "-", replacement: "*" },
  { marker: "2.", replacement: "1." },
])(
  "keeps zoom when a formatter changes $marker to $replacement",
  ({ marker, replacement }) => {
    const text = doc.replace("\t- project", `\t${marker} project`);
    const zoom = new ListZoomState(new Parser(makeLogger(), makeSettings()));
    const focused = EditorState.create({
      doc: text,
      extensions: zoom.extension,
    }).update({ effects: setListZoom.of(7) }).state;
    const formatted = focused.update({
      changes: { from: 8, to: 8 + marker.length, insert: replacement },
      filter: false,
    }).state;
    expect(
      zoom.range(formatted)?.ancestors.map((ancestor) => ancestor.label),
    ).toEqual(["work", "project"]);
    expect(formatted.doc.toString()).toBe(
      text.replace(`${marker} project`, `${replacement} project`),
    );
  },
);

test("clears zoom when a reused editor changes files without changing text", () => {
  const zoom = new ListZoomState(new Parser(makeLogger(), makeSettings()));
  const info = { file: { path: "first.md" } };
  const state = EditorState.create({
    doc,
    extensions: [zoom.extension, editorInfoField.init(() => info as never)],
  });
  const focused = state.update({
    effects: setListZoom.of(7),
    selection: { anchor: 10 },
  }).state;
  info.file = { path: "second.md" };
  expect(zoom.range(focused.update({}).state)).toBeNull();
});

test.each(["subtree", "whole-document", "unfiltered", "set"])(
  "keeps the same root through a coarse %s replacement",
  (kind) => {
    const { zoom, state } = setup();
    const focused = state.update({ effects: setListZoom.of(7) }).state;
    const next = focused.update({
      changes:
        kind === "subtree"
          ? { from: 8, to: 26, insert: "- project\n\t\t- updated task" }
          : {
              from: 0,
              to: doc.length,
              insert: doc.replace("task", "updated task"),
            },
      ...(kind === "unfiltered"
        ? { filter: false, selection: { anchor: 10 } }
        : {}),
      ...(kind === "set" ? { userEvent: "set" } : {}),
    }).state;
    expect(next.doc.toString()).toBe(doc.replace("task", "updated task"));
    expect(zoom.range(next)).toMatchObject({ from: 7, to: 34 });
  },
);

test("applies whole-document programmatic changes but reveals changed hidden content", () => {
  const { zoom, state } = setup();
  const focused = state.update({ effects: setListZoom.of(7) }).state;
  const text = doc.replace("personal", "private");
  const next = focused.update({
    changes: { from: 0, to: doc.length, insert: text },
  }).state;
  expect(next.doc.toString()).toBe(text);
  expect(zoom.range(next)).toBeNull();
});

test.each([undefined, "set"])(
  "keeps the cursor editable after a coarse replacement (%s)",
  (userEvent) => {
    const { zoom, state } = setup();
    const focused = state.update({
      effects: setListZoom.of(7),
      selection: { anchor: 10 },
    }).state;
    const replaced = focused.update({
      changes: {
        from: 0,
        to: doc.length,
        insert: doc.replace("task", "updated task"),
      },
      userEvent,
    }).state;
    expect(replaced.selection.main.head).toBe(10);
    const typed = replaced.update({
      changes: { from: replaced.selection.main.head, insert: "new " },
      userEvent: "input",
    }).state;
    expect(typed.doc.toString()).toContain("- new project");
    expect(zoom.range(typed)).not.toBeNull();
  },
);

test("does not allow an annotated whole-note editing command to erase hidden content", () => {
  const { state } = setup();
  const focused = state.update({ effects: setListZoom.of(7) }).state;
  expect(
    focused
      .update({
        changes: { from: 0, to: doc.length, insert: "oops" },
        userEvent: "input",
      })
      .state.doc.toString(),
  ).toBe(doc);
});

test("reveals an unfiltered whole-document replacement whose caller leaves the cursor hidden", () => {
  const { zoom, state } = setup();
  const focused = state.update({
    effects: setListZoom.of(7),
    selection: { anchor: 10 },
  }).state;
  const next = focused.update({
    changes: {
      from: 0,
      to: doc.length,
      insert: doc.replace("task", "updated task"),
    },
    filter: false,
  }).state;
  expect(next.selection.main.head).toBe(0);
  expect(zoom.range(next)).toBeNull();
  const typed = next.update({
    changes: { from: 0, insert: "X" },
    userEvent: "input",
  }).state;
  expect(typed.doc.toString()).toBe("X" + doc.replace("task", "updated task"));
});

test("deleting a root does not focus an identical next sibling", () => {
  const zoom = new ListZoomState(new Parser(makeLogger(), makeSettings()));
  const text = doc.replace("other", "project");
  const state = EditorState.create({
    doc: text,
    extensions: zoom.extension,
  }).update({ effects: setListZoom.of(7) }).state;
  const next = state.update({
    changes: { from: 7, to: 27 },
    filter: false,
  }).state;
  expect(next.doc.toString()).toBe("- work\n\t- project\n- personal");
  expect(zoom.range(next)).toBeNull();
});

test("keeps zoom when the same file is renamed", () => {
  const zoom = new ListZoomState(new Parser(makeLogger(), makeSettings()));
  const info = { file: { path: "first.md" } };
  const state = EditorState.create({
    doc,
    extensions: [zoom.extension, editorInfoField.init(() => info as never)],
  }).update({ effects: setListZoom.of(7) }).state;
  info.file.path = "renamed.md";
  const next = state.update({ changes: { from: 26, insert: "!" } }).state;
  expect(zoom.range(next)).toMatchObject({ from: 7, to: 27 });
});

test.each([
  ["\t", "        ", 4],
  ["    ", "\t\t", 4],
  ["      ", "        ", 2],
  ["      ", "\t\t", 2],
  ["      ", "\t\t\t", 6],
  ["      ", "\t \t", 2],
  ["\t  ", "\t\t  ", 4],
])(
  "removes visual indent %j from %j leaving %i columns",
  (parent, child, columns) => {
    const zoom = new ListZoomState(new Parser(makeLogger(), makeSettings()));
    const text = `- work\n${parent}- project\n${child}- task\n- other`;
    const state = EditorState.create({
      doc: text,
      extensions: [zoom.extension, EditorState.tabSize.of(4)],
    }).update({ effects: setListZoom.of(7) }).state;
    const range = zoom.range(state)!;
    const line = state.doc.line(3);
    let offset = line.from;
    let displayed = "";
    range.indents.between(line.from, line.to, (from, to, decoration) => {
      if (from < line.from) return;
      displayed += state.doc.sliceString(offset, from);
      const spec = decoration.spec as {
        class?: string;
        attributes?: { style: string };
        widget?: unknown;
      };
      expect(spec.widget).toBeUndefined();
      if (spec.class === "bullet-zoom-tab")
        displayed += " ".repeat(
          Number(/: (\d+)ch/.exec(spec.attributes!.style)![1]),
        );
      offset = to;
    });
    displayed += state.doc.sliceString(offset, line.from + child.length);
    expect(countColumn(displayed, 4)).toBe(columns);
    expect(state.doc.toString()).toBe(text);
  },
);

test("rebuilds indentation when tab size changes without document edits", () => {
  const zoom = new ListZoomState(new Parser(makeLogger(), makeSettings()));
  const tabs = new Compartment();
  const state = EditorState.create({
    doc: "- work\n\t- project\n        - task",
    extensions: [zoom.extension, tabs.of(EditorState.tabSize.of(4))],
  }).update({ effects: setListZoom.of(7) }).state;
  const next = state.update({
    effects: tabs.reconfigure(EditorState.tabSize.of(8)),
  }).state;
  const indents: [number, number][] = [];
  zoom.range(next)!.indents.between(18, next.doc.length, (from, to) => {
    indents.push([from, to]);
  });
  expect(indents).toEqual([[18, 26]]);
});

test("removing the plugin extension while zoomed reveals the unchanged document", () => {
  const { state, zoom } = setup();
  const focused = state.update({ effects: setListZoom.of(7) }).state;
  const removed = focused.update({
    effects: StateEffect.reconfigure.of([]),
  }).state;
  expect(removed.doc.toString()).toBe(doc);
  expect(zoom.range(removed)).toBeNull();
});

test("the breadcrumb panel tolerates the zoom field disappearing during plugin reload", async () => {
  const extensions: Extension[] = [];
  const feature = new ListZoom(
    {
      app: { vault: { on: jest.fn(), offref: jest.fn() } },
      addCommand: () => undefined,
      registerEditorExtension: (extension: Extension) =>
        extensions.push(extension),
    } as never,
    new Parser(makeLogger(), makeSettings()),
  );
  await feature.load();
  const labels: string[] = [];
  const panelDom = {
    classList: { add: () => undefined },
    setAttribute: () => undefined,
    replaceChildren: () => {
      labels.length = 0;
    },
    createSpan: () => undefined,
    createEl: (_tag: string, { text }: { text: string }) => {
      labels.push(text);
      return {
        setAttribute: () => undefined,
        addEventListener: () => undefined,
      };
    },
  };
  const focused = EditorState.create({ doc, extensions }).update({
    effects: setListZoom.of(7),
  }).state;
  const view = {
    state: focused,
    dom: { ownerDocument: { win: { createDiv: () => panelDom } } },
  };
  const panel = (
    feature as unknown as {
      panel(view: unknown): import("@codemirror/view").Panel;
    }
  ).panel(view);
  expect(labels).toContain("project");
  // The callback can run as the panel extension is being torn down.
  view.state = EditorState.create({ doc });
  panel.update!({
    startState: focused,
    state: view.state,
    docChanged: false,
  } as never);
  expect(labels).toEqual([]);
});

test("unchanged breadcrumbs retain their buttons while edited labels refresh", async () => {
  const extensions: Extension[] = [];
  let onRename: (file: unknown) => void = () => undefined;
  const ref = {};
  const vault = {
    on: jest.fn((event: string, callback: typeof onRename) => {
      expect(event).toBe("rename");
      onRename = callback;
      return ref;
    }),
    offref: jest.fn(),
  };
  const feature = new ListZoom(
    {
      app: { vault },
      addCommand: () => undefined,
      registerEditorExtension: (extension: Extension) =>
        extensions.push(extension),
    } as never,
    new Parser(makeLogger(), makeSettings()),
  );
  await feature.load();
  const buttons: { title: string; click: () => void }[] = [];
  const panelDom = {
    classList: { add: () => undefined },
    setAttribute: () => undefined,
    replaceChildren: () => {
      buttons.length = 0;
    },
    createSpan: () => undefined,
    createEl: () => {
      const button = {
        title: "",
        click: () => undefined as void,
        setAttribute: () => undefined,
        addEventListener: (_event: string, callback: () => void) => {
          button.click = callback;
        },
      };
      buttons.push(button);
      return button;
    },
  };
  const info = { file: { path: "folder/Daily.md", basename: "Daily" } };
  const view = {
    state: EditorState.create({
      doc,
      extensions: [extensions, editorInfoField.init(() => info as never)],
    }).update({
      effects: setListZoom.of(7),
    }).state,
    dom: { ownerDocument: { win: { createDiv: () => panelDom } } },
    dispatch: (spec: TransactionSpec) => {
      view.state = view.state.update(spec).state;
    },
    focus: () => undefined,
  };
  const panel = (
    feature as unknown as {
      panel(view: unknown): import("@codemirror/view").Panel;
    }
  ).panel(view);
  const originalButtons = [...buttons];
  const edit = (changes: TransactionSpec["changes"]) => {
    const startState = view.state;
    const transaction = startState.update({ changes });
    view.state = transaction.state;
    panel.update!({
      startState,
      state: view.state,
      docChanged: true,
      changes: transaction.changes,
    } as never);
  };

  edit({ from: 26, insert: "!" });
  expect(buttons.map((button) => button.title)).toEqual([
    "Daily",
    "work",
    "project",
  ]);
  buttons.forEach((button, index) =>
    expect(button).toBe(originalButtons[index]),
  );
  // Structural edits must also preserve the controls when their labels and targets are unchanged.
  edit({ from: 27, insert: "\n\t\t- next" });
  buttons.forEach((button, index) =>
    expect(button).toBe(originalButtons[index]),
  );
  edit({ from: 10, to: 17, insert: "renamed" });
  expect(buttons.map((button) => button.title)).toEqual([
    "Daily",
    "work",
    "renamed",
  ]);
  info.file.basename = "Today";
  info.file.path = "folder/Today.md";
  onRename({ path: "unrelated.md" });
  expect(buttons[0].title).toBe("Daily");
  onRename(info.file);
  expect(buttons[0].title).toBe("Today");
  edit({ from: 26, insert: "!" });
  expect(buttons[0].title).toBe("Today");
  const content = view.state.doc.toString();
  buttons[0].click();
  expect(view.state.facet(showPanel)).toEqual([null]);
  expect(view.state.doc.toString()).toBe(content);
  panel.destroy!();
  expect(vault.offref).toHaveBeenCalledWith(ref);
});
