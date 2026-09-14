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
import { MyEditor, MyEditorPosition, MyEditorSelection } from "../../editor";
import { CreateNewItem } from "../../operations/CreateNewItem";
import { ChangesApplicator } from "../../services/ChangesApplicator";
import { OperationPerformer } from "../../services/OperationPerformer";
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

test("focuses a nested fenced-code item whose code looks like a list", () => {
  const text = [
    "- aaa",
    "\t- ```go",
    "\t  const value = 1;",
    "\t  - literal list marker",
    "\t  ```",
    "\t- next",
    "- after",
  ].join("\n");
  const zoom = new ListZoomState(new Parser(makeLogger(), makeSettings()));
  const state = EditorState.create({ doc: text, extensions: zoom.extension });
  const from = state.doc.line(2).from;

  const focused = state.update({ effects: setListZoom.of(from) }).state;

  expect(zoom.range(focused)).toMatchObject({
    from,
    to: state.doc.line(5).to,
    indent: "\t",
  });
  expect(zoom.range(focused)?.ancestors.map(({ label }) => label)).toEqual([
    "aaa",
    "```go",
  ]);
  expect(focused.doc.toString()).toBe(text);
});

test("focuses a fenced-code item across extra indentation and a physical blank line", () => {
  const text = [
    "- aaa",
    "\t- ```go",
    "\t    additionally indented",
    "",
    "\t  - literal list marker",
    "\t  ```",
    "\t- next",
    "- after",
  ].join("\n");
  const zoom = new ListZoomState(new Parser(makeLogger(), makeSettings()));
  const state = EditorState.create({ doc: text, extensions: zoom.extension });
  const from = state.doc.line(2).from;

  const focused = state.update({ effects: setListZoom.of(from) }).state;

  expect(zoom.range(focused)).toMatchObject({
    from,
    to: state.doc.line(6).to,
    indent: "\t",
  });
  expect(focused.doc.toString()).toBe(text);
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

test("rejects outdenting a direct child into a sibling of the focused root", () => {
  const { zoom, state } = setup();
  const focused = state.update({ effects: setListZoom.of(7) }).state;
  const edited = focused.update({
    changes: { from: 18, to: 20, insert: "\t" },
  }).state;
  expect(zoom.range(edited)).toMatchObject({ from: 7, to: 26 });
  expect(edited.doc.toString()).toBe(doc);
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

test.each(["precise", "whole-set", "line-set", "parent-context"])(
  "follows the original focused item when a sibling is inserted immediately above it (%s)",
  (kind) => {
    const { zoom, state } = setup();
    const focused = state.update({
      effects: setListZoom.of(7),
      selection: { anchor: 10 },
    }).state;
    const inserted = "\t- new\n";
    const text = doc.slice(0, 7) + inserted + doc.slice(7);
    const next = focused.update({
      changes:
        kind === "precise"
          ? { from: 7, insert: inserted }
          : kind === "whole-set"
            ? { from: 0, to: doc.length, insert: text }
            : kind === "line-set"
              ? { from: 7, to: 17, insert: "\t- new\n\t- project" }
              : { from: 0, to: 6, insert: "- work\n\t- new" },
      userEvent: kind.endsWith("set") ? "set" : "input",
    }).state;
    if (!kind.endsWith("set")) {
      expect(next.doc.toString()).toBe(doc);
      expect(zoom.range(next)).toMatchObject({ from: 7, to: 26 });
      expect(next.selection.main.head).toBe(10);
      return;
    }
    expect(next.doc.toString()).toBe(text);
    expect(zoom.range(next)).toMatchObject({ from: 14, to: 33 });
    expect(zoom.range(next)?.ancestors.map(({ label }) => label)).toEqual([
      "work",
      "project",
    ]);
    expect(next.selection.main.head).toBe(17);
    const typed = next.update({
      changes: { from: next.selection.main.head, insert: "new " },
      userEvent: "input",
    }).state;
    expect(typed.doc.toString()).toBe(text.replace("project", "new project"));
  },
);

test("still rejects parent-context replacements that actually change hidden text", () => {
  const { zoom, state } = setup();
  const focused = state.update({
    effects: setListZoom.of(7),
    selection: { anchor: 10 },
  }).state;
  const next = focused.update({
    changes: { from: 0, to: 6, insert: "- office\n\t- new" },
    userEvent: "input",
  }).state;
  expect(next.doc.toString()).toBe(doc);
  expect(zoom.range(next)).toMatchObject({ from: 7, to: 26 });
  expect(next.selection.main.head).toBe(10);
});

test.each(["input", "set"])(
  "handles a changed hidden newline without treating it as unchanged (%s)",
  (userEvent) => {
    const { zoom, state } = setup();
    const focused = state.update({
      effects: setListZoom.of(7),
      selection: { anchor: 10 },
    }).state;
    const next = focused.update({
      changes: { from: 6, to: 7, insert: "X" },
      userEvent,
    }).state;
    if (userEvent === "input") {
      expect(next.doc.toString()).toBe(doc);
      expect(zoom.range(next)).toMatchObject({ from: 7, to: 26 });
    } else {
      expect(next.doc.toString()).toBe(doc.replace("\n", "X"));
      expect(zoom.range(next)).toBeNull();
    }
  },
);

test("does not retarget zoom when a formatter batch also replaces the separator used by a context insertion", () => {
  const { zoom, state } = setup();
  const focused = state.update({
    effects: setListZoom.of(7),
    selection: { anchor: 10 },
  }).state;
  const next = focused.update({
    changes: [
      { from: 0, to: 6, insert: "- work\n\t- new" },
      { from: 6, to: 7, insert: "X" },
    ],
    filter: false,
  }).state;
  expect(next.doc.toString()).toBe(
    "- work\n\t- newX\t- project\n\t\t- task\n\t- other\n- personal",
  );
  expect(zoom.range(next)).toBeNull();
});

test("rejects a legacy sibling insertion and keeps the focused body editable", () => {
  const parser = new Parser(makeLogger(), makeSettings());
  const zoom = new ListZoomState(parser);
  let state = EditorState.create({ doc, extensions: zoom.extension }).update({
    effects: setListZoom.of(7),
    selection: { anchor: 10 },
  }).state;
  const offset = (pos: MyEditorPosition) =>
    state.doc.line(pos.line + 1).from + pos.ch;
  const position = (offset: number) => {
    const line = state.doc.lineAt(offset);
    return { line: line.number - 1, ch: offset - line.from };
  };
  const editor = {
    getCursor: () => position(state.selection.main.head),
    getLine: (n: number) => state.doc.line(n + 1).text,
    lastLine: () => state.doc.lines - 1,
    listSelections: () =>
      state.selection.ranges.map((r) => ({
        anchor: position(r.anchor),
        head: position(r.head),
      })),
    getAllFoldedLines: () => [],
    getRange: (from: MyEditorPosition, to: MyEditorPosition) =>
      state.doc.sliceString(offset(from), offset(to)),
    replaceRange: (...args: Parameters<MyEditor["replaceRange"]>) => {
      const view = {
        get state() {
          return state;
        },
        dispatch(tr: Transaction | TransactionSpec) {
          state = tr instanceof Transaction ? tr.state : state.update(tr).state;
        },
      };
      new MyEditor({ cm: view } as never).replaceRange(...args);
    },
    setSelections: (ranges: MyEditorSelection[]) => {
      state = state.update({
        selection: EditorSelection.create(
          ranges.map((r) =>
            EditorSelection.range(offset(r.anchor), offset(r.head)),
          ),
        ),
      }).state;
    },
    fold: () => {},
    unfold: () => {},
  } as unknown as MyEditor;
  new OperationPerformer(parser, new ChangesApplicator()).perform(
    (root) => new CreateNewItem(root, "\t", true),
    editor,
  );
  expect(state.doc.toString()).toBe(doc);
  expect(zoom.range(state)).toMatchObject({ from: 7, to: 26 });
  expect(zoom.range(state)?.ancestors.map(({ label }) => label)).toEqual([
    "work",
    "project",
  ]);
  expect(state.selection.main.head).toBe(10);
  state = state.update({
    changes: { from: state.selection.main.head, insert: "new " },
    userEvent: "input",
  }).state;
  expect(state.doc.line(2).text).toBe("\t- new project");
  expect(zoom.range(state)?.ancestors.map(({ label }) => label)).toEqual([
    "work",
    "new project",
  ]);
  expect(state.selection.main.head).toBe(10);
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

test("keeps the focused root when a local deletion would remove it", () => {
  const { zoom, state } = setup();
  const focused = state.update({
    effects: setListZoom.of(7),
    selection: { anchor: 10 },
  }).state;
  const deleted = focused.update({
    changes: { from: 7, to: 26, insert: "" },
  }).state;
  expect(zoom.range(deleted)).toMatchObject({ from: 7, to: 26 });
  expect(deleted.doc.toString()).toBe(doc);
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
  expect(view.state.selection.main.head).toBe(5);
  expect(view.state.doc.toString()).toBe("-\n\t- ");
  view.state = view.state.update({ selection: { anchor: 1 } }).state;
  command.editorCheckCallback!(false, { cm: view } as never, {} as never);
  expect(view.state.doc.toString()).toBe("-\n\t- ");
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

test("maps the return viewport through the child created on initial zoom", async () => {
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
  const snapshot = StateEffect.define<number>({
    map: (value, changes) => changes.mapPos(value),
  });
  const transactions: Transaction[] = [];
  const view = {
    state: EditorState.create({ doc: "- root\n- after", extensions }),
    scrollSnapshot: () => snapshot.of(7),
    focus: () => undefined,
    dispatch: (spec: TransactionSpec) => {
      const tr = view.state.update(spec);
      view.state = tr.state;
      transactions.push(tr);
    },
  };
  const run = (id: string) =>
    commands.find((command) => command.id === id)!.editorCheckCallback!(
      false,
      { cm: view } as never,
      {} as never,
    );
  run("zoom-in");
  expect(view.state.doc.toString()).toBe("- root\n\t- \n- after");
  run("zoom-reset");
  expect(
    transactions[transactions.length - 1]?.effects.find((effect) =>
      effect.is(snapshot),
    )?.value,
  ).toBe(11);
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

test("keeps the focused item through sequential linter marker replacements", () => {
  const zoom = new ListZoomState(new Parser(makeLogger(), makeSettings()));
  let state = EditorState.create({
    doc,
    extensions: zoom.extension,
  }).update({ effects: setListZoom.of(7) }).state;

  for (const originalMarker of [0, 8, 20, 28, 36]) {
    const marker = state.doc.sliceString(originalMarker, originalMarker + 1);
    expect(marker).toBe("-");
    state = state.update({
      changes: { from: originalMarker, to: originalMarker + 1 },
      filter: false,
    }).state;
    if (!zoom.range(state))
      throw new Error(`lost zoom after deleting marker at ${originalMarker}`);
    state = state.update({
      changes: { from: originalMarker, insert: "*" },
      filter: false,
    }).state;
    if (!zoom.range(state))
      throw new Error(`lost zoom after inserting marker at ${originalMarker}`);
  }

  expect(state.doc.toString()).toBe(
    "* work\n\t* project\n\t\t* task\n\t* other\n* personal",
  );
  expect(zoom.range(state)?.ancestors.map(({ label }) => label)).toEqual([
    "work",
    "project",
  ]);
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

test.each([
  { text: doc, root: 7, from: 7, to: 8, insert: "    ", line: "    - project" },
  {
    text: doc.replace("\t- project", "    - project"),
    root: 7,
    from: 7,
    to: 11,
    insert: "\t",
    line: "\t- project",
  },
  {
    text: "- project\n\t- child\n- other",
    root: 0,
    from: 0,
    to: 1,
    insert: "*",
    line: "* project",
  },
  {
    text: doc,
    root: 7,
    from: 7,
    to: 8,
    insert: "\t\t",
    line: "\t\t- project",
    whole: true,
  },
  {
    text: doc.replace("\t- project", "  - project"),
    root: 7,
    from: 7,
    to: 9,
    insert: "    ",
    line: "    - project",
    whole: true,
  },
])(
  "keeps the original focused line when a formatter replaces its leading prefix ($line)",
  ({ text, root, from, to, insert, line, whole }) => {
    const zoom = new ListZoomState(new Parser(makeLogger(), makeSettings()));
    const focused = EditorState.create({
      doc: text,
      extensions: zoom.extension,
    }).update({ effects: setListZoom.of(root) }).state;
    const next = focused.update({
      changes: whole
        ? {
            from: 0,
            to: text.length,
            insert: text.slice(0, from) + insert + text.slice(to),
          }
        : { from, to, insert },
      filter: false,
      selection: { anchor: root + line.length },
    }).state;
    expect(next.doc.lineAt(root).text).toBe(line);
    expect(zoom.range(next)?.from).toBe(root);
    expect(
      zoom
        .range(next)
        ?.ancestors.map(({ label }) => label)
        .pop(),
    ).toBe("project");
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
