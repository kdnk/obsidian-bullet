import { EditorState, TransactionSpec } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";

import {
  NestedCodeBlockLayoutPluginValue,
  nestedCodeBlockContentDecorations,
} from "../NestedCodeBlockLayout";

const BEGIN = "HyperMD-codeblock_HyperMD-codeblock-begin_HyperMD-list-line";
const CONTENT = "HyperMD-codeblock_HyperMD-list-line";
const END = "HyperMD-codeblock_HyperMD-codeblock-end_HyperMD-list-line";

type Measurement = {
  read: () => unknown;
  write: (value: unknown) => void;
};

const publications: VoidFunction[] = [];
const nodeFilter = globalThis.NodeFilter;
const drivers = new WeakMap<
  NestedCodeBlockLayoutPluginValue,
  {
    render: () => void;
    dispatch: jest.Mock<void, TransactionSpec[]>;
  }
>();

beforeEach(() => {
  Object.defineProperty(globalThis, "NodeFilter", {
    value: { SHOW_TEXT: 4 },
    configurable: true,
  });
  jest
    .spyOn(globalThis, "queueMicrotask")
    .mockImplementation((callback) => publications.push(callback));
});

afterEach(() => {
  Object.defineProperty(globalThis, "NodeFilter", {
    value: nodeFilter,
    configurable: true,
  });
  publications.length = 0;
  jest.restoreAllMocks();
});

function flushPublications() {
  for (const callback of publications.splice(0)) callback();
}

function runMeasurement(measurement: Measurement) {
  measurement.write(measurement.read());
  flushPublications();
}

function widgetDecoration(decoration: Decoration) {
  const spec: unknown = decoration.spec;
  return typeof spec === "object" &&
    spec &&
    "widget" in spec &&
    spec.widget instanceof WidgetType &&
    "side" in spec &&
    typeof spec.side === "number"
    ? { widget: spec.widget, side: spec.side }
    : null;
}

function decorationAttributes(decoration: Decoration) {
  const spec: unknown = decoration.spec;
  if (
    typeof spec !== "object" ||
    !spec ||
    !("class" in spec) ||
    typeof spec.class !== "string" ||
    !("attributes" in spec)
  )
    throw new Error("Expected native line attributes");
  const attributes = spec.attributes;
  if (
    typeof attributes !== "object" ||
    !attributes ||
    !("style" in attributes) ||
    typeof attributes.style !== "string"
  )
    throw new Error("Expected native line style");
  return { class: spec.class, style: attributes.style };
}

function decorationClass(decoration: Decoration): string | null {
  const spec: unknown = decoration.spec;
  return typeof spec === "object" &&
    spec &&
    "class" in spec &&
    typeof spec.class === "string"
    ? spec.class
    : null;
}

function mountLayout(
  view: EditorView,
  lineNameAt?: (n: number) => string | null,
  zoomRange?: (state: EditorState) => { indent: string } | null,
) {
  const contentDOM = view.contentDOM ?? { querySelectorAll: () => [] };
  Object.assign(view, { contentDOM });
  Object.assign(contentDOM, {
    contains: (element: HTMLElement) =>
      Array.from(
        contentDOM.querySelectorAll(".cm-line, .cm-preview-code-block"),
      ).includes(element),
  });
  const plugin = new NestedCodeBlockLayoutPluginValue(
    view,
    lineNameAt,
    zoomRange,
  );
  const applied = new Map<
    HTMLElement,
    { classes: string[]; properties: string[] }
  >();
  const render = (decorations: DecorationSet = plugin.decorations) => {
    for (const [element, attrs] of applied) {
      for (const name of attrs.classes) element.classList.remove(name);
      for (const property of attrs.properties)
        element.style.removeProperty(property);
    }
    applied.clear();
    const lines = Array.from(
      contentDOM.querySelectorAll<HTMLElement>(
        ".cm-line, .cm-preview-code-block",
      ),
    ).filter((element) => !element.classList.contains("cm-preview-code-block"));
    decorations.between(0, view.state.doc.length, (from, to, decoration) => {
      if (from !== to || widgetDecoration(decoration)) return;
      const attrs = decorationAttributes(decoration);
      for (const element of lines.filter(
        (line) => view.posAtDOM(line) === from,
      )) {
        const classes = attrs.class.split(" ").filter(Boolean);
        for (const name of classes) element.classList.add(name);
        const properties = attrs.style.split(";").flatMap((declaration) => {
          const separator = declaration.indexOf(":");
          if (separator < 0) return [];
          const name = declaration.slice(0, separator).trim();
          element.style.setProperty(
            name,
            declaration.slice(separator + 1).trim(),
          );
          return [name];
        });
        applied.set(element, { classes, properties });
      }
    });
  };
  const dispatch = jest.fn((...specs: TransactionSpec[]) => {
    const transaction = view.state.update(...specs);
    Object.assign(view, {
      state: transaction.state,
      visibleRanges: view.visibleRanges.map(({ from, to }) => ({
        from: transaction.changes.mapPos(from, -1),
        to: transaction.changes.mapPos(to, 1),
      })),
    });
    plugin.update({
      view,
      startState: transaction.startState,
      state: transaction.state,
      changes: transaction.changes,
      transactions: [transaction],
      docChanged: transaction.docChanged,
      viewportChanged: false,
      geometryChanged: false,
      viewportMoved: false,
      heightChanged: false,
      focusChanged: false,
      selectionSet: transaction.selection !== undefined,
    });
    render();
  });
  Object.assign(view, { dispatch });
  const destroy = plugin.destroy.bind(plugin);
  plugin.destroy = () => {
    destroy();
    render(Decoration.none);
  };
  drivers.set(plugin, { render, dispatch });
  render();
  return plugin;
}

function makeAnimationWindow(frames: FrameRequestCallback[]) {
  return {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame: jest.fn(),
  };
}

function makeClassList(...initial: string[]) {
  const values = new Set(initial);
  return {
    add: (value: string) => values.add(value),
    remove: (value: string) => values.delete(value),
    contains: (value: string) => values.has(value),
    [Symbol.iterator]: () => values[Symbol.iterator](),
  };
}

function makeStyle(initial: Array<[string, string]> = []) {
  const values = new Map(initial);
  return {
    setProperty: (name: string, value: string) => values.set(name, value),
    removeProperty: (name: string) => values.delete(name),
    getPropertyValue: (name: string) => values.get(name) ?? "",
  };
}

function makeLine(
  classes: string[],
  options: {
    position: number;
    left?: number;
    right?: number;
    openingContentLeft?: number;
    openingContentRight?: number;
    markerEnd?: number;
    direction?: "ltr" | "rtl";
  },
) {
  const markerNext = options.openingContentLeft
    ? {
        getBoundingClientRect: () => ({
          left: options.openingContentLeft,
          right: options.openingContentRight ?? options.openingContentLeft,
        }),
      }
    : null;
  const marker =
    markerNext || options.markerEnd !== undefined
      ? {
          nextElementSibling: markerNext,
          getBoundingClientRect: () => ({
            left:
              (options.direction === "rtl"
                ? options.openingContentRight
                : options.openingContentLeft) ?? options.markerEnd,
            right:
              options.openingContentRight ??
              options.openingContentLeft ??
              options.markerEnd,
          }),
        }
      : null;
  return {
    position: options.position,
    get className() {
      return [...this.classList].join(" ");
    },
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => ({
          direction: options.direction ?? "ltr",
          marginInlineEnd: "0px",
        }),
      },
    },
    classList: makeClassList("cm-line", ...classes),
    style: makeStyle(),
    getBoundingClientRect: () => ({
      left: options.left ?? 100,
      right: options.right ?? 300,
    }),
    querySelector: (selector: string) =>
      selector === ".cm-formatting-list" ? marker : null,
  };
}

function names(...values: Array<string | null>) {
  return (lineNumber: number) => values[lineNumber - 1] ?? null;
}

function makePreviewFixture(empty = false, outside = false) {
  const state = EditorState.create({
    doc: [
      "\t- ```js",
      ...(empty ? [] : ["\t  one", "\t  two"]),
      "\t  ```",
      ...(outside ? ["- outside"] : []),
    ].join("\n"),
  });
  const lines = Array.from({ length: state.doc.lines }, (_, index) => {
    const classes =
      outside && index === state.doc.lines - 1
        ? []
        : ["HyperMD-codeblock", "HyperMD-list-line"];
    if (index === 0) classes.push("HyperMD-codeblock-begin");
    if (index === state.doc.lines - (outside ? 2 : 1))
      classes.push("HyperMD-codeblock-end");
    const line = makeLine(classes, {
      position: state.doc.line(index + 1).from,
      markerEnd: 164,
    });
    let rawFence = false;
    const marker = {
      getBoundingClientRect: () => ({
        left: 164,
        right: 164,
        top: 100,
        height: 24,
      }),
    };
    line.querySelector = ((selector: string) => {
      if (selector === ".cm-hmd-codeblock") return rawFence ? {} : null;
      if (selector === ".code-block-flair") return index === 0 ? {} : null;
      if (selector === ".cm-formatting-list" || selector === ".list-bullet")
        return marker;
      return null;
    }) as never;
    line.getBoundingClientRect = () =>
      ({ left: 100, right: 300, top: 100, height: 24 }) as never;
    Object.assign(line.ownerDocument, {
      createTreeWalker: () => ({ nextNode: () => null }),
    });
    line.ownerDocument.defaultView.getComputedStyle = (() => ({
      direction: "ltr",
      marginInlineEnd: "0px",
      lineHeight: "24px",
    })) as never;
    return Object.assign(line, {
      nodeType: 1,
      closest: (selector: string) =>
        selector === ".cm-preview-code-block"
          ? line.classList.contains("cm-preview-code-block")
            ? line
            : null
          : line,
      setRaw: (value: boolean) => {
        rawFence = value;
      },
      previousElementSibling: null as unknown,
      nextElementSibling: null as unknown,
    });
  });

  const measurements: Measurement[] = [];
  let notify: (records: unknown[]) => void = () => {};
  const body = { nodeType: 1 };
  const observe = jest.fn();
  const disconnect = jest.fn();
  let rendered = lines;
  const show = (next: typeof lines) => {
    rendered = next;
    next.forEach((line, index) => {
      line.previousElementSibling = next[index - 1] ?? null;
      line.nextElementSibling = next[index + 1] ?? null;
    });
  };
  show(lines);
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { querySelectorAll: () => rendered },
    posAtDOM: (element: { position: number }) => element.position,
    coordsAtPos: () => ({ left: 164, right: 164 }),
    dom: {
      ownerDocument: {
        body,
        defaultView: {
          MutationObserver: class {
            constructor(callback: typeof notify) {
              notify = callback;
            }
            observe = observe;
            disconnect = disconnect;
          },
        },
      },
    },
    requestMeasure: (measurement: Measurement) =>
      measurements.push(measurement),
  };
  const plugin = mountLayout(
    view as never,
    names(
      BEGIN,
      ...(empty ? [] : [CONTENT, CONTENT]),
      END,
      ...(outside ? [null] : []),
    ),
  );

  const measure = () => runMeasurement(measurements[0]);
  return {
    lines,
    view,
    measurements,
    measure,
    plugin,
    show,
    body,
    observe,
    disconnect,
    notify: (target: unknown, type = "childList", previousClass?: string) =>
      notify([
        {
          target,
          type,
          oldValue:
            previousClass ??
            (typeof target === "object" && target && "className" in target
              ? target.className
              : null),
        },
      ]),
    redraw: () => drivers.get(plugin)!.render(),
  };
}

