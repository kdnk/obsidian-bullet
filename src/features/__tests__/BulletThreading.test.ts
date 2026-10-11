import { editorLivePreviewField } from "obsidian";

import { codeFolding, foldEffect } from "@codemirror/language";
import { EditorState, StateEffect } from "@codemirror/state";
import { Direction, layer } from "@codemirror/view";

import { Logger } from "../../services/Logger";
import { Parser } from "../../services/Parser";
import { Settings } from "../../services/Settings";
import { BulletThreading, bulletThreadingPath } from "../BulletThreading";

jest.mock(
  "obsidian",
  () => ({
    editorLivePreviewField: jest
      .requireActual<typeof import("@codemirror/state")>("@codemirror/state")
      .StateField.define({
        create: () => true,
        update: (value: boolean) => value,
      }),
  }),
  { virtual: true },
);

jest.mock("@codemirror/view", () => {
  const actual =
    jest.requireActual<typeof import("@codemirror/view")>("@codemirror/view");
  return { ...actual, layer: jest.fn(actual.layer) };
});

function setup() {
  const settings = new Settings({
    loadData: async () => null,
    saveData: async () => undefined,
  });
  const parser = new Parser(new Logger(settings), settings);
  const plugin = {
    registerEditorExtension: jest.fn<void, [unknown]>(),
    app: { workspace: { updateOptions: jest.fn() } },
  };
  const feature = new BulletThreading(plugin as never, settings, parser);
  return { settings, parser, plugin, feature };
}

const documentText = "- root\n\t- parent\n\t\t- selected\n\t- sibling";

function stateAt(doc: string, line: number) {
  const state = EditorState.create({
    doc,
    extensions: [editorLivePreviewField, codeFolding()],
  });
  return state.update({ selection: { anchor: state.doc.line(line).to } }).state;
}

function config() {
  const calls = jest.mocked(layer).mock.calls;
  const last = calls[calls.length - 1];
  if (!last) throw new Error("Expected threading layer to be enabled");
  return last[0];
}

function viewFor(state: EditorState) {
  const properties = new Map<string, string>();
  const dom = {
    className: "",
    setAttribute: jest.fn(),
    style: {
      setProperty: (key: string, value: string) => properties.set(key, value),
    },
  };
  const doc = { win: { createDiv: () => dom } };
  const coordsAtPos = jest.fn((offset: number) => {
    const line = state.doc.lineAt(offset);
    const x = (offset - line.from) * 10;
    return {
      left: x,
      right: x,
      top: line.number * 30,
      bottom: line.number * 30 + 20,
    };
  });
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    domAtPos: jest.fn(() => ({ node: { parentElement: null }, offset: 0 })),
    coordsAtPos,
    dom: { ownerDocument: doc },
    contentDOM: { children: [] },
    scrollDOM: {
      getBoundingClientRect: () => ({
        left: 0,
        right: 500,
        top: 0,
        bottom: 500,
      }),
      clientWidth: 500,
      scrollLeft: 0,
      scrollTop: 0,
    },
    textDirection: Direction.LTR,
    scaleX: 1,
    scaleY: 1,
    defaultCharacterWidth: 10,
  };
  return { view, properties, coordsAtPos, dom };
}

test("default off installs no runtime extension or parser work", async () => {
  const { settings, parser, plugin, feature } = setup();
  const parse = jest.spyOn(parser, "parse");
  jest.mocked(layer).mockClear();
  await feature.load();
  expect(settings.bulletThreading).toBe(false);
  expect(plugin.registerEditorExtension).toHaveBeenCalledWith([]);
  settings.bulletThreadingColor = "#123456";
  settings.betterListsStyles = !settings.betterListsStyles;
  expect(layer).not.toHaveBeenCalled();
  expect(parse).not.toHaveBeenCalled();
  expect(plugin.app.workspace.updateOptions).not.toHaveBeenCalled();
  await feature.unload();
});

test("enabling and disabling replaces and removes the registered runtime", async () => {
  const { settings, plugin, feature } = setup();
  await feature.load();
  const extensions = plugin.registerEditorExtension.mock.calls[0][0];
  settings.bulletThreading = true;
  expect(extensions).toHaveLength(1);
  const first = config();
  settings.bulletThreadingColor = "#123456";
  expect(config()).not.toBe(first);
  settings.bulletThreading = false;
  expect(extensions).toEqual([]);
  expect(plugin.app.workspace.updateOptions).toHaveBeenCalledTimes(3);
  await feature.unload();
  settings.bulletThreading = true;
  expect(extensions).toEqual([]);
  expect(plugin.app.workspace.updateOptions).toHaveBeenCalledTimes(3);
});

