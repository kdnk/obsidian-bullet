import { Platform } from "obsidian";

import {
  EditorState,
  Extension,
  Transaction,
  TransactionSpec,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { Settings } from "../../services/Settings";
import { FoldScrollReservePluginValue } from "../FoldScroll";
import { FoldScrollReserve } from "../FoldScrollReserve";
import { selectionLayout } from "../selectionLayout";

jest.mock("obsidian", () => ({ Platform: { isMobile: false } }), {
  virtual: true,
});

type Measurement = NonNullable<Parameters<EditorView["requestMeasure"]>[0]>;

interface TestElement {
  className: string;
  style: { height: string; paddingBottom: string };
  parentElement: { getBoundingClientRect(): { bottom: number } } | null;
  attributes: Map<string, string>;
  children: TestElement[];
  clientHeight: number;
  clientWidth: number;
  scrollHeight: number;
  scrollTop: number;
  setAttribute(name: string, value: string): void;
  append(child: TestElement): void;
  remove: jest.Mock;
  getBoundingClientRect(): { height: number };
}

function makeView(autoHeightTableCell = false, transform = "none") {
  const geometry = {
    naturalBottom: 900,
    anchorTop: 220.25,
    padding: 32,
    scale: 1,
    dpr: 1,
    quantize: (value: number) => Math.round(value),
  };
  const measurements: Measurement[] = [];
  const elements: TestElement[] = [];
  const quantized: number[] = [];
  const classes = new Set<string>();
  const properties = new Map<string, string>();
  const container = {
    contains: () => true,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
    },
    style: {
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    },
  };
  function create(): TestElement {
    let scrollTop = 0;
    const element: TestElement = {
      className: "",
      style: { height: "", paddingBottom: "" },
      parentElement: null,
      attributes: new Map<string, string>(),
      children: [],
      clientHeight: 1,
      clientWidth: 1,
      get scrollHeight() {
        return Number.parseFloat(element.children[0]?.style.height ?? "0") || 0;
      },
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(value: number) {
        quantized.push(value);
        scrollTop = geometry.quantize(value);
      },
      setAttribute: (name: string, value: string) =>
        element.attributes.set(name, value),
      append: (child: TestElement) => element.children.push(child),
      remove: jest.fn(),
      getBoundingClientRect: () => ({
        height:
          (element.className.endsWith("padding-probe")
            ? geometry.padding
            : Number.parseFloat(element.style.height) || 0) * geometry.scale,
      }),
    };
    elements.push(element);
    return element;
  }
  const host = {
    contains: (element: unknown) => element === container,
    append: (element: TestElement) => {
      element.parentElement = host;
    },
    getBoundingClientRect: () => ({
      bottom:
        geometry.naturalBottom +
        (Number.parseFloat(elements[0]?.style.height ?? "0") || 0) *
          geometry.scale,
    }),
  };
  const win = {
    createDiv: create,
    setTimeout: jest.fn(() => 1),
    clearTimeout: jest.fn(),
    getComputedStyle: () => ({
      paddingBottom: "32px",
      transform,
      translate: "none",
    }),
    get devicePixelRatio() {
      return geometry.dpr;
    },
  };
  const view = {
    composing: false,
    compositionStarted: false,
    state: EditorState.create({
      doc: "- parent\n\t- child",
      extensions: [
        EditorView.scrollMargins.of(() => ({ top: 12 })),
        EditorView.scrollMargins.of(() => ({ top: 24 })),
      ],
    }),
    dom: {
      closest: () => (autoHeightTableCell ? {} : null),
      ownerDocument: { win, defaultView: win },
    },
    contentDOM: {
      closest: (selector: string) =>
        selector === ".cm-sizer" ? host : container,
      style: { paddingBottom: "100px" },
    },
    scrollDOM: {
      scrollHeight: 2000,
      scrollTop: 4371,
      clientHeight: 600,
      contains: (element: unknown) => element === host,
      getBoundingClientRect: () => ({ top: 50, bottom: 650 }),
    },
    get scaleY() {
      return geometry.scale;
    },
    coordsAtPos: jest.fn(() => {
      const top =
        geometry.anchorTop +
        (Number.parseFloat(
          properties.get("--bullet-plugin-fold-scroll-offset") ?? "0",
        ) || 0) *
          geometry.scale;
      return { top, bottom: top + 18 };
    }),
    lineBlockAtHeight: jest.fn(),
    dispatch: jest.fn((spec: TransactionSpec) => {
      view.state = view.state.update(spec).state;
    }),
    requestMeasure: (request: Measurement) => {
      if (!measurements.includes(request)) measurements.push(request);
    },
  };
  const plugin = new FoldScrollReservePluginValue(view as never);
  const apply = (effect: ReturnType<typeof EditorView.scrollIntoView>) => {
    const transaction = view.state.update({ effects: effect });
    view.state = transaction.state;
    plugin.update({
      transactions: [transaction],
      docChanged: false,
      geometryChanged: false,
      viewportChanged: false,
    } as never);
  };
  const flush = () => {
    for (let count = 0; measurements.length; count++) {
      if (count > 8) throw Error("Measurement did not settle");
      const request = measurements.shift();
      if (request) request.write?.(request.read(view as never), view as never);
    }
  };
  return {
    geometry,
    view,
    plugin,
    elements,
    measurements,
    flush,
    apply,
    quantized,
    classes,
    properties,
  };
}