describe("native preview row roles", () => {
  const originalNodeFilter = globalThis.NodeFilter;
  beforeAll(() =>
    Object.defineProperty(globalThis, "NodeFilter", {
      value: { SHOW_TEXT: 4 },
      configurable: true,
    }),
  );
  afterAll(() =>
    Object.defineProperty(globalThis, "NodeFilter", {
      value: originalNodeFilter,
      configurable: true,
    }),
  );

  test("hides the native caret only on the selected nested code row", () => {
    const fixture = makePreviewFixture(false, true);
    const [opening, first, , , outside] = fixture.lines;
    const dispatch = drivers.get(fixture.plugin)!.dispatch;

    dispatch({
      selection: { anchor: fixture.view.state.doc.line(1).from + 3 },
    });

    expect(
      opening.classList.contains("bullet-plugin-nested-code-cursor-line"),
    ).toBe(true);
    expect(
      first.classList.contains("bullet-plugin-nested-code-cursor-line"),
    ).toBe(false);

    dispatch({
      selection: { anchor: fixture.view.state.doc.line(2).from + 3 },
    });
    expect(
      opening.classList.contains("bullet-plugin-nested-code-cursor-line"),
    ).toBe(false);
    expect(
      first.classList.contains("bullet-plugin-nested-code-cursor-line"),
    ).toBe(true);

    dispatch({
      selection: {
        anchor: fixture.view.state.doc.line(2).from + 3,
        head: fixture.view.state.doc.line(2).from + 4,
      },
    });
    expect(
      first.classList.contains("bullet-plugin-nested-code-cursor-line"),
    ).toBe(false);

    dispatch({ selection: { anchor: fixture.view.state.doc.length } });
    expect(
      first.classList.contains("bullet-plugin-nested-code-cursor-line"),
    ).toBe(false);
    expect(
      outside.classList.contains("bullet-plugin-nested-code-cursor-line"),
    ).toBe(false);
    fixture.plugin.destroy();
  });

  test("marks native preview fences and rounds the first and last code rows", () => {
    const fixture = makePreviewFixture();
    const [opening, first, last, closing] = fixture.lines;
    fixture.measure();
    expect(
      opening.classList.contains("bullet-plugin-code-preview-hidden-fence"),
    ).toBe(true);
    expect(
      closing.classList.contains("bullet-plugin-code-preview-hidden-fence"),
    ).toBe(true);
    expect(first.classList.contains("bullet-plugin-code-preview-first")).toBe(
      true,
    );
    expect(last.classList.contains("bullet-plugin-code-preview-last")).toBe(
      true,
    );
    expect(first.classList.contains("bullet-plugin-code-preview-body")).toBe(
      true,
    );
    expect(last.classList.contains("bullet-plugin-code-preview-body")).toBe(
      true,
    );
    expect(
      opening.classList.contains("bullet-plugin-code-preview-embed-opening"),
    ).toBe(false);
    fixture.plugin.destroy();
    for (const line of fixture.lines) {
      expect(
        [...line.classList].filter((name) =>
          name.startsWith("bullet-plugin-code-preview-"),
        ),
      ).toEqual([]);
    }
  });

  test("removes the preview-body role while editing inside the code block", () => {
    const fixture = makePreviewFixture(false, true);
    const body = fixture.lines[1];
    fixture.measure();
    expect(body.classList.contains("bullet-plugin-code-preview-body")).toBe(
      true,
    );

    drivers.get(fixture.plugin)!.dispatch({
      selection: { anchor: fixture.view.state.doc.length },
    });
    fixture.measure();
    expect(body.classList.contains("bullet-plugin-code-preview-body")).toBe(
      true,
    );
    drivers.get(fixture.plugin)!.dispatch({
      selection: { anchor: fixture.view.state.doc.line(2).to },
    });
    fixture.lines[0].setRaw(true);
    fixture.lines[3].setRaw(true);
    fixture.measure();

    expect(body.classList.contains("bullet-plugin-code-preview-body")).toBe(
      false,
    );
    fixture.plugin.destroy();
  });

  test("marks only the hidden closing fence for an empty native block", () => {
    const fixture = makePreviewFixture(true);
    const [opening, closing] = fixture.lines;
    fixture.measure();
    expect(
      opening.classList.contains("bullet-plugin-code-preview-hidden-fence"),
    ).toBe(false);
    expect(opening.classList.contains("bullet-plugin-code-preview-last")).toBe(
      true,
    );
    expect(
      opening.classList.contains("bullet-plugin-code-opening-aligned"),
    ).toBe(false);
    expect(
      opening.style.getPropertyValue("--bullet-code-opening-marker-offset"),
    ).toBe("");
    expect(
      closing.classList.contains("bullet-plugin-code-preview-hidden-fence"),
    ).toBe(true);
    fixture.plugin.destroy();
  });

  test("centers a 24px marker on a physical blank native row's 21px line box", () => {
    const fixture = makePreviewFixture();
    const source = fixture.view.state.doc.line(2);
    drivers.get(fixture.plugin)!.dispatch({
      changes: { from: source.from, to: source.to, insert: "" },
    });
    fixture.lines.forEach((line, index) => {
      line.position = fixture.view.state.doc.line(index + 1).from;
    });
    const [opening, blank] = fixture.lines;
    blank.classList = makeClassList("cm-line", "HyperMD-codeblock");
    blank.getBoundingClientRect = () =>
      ({ left: 100, right: 300, top: 124, height: 21 }) as never;
    blank.ownerDocument.defaultView.getComputedStyle = () => ({
      direction: "ltr",
      marginInlineEnd: "0px",
      lineHeight: "21px",
      paddingTop: "0px",
      paddingBottom: "0px",
    });

    fixture.measure();
    expect(fixture.view.state.doc.line(2).text).toBe("");
    expect(
      opening.style.getPropertyValue("--bullet-code-opening-marker-offset"),
    ).toBe("22.5px");
    expect(
      opening.style.getPropertyValue("--bullet-code-indent-guide-height"),
    ).toBe("45px");
    expect(opening.style.getPropertyValue("height")).toBe("");
    opening.setRaw(true);
    fixture.measure();
    expect(
      opening.style.getPropertyValue("--bullet-code-opening-marker-offset"),
    ).toBe("22.5px");
    expect(
      opening.style.getPropertyValue("--bullet-code-indent-guide-height"),
    ).toBe("45px");
    fixture.plugin.destroy();
  });

  test("keeps the opening marker on the first body row through source editing and redraw", () => {
    const fixture = makePreviewFixture(false, true);
    const [opening, first, , closing] = fixture.lines;
    first.getBoundingClientRect = () =>
      ({ left: 100, right: 300, top: 124, height: 24 }) as never;
    const dispatch = drivers.get(fixture.plugin)!.dispatch;
    dispatch({ selection: { anchor: fixture.view.state.doc.length } });
    fixture.measure();
    expect(
      opening.style.getPropertyValue("--bullet-code-opening-marker-offset"),
    ).toBe("24px");
    opening.setRaw(true);
    closing.setRaw(true);
    dispatch({ selection: { anchor: 3 } });
    expect(
      opening.style.getPropertyValue("--bullet-code-opening-marker-offset"),
    ).toBe("24px");
    expect(
      opening.classList.contains("bullet-plugin-code-preview-hidden-fence"),
    ).toBe(false);
    fixture.measure();
    fixture.redraw();
    expect(
      opening.style.getPropertyValue("--bullet-code-opening-marker-offset"),
    ).toBe("24px");
    expect(
      opening.style.getPropertyValue("--bullet-code-indent-guide-height"),
    ).toBe("48px");
    opening.setRaw(false);
    closing.setRaw(false);
    dispatch({ selection: { anchor: fixture.view.state.doc.length } });
    fixture.measure();
    expect(
      opening.style.getPropertyValue("--bullet-code-opening-marker-offset"),
    ).toBe("24px");
    expect(
      opening.classList.contains("bullet-plugin-code-preview-hidden-fence"),
    ).toBe(true);
    fixture.plugin.destroy();
  });

  test("keeps ordered source markers at native coordinates while aligning their preview", () => {
    const fixture = makePreviewFixture();
    const [opening, first, , closing] = fixture.lines;
    const dispatch = drivers.get(fixture.plugin)!.dispatch;
    dispatch({
      changes: {
        from: 0,
        to: fixture.view.state.doc.line(1).to,
        insert: "\t1. ```js",
      },
    });
    fixture.lines.forEach((line, index) => {
      line.position = fixture.view.state.doc.line(index + 1).from;
    });
    const query = opening.querySelector;
    opening.querySelector = ((selector: string) =>
      selector === ".list-bullet"
        ? null
        : selector === ".list-number"
          ? query(".cm-formatting-list")
          : query(selector)) as typeof opening.querySelector;
    first.getBoundingClientRect = () =>
      ({ left: 100, right: 300, top: 124, height: 24 }) as never;
    fixture.measure();
    expect(
      opening.style.getPropertyValue("--bullet-code-opening-marker-offset"),
    ).toBe("24px");
    opening.setRaw(true);
    closing.setRaw(true);
    fixture.measure();
    expect(
      opening.classList.contains("bullet-plugin-code-opening-aligned"),
    ).toBe(false);
    expect(
      opening.style.getPropertyValue("--bullet-code-opening-marker-offset"),
    ).toBe("");
    fixture.plugin.destroy();
  });

  test("retains complete preview roles in decorations across a native redraw", () => {
    const fixture = makePreviewFixture();
    const [opening] = fixture.lines;
    fixture.measure();
    for (const name of [...opening.classList]) {
      if (name.startsWith("bullet-plugin-")) opening.classList.remove(name);
    }
    fixture.redraw();
    fixture.notify(opening, "attributes");
    expect(
      opening.classList.contains("bullet-plugin-code-preview-hidden-fence"),
    ).toBe(true);
    expect(
      opening.classList.contains("bullet-plugin-code-preview-opening"),
    ).toBe(true);
    const pending = fixture.measurements.length;
    fixture.measure();
    fixture.notify(opening, "attributes");
    expect(fixture.measurements).toHaveLength(pending);
    fixture.plugin.destroy();
  });

  test("publishes source fences and adjacent preview edges after their presentation changes", () => {
    const fixture = makePreviewFixture();
    const [opening, first, last, closing] = fixture.lines;
    fixture.measure();
    opening.setRaw(true);
    closing.setRaw(true);
    fixture.notify(opening);
    fixture.measure();
    expect(
      opening.classList.contains("bullet-plugin-code-preview-hidden-fence"),
    ).toBe(false);
    expect(
      opening.classList.contains("bullet-plugin-code-preview-opening"),
    ).toBe(false);
    expect(
      closing.classList.contains("bullet-plugin-code-preview-hidden-fence"),
    ).toBe(false);
    expect(first.classList.contains("bullet-plugin-code-preview-first")).toBe(
      false,
    );
    expect(last.classList.contains("bullet-plugin-code-preview-last")).toBe(
      false,
    );
    opening.setRaw(false);
    closing.setRaw(false);
    fixture.notify(closing);
    fixture.measure();
    expect(
      opening.classList.contains("bullet-plugin-code-preview-hidden-fence"),
    ).toBe(true);
    expect(first.classList.contains("bullet-plugin-code-preview-first")).toBe(
      true,
    );
    expect(last.classList.contains("bullet-plugin-code-preview-last")).toBe(
      true,
    );
    fixture.measure();
    fixture.plugin.destroy();
  });

  test("retains decorated guide roles through redraw and publishes a raw fence independently of its embed", () => {
    const fixture = makePreviewFixture();
    const [opening, embed] = fixture.lines;
    embed.classList = makeClassList("cm-preview-code-block");
    embed.position = 3;
    const code = { getBoundingClientRect: () => ({ top: 100, height: 24 }) };
    embed.querySelector = ((selector: string) =>
      selector === ".ec-line .code" ? code : null) as never;
    fixture.show([opening, embed]);
    fixture.measure();
    const openingRoles = [
      "bullet-plugin-code-preview-hidden-fence",
      "bullet-plugin-code-preview-opening",
      "bullet-plugin-code-preview-embed-opening",
    ];
    for (const name of openingRoles)
      expect(opening.classList.contains(name)).toBe(true);
    expect(embed.classList.contains("bullet-plugin-code-preview-embed")).toBe(
      true,
    );
    for (const name of openingRoles) opening.classList.remove(name);
    fixture.redraw();
    fixture.notify(opening, "attributes");
    for (const name of openingRoles)
      expect(opening.classList.contains(name)).toBe(true);
    const pending = fixture.measurements.length;
    fixture.measure();
    fixture.notify(opening, "attributes");
    expect(fixture.measurements).toHaveLength(pending);

    // Native children can switch to source before the processor widget leaves.
    opening.setRaw(true);
    fixture.notify(opening);
    fixture.measure();
    for (const name of openingRoles)
      expect(opening.classList.contains(name)).toBe(false);
    fixture.show([opening]);
    fixture.measure();
    expect(embed.classList.contains("bullet-plugin-code-preview-embed")).toBe(
      false,
    );
    expect(
      opening.style.getPropertyValue("--bullet-code-indent-guide-height"),
    ).toBe("24px");
    fixture.plugin.destroy();
  });
});

test.each([" ", "  ", "\t", "\t  "])(
  "paints the blank code caret after literal indentation %j",
  (indent) => {
    const state = EditorState.create({
      doc: `\t\t- \`\`\`\n\t\t  ${indent}\n\t\t  \`\`\``,
    });
    const cursor = state.doc.line(2).to;
    const view = {
      state: state.update({ selection: { anchor: cursor } }).state,
      visibleRanges: [{ from: 0, to: state.doc.length }],
      contentDOM: { querySelectorAll: () => [] },
      dom: { ownerDocument: { defaultView: {} } },
      requestMeasure: jest.fn(),
    };
    const plugin = new NestedCodeBlockLayoutPluginValue(
      view as never,
      names(BEGIN, CONTENT, END),
    );
    const cursorLines: number[] = [];
    plugin.decorations.between(0, state.doc.length, (from, to, decoration) => {
      if (
        from === to &&
        decorationAttributes(decoration).class.includes(
          "bullet-plugin-nested-code-cursor-line",
        )
      )
        cursorLines.push(state.doc.lineAt(from).number);
    });
    expect(cursorLines).toEqual([2]);
    expect(view.state.doc.toString()).toBe(state.doc.toString());
    plugin.destroy();
  },
);

function lineAttributes(
  plugin: NestedCodeBlockLayoutPluginValue,
  position: number,
) {
  let result = { class: "", style: "" };
  plugin.decorations.between(position, position, (from, to, decoration) => {
    if (from === position && to === position && !widgetDecoration(decoration))
      result = decorationAttributes(decoration);
  });
  return result;
}

function withoutCursorLine(attributes: { class: string; style: string }) {
  return {
    ...attributes,
    class: attributes.class
      .split(" ")
      .filter((name) => name !== "bullet-plugin-nested-code-cursor-line")
      .join(" "),
  };
}

function makeSourceFixture() {
  let state = EditorState.create({
    doc: "- before\n- ```js\n  one\n\n  two\n  ```\n- after",
  });
  const lineNameAt = (n: number) => {
    const text = state.doc.line(n).text;
    if (text.startsWith("- ```")) return BEGIN;
    if (text === "  ```") return END;
    return text.startsWith("  ") || text.startsWith("\t") ? CONTENT : null;
  };
  const nativeLines = () =>
    Array.from({ length: state.doc.lines }, (_, index) => {
      const name = lineNameAt(index + 1);
      return makeLine(
        (
          name ??
          (state.doc.line(index + 1).text === "" ? "HyperMD-codeblock" : "")
        ).split("_"),
        {
          position: state.doc.line(index + 1).from,
          ...(name === BEGIN ? { markerEnd: 160 } : {}),
        },
      );
    });
  let lines = nativeLines();
  let visible: number[] | null = null;

  const measurements: Measurement[] = [];
  const view = {
    get state() {
      return state;
    },
    set state(value: EditorState) {
      state = value;
      lines = nativeLines();
    },
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: {
      querySelectorAll: () =>
        lines.filter((_, index) => !visible || visible.includes(index + 1)),
    },
    posAtDOM: (element: { position: number }) => element.position,
    coordsAtPos: () => ({ left: 160, right: 160 }),
    dom: { ownerDocument: { defaultView: {} } },
    requestMeasure: (measurement: Measurement) =>
      measurements.push(measurement),
  };
  const plugin = mountLayout(view as never, lineNameAt);

  return {
    plugin,
    view,
    get lines() {
      return lines;
    },
    measurements,
    measure: () => runMeasurement(measurements[0]),
    dispatch: drivers.get(plugin)!.dispatch,
    show: (numbers: number[]) => {
      visible = numbers;
      view.visibleRanges = numbers.map((n) => ({
        from: state.doc.line(n).from,
        to: state.doc.line(n).to,
      }));
      plugin.update({
        view,
        state,
        startState: state,
        changes: state.update({}).changes,
        transactions: [],
        docChanged: false,
        viewportChanged: true,
        geometryChanged: false,
      } as never);
      drivers.get(plugin)!.render();
    },
  };
}

