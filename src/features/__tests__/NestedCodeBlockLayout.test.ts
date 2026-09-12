import { EditorState } from "@codemirror/state";

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

function makeStyle() {
  const values = new Map<string, string>();
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
  const marker = markerNext ? { nextElementSibling: markerNext } : null;
  return {
    position: options.position,
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => ({ direction: options.direction ?? "ltr" }),
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
  const frames: FrameRequestCallback[] = [];
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: {
      querySelectorAll: () => [opening, content, closing, documentCode],
    },
    posAtDOM: (element: { position: number }) => element.position,
    coordsAtPos: () => ({ left: 130, right: 130 }),
    dom: { ownerDocument: { defaultView: makeAnimationWindow(frames) } },
    requestMeasure: (measurement: Measurement) =>
      measurements.push(measurement),
  };

  const plugin = new NestedCodeBlockLayoutPluginValue(
    view as never,
    names(BEGIN, CONTENT, END, "HyperMD-codeblock"),
  );
  frames[0](0);
  const measurement = measurements[0];
  measurement.write(measurement.read());

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

test("derives an offscreen opening from the rendered continuation indentation", () => {
  const state = EditorState.create({ doc: "\t123. ```go\n\t     line" });
  const content = makeLine(["HyperMD-codeblock", "HyperMD-list-line"], {
    position: state.doc.line(2).from,
  });
  const measurements: Measurement[] = [];
  const frames: FrameRequestCallback[] = [];
  const view = {
    state,
    visibleRanges: [{ from: state.doc.line(2).from, to: state.doc.length }],
    contentDOM: { querySelectorAll: () => [content] },
    posAtDOM: (element: { position: number }) => element.position,
    coordsAtPos: (position: number) => {
      expect(position).toBe(state.doc.line(2).from + 6);
      return { left: 148.5, right: 148.5 };
    },
    dom: { ownerDocument: { defaultView: makeAnimationWindow(frames) } },
    requestMeasure: (measurement: Measurement) =>
      measurements.push(measurement),
  };

  new NestedCodeBlockLayoutPluginValue(view as never, names(BEGIN, CONTENT));
  frames[0](0);
  const measurement = measurements[0];
  measurement.write(measurement.read());

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
  const frames: FrameRequestCallback[] = [];
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { querySelectorAll: () => [opening] },
    posAtDOM: () => 0,
    dom: { ownerDocument: { defaultView: makeAnimationWindow(frames) } },
    requestMeasure: (measurement: Measurement) =>
      measurements.push(measurement),
  };

  new NestedCodeBlockLayoutPluginValue(view as never, names(BEGIN));
  frames[0](0);
  const measurement = measurements[0];
  measurement.write(measurement.read());

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
  const frames: FrameRequestCallback[] = [];
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { querySelectorAll: () => [opening] },
    posAtDOM: () => 0,
    coordsAtPos: (position: number) => {
      expect(position).toBe(2);
      return { left: 140, right: 140 };
    },
    dom: { ownerDocument: { defaultView: makeAnimationWindow(frames) } },
    requestMeasure: (measurement: Measurement) =>
      measurements.push(measurement),
  };

  new NestedCodeBlockLayoutPluginValue(view as never, names(BEGIN));
  frames[0](0);
  const measurement = measurements[0];
  measurement.write(measurement.read());

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
  const frames: FrameRequestCallback[] = [];
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { querySelectorAll: () => [opening] },
    posAtDOM: () => 0,
    dom: { ownerDocument: { defaultView: makeAnimationWindow(frames) } },
    requestMeasure: (measurement: Measurement) =>
      measurements.push(measurement),
  };

  const plugin = new NestedCodeBlockLayoutPluginValue(
    view as never,
    names(BEGIN),
  );
  frames[0](0);
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
  const frames: FrameRequestCallback[] = [];
  const lineNameAt = jest.fn((lineNumber: number) =>
    lineNumber === 1 ? BEGIN : CONTENT,
  );
  const view = {
    state,
    visibleRanges: [{ from: lastLine.from, to: lastLine.to }],
    contentDOM: { querySelectorAll: () => [content] },
    posAtDOM: (element: { position: number }) => element.position,
    coordsAtPos: () => ({ left: 130, right: 130 }),
    dom: { ownerDocument: { defaultView: makeAnimationWindow(frames) } },
    requestMeasure: jest.fn(),
  };
  const plugin = new NestedCodeBlockLayoutPluginValue(
    view as never,
    lineNameAt,
  );
  frames[0](0);

  const emptyChanges = state.update({}).changes;
  for (let lineNumber = 10; lineNumber < 500; lineNumber += 10) {
    const viewportLine = state.doc.line(lineNumber);
    view.visibleRanges = [{ from: viewportLine.from, to: viewportLine.to }];
    plugin.update({
      startState: state,
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
    marked.push(state.doc.sliceString(from, to));
  });

  expect(marked).toEqual(["i", " ", "}", "n"]);
});