test("creates one noneditable external tail without changing native content padding", () => {
  const { view, plugin, elements, flush } = makeView();
  flush();
  expect(elements[0].className).toBe("bullet-plugin-fold-scroll-reserve");
  expect(elements[0].attributes.get("contenteditable")).toBe("false");
  expect(elements[0].attributes.get("aria-hidden")).toBe("true");
  expect(elements[0].style.height).toBe("0px");
  expect(view.contentDOM.style.paddingBottom).toBe("100px");
  plugin.destroy();
});

test("keeps a fractional glyph offset while accounting for the largest top scroll margin", () => {
  const { view, geometry, plugin, flush } = makeView();
  flush();
  geometry.scale = 2;
  geometry.dpr = 2;
  const effect = plugin.prepare(2);
  expect(effect.value).toMatchObject({
    range: { head: 2 },
    y: "start",
    yMargin: 146.25,
    isSnapshot: false,
  });
  expect(view.contentDOM.style.paddingBottom).toBe("100px");
  plugin.destroy();
});

test("shrinks the temporary tail to the actual post-fold gap and anchor displacement", () => {
  const { geometry, plugin, elements, flush, apply } = makeView();
  flush();
  const tail = elements[0];
  const effect = plugin.prepare(2);
  geometry.naturalBottom = 500;
  geometry.anchorTop += 20.5;
  apply(effect);
  flush();
  expect(elements[0]).toBe(tail);
  expect(tail.style.height).toBe("139px");
  plugin.destroy();
});

test("uses fractional rendered padding at UI zoom instead of computed or integer heights", () => {
  const { geometry, plugin, elements, flush } = makeView();
  geometry.dpr = 0.7607257962226868;
  geometry.padding = 31.980148315429688;
  geometry.naturalBottom = 316.98;
  flush();
  expect(
    Number.parseFloat(elements[0].style.height) * geometry.dpr,
  ).toBeCloseTo(230, 8);
  plugin.destroy();
});

test("does not trim primed space before pending native navigation finishes", async () => {
  const { geometry, view, plugin, elements, flush, apply } = makeView();
  flush();
  plugin.prime();
  apply(EditorView.scrollIntoView(2));
  geometry.naturalBottom = 500;
  flush();
  expect(elements[0].style.height).toBe("600px");
  await Promise.resolve();
  expect(view.lineBlockAtHeight).toHaveBeenCalledWith(0);
  flush();
  expect(elements[0].style.height).toBe("118px");
  plugin.destroy();
});