describe("retained source geometry", () => {
  test("covers physical blank rows before measurement and restores cached rows on remount", () => {
    const fixture = makeSourceFixture();
    const blankFrom = fixture.view.state.doc.line(4).from;
    expect(lineAttributes(fixture.plugin, blankFrom)).toEqual({
      class: "bullet-plugin-nested-code-block",
      style: "",
    });
    fixture.measure();
    expect(lineAttributes(fixture.plugin, blankFrom).style).toBe(
      "--bullet-nested-code-block-inset: 60px;",
    );
    fixture.show([5]);
    expect(lineAttributes(fixture.plugin, blankFrom).style).toBe(
      "--bullet-nested-code-block-inset: 60px;",
    );
    fixture.show([3, 4]);
    expect(
      fixture.lines[3].style.getPropertyValue(
        "--bullet-nested-code-block-inset",
      ),
    ).toBe("60px");
    fixture.plugin.destroy();
  });

  test("maps native geometry across ordinary body edits and insertion before its fence", () => {
    const fixture = makeSourceFixture();
    fixture.measure();
    const body = fixture.view.state.doc.line(3);
    fixture.dispatch({ changes: { from: body.to, insert: "!" } });
    expect(lineAttributes(fixture.plugin, body.from).style).toBe(
      "--bullet-nested-code-block-inset: 60px;",
    );
    fixture.dispatch({ changes: { from: 0, insert: "heading\n" } });
    const next = fixture.view.state.doc.line(4);
    expect(next.text).toBe("  one!");
    expect(lineAttributes(fixture.plugin, next.from).style).toBe(
      "--bullet-nested-code-block-inset: 60px;",
    );
    expect(lineAttributes(fixture.plugin, 0)).toEqual({ class: "", style: "" });
    fixture.plugin.destroy();
  });

  test.each(["row replacement", "prefix replacement", "opening replacement"])(
    "drops stale geometry after a %s even when the new row is still code",
    (change) => {
      const fixture = makeSourceFixture();
      fixture.measure();
      const { doc } = fixture.view.state;
      expect(lineAttributes(fixture.plugin, doc.line(3).from).style).toBe(
        "--bullet-nested-code-block-inset: 60px;",
      );
      const changes =
        change === "row replacement"
          ? {
              from: doc.line(3).from,
              to: doc.line(4).from,
              insert: "  replacement\n",
            }
          : change === "prefix replacement"
            ? { from: doc.line(3).from, to: doc.line(3).from + 2, insert: "\t" }
            : {
                from: doc.line(2).from,
                to: doc.line(2).to,
                insert: doc.line(2).text,
              };
      fixture.dispatch({ changes });
      const body = fixture.view.state.doc.line(3);
      expect(lineAttributes(fixture.plugin, body.from)).toEqual({
        class: "bullet-plugin-nested-code-block",
        style: "",
      });
      fixture.plugin.destroy();
    },
  );

  test("never transfers a measured source row's attributes to a recycled native element", () => {
    const fixture = makeSourceFixture();
    fixture.measure();
    const line = fixture.lines[2];
    expect(
      line.style.getPropertyValue("--bullet-nested-code-block-inset"),
    ).toBe("60px");
    const measurement = fixture.measurements[0];
    measurement.write(measurement.read());
    line.position = fixture.view.state.doc.line(7).from;
    drivers.get(fixture.plugin)!.render();
    flushPublications();
    expect(
      line.style.getPropertyValue("--bullet-nested-code-block-inset"),
    ).toBe("");
    expect(line.classList.contains("bullet-plugin-nested-code-block")).toBe(
      false,
    );
    fixture.plugin.destroy();
  });

  test("removes cached native attributes when a fence is deleted", () => {
    const fixture = makeSourceFixture();
    fixture.measure();
    expect(
      lineAttributes(fixture.plugin, fixture.view.state.doc.line(3).from).style,
    ).toContain("60px");
    const opening = fixture.view.state.doc.line(2);
    fixture.dispatch({
      changes: { from: opening.from, to: opening.to, insert: "- prose" },
    });
    expect(
      lineAttributes(fixture.plugin, fixture.view.state.doc.line(3).from),
    ).toEqual({ class: "", style: "" });
    fixture.plugin.destroy();
  });
});