test("ancestor path excludes siblings and the synthetic root", () => {
  const { parser } = setup();
  expect(bulletThreadingPath(stateAt(documentText, 3), parser)).toEqual([
    { from: 0, to: 1, indent: "" },
    { from: 8, to: 9, indent: "\t" },
    { from: 19, to: 20, indent: "\t\t" },
  ]);
  expect(bulletThreadingPath(stateAt("plain text", 1), parser)).toEqual([]);
});

test("literal list markers in fenced code retain the actual owner", () => {
  const { parser } = setup();
  const doc = "- root\n\t- ```js\n\t  - literal code\n\t  ```\n\t- sibling";
  expect(bulletThreadingPath(stateAt(doc, 3), parser)).toEqual([
    { from: 0, to: 1, indent: "" },
    { from: 8, to: 9, indent: "\t" },
  ]);
});

test("drawing uses the selected color and caches the path during scrolling", async () => {
  const { settings, parser, feature } = setup();
  settings.bulletThreading = true;
  settings.bulletThreadingColor = "#123456";
  await feature.load();
  const parse = jest.spyOn(parser, "parse");
  const { view, properties, dom } = viewFor(stateAt(documentText, 3));
  const markers = config().markers(view as never);
  expect(markers).toHaveLength(2);
  expect(markers[0].draw()).toBe(dom);
  expect(properties.get("--bullet-thread-color")).toBe("#123456");
  expect(properties.get("--bullet-thread-height")).toBe("26px");
  config().markers(view as never);
  expect(parse).toHaveBeenCalledTimes(1);
  config().destroy?.({} as never, view as never);
  config().markers(view as never);
  expect(parse).toHaveBeenCalledTimes(2);
  await feature.unload();
});

test("zoom-hidden ancestors are excluded before any coordinate reads", async () => {
  const { settings, parser, plugin } = setup();
  settings.bulletThreading = true;
  const state = stateAt(documentText, 3);
  const from = state.doc.line(2).from;
  const feature = new BulletThreading(
    plugin as never,
    settings,
    parser,
    () => ({
      from,
      to: state.doc.line(3).to,
      indent: "\t",
    }),
  );
  await feature.load();
  const { view, coordsAtPos } = viewFor(state);
  expect(config().markers(view as never)).toHaveLength(1);
  expect(coordsAtPos.mock.calls.flat()).not.toContain(0);
  await feature.unload();
});

test("fold-hidden descendants are excluded before coordinate reads", async () => {
  const { settings, feature } = setup();
  settings.bulletThreading = true;
  await feature.load();
  const initial = stateAt(documentText, 3);
  const state = initial.update({
    effects: foldEffect.of({
      from: initial.doc.line(2).to,
      to: initial.doc.line(3).to,
    }),
  }).state;
  const { view, coordsAtPos } = viewFor(state);
  expect(config().markers(view as never)).toHaveLength(1);
  expect(coordsAtPos.mock.calls.flat()).not.toContain(
    state.doc.line(3).from + 2,
  );
  await feature.unload();
});

test("offscreen parent continues from the viewport using the visible native prefix", async () => {
  const { settings, feature } = setup();
  settings.bulletThreading = true;
  await feature.load();
  const state = stateAt(documentText, 3);
  const { view, properties, coordsAtPos } = viewFor(state);
  view.visibleRanges = [
    { from: state.doc.line(3).from, to: state.doc.line(3).to },
  ];
  const markers = config().markers(view as never);
  expect(markers).toHaveLength(1);
  markers[0].draw();
  expect(properties.get("--bullet-thread-left")).toBe("15px");
  expect(properties.get("--bullet-thread-top")).toBe("0px");
  expect(properties.get("--bullet-thread-width")).toBe("6px");
  expect(properties.get("--bullet-thread-height")).toBe("100px");
  expect(coordsAtPos).toHaveBeenCalledTimes(4);
  expect(coordsAtPos.mock.calls.flat()).not.toContain(0);
  expect(
    coordsAtPos.mock.calls.every(
      ([offset]) => offset >= state.doc.line(3).from,
    ),
  ).toBe(true);
  await feature.unload();
});