test("removes unnecessary tail after unfolding and keeps late callbacks inert on teardown", async () => {
  const { geometry, plugin, elements, flush, apply } = makeView();
  geometry.naturalBottom = 500;
  flush();
  expect(elements[0].style.height).toBe("118px");
  apply(plugin.prepare(2));
  geometry.naturalBottom = 900;
  flush();
  expect(elements[0].style.height).toBe("0px");
  plugin.destroy();
  await Promise.resolve();
  flush();
  expect(elements[0].remove).toHaveBeenCalledTimes(1);
});

test("keeps preflight height through layout reads before the native fold transaction", async () => {
  const { plugin, elements, geometry, flush, apply } = makeView();
  flush();
  const effect = plugin.prepare(2);
  flush();
  await Promise.resolve();
  flush();
  expect(elements[0].style.height).toBe("412px");
  geometry.naturalBottom = 500;
  apply(effect);
  flush();
  expect(elements[0].style.height).toBe("118px");
  plugin.destroy();
});

test("an earlier navigation microtask cannot retire a newly captured fold", async () => {
  const { plugin, elements, flush, apply } = makeView();
  flush();
  apply(EditorView.scrollIntoView(2));
  plugin.prepare(2);
  await Promise.resolve();
  flush();
  expect(elements[0].style.height).toBe("412px");
  plugin.destroy();
});

test("does not add scroll height to an auto-height table cell", () => {
  const { view, plugin, elements, flush } = makeView(true);
  plugin.prime();
  flush();
  expect(elements).toEqual([]);
  expect(view.contentDOM.style.paddingBottom).toBe("100px");
  plugin.destroy();
});

test("absorbs browser scroll rounding outside editable content before the native target", () => {
  const { geometry, plugin, elements, quantized, properties, flush, apply } =
    makeView();
  flush();
  const effect = plugin.prepare(2);
  geometry.anchorTop += 2.375;
  apply(effect);
  flush();
  expect(quantized).toEqual([4373.375]);
  expect(plugin.currentOffset()).toBe(-0.375);
  expect(properties.get("--bullet-plugin-fold-scroll-offset")).toBe("-0.375px");
  expect(elements[3].style.height).toBe("4975px");
  expect(elements[0].style.height).toBe("0px");
  plugin.destroy();
});

test("retains the exact existing offset when the next fold does not move its glyph", () => {
  const { geometry, plugin, quantized, flush, apply } = makeView();
  flush();
  const first = plugin.prepare(2);
  geometry.anchorTop += 2.375;
  apply(first);
  flush();
  const next = plugin.prepare(2);
  apply(next);
  flush();
  expect(quantized).toEqual([4373.375]);
  expect(plugin.currentOffset()).toBe(-0.375);
  plugin.destroy();
});

test("refreshes native selection layers once after a changed offset and completed target", async () => {
  const { geometry, view, plugin, flush, apply } = makeView();
  flush();
  const selection = view.state.selection;
  const effect = plugin.prepare(2);
  geometry.anchorTop += 2.375;
  apply(effect);
  flush();
  expect(view.dispatch).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(view.dispatch).toHaveBeenCalledTimes(1);
  expect(view.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ selection, filter: false }),
  );
  const refresh = view.state.update(view.dispatch.mock.calls[0][0]);
  expect(refresh.annotation(selectionLayout)).toBe(true);
  expect(refresh.annotation(Transaction.addToHistory)).toBe(false);
  expect(view.lineBlockAtHeight).toHaveBeenCalledTimes(2);

  apply(plugin.prepare(2));
  flush();
  await Promise.resolve();
  expect(view.dispatch).toHaveBeenCalledTimes(1);
  expect(view.lineBlockAtHeight).toHaveBeenCalledTimes(3);
  plugin.destroy();
});