describe("native measurement publication", () => {
  test.each([false, true])(
    "publishes complete native attributes in the first measurement frame (geometry changes: %s)",
    (geometryChanges) => {
      const state = EditorState.create({ doc: "- ```\n  code\n  ```" });
      const opening = makeLine(BEGIN.split("_"), {
        position: 0,
        markerEnd: 164,
      });
      const body = makeLine(CONTENT.split("_"), {
        position: state.doc.line(2).from,
      });
      body.querySelector = ((selector: string) =>
        selector === ".bullet-plugin-nested-code-block-content"
          ? { getBoundingClientRect: () => ({ left: 132, right: 164 }) }
          : null) as never;
      const frames: FrameRequestCallback[] = [];
      const win = makeAnimationWindow(frames);
      const pending = new Set<Measurement>();
      let measuring = false;
      let scheduled = false;
      let afterRead: VoidFunction | undefined;
      const view = {
        state,
        visibleRanges: [{ from: 0, to: state.doc.length }],
        contentDOM: { querySelectorAll: () => [opening, body] },
        posAtDOM: (element: { position: number }) => element.position,
        dom: { ownerDocument: { defaultView: win } },
        requestMeasure: (request: Measurement) => {
          pending.add(request);
          if (measuring || scheduled) return;
          scheduled = true;
          win.requestAnimationFrame(() => {
            scheduled = false;
            measuring = true;
            for (let cycle = 0; pending.size; cycle++) {
              if (cycle > 5) throw Error("Measurement did not settle");
              const requests = [...pending];
              pending.clear();
              const values = requests.map((measurement) => measurement.read());
              afterRead?.();
              requests.forEach((measurement, index) =>
                measurement.write(values[index]),
              );
            }
            measuring = false;
          });
        },
      };
      const plugin = mountLayout(view as never, names(BEGIN, CONTENT, END));
      const dispatch = drivers.get(plugin)!.dispatch;
      Object.assign(view, {
        dispatch: (...specs: TransactionSpec[]) => {
          expect(measuring).toBe(false);
          dispatch(...specs);
        },
      });
      if (geometryChanges)
        afterRead = () => {
          afterRead = undefined;
          opening.getBoundingClientRect = () => ({ left: 80, right: 300 });
          plugin.update({
            view,
            startState: state,
            state,
            transactions: [],
            geometryChanged: true,
          } as never);
        };
      for (const callback of frames.splice(0)) {
        callback(0);
        flushPublications();
      }
      expect(lineAttributes(plugin, body.position)).toEqual({
        class: "bullet-plugin-nested-code-block",
        style: geometryChanges
          ? "--bullet-nested-code-block-inset: 84px; --bullet-code-content-padding: calc(84px - 32px + 0ch + var(--size-4-4));"
          : "--bullet-nested-code-block-inset: 64px; --bullet-code-content-padding: calc(64px - 32px + 0ch + var(--size-4-4));",
      });
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(frames).toHaveLength(0);
      expect(pending.size).toBe(0);
      plugin.destroy();
    },
  );

  test("handles SVG class mutations through the element's class tokens", () => {
    const fixture = makePreviewFixture();
    fixture.measure();
    const element = fixture.lines[0];
    const previousClass = element.className;
    Object.defineProperty(element, "className", {
      value: { baseVal: previousClass },
      configurable: true,
    });
    element.classList.add("native-state-changed");
    fixture.notify(element, "attributes", previousClass);
    fixture.measure();
    expect(lineAttributes(fixture.plugin, 0).style).toContain(
      "--bullet-nested-code-block-inset: 64px;",
    );
    expect(fixture.measurements).toHaveLength(2);
    fixture.plugin.destroy();
  });

  test("does not write or clean processor attributes after its element becomes a native row", () => {
    const fixture = makePreviewFixture();
    const [opening, embed] = fixture.lines;
    embed.classList = makeClassList("cm-preview-code-block");
    embed.position = 3;
    embed.querySelector = (() => null) as never;
    fixture.show([opening, embed]);
    fixture.measure();
    expect(
      embed.style.getPropertyValue("--bullet-nested-code-block-inset"),
    ).toBe("64px");
    const measurement = fixture.measurements[0];
    const frame = measurement.read();
    embed.classList = makeClassList("cm-line", "HyperMD-list-line");
    embed.style = makeStyle([["--bullet-nested-code-block-inset", "123px"]]);
    measurement.write(frame);
    expect(
      embed.style.getPropertyValue("--bullet-nested-code-block-inset"),
    ).toBe("123px");
    fixture.plugin.destroy();
    expect(
      embed.style.getPropertyValue("--bullet-nested-code-block-inset"),
    ).toBe("123px");
  });

  test("publishes complete row attributes after measure returns and coalesces the newest frame", () => {
    const fixture = makePreviewFixture();
    const { plugin, measurements, lines } = fixture;
    const measurement = measurements[0];
    const dispatch = drivers.get(plugin)!.dispatch;
    const nativeWrite = jest.spyOn(lines[0].style, "setProperty");
    const nativeClass = jest.spyOn(lines[0].classList, "add");
    const first = measurement.read();
    measurement.write(first);
    const before = lineAttributes(plugin, 0);
    expect(before).toEqual({
      class: "bullet-plugin-nested-code-block",
      style: "",
    });
    expect(nativeWrite).not.toHaveBeenCalled();
    expect(nativeClass).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    lines[0].getBoundingClientRect = () =>
      ({ left: 90, right: 300, top: 100, height: 24 }) as never;
    measurement.write(measurement.read());
    expect(publications).toHaveLength(1);
    flushPublications();
    expect(lineAttributes(plugin, 0)).toEqual({
      class:
        "bullet-plugin-nested-code-block bullet-plugin-code-opening-aligned bullet-plugin-code-guide-continuation bullet-plugin-code-preview-opening bullet-plugin-code-preview-hidden-fence",
      style:
        "--bullet-nested-code-block-inset: 74px; --bullet-code-opening-marker-offset: 0px; --bullet-code-indent-guide-height: 24px;",
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(fixture.measurements).toHaveLength(1);
    fixture.measure();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(fixture.measurements).toHaveLength(1);
    plugin.destroy();
  });

  test("keeps measured geometry and preview roles for an unchanged explicit selection", () => {
    const fixture = makePreviewFixture();
    fixture.measure();
    const dispatch = drivers.get(fixture.plugin)!.dispatch;
    const before = lineAttributes(fixture.plugin, 0);
    dispatch({ selection: fixture.view.state.selection });
    expect(lineAttributes(fixture.plugin, 0)).toEqual(before);
    expect(before.style).toContain("--bullet-nested-code-block-inset: 64px;");
    expect(before.class).toContain("bullet-plugin-code-preview-opening");
    expect(fixture.measurements).toHaveLength(1);
    fixture.plugin.destroy();
  });

  test("keeps an offscreen opener's marker alignment when editing enters its source block", () => {
    const fixture = makePreviewFixture(false, true);
    const dispatch = drivers.get(fixture.plugin)!.dispatch;
    dispatch({ selection: { anchor: fixture.view.state.doc.length } });
    fixture.measure();
    expect(lineAttributes(fixture.plugin, 0).class).toContain(
      "bullet-plugin-code-preview-opening",
    );
    fixture.show([fixture.lines[1]]);
    dispatch({
      selection: { anchor: fixture.view.state.doc.line(2).from + 3 },
    });
    expect(lineAttributes(fixture.plugin, 0)).toEqual({
      class:
        "bullet-plugin-nested-code-block bullet-plugin-code-opening-aligned bullet-plugin-code-guide-continuation",
      style:
        "--bullet-nested-code-block-inset: 64px; --bullet-code-opening-marker-offset: 0px; --bullet-code-indent-guide-height: 24px;",
    });
    fixture.plugin.destroy();
  });

  test("clips the first owner guide at the aligned bullet center while its opener is offscreen", () => {
    const fixture = makePreviewFixture(false, true);
    const [opening, first] = fixture.lines;
    first.getBoundingClientRect = () =>
      ({ left: 100, right: 300, top: 124, height: 24 }) as never;
    const dispatch = drivers.get(fixture.plugin)!.dispatch;
    dispatch({ selection: { anchor: fixture.view.state.doc.length } });
    fixture.measure();

    fixture.show([first]);
    dispatch({ selection: { anchor: fixture.view.state.doc.line(2).to } });
    expect(lineAttributes(fixture.plugin, first.position)).toEqual({
      class:
        "bullet-plugin-nested-code-block bullet-plugin-code-owner-guide-clipped",
      style:
        "--bullet-nested-code-block-inset: 64px; --bullet-code-owner-guide-clip: 12px;",
    });

    fixture.measure();
    expect(lineAttributes(fixture.plugin, first.position).style).toContain(
      "--bullet-code-owner-guide-clip: 12px;",
    );

    dispatch({ selection: { anchor: fixture.view.state.doc.length } });
    fixture.measure();
    const preview = lineAttributes(fixture.plugin, first.position);
    expect(preview.class).not.toContain(
      "bullet-plugin-code-owner-guide-clipped",
    );
    expect(preview.style).not.toContain("--bullet-code-owner-guide-clip");
    expect(
      lineAttributes(fixture.plugin, opening.position).style,
    ).not.toContain("--bullet-code-owner-guide-clip");
    fixture.plugin.destroy();
  });

  test("removes first-row clipping when a newline moves that body row down", () => {
    const fixture = makePreviewFixture(false, true);
    const [opening, first, , closing] = fixture.lines;
    opening.setRaw(true);
    closing.setRaw(true);
    first.getBoundingClientRect = () =>
      ({ left: 100, right: 300, top: 124, height: 24 }) as never;
    const dispatch = drivers.get(fixture.plugin)!.dispatch;
    dispatch({ selection: { anchor: fixture.view.state.doc.line(2).to } });
    fixture.measure();
    expect(lineAttributes(fixture.plugin, first.position).style).toContain(
      "--bullet-code-owner-guide-clip: 12px;",
    );

    fixture.show([first]);
    dispatch({ changes: { from: first.position, insert: "\t  \n" } });
    first.position = fixture.view.state.doc.line(3).from;
    fixture.measure();
    const moved = lineAttributes(fixture.plugin, first.position);
    expect(moved.style).toContain(
      "--bullet-nested-code-block-inset: calc(64px + var(--list-padding-inline-start));",
    );
    expect(moved.style).not.toContain("--bullet-code-owner-guide-clip");
    expect(fixture.view.state.doc.line(3).text).toBe("\t  one");
    fixture.plugin.destroy();
  });

  test("continues opening ancestor guides through the code card in preview and source", () => {
    const fixture = makePreviewFixture(false, true);
    const [opening, first, second, closing, outside] = fixture.lines;
    for (const [index, line] of fixture.lines.entries()) {
      line.getBoundingClientRect = () =>
        ({
          left: 100,
          right: 300,
          top: 100 + index * 24,
          height: 24,
          bottom: 124 + index * 24,
        }) as never;
    }
    Object.assign(outside, {
      querySelectorAll: (selector: string) =>
        selector.includes(".bullet-plugin-outer-list-guide")
          ? [
              {
                getBoundingClientRect: () => ({ top: 201.25 }),
              },
            ]
          : selector.includes(".cm-indent")
            ? [
                {
                  getBoundingClientRect: () => ({ top: 197.25 }),
                },
              ]
            : [],
    });
    Object.assign(opening, {
      querySelectorAll: (selector: string) =>
        selector.includes(".bullet-plugin-outer-list-guide")
          ? [
              {
                getBoundingClientRect: () => ({ top: 104 }),
              },
            ]
          : selector.includes(".cm-indent")
            ? [
                {
                  getBoundingClientRect: () => ({ top: 106 }),
                },
              ]
            : [],
    });
    Object.assign(opening.ownerDocument.defaultView, { devicePixelRatio: 2 });

    fixture.measure();
    let openingAttributes = lineAttributes(fixture.plugin, opening.position);
    expect(openingAttributes.class).toContain(
      "bullet-plugin-code-guide-continuation",
    );
    expect(openingAttributes.style).toContain(
      "--bullet-code-indent-guide-height: 91.5px;",
    );
    expect(openingAttributes.style).toContain(
      "--bullet-code-outer-guide-height: 97.5px;",
    );
    for (const row of [first, second, closing]) {
      const classes = lineAttributes(fixture.plugin, row.position).class;
      expect(classes).toContain("bullet-plugin-code-indent-guide-covered");
      expect(classes).toContain("bullet-plugin-code-outer-guide-covered");
    }
    expect(
      lineAttributes(fixture.plugin, outside.position).class,
    ).not.toContain("bullet-plugin-code-indent-guide-covered");
    expect(lineAttributes(fixture.plugin, outside.position)).toEqual({
      class: "bullet-plugin-code-guide-seam",
      style:
        "--bullet-code-indent-guide-seam-clip: 0.25px; --bullet-code-outer-guide-seam-clip: 0.25px;",
    });

    const dispatch = drivers.get(fixture.plugin)!.dispatch;
    dispatch({ selection: { anchor: second.position + 3 } });
    fixture.measure();
    openingAttributes = lineAttributes(fixture.plugin, opening.position);
    expect(openingAttributes.class).toContain(
      "bullet-plugin-code-guide-continuation",
    );
    expect(openingAttributes.style).toContain(
      "--bullet-code-indent-guide-height: 91.5px;",
    );
    expect(openingAttributes.style).toContain(
      "--bullet-code-outer-guide-height: 97.5px;",
    );

    fixture.show([first, second, closing, outside]);
    dispatch({ selection: { anchor: first.position + 3 } });
    openingAttributes = lineAttributes(fixture.plugin, opening.position);
    expect(openingAttributes.class).toContain(
      "bullet-plugin-code-guide-continuation",
    );
    expect(openingAttributes.style).toContain(
      "--bullet-code-indent-guide-height: 91.5px;",
    );
    expect(openingAttributes.style).toContain(
      "--bullet-code-outer-guide-height: 97.5px;",
    );
    expect(lineAttributes(fixture.plugin, outside.position)).toEqual({
      class: "bullet-plugin-code-guide-seam",
      style:
        "--bullet-code-indent-guide-seam-clip: 0.25px; --bullet-code-outer-guide-seam-clip: 0.25px;",
    });

    fixture.measure();
    for (const row of [first, second, closing]) {
      const classes = lineAttributes(fixture.plugin, row.position).class;
      expect(classes).not.toContain("bullet-plugin-code-indent-guide-covered");
      expect(classes).not.toContain("bullet-plugin-code-outer-guide-covered");
    }
    fixture.plugin.destroy();
  });

  test.each([false, true])(
    "continues the opening outer guide to the final code-card edge with a following blank row %s",
    (blankAfter) => {
      const fixture = makePreviewFixture(false, blankAfter);
      const [opening, first, second, closing, outside] = fixture.lines;
      fixture.lines.forEach((line, index) => {
        line.getBoundingClientRect = () =>
          ({
            top: 100 + index * 24,
            height: 24,
            left: 100,
            right: 300,
          }) as never;
      });
      Object.assign(opening, {
        querySelectorAll: (selector: string) =>
          selector.includes(".bullet-plugin-outer-list-guide")
            ? [{ getBoundingClientRect: () => ({ top: 104 }) }]
            : [],
      });
      if (outside) {
        drivers.get(fixture.plugin)!.dispatch({
          changes: {
            from: outside.position,
            to: fixture.view.state.doc.length,
            insert: "",
          },
        });
      }

      fixture.measure();

      expect(lineAttributes(fixture.plugin, opening.position).style).toContain(
        "--bullet-code-outer-guide-height: 92px;",
      );
      for (const row of [first, second, closing]) {
        expect(lineAttributes(fixture.plugin, row.position).class).toContain(
          "bullet-plugin-code-outer-guide-covered",
        );
      }
      fixture.plugin.destroy();
    },
  );

  test("replaces the previous outer guide height after deleting the post-card list item", () => {
    const fixture = makePreviewFixture(false, true);
    const [opening, first, second, closing, outside] = fixture.lines;
    fixture.lines.forEach((line, index) => {
      line.getBoundingClientRect = () =>
        ({ top: 100 + index * 24, height: 24, left: 100, right: 300 }) as never;
    });
    Object.assign(opening, {
      querySelectorAll: (selector: string) =>
        selector.includes(".bullet-plugin-outer-list-guide")
          ? [{ getBoundingClientRect: () => ({ top: 104 }) }]
          : [],
    });
    Object.assign(outside, {
      querySelectorAll: (selector: string) =>
        selector.includes(".bullet-plugin-outer-list-guide")
          ? [{ getBoundingClientRect: () => ({ top: 201 }) }]
          : [],
    });
    fixture.measure();
    expect(lineAttributes(fixture.plugin, opening.position).style).toContain(
      "--bullet-code-outer-guide-height: 97px;",
    );

    drivers.get(fixture.plugin)!.dispatch({
      changes: {
        from: outside.position,
        to: fixture.view.state.doc.length,
        insert: "",
      },
    });
    Object.assign(outside, { querySelectorAll: () => [] });
    fixture.measure();

    expect(fixture.view.state.doc.line(5).text).toBe("");
    expect(lineAttributes(fixture.plugin, opening.position).style).toContain(
      "--bullet-code-outer-guide-height: 92px;",
    );
    for (const row of [first, second, closing]) {
      expect(lineAttributes(fixture.plugin, row.position).class).toContain(
        "bullet-plugin-code-outer-guide-covered",
      );
    }
    fixture.plugin.destroy();
  });

  test("joins guides at their painted containing-block origin instead of the inline box", () => {
    const fixture = makePreviewFixture(false, true);
    const [opening, , , , outside] = fixture.lines;
    const tops = [
      234.3359375, 242.3359375, 263.3359375, 284.3359375, 305.3359375,
    ];
    const heights = [8, 21, 21, 21, 26.390625];
    for (const [index, line] of fixture.lines.entries()) {
      line.getBoundingClientRect = () =>
        ({
          left: 100,
          right: 300,
          top: tops[index],
          height: heights[index],
        }) as never;
    }
    const guides = [opening, outside].map((line) => {
      const guide = {
        offsetParent: line,
        parentElement: line,
        getBoundingClientRect: () => ({
          top:
            (line === outside ? 305.3359375 : 234.3359375) +
            (line === outside ? 1.1953125 : 0),
        }),
      };
      Object.assign(line, {
        clientTop: 0,
        querySelectorAll: (selector: string) =>
          selector.includes(".cm-indent") ? [guide] : [],
      });
      return guide;
    });
    for (const line of [opening, outside]) {
      Object.assign(line.ownerDocument.defaultView, {
        devicePixelRatio: 2,
        getComputedStyle: (element: unknown, pseudo?: string) => ({
          direction: "ltr",
          marginInlineEnd: "0px",
          lineHeight: "24px",
          position: pseudo
            ? "absolute"
            : guides.some((guide) => element === guide)
              ? "static"
              : "relative",
          top: "0px",
        }),
      });
    }

    fixture.measure();

    expect(lineAttributes(fixture.plugin, opening.position).style).toContain(
      "--bullet-code-indent-guide-height: 71.1640625px;",
    );
    expect(lineAttributes(fixture.plugin, outside.position)).toEqual({
      class: "bullet-plugin-code-guide-seam",
      style: "--bullet-code-indent-guide-seam-clip: 0.1640625px;",
    });
    fixture.plugin.destroy();
  });

  test("preserves positioned outer-guide origins and static-guide containing wrappers", () => {
    const fixture = makePreviewFixture(false, true);
    const [opening, , , , outside] = fixture.lines;
    fixture.lines.forEach((line, index) => {
      line.getBoundingClientRect = () =>
        ({ left: 100, right: 300, top: 100 + index * 24, height: 24 }) as never;
    });
    for (const line of [opening, outside]) {
      const indent = {
        offsetParent: {
          clientTop: 1,
          getBoundingClientRect: () => ({
            top: line === opening ? 105 : 196.25,
          }),
        },
        getBoundingClientRect: () => ({ top: line === opening ? 114 : 199 }),
      };
      const outer = {
        offsetParent: line,
        clientTop: 0,
        getBoundingClientRect: () => ({
          top: line === opening ? 104 : 201.25,
        }),
      };
      Object.assign(line, {
        querySelectorAll: (selector: string) =>
          selector.includes(".cm-indent")
            ? [indent]
            : selector.includes(".bullet-plugin-outer-list-guide")
              ? [outer]
              : [],
      });
      Object.assign(line.ownerDocument.defaultView, {
        devicePixelRatio: 2,
        getComputedStyle: (element: unknown, pseudo?: string) => ({
          direction: "ltr",
          marginInlineEnd: "0px",
          lineHeight: "24px",
          position: pseudo || element === outer ? "absolute" : "static",
          top: "0px",
        }),
      });
    }

    fixture.measure();

    const style = lineAttributes(fixture.plugin, opening.position).style;
    expect(style).toContain("--bullet-code-indent-guide-height: 91.5px;");
    expect(style).toContain("--bullet-code-outer-guide-height: 97.5px;");
    expect(lineAttributes(fixture.plugin, outside.position)).toEqual({
      class: "bullet-plugin-code-guide-seam",
      style:
        "--bullet-code-indent-guide-seam-clip: 0.25px; --bullet-code-outer-guide-seam-clip: 0.25px;",
    });
    fixture.plugin.destroy();
  });

  test("covers body guides when an opening guide has no direct-child geometry", () => {
    const fixture = makePreviewFixture();
    const [opening, first] = fixture.lines;
    Object.assign(opening, {
      querySelectorAll: (selector: string) =>
        selector === ".cm-indent"
          ? [{ getBoundingClientRect: () => ({ top: 100 }) }]
          : [],
    });

    fixture.measure();

    expect(lineAttributes(fixture.plugin, first.position).class).toContain(
      "bullet-plugin-code-indent-guide-covered",
    );
    expect(lineAttributes(fixture.plugin, first.position).class).not.toContain(
      "bullet-plugin-code-outer-guide-covered",
    );
    expect(
      lineAttributes(fixture.plugin, opening.position).style,
    ).not.toContain("--bullet-code-outer-guide-height");
    fixture.plugin.destroy();
  });

  test("toggles an offscreen body's preview role across source editing", () => {
    const fixture = makePreviewFixture(false, true);
    const body = fixture.lines[1];
    const dispatch = drivers.get(fixture.plugin)!.dispatch;
    dispatch({ selection: { anchor: fixture.view.state.doc.length } });
    fixture.show([body]);
    fixture.measure();
    expect(lineAttributes(fixture.plugin, body.position).class).toContain(
      "bullet-plugin-code-preview-body",
    );

    dispatch({ selection: { anchor: fixture.view.state.doc.line(2).to } });
    fixture.measure();
    expect(lineAttributes(fixture.plugin, body.position).class).not.toContain(
      "bullet-plugin-code-preview-body",
    );

    dispatch({ selection: { anchor: fixture.view.state.doc.length } });
    fixture.measure();
    expect(lineAttributes(fixture.plugin, body.position).class).toContain(
      "bullet-plugin-code-preview-body",
    );
    fixture.plugin.destroy();
  });

  test.each(["document", "selection", "presentation", "theme", "destroy"])(
    "discards a pending frame after a %s change",
    (change) => {
      const fixture = makePreviewFixture();
      const { plugin, view, measurements } = fixture;
      const dispatch = drivers.get(plugin)!.dispatch;
      fixture.measure();
      const before = lineAttributes(plugin, 0);
      fixture.lines[0].getBoundingClientRect = () =>
        ({ left: 80, right: 300, top: 100, height: 24 }) as never;
      measurements[0].write(measurements[0].read());
      const published = dispatch.mock.calls.length;
      if (change === "document")
        dispatch({ changes: { from: view.state.doc.line(2).to, insert: "x" } });
      else if (change === "selection")
        dispatch({ selection: { anchor: view.state.doc.line(2).from + 3 } });
      else if (change === "presentation") {
        fixture.lines[0].setRaw(true);
        fixture.notify(fixture.lines[0]);
      } else if (change === "theme") fixture.notify(fixture.body, "attributes");
      else plugin.destroy();
      flushPublications();
      expect(dispatch.mock.calls.length).toBe(
        published + (change === "document" || change === "selection" ? 1 : 0),
      );
      expect(withoutCursorLine(lineAttributes(plugin, 0))).toEqual(
        withoutCursorLine(before),
      );
      if (change !== "destroy") {
        fixture.measure();
        expect(lineAttributes(plugin, 0).style).toContain(
          "--bullet-nested-code-block-inset: 84px;",
        );
        plugin.destroy();
      }
    },
  );

  test("keeps a private publication effect from affecting another editor", () => {
    const first = makePreviewFixture();
    const second = makePreviewFixture();
    first.measure();
    const firstDispatch = drivers.get(first.plugin)!.dispatch;
    const secondDispatch = drivers.get(second.plugin)!.dispatch;
    secondDispatch(firstDispatch.mock.calls[0][0]);
    expect(lineAttributes(second.plugin, 0)).toEqual({
      class: "bullet-plugin-nested-code-block",
      style: "",
    });
    second.measure();
    expect(lineAttributes(second.plugin, 0).style).toContain(
      "--bullet-nested-code-block-inset: 64px;",
    );
    first.plugin.destroy();
    second.plugin.destroy();
  });

  test("rejects a measurement effect combined with a document edit", () => {
    const fixture = makePreviewFixture();
    fixture.measure();
    const dispatch = drivers.get(fixture.plugin)!.dispatch;
    const published: TransactionSpec = dispatch.mock.calls[0][0];
    const effect = fixture.view.state.update(published).effects[0];
    expect(effect.map(fixture.view.state.update({}).changes)).toBe(effect);
    expect(
      effect.map(
        fixture.view.state.update({ changes: { from: 0, insert: "prefix" } })
          .changes,
      ),
    ).toBeUndefined();
    dispatch({
      ...published,
      changes: { from: 0, to: fixture.view.state.doc.length, insert: "plain" },
    });
    expect(lineAttributes(fixture.plugin, 0)).toEqual({ class: "", style: "" });
    expect(fixture.view.state.doc.toString()).toBe("plain");
    fixture.plugin.destroy();
  });
});

describe("plain Shiki preview appearance", () => {
  const plainClass = "bullet-plugin-code-preview-plain";
  const appearanceProperties = [
    "--bullet-code-preview-background",
    "--bullet-code-preview-end",
    "--bullet-code-preview-radius",
  ];
  const originalNodeFilter = globalThis.NodeFilter;
  beforeAll(() =>
    Object.defineProperty(globalThis, "NodeFilter", {
      value: { SHOW_TEXT: 4 },
      configurable: true,
    }),
  );
  afterAll(() =>
    Object.defineProperty(globalThis, "NodeFilter", {
      value: originalNodeFilter,
      configurable: true,
    }),
  );

  function setup() {
    const fixture = makePreviewFixture();
    const [opening, embed] = fixture.lines;
    const appearance = {
      background: "rgb(31, 31, 40)",
      end: 348,
      radius: "6px",
      headerHeight: 0,
      preAvailable: true,
    };
    const pre = {
      getBoundingClientRect: () => ({ left: 164, right: appearance.end }),
    };
    const frame = { classList: makeClassList("frame") };
    const header = {
      getBoundingClientRect: () => ({ height: appearance.headerHeight }),
    };
    const code = { getBoundingClientRect: () => ({ top: 124, height: 21 }) };
    embed.classList = makeClassList("cm-preview-code-block");
    embed.position = 3;
    embed.querySelector = ((selector: string) => {
      if (selector === ".expressive-code pre")
        return appearance.preAvailable ? pre : null;
      if (selector === ".expressive-code .frame") return frame;
      if (selector === ".expressive-code .header") return header;
      if (selector === ".ec-line .code") return code;
      return null;
    }) as never;
    embed.ownerDocument.defaultView.getComputedStyle = ((element: unknown) => {
      if (element === pre) return { backgroundColor: appearance.background };
      if (element === frame)
        return { borderStartStartRadius: appearance.radius };
      return { lineHeight: "21px", paddingTop: "0px", paddingBottom: "0px" };
    }) as never;
    fixture.show([opening, embed]);
    fixture.measure();
    return { ...fixture, opening, embed, appearance, frame };
  }

  test("uses the rendered card's color, inline end, and frame radius without resizing its source fence", () => {
    const fixture = setup();
    try {
      expect(
        appearanceProperties.map((property) =>
          fixture.opening.style.getPropertyValue(property),
        ),
      ).toEqual(["rgb(31, 31, 40)", "248px", "6px"]);
      expect(fixture.opening.classList.contains(plainClass)).toBe(true);
      expect(fixture.embed.classList.contains(plainClass)).toBe(true);
      expect(fixture.opening.style.getPropertyValue("height")).toBe("");
      expect(fixture.opening.style.getPropertyValue("block-size")).toBe("");
      fixture.appearance.end = 402;
      fixture.appearance.radius = "10px";
      fixture.measure();
      expect(
        fixture.opening.style.getPropertyValue("--bullet-code-preview-end"),
      ).toBe("302px");
      expect(
        fixture.opening.style.getPropertyValue("--bullet-code-preview-radius"),
      ).toBe("10px");
    } finally {
      fixture.plugin.destroy();
    }
    for (const element of [fixture.opening, fixture.embed]) {
      expect(element.classList.contains(plainClass)).toBe(false);
      for (const property of appearanceProperties)
        expect(element.style.getPropertyValue(property)).toBe("");
    }
  });

  test("publishes the complete processor-opening attributes and removes every preview-only value in source", () => {
    const fixture = setup();
    expect(lineAttributes(fixture.plugin, 0)).toEqual({
      class:
        "bullet-plugin-nested-code-block bullet-plugin-code-opening-aligned bullet-plugin-code-guide-continuation bullet-plugin-code-preview-opening bullet-plugin-code-preview-embed-opening bullet-plugin-code-preview-plain bullet-plugin-code-preview-hidden-fence",
      style:
        "--bullet-nested-code-block-inset: 64px; --bullet-code-opening-marker-offset: 0px; --bullet-code-indent-guide-height: 24px; --bullet-code-preview-background: rgb(31, 31, 40); --bullet-code-preview-end: 248px; --bullet-code-preview-radius: 6px;",
    });
    fixture.opening.setRaw(true);
    fixture.notify(fixture.opening);
    fixture.measure();
    expect(lineAttributes(fixture.plugin, 0)).toEqual({
      class:
        "bullet-plugin-nested-code-block bullet-plugin-code-guide-continuation",
      style:
        "--bullet-nested-code-block-inset: 64px; --bullet-code-indent-guide-height: 24px;",
    });
    fixture.plugin.destroy();
  });

  test.each(["has-title", "is-terminal"])(
    "leaves a visible %s header under the processor's own layout",
    (kind) => {
      const fixture = setup();
      try {
        fixture.frame.classList.add(kind);
        fixture.appearance.headerHeight = 28;
        fixture.measure();
        for (const element of [fixture.opening, fixture.embed])
          expect(element.classList.contains(plainClass)).toBe(false);
        for (const property of appearanceProperties)
          expect(fixture.opening.style.getPropertyValue(property)).toBe("");
        expect(
          fixture.opening.classList.contains(
            "bullet-plugin-code-preview-hidden-fence",
          ),
        ).toBe(true);
        expect(
          fixture.embed.classList.contains("bullet-plugin-code-preview-embed"),
        ).toBe(true);
      } finally {
        fixture.plugin.destroy();
      }
    },
  );

  test("clears appearance while an asynchronous renderer has no code card", () => {
    const fixture = setup();
    try {
      fixture.appearance.preAvailable = false;
      fixture.measure();
      for (const property of appearanceProperties)
        expect(fixture.opening.style.getPropertyValue(property)).toBe("");
      expect(fixture.opening.classList.contains(plainClass)).toBe(false);
      expect(fixture.embed.classList.contains(plainClass)).toBe(false);
    } finally {
      fixture.plugin.destroy();
    }
  });

  test("retains plain opening paint through redraw and removes it when the source fence returns", () => {
    const fixture = setup();
    try {
      fixture.opening.classList.remove(plainClass);
      fixture.redraw();
      fixture.notify(fixture.opening, "attributes");
      expect(fixture.opening.classList.contains(plainClass)).toBe(true);
      expect(fixture.embed.classList.contains(plainClass)).toBe(true);
      const pending = fixture.measurements.length;
      fixture.measure();
      fixture.notify(fixture.opening, "attributes");
      expect(fixture.measurements).toHaveLength(pending);

      fixture.opening.setRaw(true);
      fixture.notify(fixture.opening);
      fixture.measure();
      expect(fixture.opening.classList.contains(plainClass)).toBe(false);
      fixture.show([fixture.opening]);
      fixture.measure();
      for (const element of [fixture.opening, fixture.embed]) {
        expect(element.classList.contains(plainClass)).toBe(false);
        for (const property of appearanceProperties)
          expect(element.style.getPropertyValue(property)).toBe("");
      }
    } finally {
      fixture.plugin.destroy();
    }
  });

  test("remeasures a theme repaint even when its card geometry is unchanged", () => {
    const fixture = setup();
    try {
      expect(fixture.observe).toHaveBeenCalledWith(fixture.body, {
        attributes: true,
        attributeFilter: ["class"],
      });
      const pending = fixture.measurements.length;
      fixture.appearance.background = "rgb(242, 236, 188)";
      fixture.notify(fixture.body, "attributes");
      expect(fixture.measurements).toHaveLength(pending + 1);
      expect(
        fixture.opening.style.getPropertyValue(
          "--bullet-code-preview-background",
        ),
      ).toBe("rgb(31, 31, 40)");

      fixture.measure();
      expect(
        fixture.opening.style.getPropertyValue(
          "--bullet-code-preview-background",
        ),
      ).toBe("rgb(242, 236, 188)");
      expect(
        fixture.opening.style.getPropertyValue("--bullet-code-preview-end"),
      ).toBe("248px");
    } finally {
      fixture.plugin.destroy();
    }
    expect(fixture.disconnect).toHaveBeenCalledTimes(1);
    const stopped = fixture.measurements.length;
    fixture.notify(fixture.body, "attributes");
    expect(fixture.measurements).toHaveLength(stopped);
  });
});

test("aligns every visible line to the measured list content edge", () => {
  const state = EditorState.create({
    doc: ["\t- ```ts", "\t  code", "\t  ```", "```ts"].join("\n"),
  });
  const opening = makeLine(
    ["HyperMD-codeblock", "HyperMD-codeblock-begin", "HyperMD-list-line"],
    { position: state.doc.line(1).from, openingContentLeft: 160 },
  );
  const content = makeLine(["HyperMD-codeblock", "HyperMD-list-line"], {
    position: state.doc.line(2).from,
  });
  const closing = makeLine(
    ["HyperMD-codeblock", "HyperMD-codeblock-end", "HyperMD-list-line"],
    { position: state.doc.line(3).from },
  );
  const documentCode = makeLine(
    ["HyperMD-codeblock", "HyperMD-codeblock-begin"],
    { position: state.doc.line(4).from },
  );
  const measurements: Measurement[] = [];

  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: {
      querySelectorAll: () => [opening, content, closing, documentCode],
    },
    posAtDOM: (element: { position: number }) => element.position,
    coordsAtPos: () => ({ left: 130, right: 130 }),
    dom: { ownerDocument: { defaultView: {} } },
    requestMeasure: (measurement: Measurement) =>
      measurements.push(measurement),
  };

  const plugin = mountLayout(
    view as never,
    names(BEGIN, CONTENT, END, "HyperMD-codeblock"),
  );

  const measurement = measurements[0];
  runMeasurement(measurement);

  for (const line of [opening, content, closing]) {
    expect(line.classList.contains("bullet-plugin-nested-code-block")).toBe(
      true,
    );
    expect(
      line.style.getPropertyValue("--bullet-nested-code-block-inset"),
    ).toBe("60px");
  }
  expect(
    documentCode.classList.contains("bullet-plugin-nested-code-block"),
  ).toBe(false);

  plugin.destroy();
  for (const line of [opening, content, closing]) {
    expect(line.classList.contains("bullet-plugin-nested-code-block")).toBe(
      false,
    );
    expect(
      line.style.getPropertyValue("--bullet-nested-code-block-inset"),
    ).toBe("");
  }
});

test("insets a rendered code embed from its owning list marker when the fence text is hidden", () => {
  const state = EditorState.create({
    doc: "\t- ```js\n\t  code\n\t  ```\n\n```js\ncode\n```",
  });
  const opening = makeLine(
    ["HyperMD-codeblock", "HyperMD-codeblock-begin", "HyperMD-list-line"],
    { position: 0, markerEnd: 164 },
  );
  const embed = makeLine(["cm-preview-code-block"], { position: 3 });
  const outsideEmbed = makeLine(["cm-preview-code-block"], {
    position: state.doc.line(5).from,
  });
  const measurements: Measurement[] = [];

  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { querySelectorAll: () => [opening, embed, outsideEmbed] },
    posAtDOM: (element: { position: number }) => element.position,
    // Hidden source coordinates point to the full-width embed, not the marker.
    coordsAtPos: () => ({ left: 100, right: 100 }),
    dom: { ownerDocument: { defaultView: {} } },
    requestMeasure: (measurement: Measurement) =>
      measurements.push(measurement),
  };
  const plugin = mountLayout(
    view as never,
    names(BEGIN, CONTENT, END, null, "HyperMD-codeblock"),
  );

  runMeasurement(measurements[0]);
  for (const element of [opening, embed]) {
    expect(
      element.style.getPropertyValue("--bullet-nested-code-block-inset"),
    ).toBe("64px");
    expect(element.classList.contains("bullet-plugin-nested-code-block")).toBe(
      true,
    );
  }
  expect(
    outsideEmbed.classList.contains("bullet-plugin-nested-code-block"),
  ).toBe(false);
  plugin.destroy();
  expect(embed.style.getPropertyValue("--bullet-nested-code-block-inset")).toBe(
    "",
  );
  expect(embed.classList.contains("bullet-plugin-nested-code-block")).toBe(
    false,
  );
});