test("native RTL marker coordinates draw a right elbow", async () => {
  const { settings, feature } = setup();
  settings.bulletThreading = true;
  await feature.load();
  const state = stateAt(documentText, 3);
  const { view, properties, dom, coordsAtPos } = viewFor(state);
  view.textDirection = Direction.RTL;
  coordsAtPos.mockImplementation((offset) => {
    const line = state.doc.lineAt(offset);
    const x = 500 - (offset - line.from) * 10;
    return {
      left: x,
      right: x,
      top: line.number * 30,
      bottom: line.number * 30 + 20,
    };
  });
  const markers = config().markers(view as never);
  expect(markers).toHaveLength(2);
  markers[0].draw();
  expect(dom.className).toBe(
    "bullet-plugin-thread-edge bullet-plugin-thread-edge-rtl",
  );
  expect(properties.get("--bullet-thread-left")).toBe("489px");
  expect(properties.get("--bullet-thread-top")).toBe("44px");
  expect(properties.get("--bullet-thread-width")).toBe("6px");
  expect(properties.get("--bullet-thread-height")).toBe("26px");
  await feature.unload();
});

test.each([
  { doc: "100. root\n\t1. selected", markerEnd: 3 },
  { doc: "- root\n\t- [ ] selected", markerEnd: 2 },
])(
  "clipped parent with a different marker shape is omitted for $doc",
  async ({ doc, markerEnd }) => {
    const { settings, feature } = setup();
    settings.bulletThreading = true;
    await feature.load();
    const state = stateAt(doc, 2);
    const { view, coordsAtPos } = viewFor(state);
    coordsAtPos.mockImplementation((offset) => {
      const line = state.doc.lineAt(offset);
      const x = line.number * 40 + (offset - line.from) * 10;
      return {
        left: x,
        right: x,
        top: line.number * 30,
        bottom: line.number * 30 + 20,
      };
    });
    expect(config().markers(view as never)).toHaveLength(1);
    coordsAtPos.mockClear();
    view.visibleRanges = [
      { from: state.doc.line(2).from, to: state.doc.line(2).to },
    ];
    expect(config().markers(view as never)).toEqual([]);
    expect(coordsAtPos.mock.calls).toEqual([
      [state.doc.line(2).from + 1, 1],
      [state.doc.line(2).from + markerEnd, -1],
    ]);
    await feature.unload();
  },
);

test("clipped continuation measures native spacing instead of indent depth", async () => {
  const { settings, feature } = setup();
  settings.bulletThreading = true;
  await feature.load();
  const state = stateAt(documentText, 3);
  const { view, properties } = viewFor(state);
  const coordsAtPos = jest.fn((offset: number, side?: number) => ({
    left: offset === state.doc.line(3).from + 1 ? 60 : side === -1 ? 88 : 100,
    right: offset === state.doc.line(3).from + 1 ? 60 : side === -1 ? 88 : 100,
    top: 100,
    bottom: 120,
  }));
  const measuredView = {
    ...view,
    visibleRanges: [{ from: state.doc.line(3).from, to: state.doc.line(3).to }],
    coordsAtPos,
    domAtPos: () => ({
      node: {
        parentElement: {
          closest: () => ({
            querySelectorAll: () => [
              {
                getClientRects: () => [
                  {
                    left: 100,
                    right: 108,
                    top: 100,
                    bottom: 120,
                    width: 8,
                    height: 20,
                  },
                ],
              },
            ],
          }),
        },
      },
    }),
    scrollDOM: {
      ...view.scrollDOM,
      getBoundingClientRect: () => ({
        left: 0,
        right: 500,
        top: 20,
        bottom: 500,
      }),
    },
  };
  const markers = config().markers(measuredView as never);
  expect(markers).toHaveLength(1);
  markers[0].draw();
  expect(properties.get("--bullet-thread-left")).toBe("76px");
  expect(properties.get("--bullet-thread-top")).toBe("0px");
  expect(properties.get("--bullet-thread-width")).toBe("24px");
  expect(properties.get("--bullet-thread-height")).toBe("90px");
  expect(coordsAtPos.mock.calls).toEqual([
    [18, 1],
    [19, -1],
  ]);
  const unmeasurableView = { ...measuredView, coordsAtPos: () => null };
  expect(config().markers(unmeasurableView as never)).toEqual([]);
  await feature.unload();
});