test("refreshes native selection layers when restoring an earlier snapshot offset", async () => {
  const { view, plugin, flush, apply } = makeView();
  flush();
  plugin.prime();
  plugin.restoreOffset(-0.375);
  apply(EditorView.scrollIntoView(2));
  await Promise.resolve();
  expect(view.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      selection: view.state.selection,
      filter: false,
    }),
  );
  expect(view.lineBlockAtHeight).toHaveBeenCalledTimes(2);
  plugin.destroy();
});

test.each(["composing", "compositionStarted"] as const)(
  "keeps layer refresh pending during %s and resumes after composition layout",
  async (composition) => {
    const { geometry, view, plugin, flush, apply } = makeView();
    flush();
    view[composition] = true;
    const effect = plugin.prepare(2);
    geometry.anchorTop += 2.375;
    apply(effect);
    flush();
    await Promise.resolve();
    flush();
    expect(view.dispatch).not.toHaveBeenCalled();

    plugin.onCompositionEnd();
    view[composition] = false;
    view.state = view.state.update({ selection: { anchor: 4 } }).state;
    flush();
    await Promise.resolve();
    expect(view.dispatch).toHaveBeenCalledTimes(1);
    expect(view.state.selection.main.head).toBe(4);
    expect(view.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: view.state.selection,
        filter: false,
      }),
    );
    plugin.destroy();
  },
);

test("a deferred composition refresh is inert after the view is destroyed", async () => {
  const { geometry, view, plugin, flush, apply } = makeView();
  flush();
  view.composing = true;
  const effect = plugin.prepare(2);
  geometry.anchorTop += 2.375;
  apply(effect);
  flush();
  await Promise.resolve();
  plugin.onCompositionEnd();
  plugin.destroy();
  view.composing = false;
  flush();
  await Promise.resolve();
  expect(view.dispatch).not.toHaveBeenCalled();
});

test("a deferred composition refresh does not retire the next prepared native fold", async () => {
  const { geometry, view, plugin, elements, flush, apply } = makeView();
  flush();
  view.composing = true;
  const first = plugin.prepare(2);
  geometry.anchorTop += 2.375;
  apply(first);
  flush();
  await Promise.resolve();
  view.composing = false;

  const next = plugin.prepare(2);
  const primed = elements[0].style.height;
  const selection = view.state.update({ selection: view.state.selection });
  view.state = selection.state;
  plugin.update({
    transactions: [selection],
    docChanged: false,
    geometryChanged: false,
    viewportChanged: false,
  } as never);
  await Promise.resolve();
  flush();
  expect(view.dispatch).not.toHaveBeenCalled();
  expect(elements[0].style.height).toBe(primed);
  apply(next);
  flush();
  await Promise.resolve();
  expect(view.dispatch).toHaveBeenCalledTimes(1);
  plugin.destroy();
});

test.each([0, Number.NaN, 4400])(
  "rejects an invalid or clamped browser probe result %s",
  (rounded) => {
    const { geometry, plugin, flush, apply } = makeView();
    flush();
    geometry.quantize = () => rounded;
    const effect = plugin.prepare(2);
    geometry.anchorTop += 2.375;
    apply(effect);
    flush();
    expect(plugin.currentOffset()).toBe(0);
    plugin.destroy();
  },
);

test("rejects a quantizer that has no rendered viewport", () => {
  const { geometry, plugin, elements, flush, apply } = makeView();
  flush();
  elements[2].clientHeight = 0;
  const effect = plugin.prepare(2);
  geometry.anchorTop += 2.375;
  apply(effect);
  flush();
  expect(plugin.currentOffset()).toBe(0);
  plugin.destroy();
});