test.each([
  "unordered",
  "ordered",
  "no-body",
  "blank-body",
  "empty",
  "empty-no-line-box",
  "empty-compact-no-line-box",
])(
  "aligns %s preview below a native-height fence after class redraw",
  (kind) => {
    const noLineBox = kind.endsWith("no-line-box");
    const compact = kind === "empty-compact-no-line-box";
    const expectedOffset =
      kind === "no-body" ? "" : compact ? "23px" : noLineBox ? "26px" : "36px";
    const state = EditorState.create({
      doc: [
        "\t- ```js",
        ...(kind === "no-body"
          ? []
          : [kind === "blank-body" ? "" : "\t  code"]),
        "\t  ```",
      ].join("\n"),
    });
    const opening = makeLine(
      ["HyperMD-codeblock", "HyperMD-codeblock-begin", "HyperMD-list-line"],
      { position: 0, markerEnd: 164 },
    );
    const activeOffset = () =>
      opening.classList.contains("bullet-plugin-code-opening-aligned")
        ? Number.parseFloat(
            opening.style.getPropertyValue(
              "--bullet-code-opening-marker-offset",
            ),
          ) || 0
        : 0;
    const marker = {
      getBoundingClientRect: () => ({
        left: 164,
        right: 164,
        top: 100 + (kind === "ordered" ? activeOffset() : 0),
        height: 24,
      }),
    };
    const markerContainer = {
      getBoundingClientRect: () => ({
        left: 164,
        right: 164,
        top: 100,
        height: 24,
      }),
    };
    opening.querySelector = ((selector: string) =>
      selector === ".cm-formatting-list"
        ? markerContainer
        : selector === (kind === "ordered" ? ".list-number" : ".list-bullet")
          ? marker
          : null) as typeof opening.querySelector;
    opening.getBoundingClientRect = () =>
      ({ left: 100, right: 300, top: 100 }) as never;
    opening.ownerDocument.defaultView.getComputedStyle = (
      element?: unknown,
    ) => ({
      direction: "ltr",
      marginInlineEnd: "0px",
      insetBlockStart:
        element === marker && kind === "ordered"
          ? `${activeOffset()}px`
          : "0px",
    });
    const embed = makeLine(["cm-preview-code-block"], { position: 3 });
    Object.assign(opening, { nextElementSibling: embed });
    Object.assign(embed, { previousElementSibling: opening });
    embed.querySelector = ((selector: string) =>
      selector === ".ec-line .code" || selector === "code"
        ? {
            getBoundingClientRect: () => ({
              top: 126,
              height: noLineBox ? 24 : 16,
            }),
          }
        : null) as never;
    embed.ownerDocument.defaultView.getComputedStyle = (() => ({
      lineHeight: "16px",
      paddingTop: noLineBox ? "12px" : "14px",
      paddingBottom: noLineBox ? "12px" : "0px",
    })) as never;
    embed.getBoundingClientRect = () =>
      ({
        left: 100,
        right: 300,
        top: 126,
        height: compact ? 21 : noLineBox ? 24 : 45,
      }) as never;
    Object.assign(embed.ownerDocument, {
      createTreeWalker: () => ({
        nextNode: () =>
          kind.startsWith("empty") || kind.endsWith("body") ? null : {},
      }),
      createRange: () => ({
        selectNodeContents: () => {},
        getClientRects: () => [{ top: 140, height: 16 }],
      }),
    });
    const measurements: Measurement[] = [];

    const view = {
      state,
      visibleRanges: [{ from: 0, to: state.doc.length }],
      contentDOM: { querySelectorAll: () => [opening, embed] },
      posAtDOM: (element: { position: number }) => element.position,
      dom: { ownerDocument: { defaultView: {} } },
      requestMeasure: (measurement: Measurement) =>
        measurements.push(measurement),
    };
    const originalNodeFilter = globalThis.NodeFilter;
    Object.defineProperty(globalThis, "NodeFilter", {
      value: { SHOW_TEXT: 4 },
      configurable: true,
    });
    try {
      const plugin = mountLayout(
        view as never,
        names(
          BEGIN,
          ...(kind === "no-body"
            ? []
            : [kind === "blank-body" ? null : CONTENT]),
          END,
        ),
      );

      const measure = () => runMeasurement(measurements[0]);
      measure();
      expect(
        opening.style.getPropertyValue("--bullet-code-opening-marker-offset"),
      ).toBe(expectedOffset);
      measure();
      expect(
        opening.style.getPropertyValue("--bullet-code-opening-marker-offset"),
      ).toBe(expectedOffset);
      opening.classList.remove("bullet-plugin-code-opening-aligned");
      drivers.get(plugin)!.render();
      measure();
      expect(
        opening.style.getPropertyValue("--bullet-code-opening-marker-offset"),
      ).toBe(expectedOffset);
      expect(
        opening.style.getPropertyValue("--bullet-code-indent-guide-height"),
      ).toBe(compact ? "47px" : noLineBox ? "50px" : "71px");
      if (compact)
        expect(marker.getBoundingClientRect().top + activeOffset() + 24).toBe(
          147,
        );
      plugin.destroy();
      expect(
        opening.style.getPropertyValue("--bullet-code-indent-guide-height"),
      ).toBe("");
      expect(embed.classList.contains("bullet-plugin-code-preview-embed")).toBe(
        false,
      );
    } finally {
      Object.defineProperty(globalThis, "NodeFilter", {
        value: originalNodeFilter,
        configurable: true,
      });
    }
  },
);