test("source mode skips parsing and layout", async () => {
  const { settings, parser, feature } = setup();
  settings.bulletThreading = true;
  await feature.load();
  const parse = jest.spyOn(parser, "parse");
  const { view, coordsAtPos } = viewFor(
    EditorState.create({ doc: documentText }),
  );
  expect(config().markers(view as never)).toEqual([]);
  expect(parse).not.toHaveBeenCalled();
  expect(coordsAtPos).not.toHaveBeenCalled();
  await feature.unload();
});

test("zoom and folding effects schedule a fresh measurement", async () => {
  const { settings, feature } = setup();
  settings.bulletThreading = true;
  await feature.load();
  const state = stateAt(documentText, 3);
  const transaction = state.update({
    effects: StateEffect.define<void>().of(),
  });
  expect(
    config().update(
      {
        docChanged: false,
        selectionSet: false,
        viewportChanged: false,
        transactions: [transaction],
      } as never,
      {} as never,
    ),
  ).toBe(true);
  await feature.unload();
});

test("ordered and task items preserve their actual ancestors", () => {
  const { parser } = setup();
  const doc = "100. root\n\t2. [ ] parent\n\t\t- [x] selected\n\t3. sibling";
  const state = stateAt(doc, 3);
  expect(bulletThreadingPath(state, parser)).toEqual([
    { from: 0, to: 4, indent: "" },
    {
      from: state.doc.line(2).from + 1,
      to: state.doc.line(2).from + 3,
      indent: "\t",
    },
    {
      from: state.doc.line(3).from + 2,
      to: state.doc.line(3).from + 3,
      indent: "\t\t",
    },
  ]);
});

test("wrapped marker geometry uses its first rendered row", async () => {
  const { settings, feature } = setup();
  settings.bulletThreading = true;
  await feature.load();
  const state = stateAt(documentText, 3);
  const { view, properties, coordsAtPos } = viewFor(state);
  const measuredView = {
    ...view,
    domAtPos: (offset: number) => {
      const line = state.doc.lineAt(offset).number;
      return {
        node: {
          parentElement: {
            closest: () => ({
              querySelectorAll: () => [
                {
                  getClientRects: () => [
                    {
                      left: line * 20,
                      right: line * 20 + 8,
                      top: line * 30,
                      bottom: line * 30 + 20,
                      width: 8,
                      height: 20,
                    },
                    {
                      left: line * 20,
                      right: line * 20 + 8,
                      top: line * 30 + 20,
                      bottom: line * 30 + 40,
                      width: 8,
                      height: 20,
                    },
                  ],
                },
              ],
            }),
          },
        },
      };
    },
  };
  const markers = config().markers(measuredView as never);
  expect(markers).toHaveLength(2);
  markers[0].draw();
  expect(properties.get("--bullet-thread-top")).toBe("44px");
  expect(properties.get("--bullet-thread-height")).toBe("26px");
  expect(properties.get("--bullet-thread-width")).toBe("16px");
  expect(coordsAtPos).not.toHaveBeenCalled();
  await feature.unload();
});

test("task widgets at line boundaries use their visible bullet centers", async () => {
  const { settings, feature } = setup();
  settings.bulletThreading = true;
  await feature.load();
  const state = stateAt("- root\n\t- [ ] parent\n\t\t- [ ] child", 3);
  const { view, properties, coordsAtPos } = viewFor(state);
  const rows = [1, 2, 3].map((line) => ({
    line,
    classList: { contains: (value: string) => value === "cm-line" },
    querySelectorAll: () => [
      {
        getClientRects: () => [
          {
            left: line * 40,
            right: line * 40 + 8,
            top: line * 30,
            bottom: line * 30 + 20,
            width: 8,
            height: 20,
          },
        ],
      },
    ],
  }));
  const measuredView = {
    ...view,
    contentDOM: { children: rows },
    posAtDOM: (row: (typeof rows)[number]) => state.doc.line(row.line).from,
  };
  const markers = config().markers(measuredView as never);
  expect(markers).toHaveLength(2);
  markers[1].draw();
  expect(properties.get("--bullet-thread-left")).toBe("84px");
  expect(properties.get("--bullet-thread-width")).toBe("36px");
  expect(properties.get("--bullet-thread-height")).toBe("26px");
  expect(coordsAtPos).not.toHaveBeenCalled();
  await feature.unload();
});