test("does not treat scroll clamping at a negative target as fractional rounding", () => {
  const { geometry, view, plugin, quantized, flush, apply } = makeView();
  flush();
  view.scrollDOM.scrollTop = 0;
  const effect = plugin.prepare(2);
  geometry.anchorTop -= 0.375;
  apply(effect);
  flush();
  expect(quantized).toEqual([]);
  expect(plugin.currentOffset()).toBe(0);
  plugin.destroy();
});

test("does not take ownership of a native container with an existing transform", () => {
  const { plugin, elements, classes, flush } = makeView(
    false,
    "matrix(1, 0, 0, 1, 0, 3)",
  );
  flush();
  plugin.restoreOffset(-0.375);
  expect(plugin.currentOffset()).toBe(0);
  expect(elements).toHaveLength(2);
  expect(classes.size).toBe(0);
  plugin.destroy();
});

test("restores saved offsets and removes only its owned container styling on teardown", () => {
  const { plugin, properties, classes, flush } = makeView();
  flush();
  classes.add("cm-contentContainer");
  plugin.restoreOffset(-0.375);
  expect(plugin.currentOffset()).toBe(-0.375);
  plugin.restoreOffset(0.25);
  expect(plugin.currentOffset()).toBe(0.25);
  expect(properties.get("--bullet-plugin-fold-scroll-offset")).toBe("0.25px");
  plugin.destroy();
  flush();
  expect(classes).toEqual(new Set(["cm-contentContainer"]));
  expect(properties.size).toBe(0);
});

describe("fold reserve ownership", () => {
  function setup(mobile: boolean, guides: boolean, rightControls: boolean) {
    (Platform as { isMobile: boolean }).isMobile = mobile;
    const settings = new Settings({
      loadData: async () => null,
      saveData: async () => {},
    });
    settings.verticalLinesAction = guides ? "toggle-folding" : "none";
    settings.mobileRightFoldControls = rightControls;
    let extensions: Extension[] = [];
    const updateOptions = jest.fn();
    const feature = new FoldScrollReserve(
      {
        app: { workspace: { updateOptions } },
        registerEditorExtension: (value: Extension[]) => {
          extensions = value;
        },
      } as never,
      settings,
    );
    return { feature, settings, updateOptions, extensions: () => extensions };
  }

  test.each([
    [false, false, false, true],
    [false, true, false, true],
    [true, false, false, false],
    [true, false, true, true],
    [true, true, false, true],
    [true, true, true, true],
  ])(
    "mobile=%s guides=%s rightControls=%s reserves=%s",
    async (mobile, guides, rightControls, enabled) => {
      const context = setup(mobile, guides, rightControls);
      await context.feature.load();
      expect(context.extensions()).toHaveLength(enabled ? 1 : 0);
      expect(context.updateOptions).not.toHaveBeenCalled();
      await context.feature.unload();
    },
  );

  test("keeps desktop native folding protected when guides are disabled", async () => {
    const context = setup(false, true, false);
    await context.feature.load();
    const reserve = context.extensions()[0];
    context.settings.verticalLinesAction = "none";
    expect(context.extensions()).toEqual([reserve]);
    expect(context.updateOptions).not.toHaveBeenCalled();
    await context.feature.unload();
  });

  test("shares the mobile reserve and reconfigures only when the last consumer changes", async () => {
    const context = setup(true, true, true);
    await context.feature.load();
    const reserve = context.extensions()[0];
    context.settings.verticalLinesAction = "none";
    expect(context.extensions()).toEqual([reserve]);
    expect(context.updateOptions).not.toHaveBeenCalled();
    context.settings.mobileRightFoldControls = false;
    expect(context.extensions()).toEqual([]);
    expect(context.updateOptions).toHaveBeenCalledTimes(1);
    context.settings.verticalLinesAction = "toggle-folding";
    expect(context.extensions()).toEqual([reserve]);
    expect(context.updateOptions).toHaveBeenCalledTimes(2);
    await context.feature.unload();
    context.settings.verticalLinesAction = "none";
    expect(context.updateOptions).toHaveBeenCalledTimes(2);
  });
});