test("remeasures processor changes while ignoring decoration-only native class mutations", () => {
  const state = EditorState.create({ doc: "\t- ```js" });
  const line = Object.assign(
    makeLine(
      ["HyperMD-codeblock", "HyperMD-codeblock-begin", "HyperMD-list-line"],
      { position: 0, markerEnd: 164 },
    ),
    { nodeType: 1, closest: () => null },
  );

  const measurements: Measurement[] = [];
  const disconnect = jest.fn();
  let notify: (records: unknown[]) => void = () => {};
  const observe = jest.fn();
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { querySelectorAll: () => [line] },
    posAtDOM: () => 0,
    dom: {
      ownerDocument: {
        defaultView: {
          MutationObserver: class {
            constructor(callback: typeof notify) {
              notify = callback;
            }
            observe = observe;
            disconnect = disconnect;
          },
        },
      },
    },
    requestMeasure: (measurement: Measurement) =>
      measurements.push(measurement),
  };
  const plugin = mountLayout(view as never, names(BEGIN));

  runMeasurement(measurements[0]);
  notify([{ target: line, type: "attributes", oldValue: line.className }]);
  expect(measurements).toHaveLength(1);
  const oldValue = line.className;
  line.classList.remove("bullet-plugin-nested-code-block");
  notify([{ target: line, type: "attributes", oldValue }]);
  expect(measurements).toHaveLength(1);
  drivers.get(plugin)!.render();
  expect(line.style.getPropertyValue("--bullet-nested-code-block-inset")).toBe(
    "64px",
  );
  line.classList.add("HyperMD-codeblock-extra");
  notify([{ target: line, type: "attributes", oldValue }]);
  expect(measurements).toHaveLength(2);

  runMeasurement(measurements[1]);
  notify([{ target: { nodeType: 1, closest: () => ({}) }, type: "childList" }]);
  expect(measurements).toHaveLength(3);
  expect(observe).toHaveBeenCalledWith(
    view.contentDOM,
    expect.objectContaining({
      childList: true,
      subtree: true,
      attributeFilter: ["class"],
    }),
  );
  plugin.destroy();
  expect(disconnect).toHaveBeenCalledTimes(1);
  notify([{ target: view.contentDOM, type: "childList" }]);
  expect(measurements).toHaveLength(3);
});

test("derives an offscreen opening from the rendered continuation indentation", () => {
  const state = EditorState.create({ doc: "\t123. ```go\n\t     line" });
  const content = makeLine(["HyperMD-codeblock", "HyperMD-list-line"], {
    position: state.doc.line(2).from,
  });
  const measurements: Measurement[] = [];

  const view = {
    state,
    visibleRanges: [{ from: state.doc.line(2).from, to: state.doc.length }],
    contentDOM: { querySelectorAll: () => [content] },
    posAtDOM: (element: { position: number }) => element.position,
    coordsAtPos: (position: number) => {
      expect(position).toBe(state.doc.line(2).from + 6);
      return { left: 148.5, right: 148.5 };
    },
    dom: { ownerDocument: { defaultView: {} } },
    requestMeasure: (measurement: Measurement) =>
      measurements.push(measurement),
  };

  mountLayout(view as never, names(BEGIN, CONTENT));

  const measurement = measurements[0];
  runMeasurement(measurement);

  expect(
    content.style.getPropertyValue("--bullet-nested-code-block-inset"),
  ).toBe("calc(48.5px + var(--list-padding-inline-start))");
});

test("measures inline-start from the right edge in RTL", () => {
  const state = EditorState.create({ doc: "- ```" });
  const opening = makeLine(
    ["HyperMD-codeblock", "HyperMD-codeblock-begin", "HyperMD-list-line"],
    {
      position: 0,
      left: 100,
      right: 300,
      openingContentLeft: 160,
      openingContentRight: 170,
      direction: "rtl",
    },
  );
  const measurements: Measurement[] = [];

  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { querySelectorAll: () => [opening] },
    posAtDOM: () => 0,
    dom: { ownerDocument: { defaultView: {} } },
    requestMeasure: (measurement: Measurement) =>
      measurements.push(measurement),
  };

  mountLayout(view as never, names(BEGIN));

  const measurement = measurements[0];
  runMeasurement(measurement);

  expect(
    opening.style.getPropertyValue("--bullet-nested-code-block-inset"),
  ).toBe("130px");
});

test("falls back to the document position when the opening marker DOM is transient", () => {
  const state = EditorState.create({ doc: "- ```" });
  const opening = makeLine(
    ["HyperMD-codeblock", "HyperMD-codeblock-begin", "HyperMD-list-line"],
    { position: 0 },
  );
  const measurements: Measurement[] = [];

  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { querySelectorAll: () => [opening] },
    posAtDOM: () => 0,
    coordsAtPos: (position: number) => {
      expect(position).toBe(2);
      return { left: 140, right: 140 };
    },
    dom: { ownerDocument: { defaultView: {} } },
    requestMeasure: (measurement: Measurement) =>
      measurements.push(measurement),
  };

  mountLayout(view as never, names(BEGIN));

  const measurement = measurements[0];
  runMeasurement(measurement);

  expect(
    opening.style.getPropertyValue("--bullet-nested-code-block-inset"),
  ).toBe("40px");
});

test("does not reapply a queued measurement after destruction", () => {
  const state = EditorState.create({ doc: "- ```" });
  const opening = makeLine(
    ["HyperMD-codeblock", "HyperMD-codeblock-begin", "HyperMD-list-line"],
    { position: 0, openingContentLeft: 160 },
  );
  const measurements: Measurement[] = [];

  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { querySelectorAll: () => [opening] },
    posAtDOM: () => 0,
    dom: { ownerDocument: { defaultView: {} } },
    requestMeasure: (measurement: Measurement) =>
      measurements.push(measurement),
  };

  const plugin = mountLayout(view as never, names(BEGIN));

  const measurement = measurements[0];
  const measured = measurement.read();
  plugin.destroy();
  measurement.write(measured);

  expect(opening.classList.contains("bullet-plugin-nested-code-block")).toBe(
    false,
  );
  expect(
    opening.style.getPropertyValue("--bullet-nested-code-block-inset"),
  ).toBe("");
});

test("maps a known long-block opening across ordinary content edits", () => {
  const state = EditorState.create({
    doc: ["- ```ts", ...Array.from({ length: 500 }, () => "  value")].join(
      "\n",
    ),
  });
  const lastLine = state.doc.line(state.doc.lines);
  const content = makeLine(["HyperMD-codeblock", "HyperMD-list-line"], {
    position: lastLine.from,
  });

  const lineNameAt = jest.fn((lineNumber: number) =>
    lineNumber === 1 ? BEGIN : CONTENT,
  );
  const view = {
    state,
    visibleRanges: [{ from: lastLine.from, to: lastLine.to }],
    contentDOM: { querySelectorAll: () => [content] },
    posAtDOM: (element: { position: number }) => element.position,
    coordsAtPos: () => ({ left: 130, right: 130 }),
    dom: { ownerDocument: { defaultView: {} } },
    requestMeasure: jest.fn(),
  };
  const plugin = mountLayout(view as never, lineNameAt);

  const emptyChanges = state.update({}).changes;
  for (let lineNumber = 10; lineNumber < 500; lineNumber += 10) {
    const viewportLine = state.doc.line(lineNumber);
    view.visibleRanges = [{ from: viewportLine.from, to: viewportLine.to }];
    plugin.update({
      startState: state,
      transactions: [],
      state,
      view,
      changes: emptyChanges,
      docChanged: false,
      viewportChanged: true,
      geometryChanged: false,
    } as never);
  }
  view.visibleRanges = [{ from: lastLine.from, to: lastLine.to }];
  plugin.update({
    startState: state,
    transactions: [],
    state,
    view,
    changes: emptyChanges,
    docChanged: false,
    viewportChanged: true,
    geometryChanged: false,
  } as never);
  lineNameAt.mockClear();

  const transaction = state.update({
    changes: { from: lastLine.to, insert: "x" },
  });
  const nextLastLine = transaction.state.doc.line(transaction.state.doc.lines);
  view.state = transaction.state;
  view.visibleRanges = [{ from: nextLastLine.from, to: nextLastLine.to }];
  plugin.update({
    startState: state,
    transactions: [transaction],
    state: transaction.state,
    view,
    changes: transaction.changes,
    docChanged: true,
    viewportChanged: false,
    geometryChanged: false,
  } as never);

  expect(lineNameAt.mock.calls.length).toBeLessThan(20);
});

test("marks only parser-confirmed visible code content", () => {
  const state = EditorState.create({
    doc: [
      "```md",
      "- ``` decoy",
      "```",
      "- ```ts",
      "  if (ready) {",
      "    run();",
      "  }",
      "     ```",
      "normal",
      "- ~~~ts",
      "  next();",
      "   ~~~",
    ].join("\n"),
  });
  const lineNameAt = names(
    "HyperMD-codeblock-begin",
    "HyperMD-codeblock",
    "HyperMD-codeblock-end",
    BEGIN,
    CONTENT,
    CONTENT,
    CONTENT,
    END,
    "HyperMD",
    BEGIN,
    CONTENT,
    END,
  );
  const marked: string[] = [];

  nestedCodeBlockContentDecorations(
    state,
    [{ from: state.doc.line(4).from, to: state.doc.length }],
    lineNameAt,
  ).between(0, state.doc.length, (from, to) => {
    if (from !== to) marked.push(state.doc.sliceString(from, to));
  });

  expect(marked).toEqual(["`", "i", " ", "}", " ", "~", "n", " "]);
});

test("marks source glyphs without inserting widgets at owned boundaries", () => {
  const source = [
    "- ```js",
    "\tcode",
    "\t  ",
    "",
    " ",
    " underindented",
    "  ```",
    "",
    "  outside",
  ].join("\n");
  const state = EditorState.create({ doc: source });
  const decorations = nestedCodeBlockContentDecorations(
    state,
    undefined,
    names(
      BEGIN,
      CONTENT,
      null,
      null,
      "HyperMD-codeblock",
      CONTENT,
      END,
      null,
      CONTENT,
    ),
  );
  const widgets: Array<{ from: number; to: number; side: number }> = [];
  const marks: Array<{ from: number; to: number }> = [];
  decorations.between(0, state.doc.length, (from, to, decoration) => {
    const widget = widgetDecoration(decoration);
    if (widget) {
      widgets.push({ from, to, side: widget.side });
    } else {
      marks.push({ from, to });
    }
  });

  const boundaries = [
    state.doc.line(1).from + 2,
    state.doc.line(2).from + 1,
    state.doc.line(3).from + 1,
    state.doc.line(4).from,
    state.doc.line(5).to,
    state.doc.line(7).from + 2,
  ];
  expect(widgets).toEqual([]);
  expect(marks).toEqual(
    [boundaries[0], boundaries[1], boundaries[2], boundaries[5]].map(
      (from) => ({
        from,
        to: from + 1,
      }),
    ),
  );
  expect(state.doc.toString()).toBe(source);
});

test.each(["HyperMD-codeblock", null])(
  "retains a nested fence across an empty body row whose syntax name is %s",
  (blankName) => {
    const state = EditorState.create({
      doc: "- ```js\n  before\n\n  after\n  ```\n\n  unrelated",
    });
    const marked: string[] = [];
    nestedCodeBlockContentDecorations(
      state,
      [{ from: state.doc.line(3).from, to: state.doc.length }],
      names(BEGIN, CONTENT, blankName, CONTENT, END, null, CONTENT),
    ).between(0, state.doc.length, (from, to) => {
      if (from !== to) marked.push(state.doc.sliceString(from, to));
    });

    // The empty body row is transparent to ownership lookup; the closing
    // fence is not. A later list-like line must not inherit this block.
    expect(marked).toEqual(["a", "`"]);
  },
);

test("uses a visible continuation to inset preceding empty code rows when the opener is offscreen", () => {
  const state = EditorState.create({
    doc: "\t- ```js\n\t  before\n\n\t  after\n\t  ```",
  });
  const blank = makeLine(["HyperMD-codeblock"], {
    position: state.doc.line(3).from,
  });
  const content = makeLine(["HyperMD-codeblock", "HyperMD-list-line"], {
    position: state.doc.line(4).from,
  });
  const measurements: Measurement[] = [];
  const view = {
    state,
    visibleRanges: [{ from: state.doc.line(3).from, to: state.doc.line(4).to }],
    contentDOM: { querySelectorAll: () => [blank, content] },
    posAtDOM: (element: { position: number }) => element.position,
    coordsAtPos: () => ({ left: 148.5, right: 148.5 }),
    dom: { ownerDocument: { defaultView: {} } },
    requestMeasure: (measurement: Measurement) =>
      measurements.push(measurement),
  };
  const plugin = mountLayout(
    view as never,
    names(BEGIN, CONTENT, "HyperMD-codeblock", CONTENT, END),
  );

  runMeasurement(measurements[0]);

  for (const element of [blank, content]) {
    expect(element.classList.contains("bullet-plugin-nested-code-block")).toBe(
      true,
    );
    expect(
      element.style.getPropertyValue("--bullet-nested-code-block-inset"),
    ).toBe("calc(48.5px + var(--list-padding-inline-start))");
  }
  expect(blank.style.getPropertyValue("--bullet-code-content-padding")).toBe(
    "",
  );
  plugin.destroy();
  expect(blank.classList.contains("bullet-plugin-nested-code-block")).toBe(
    false,
  );
});

test.each(["-", "123."])(
  "measures an offscreen %s marker with native typography independently of code padding",
  (markerText) => {
    const state = EditorState.create({
      doc: `\t${markerText} \`\`\`js\n\t${" ".repeat(markerText.length + 1)}code`,
    });
    const content = makeLine(["HyperMD-codeblock", "HyperMD-list-line"], {
      position: state.doc.line(2).from,
    });
    let markerWidth = 23.4;
    const aggregatedPrefix = markerText === "123.";
    const prefixTextNode = {};
    const range = {
      setStart: jest.fn(),
      setEnd: jest.fn(),
      getClientRects: () => [{ left: 100, right: 172 }],
    };
    Object.assign(content.ownerDocument, { createRange: () => range });
    const nodes: Array<{ remove: jest.Mock }> = [];
    const doc = {
      defaultView: {
        ...makeAnimationWindow([]),
        getComputedStyle: () => ({ marginInlineEnd: "4.8px" }),
      },
      createTextNode: (text: string) => ({ textContent: text }),
      createRange: () => range,
    };
    const create = () => {
      const element = {
        ownerDocument: doc,
        className: "",
        textContent: "",
        children: [],
        style: { cssText: "" },
        setAttribute: jest.fn(),
        appendChild: jest.fn(),
        remove: jest.fn(),
        getBoundingClientRect: () => ({ width: markerWidth }),
      };
      nodes.push(element);
      return element;
    };
    Object.assign(doc, { win: { createDiv: create, createSpan: create } });

    Object.assign(doc.defaultView, {});
    const measurements: Measurement[] = [];
    const view = {
      state,
      visibleRanges: [{ from: state.doc.line(2).from, to: state.doc.length }],
      contentDOM: { querySelectorAll: () => [content] },
      dom: { ownerDocument: doc, appendChild: jest.fn() },
      posAtDOM: (element: { position: number }, offset = 0) =>
        element.position + (aggregatedPrefix ? offset * 2 : offset),
      domAtPos: () => ({ node: prefixTextNode, offset: 1 }),
      // CodeMirror may report a hidden replacement's boundary rectangle while
      // switching editing state. Native prefix DOM is the measurement source.
      coordsAtPos: () => {
        throw Error("Transient CodeMirror boundary geometry");
      },
      requestMeasure: (measurement: Measurement) =>
        measurements.push(measurement),
    };
    const indent = {
      position: state.doc.line(2).from,
      childNodes: [{}],
      getBoundingClientRect: () => ({ left: 100, right: 172 }),
      contains: (node: unknown) => node === prefixTextNode,
    };
    Object.assign(content, { querySelectorAll: () => [indent] });
    const plugin = mountLayout(view as never, names(BEGIN, CONTENT));

    const measure = () => runMeasurement(measurements[0]);
    measure();
    expect(
      content.style.getPropertyValue("--bullet-nested-code-block-inset"),
    ).toBe("100.2px");
    markerWidth = 25.4;
    measure();
    expect(
      content.style.getPropertyValue("--bullet-nested-code-block-inset"),
    ).toBe("102.2px");
    expect(view.dom.appendChild).toHaveBeenCalledTimes(1);
    expect(range.setEnd).toHaveBeenCalledTimes(aggregatedPrefix ? 2 : 0);
    plugin.destroy();
    expect(nodes[0].remove).toHaveBeenCalledTimes(1);
  },
);

test.each(["", "\t", " "])(
  "insets a viewport containing only physical empty rows with zoom indent %j",
  (zoomIndent) => {
    const state = EditorState.create({ doc: "\t\t- ```js\n\n\n\t\t  ```" });
    const blank = makeLine(["HyperMD-codeblock"], {
      position: state.doc.line(3).from,
    });
    Object.assign(blank, { querySelectorAll: () => [] });

    const measurements: Measurement[] = [];
    const created: Array<{
      className: string;
      textContent: string;
      style: ReturnType<typeof makeStyle>;
    }> = [];
    let indentWidth = zoomIndent ? 36 : 72;
    const doc = {
      defaultView: {
        getComputedStyle: (_element: unknown, pseudo?: string) =>
          pseudo
            ? {
                left: "0.1px",
                width: "7px",
                transform: "none",
                translate: "none",
              }
            : { marginInlineEnd: "4.8px", direction: "ltr" },
      },
      createTextNode: (text: string) => ({ textContent: text }),
    };
    const create = () => {
      const children: unknown[] = [];
      const element = {
        ownerDocument: doc,
        className: "",
        textContent: "",
        children,
        style: makeStyle(),
        setAttribute: jest.fn(),
        appendChild: jest.fn((child: unknown) => children.push(child)),
        remove: jest.fn(),
        getBoundingClientRect: () => ({
          left: element.className === "list-bullet" ? 8 : 0,
          width:
            element.className === "bullet-plugin-code-indent-measure"
              ? indentWidth
              : 23.4,
        }),
      };
      created.push(element);
      return element;
    };
    Object.assign(doc, { win: { createDiv: create, createSpan: create } });
    const view = {
      state,
      visibleRanges: [
        { from: state.doc.line(2).from, to: state.doc.line(3).to },
      ],
      contentDOM: { querySelectorAll: () => [blank] },
      dom: { ownerDocument: doc, appendChild: jest.fn() },
      posAtDOM: (element: { position: number }) => element.position,
      coordsAtPos: () => {
        throw Error("No rendered source indentation");
      },
      requestMeasure: (measurement: Measurement) =>
        measurements.push(measurement),
    };
    const plugin = mountLayout(
      view as never,
      names(BEGIN, null, null, END),
      () => (zoomIndent ? { indent: zoomIndent } : null),
    );

    const measure = () => runMeasurement(measurements[0]);
    measure();
    expect(
      blank.style.getPropertyValue("--bullet-nested-code-block-inset"),
    ).toBe(`${indentWidth + 28.2}px`);
    expect(blank.classList.contains("bullet-plugin-nested-code-block")).toBe(
      true,
    );
    expect(blank.classList.contains("bullet-plugin-code-owner-guide")).toBe(
      true,
    );
    expect(
      blank.style.getPropertyValue("--bullet-code-owner-guide-offset"),
    ).toBe(`calc(${indentWidth + 28.2}px - 16.6px)`);
    const expectedUnits =
      zoomIndent === " " ? ["\t", "\t"] : [zoomIndent ? "\t" : "\t\t"];
    // Both the raw closing fence and the detached list marker retain the
    // same visible native indentation units.
    expect(
      created
        .filter((e) => e.className === "bullet-plugin-code-indent-unit")
        .map((e) => e.textContent),
    ).toEqual([...expectedUnits, ...expectedUnits]);
    indentWidth += 4;
    measure();
    expect(
      blank.style.getPropertyValue("--bullet-nested-code-block-inset"),
    ).toBe(`${indentWidth + 28.2}px`);
    expect(
      blank.style.getPropertyValue("--bullet-code-owner-guide-offset"),
    ).toBe(`calc(${indentWidth + 28.2}px - 16.6px)`);
    plugin.destroy();
  },
);

test("preserves unchanged code width probes when one source character changes", () => {
  type ProbeNode = {
    className: string;
    textContent: string;
    children: ProbeNode[];
    parent: ProbeNode | null;
    appendChild: (child: ProbeNode) => void;
    remove: jest.Mock;
    setAttribute: jest.Mock;
  };
  const created: ProbeNode[] = [];
  const create = (): ProbeNode => {
    const element: ProbeNode = {
      className: "",
      textContent: "",
      children: [],
      parent: null,
      appendChild(child) {
        child.parent = element;
        element.children.push(child);
      },
      remove: jest.fn(() => {
        if (!element.parent) return;
        const siblings = element.parent.children;
        siblings.splice(siblings.indexOf(element), 1);
        element.parent = null;
      }),
      setAttribute: jest.fn(),
    };
    created.push(element);
    return element;
  };

  const doc = {
    defaultView: {},
    win: { createDiv: create, createSpan: create },
    createTextNode: (text: string) =>
      Object.assign(create(), { textContent: text }),
  };
  const state = EditorState.create({
    doc: ["\t- ```js", "\t  one", "\t  two", "\t  three", "\t  ```"].join("\n"),
  });
  const host = create();
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    dom: { ownerDocument: doc, appendChild: host.appendChild },
    requestMeasure: jest.fn(),
  };
  const plugin = mountLayout(
    view as never,
    names(BEGIN, CONTENT, CONTENT, CONTENT, END),
  );
  try {
    const container = host.children[0];
    const [codeProbe, fenceProbe] = container.children.filter(
      (element) => element.className === "bullet-plugin-code-width-measure",
    );
    const beforeRows = [...codeProbe.children];
    const beforeAllocations = created.length;
    const transaction = state.update({
      changes: { from: state.doc.line(3).to, insert: "x" },
    });
    view.state = transaction.state;
    view.visibleRanges = [{ from: 0, to: transaction.state.doc.length }];
    plugin.update({
      startState: transaction.startState,
      transactions: [transaction],
      state: transaction.state,
      docChanged: true,
      changes: transaction.changes,
      view,
    } as never);

    expect(container.children).toContain(codeProbe);
    expect(container.children).toContain(fenceProbe);
    expect(codeProbe.children).toHaveLength(3);
    expect(codeProbe.children).toContain(beforeRows[0]);
    expect(codeProbe.children).toContain(beforeRows[2]);
    expect(codeProbe.children).not.toContain(beforeRows[1]);
    expect(beforeRows[1].remove).toHaveBeenCalledTimes(1);
    const allocatedRows = created
      .slice(beforeAllocations)
      .filter(
        (element) => element.className === "bullet-plugin-code-width-row",
      );
    expect(allocatedRows).toHaveLength(1);
    expect(codeProbe.children).toContain(allocatedRows[0]);
    const newRowContents = allocatedRows[0].children;
    expect(newRowContents[newRowContents.length - 1]?.textContent).toBe("twox");
  } finally {
    plugin.destroy();
  }
});

test.each([
  ["\t\t\t- ```js", "\t\t\t  hello", 0],
  ["\t\t\t- ```js", "\t\t\t    hello", 0],
  ["- ```js", "\thello", 2],
  ["- ```js", "\t", 2],
  ["\t- ```js", " ", 0],
  ["- ```js", "", 0],
])(
  "pads the source container boundary relative to the background for %j / %j",
  (openingText, bodyText, residual) => {
    const state = EditorState.create({ doc: `${openingText}\n${bodyText}` });
    const opening = makeLine(BEGIN.split("_"), {
      position: 0,
      left: 76,
      markerEnd: 176.222,
    });
    const body = makeLine(CONTENT.split("_"), {
      position: state.doc.line(2).from,
      left: 76,
    });
    const query = body.querySelector;
    body.querySelector = ((selector: string) =>
      selector === ".bullet-plugin-nested-code-block-content"
        ? { getBoundingClientRect: () => ({ left: 164.406, right: 190 }) }
        : query(selector)) as never;

    const measurements: Measurement[] = [];
    const view = {
      state,
      visibleRanges: [{ from: 0, to: state.doc.length }],
      contentDOM: { querySelectorAll: () => [opening, body] },
      posAtDOM: (element: { position: number }) => element.position,
      coordsAtPos: () => {
        throw Error("Padded cursor coordinates must not move the background");
      },
      dom: { ownerDocument: { defaultView: {} } },
      requestMeasure: (measurement: Measurement) =>
        measurements.push(measurement),
    };
    const plugin = mountLayout(view as never, names(BEGIN, CONTENT));

    const measure = () => runMeasurement(measurements[0]);
    measure();
    const padding = body.style.getPropertyValue(
      "--bullet-code-content-padding",
    );
    expect(padding).toBe(
      `calc(100.22px - 88.41px + ${residual}ch + var(--size-4-4))`,
    );
    measure();
    expect(body.style.getPropertyValue("--bullet-code-content-padding")).toBe(
      padding,
    );
    expect(
      body.style.getPropertyValue("--bullet-nested-code-block-inset"),
    ).toBe("100.22px");
    plugin.destroy();
    expect(body.style.getPropertyValue("--bullet-code-content-padding")).toBe(
      "",
    );
  },
);

test("measures each source row against the same content edge, including both fences", () => {
  const state = EditorState.create({ doc: "\t- ```js\n\t  hello\n\t  ```" });
  const starts = [164, 150, 139];
  const rows = [BEGIN, CONTENT, END].map((name, index) => {
    const row = makeLine(name.split("_"), {
      position: state.doc.line(index + 1).from,
      markerEnd: 164,
    });
    const query = row.querySelector;
    row.querySelector = ((selector: string) =>
      selector === ".bullet-plugin-nested-code-block-content"
        ? {
            getBoundingClientRect: () => ({
              left: starts[index],
              right: starts[index] + 8,
            }),
          }
        : query(selector)) as never;
    return row;
  });
  const measurements: Measurement[] = [];
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { querySelectorAll: () => rows },
    posAtDOM: (element: { position: number }) => element.position,
    coordsAtPos: () => {
      throw Error("Use unpadded source bounds");
    },
    dom: { ownerDocument: { defaultView: {} } },
    requestMeasure: (measurement: Measurement) =>
      measurements.push(measurement),
  };
  const plugin = mountLayout(view as never, names(BEGIN, CONTENT, END));
  const marked: number[] = [];
  plugin.decorations.between(0, state.doc.length, (from, to) => {
    if (from !== to) marked.push(from);
  });
  expect(marked).toEqual([3, 12, 21]);
  runMeasurement(measurements[0]);
  expect(
    rows.map((row) =>
      row.style.getPropertyValue("--bullet-code-content-padding"),
    ),
  ).toEqual([
    "calc(64px - 64px + 0ch + var(--size-4-4))",
    "calc(64px - 50px + 0ch + var(--size-4-4))",
    "calc(64px - 39px + 0ch + var(--size-4-4))",
  ]);
  drivers.get(plugin)!.render();
  expect(rows[2].style.getPropertyValue("--bullet-code-content-padding")).toBe(
    "calc(64px - 39px + 0ch + var(--size-4-4))",
  );
  plugin.destroy();
});

test.each([
  ["base container", "\t  hello", true],
  ["literal code spaces", "\t    hello", false],
  ["partial container tab", "\t\thello", true],
  ["literal code tab", "\t\t\thello", false],
])(
  "aligns native body fold controls for %s",
  (_name, bodyText, beforePadding) => {
    const source = `\t- \`\`\`js\n${bodyText}\n\t  \`\`\``;
    const state = EditorState.create({ doc: source });
    const rows = [BEGIN, CONTENT, END].map((name, index) => {
      const row = makeLine(name.split("_"), {
        position: state.doc.line(index + 1).from,
        markerEnd: 164,
      });
      const query = row.querySelector;
      row.querySelector = ((selector: string) =>
        selector === ".cm-fold-indicator" ? {} : query(selector)) as never;
      return row;
    });
    const measurements: Measurement[] = [];
    const view = {
      state,
      visibleRanges: [{ from: 0, to: state.doc.length }],
      contentDOM: { querySelectorAll: () => rows },
      posAtDOM: (element: { position: number }) => element.position,
      coordsAtPos: () => ({ left: 164, right: 164 }),
      dom: { ownerDocument: { defaultView: {} } },
      requestMeasure: (measurement: Measurement) =>
        measurements.push(measurement),
    };
    const plugin = mountLayout(view as never, names(BEGIN, CONTENT, END));
    runMeasurement(measurements[0]);
    expect(
      rows[1].style.getPropertyValue("--bullet-code-body-fold-offset"),
    ).toBe(
      beforePadding
        ? "calc(var(--bullet-code-content-padding, 0px) - var(--size-4-4) / 2)"
        : "calc(0px - var(--size-4-4) / 2)",
    );
    expect(
      rows.map((row) => row.classList.contains("bullet-plugin-code-body-fold")),
    ).toEqual([false, true, false]);
    expect(view.state.doc.toString()).toBe(source);
    expect(rows.map((row) => row.getBoundingClientRect().left)).toEqual([
      100, 100, 100,
    ]);
    plugin.destroy();
    expect(
      rows[1].style.getPropertyValue("--bullet-code-body-fold-offset"),
    ).toBe("");
  },
);

test("keeps body fold controls aligned in native preview", () => {
  const fixture = makePreviewFixture(false, true);
  const body = fixture.lines[1];
  const query = body.querySelector;
  body.querySelector = ((selector: string) =>
    selector === ".cm-fold-indicator" ? {} : query(selector)) as never;
  drivers.get(fixture.plugin)!.dispatch({
    selection: { anchor: fixture.view.state.doc.length },
  });
  fixture.measure();
  expect(body.classList.contains("bullet-plugin-code-preview-body")).toBe(true);
  expect(body.classList.contains("bullet-plugin-code-body-fold")).toBe(true);
  expect(body.style.getPropertyValue("--bullet-code-body-fold-offset")).toBe(
    "calc(var(--bullet-code-content-padding, 0px) - var(--size-4-4) / 2)",
  );
  expect(
    fixture.lines[0].classList.contains("bullet-plugin-code-body-fold"),
  ).toBe(false);
  fixture.plugin.destroy();
});

test.each([
  ["a tab that crosses the content boundary", "\t\t\tllo", "\t"],
  ["equivalent spaces", "\t\t  llo", "  "],
  ["literal code indentation after the boundary", "\t\t\t\tllo", "\t"],
])("marks the owning-list continuation for %s", (_name, bodyText, owned) => {
  const source = `\t\t- \`\`\`\n${bodyText}\n\t\t  \`\`\``;
  const state = EditorState.create({ doc: source });
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { querySelectorAll: () => [] },
    dom: { ownerDocument: { defaultView: {} } },
    requestMeasure: jest.fn(),
  };
  const plugin = new NestedCodeBlockLayoutPluginValue(
    view as never,
    names(BEGIN, CONTENT, END),
  );
  const roles: Array<{ from: number; to: number; source: string }> = [];
  plugin.prefixRoleDecorations.between(
    0,
    state.doc.length,
    (from, to, decoration) => {
      if (decorationClass(decoration) === "bullet-plugin-code-owner-prefix")
        roles.push({ from, to, source: state.doc.sliceString(from, to) });
      expect(widgetDecoration(decoration)).toBeNull();
    },
  );

  expect(roles[0]).toEqual({
    from: state.doc.line(2).from + 2,
    to: state.doc.line(2).from + 2 + owned.length,
    source: owned,
  });
  expect(roles.map(({ source: value }) => value)).toEqual([owned, "  "]);
  expect(state.doc.toString()).toBe(source);
  plugin.destroy();
});

test.each([
  [
    "root continuation",
    "- parent\n  ```js\n  code\n  ```\n  note",
    ["  ", "  ", "  "],
  ],
  [
    "nested continuation",
    "- root\n\t- parent\n\t  ```js\n\t  code\n\t  ```\n\t  note",
    ["  ", "  ", "  "],
  ],
  ["attached fence", "- ```js\n  code\n  ```\n- note", []],
  ["unowned fence", "```js\ncode\n```\nnote", []],
])(
  "isolates only the owning guide in a previewed %s",
  (_label, source, expected) => {
    const state = EditorState.create({
      doc: source,
      selection: { anchor: source.length },
    });
    const plugin = new NestedCodeBlockLayoutPluginValue(
      {
        state,
        visibleRanges: [{ from: 0, to: state.doc.length }],
        contentDOM: { querySelectorAll: () => [] },
        dom: { ownerDocument: { defaultView: {} } },
        requestMeasure: jest.fn(),
      } as never,
      () => null,
    );
    const prefixes: string[] = [];
    plugin.prefixRoleDecorations.between(
      0,
      state.doc.length,
      (from, to, decoration) => {
        if (
          decorationClass(decoration) ===
          "bullet-plugin-code-continuation-preview-prefix"
        )
          prefixes.push(state.doc.sliceString(from, to));
        expect(widgetDecoration(decoration)).toBeNull();
      },
    );
    expect(prefixes).toEqual(expected);
    expect(state.doc.toString()).toBe(source);
    plugin.destroy();
  },
);

test.each([2, 3, 4])(
  "preserves continuation editing guides with the cursor on row %s",
  (row) => {
    const source = "- parent\n  ```js\n  code\n  ```\n  note";
    const doc = EditorState.create({ doc: source }).doc;
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.line(row).to },
    });
    const plugin = new NestedCodeBlockLayoutPluginValue(
      {
        state,
        visibleRanges: [{ from: 0, to: state.doc.length }],
        contentDOM: { querySelectorAll: () => [] },
        dom: { ownerDocument: { defaultView: {} } },
        requestMeasure: jest.fn(),
      } as never,
      () => null,
    );
    const roles: Array<string | null> = [];
    plugin.prefixRoleDecorations.between(
      0,
      state.doc.length,
      (_from, _to, decoration) => {
        roles.push(decorationClass(decoration));
      },
    );
    expect(roles).toEqual([]);
    plugin.destroy();
  },
);

test("does not synthesize an owning-prefix role for a physical blank row", () => {
  const state = EditorState.create({ doc: "\t\t- ```\n\n\t\t  ```" });
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { querySelectorAll: () => [] },
    dom: { ownerDocument: { defaultView: {} } },
    requestMeasure: jest.fn(),
  };
  const plugin = new NestedCodeBlockLayoutPluginValue(
    view as never,
    names(BEGIN, null, END),
  );
  const ranges: Array<{ from: number; to: number }> = [];
  plugin.prefixRoleDecorations.between(0, state.doc.length, (from, to) => {
    ranges.push({ from, to });
  });

  expect(ranges).toEqual([
    {
      from: state.doc.line(3).from + 2,
      to: state.doc.line(3).from + 4,
    },
  ]);
  plugin.destroy();
});

function makeWidthFixture(
  openingText: string,
  firstText: string,
  indentedText: string,
  hidden = "",
  options: {
    closing?: string;
    editing?: boolean;
    flairBottom?: number;
    firstHeight?: number;
  } = {},
) {
  type Probe = {
    className: string;
    textContent: string;
    children: Probe[];
    firstChild: Probe | null;
    ownerDocument: unknown;
    appendChild: (child: Probe) => void;
    remove: () => void;
    setAttribute: () => void;
    getBoundingClientRect: () => {
      left: number;
      right: number;
      width: number;
    };
  };

  const doc = {
    defaultView: {
      getComputedStyle: () => ({ marginInlineEnd: "0px" }),
    },
    createRange: () => {
      let span: Probe;
      let offset = 0;
      return {
        selectNodeContents: (node: Probe) => {
          span = node;
        },
        setEnd: (_node: unknown, n: number) => {
          offset = n;
        },
        getClientRects: () => [
          { right: span.getBoundingClientRect().left + offset * 8 },
        ],
      };
    },
  };
  const create = (): Probe => {
    let text = "";
    let parent: Probe | undefined;
    const width = (node: Probe): number => node.getBoundingClientRect().width;
    const node: Probe = {
      className: "",
      ownerDocument: doc,
      get textContent() {
        return text || node.children.map((child) => child.textContent).join("");
      },
      set textContent(value) {
        text = value;
      },
      children: [],
      get firstChild() {
        return node.children[0] ?? (text ? node : null);
      },
      appendChild(child) {
        (child as Probe & { attach?: (to: Probe) => void }).attach?.(node);
        node.children.push(child);
      },
      remove() {
        if (parent) parent.children.splice(parent.children.indexOf(node), 1);
      },
      setAttribute() {},
      getBoundingClientRect() {
        const childrenWidth = node.children
          .filter(
            (child) => child.className !== "bullet-plugin-code-width-residual",
          )
          .reduce((sum, child) => sum + width(child), 0);
        const textWidth = [...text].reduce(
          (sum, char) => sum + (char === "\t" ? 32 : 8),
          0,
        );
        const measuredWidth = Math.max(textWidth, childrenWidth);
        const left =
          parent?.className === "bullet-plugin-code-indent-measure"
            ? parent.children
                .slice(0, parent.children.indexOf(node))
                .reduce((sum, child) => sum + width(child), 0)
            : 0;
        return { left, right: left + measuredWidth, width: measuredWidth };
      },
    };
    Object.assign(node, {
      attach: (to: Probe) => {
        parent = to;
      },
    });
    return node;
  };
  Object.assign(doc, {
    win: { createDiv: create, createSpan: create },
    createTextNode: (text: string) =>
      Object.assign(create(), { textContent: text }),
  });
  const text = [
    openingText,
    firstText,
    indentedText,
    options.closing ?? /^[ \t]*/.exec(openingText)![0] + "  ```",
    "- outside",
  ].join("\n");
  const state = EditorState.create({
    doc: text,
    selection: { anchor: options.editing ? 0 : text.length },
  });
  const opening = makeLine(BEGIN.split("_"), { position: 0, markerEnd: 124 });
  const first = makeLine(CONTENT.split("_"), {
    position: state.doc.line(2).from,
  });
  const second = makeLine(CONTENT.split("_"), {
    position: state.doc.line(3).from,
  });
  if (options.flairBottom !== undefined) {
    const originalQuery = opening.querySelector;
    opening.querySelector = ((selector: string) => {
      if (selector === ".code-block-flair")
        return {
          getBoundingClientRect: () => ({
            top: 106,
            bottom: options.flairBottom!,
            width: 32,
          }),
        };
      // No processor text geometry is needed for this width-only fixture.
      if (selector === ".cm-hmd-codeblock") return {};
      return originalQuery(selector);
    }) as never;
    opening.ownerDocument.defaultView.getComputedStyle = (() => ({
      lineHeight: "21px",
      marginInlineEnd: "0px",
      direction: "ltr",
    })) as never;
    Object.assign(first.ownerDocument, {
      createTreeWalker: () => ({ nextNode: () => null }),
    });
    const openingRect = opening.getBoundingClientRect();
    opening.getBoundingClientRect = () => ({
      ...openingRect,
      top: 100,
      bottom: 124,
      height: 24,
    });
    const firstRect = first.getBoundingClientRect();
    const firstHeight = options.firstHeight ?? 21;
    first.getBoundingClientRect = () => ({
      ...firstRect,
      top: 124,
      bottom: 124 + firstHeight,
      height: firstHeight,
    });
    const secondRect = second.getBoundingClientRect();
    second.getBoundingClientRect = () => ({
      ...secondRect,
      top: 124 + firstHeight,
      bottom: 145 + firstHeight,
      height: 21,
    });
    Object.assign(opening, { nextElementSibling: first });
    Object.assign(first, { nextElementSibling: second });
  }
  const measurements: Measurement[] = [];
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { querySelectorAll: () => [opening, first, second] },
    posAtDOM: (element: { position: number }) => element.position,
    dom: { ownerDocument: doc, appendChild: jest.fn() },
    requestMeasure: (measurement: Measurement) =>
      measurements.push(measurement),
  };
  const plugin = mountLayout(
    view as never,
    names(BEGIN, CONTENT, CONTENT, END, null),
    () => (hidden ? { indent: hidden } : null),
  );

  const measure = () => {
    runMeasurement(measurements[0]);
    return first.style.getPropertyValue("--bullet-nested-code-block-end");
  };
  return {
    plugin,
    measure,
    view,
    opening,
    first,
    second,
    updateOpening: (next: string) => {
      const transaction = view.state.update({
        changes: { from: 0, to: view.state.doc.line(1).to, insert: next },
      });
      view.state = transaction.state;
      view.visibleRanges = [{ from: 0, to: view.state.doc.length }];
      first.position = view.state.doc.line(2).from;
      second.position = view.state.doc.line(3).from;
      plugin.update({
        startState: transaction.startState,
        transactions: [transaction],
        state: view.state,
        docChanged: true,
        changes: transaction.changes,
        view,
      } as never);
    },
  };
}

test("retains full-source width and updates offscreen cached rows when visible code grows", () => {
  const fixture = makeWidthFixture("- ```js", "  hi", "  abcdefghij");
  expect(fixture.measure()).toContain("calc(104px + 2 * var(--size-4-4))");
  Object.assign(fixture.view.contentDOM, {
    querySelectorAll: () => [fixture.opening, fixture.first],
  });
  expect(fixture.measure()).toContain("calc(104px + 2 * var(--size-4-4))");
  const from = fixture.view.state.doc.line(2).to;
  drivers
    .get(fixture.plugin)!
    .dispatch({ changes: { from, insert: "abcdefghijklmnop" } });
  const second = fixture.view.state.doc.line(3);
  expect(lineAttributes(fixture.plugin, second.from).style).toContain(
    "calc(104px + 2 * var(--size-4-4))",
  );
  expect(fixture.measure()).toContain("calc(168px + 2 * var(--size-4-4))");
  expect(lineAttributes(fixture.plugin, second.from).style).toContain(
    "calc(168px + 2 * var(--size-4-4))",
  );
  fixture.plugin.destroy();
});

test.each([
  ["- ```js", "  hello", "    nested", ""],
  ["- ```js", "  hello", "\tnested", ""],
  ["\t- ```js", "\t  hello", "\t    nested", "\t"],
])(
  "fits code-only widths while preserving literal indentation for %j",
  (openingText, firstText, indentedText, hidden) => {
    const fixture = makeWidthFixture(
      openingText,
      firstText,
      indentedText,
      hidden,
    );
    // Six code characters plus two literal spaces = 64px. The list container
    // is removed exactly once; leading and trailing code padding remain.
    expect(fixture.measure()).toContain("calc(88px + 2 * var(--size-4-4))");
    fixture.plugin.destroy();
  },
);

test.each([
  [135, 21],
  [170, 70],
])(
  "reserves copy-control width only beside actual overlapping rows (bottom %i, first height %i)",
  (flairBottom, firstHeight) => {
    const fixture = makeWidthFixture("- ```js", "  hi", "  abcdefgh", "", {
      flairBottom,
      firstHeight,
    });
    try {
      expect(fixture.measure()).toContain("calc(88px + 2 * var(--size-4-4))");
    } finally {
      fixture.plugin.destroy();
    }
  },
);

test.each([
  ["", "  ", "184"],
  ["\t", "\t  ", "184"],
  ["", "\t", "200"],
])(
  "fits a padded closing fence after removing its container prefix with hidden indent %j",
  (hidden, closingPrefix, expectedEnd) => {
    const fixture = makeWidthFixture(
      `${hidden}- \`\`\`js`,
      `${hidden}  hi`,
      `${hidden}  yo`,
      hidden,
      { closing: `${closingPrefix}${"`".repeat(20)}`, editing: true },
    );
    try {
      expect(fixture.measure()).toContain(
        `calc(${expectedEnd}px + 2 * var(--size-4-4))`,
      );
    } finally {
      fixture.plugin.destroy();
    }
  },
);

test.each(["    abcdef", "\tabcdef"])(
  "refreshes code width metadata when the source container changes for %j",
  (raw) => {
    const fixture = makeWidthFixture("- ```js", raw, raw, "", {
      closing: "    ```",
    });
    try {
      expect(fixture.measure()).toContain("calc(88px + 2 * var(--size-4-4))");
      fixture.updateOpening("-   ```js");
      expect(fixture.measure()).toContain("calc(72px + 2 * var(--size-4-4))");
      fixture.updateOpening("- ```js");
      expect(fixture.measure()).toContain("calc(88px + 2 * var(--size-4-4))");
    } finally {
      fixture.plugin.destroy();
    }
  },
);
