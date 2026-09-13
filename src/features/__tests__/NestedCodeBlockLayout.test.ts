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

function makePreviewFixture(empty = false) {
  const state = EditorState.create({
    doc: [
      "\t- ```js",
      ...(empty ? [] : ["\t  one", "\t  two"]),
      "\t  ```",
    ].join("\n"),
  });
  const lines = Array.from({ length: state.doc.lines }, (_, index) => {
    const classes = ["HyperMD-codeblock", "HyperMD-list-line"];
    if (index === 0) classes.push("HyperMD-codeblock-begin");
    if (index === state.doc.lines - 1) classes.push("HyperMD-codeblock-end");
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
      closest: () => line,
      setRaw: (value: boolean) => {
        rawFence = value;
      },
      previousElementSibling: null as unknown,
      nextElementSibling: null as unknown,
    });
  });
  const frames: FrameRequestCallback[] = [];
  const measurements: Measurement[] = [];
  let notify: (records: unknown[]) => void = () => {};
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
        defaultView: {
          ...makeAnimationWindow(frames),
          MutationObserver: class {
            constructor(callback: typeof notify) {
              notify = callback;
            }
            observe() {}
            disconnect() {}
          },
        },
      },
    },
    requestMeasure: (measurement: Measurement) =>
      measurements.push(measurement),
  };
  const plugin = new NestedCodeBlockLayoutPluginValue(
    view as never,
    names(BEGIN, ...(empty ? [] : [CONTENT, CONTENT]), END),
  );
  frames[0](0);
  const measure = () => measurements[0].write(measurements[0].read());
  return {
    lines,
    frames,
    measure,
    plugin,
    show,
    notify: (target: unknown, type = "childList") => notify([{ target, type }]),
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

  test("collapses hidden fences and rounds the first and last visible code rows", () => {
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

  test("keeps an empty native opener visible while hiding its closing fence", () => {
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
      closing.classList.contains("bullet-plugin-code-preview-hidden-fence"),
    ).toBe(true);
    fixture.plugin.destroy();
  });

  test("restores lost height roles before the next CodeMirror measurement without observing its own classes", () => {
    const fixture = makePreviewFixture();
    const [opening] = fixture.lines;
    fixture.measure();
    for (const name of [...opening.classList]) {
      if (name.startsWith("bullet-plugin-")) opening.classList.remove(name);
    }
    fixture.notify(opening, "attributes");
    expect(
      opening.classList.contains("bullet-plugin-code-preview-hidden-fence"),
    ).toBe(true);
    expect(
      opening.classList.contains("bullet-plugin-code-preview-opening"),
    ).toBe(true);
    const pending = fixture.frames.length;
    fixture.frames[pending - 1](0);
    fixture.measure();
    fixture.notify(opening, "attributes");
    expect(fixture.frames).toHaveLength(pending);
    fixture.plugin.destroy();
  });

  test("reveals source fences and removes adjacent preview edges as soon as their children change", () => {
    const fixture = makePreviewFixture();
    const [opening, first, last, closing] = fixture.lines;
    fixture.measure();
    opening.setRaw(true);
    closing.setRaw(true);
    fixture.notify(opening);
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

  test("restores embed height and guide roles after a partial class reset, then reveals a raw fence immediately", () => {
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
    fixture.notify(opening, "attributes");
    for (const name of openingRoles)
      expect(opening.classList.contains(name)).toBe(true);
    const pending = fixture.frames.length;
    fixture.frames[pending - 1](0);
    fixture.measure();
    fixture.notify(opening, "attributes");
    expect(fixture.frames).toHaveLength(pending);

    // Native children can switch to source before the processor widget leaves.
    opening.setRaw(true);
    fixture.notify(opening);
    for (const name of openingRoles)
      expect(opening.classList.contains(name)).toBe(false);
    fixture.show([opening]);
    fixture.measure();
    expect(embed.classList.contains("bullet-plugin-code-preview-embed")).toBe(
      false,
    );
    expect(opening.style.getPropertyValue("--bullet-code-preview-height")).toBe(
      "",
    );
    fixture.plugin.destroy();
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
  const frames: FrameRequestCallback[] = [];
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { querySelectorAll: () => [opening, embed, outsideEmbed] },
    posAtDOM: (element: { position: number }) => element.position,
    // Hidden source coordinates point to the full-width embed, not the marker.
    coordsAtPos: () => ({ left: 100, right: 100 }),
    dom: { ownerDocument: { defaultView: makeAnimationWindow(frames) } },
    requestMeasure: (measurement: Measurement) =>
      measurements.push(measurement),
  };
  const plugin = new NestedCodeBlockLayoutPluginValue(
    view as never,
    names(BEGIN, CONTENT, END, null, "HyperMD-codeblock"),
  );
  frames[0](0);
  measurements[0].write(measurements[0].read());
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

test.each(["unordered", "ordered", "empty", "empty-no-line-box"])(
  "keeps %s preview baseline stable after native class redraw",
  (kind) => {
    const state = EditorState.create({ doc: "\t- ```js\n\t  code\n\t  ```" });
    const opening = makeLine(
      ["HyperMD-codeblock", "HyperMD-codeblock-begin", "HyperMD-list-line"],
      { position: 0, markerEnd: 164 },
    );
    const activeOffset = () =>
      opening.classList.contains("bullet-plugin-code-preview-opening")
        ? Number.parseFloat(
            opening.style.getPropertyValue(
              "--bullet-code-preview-marker-offset",
            ),
          ) || 0
        : 0;
    const marker = {
      getBoundingClientRect: () => ({
        left: 164,
        right: 164,
        top: 100 + activeOffset(),
        height: 24,
      }),
    };
    opening.querySelector = ((selector: string) =>
      selector === ".cm-formatting-list" ||
      (selector === ".list-bullet" && kind !== "ordered")
        ? marker
        : null) as typeof opening.querySelector;
    opening.getBoundingClientRect = () =>
      ({ left: 100, right: 300, top: 100 }) as never;
    opening.ownerDocument.defaultView.getComputedStyle = () => ({
      direction: "ltr",
      marginInlineEnd: "0px",
      insetBlockStart: `${activeOffset()}px`,
    });
    const embed = makeLine(["cm-preview-code-block"], { position: 3 });
    Object.assign(opening, { nextElementSibling: embed });
    Object.assign(embed, { previousElementSibling: opening });
    embed.querySelector = (() => ({
      getBoundingClientRect: () => ({
        top: 126,
        height: kind === "empty-no-line-box" ? 24 : 16,
      }),
    })) as never;
    embed.ownerDocument.defaultView.getComputedStyle = (() => ({
      lineHeight: "16px",
      paddingTop: kind === "empty-no-line-box" ? "12px" : "14px",
      paddingBottom: kind === "empty-no-line-box" ? "12px" : "0px",
    })) as never;
    embed.getBoundingClientRect = () =>
      ({
        left: 100,
        right: 300,
        top: 126,
        height: kind === "empty-no-line-box" ? 24 : 45,
      }) as never;
    Object.assign(embed.ownerDocument, {
      createTreeWalker: () => ({
        nextNode: () => (kind.startsWith("empty") ? null : {}),
      }),
      createRange: () => ({
        selectNodeContents: () => {},
        getClientRects: () => [{ top: 140, height: 16 }],
      }),
    });
    const measurements: Measurement[] = [];
    const frames: FrameRequestCallback[] = [];
    const view = {
      state,
      visibleRanges: [{ from: 0, to: state.doc.length }],
      contentDOM: { querySelectorAll: () => [opening, embed] },
      posAtDOM: (element: { position: number }) => element.position,
      dom: { ownerDocument: { defaultView: makeAnimationWindow(frames) } },
      requestMeasure: (measurement: Measurement) =>
        measurements.push(measurement),
    };
    const originalNodeFilter = globalThis.NodeFilter;
    Object.defineProperty(globalThis, "NodeFilter", {
      value: { SHOW_TEXT: 4 },
      configurable: true,
    });
    try {
      const plugin = new NestedCodeBlockLayoutPluginValue(
        view as never,
        names(BEGIN, CONTENT, END),
      );
      frames[0](0);
      const measure = () => measurements[0].write(measurements[0].read());
      measure();
      expect(
        opening.style.getPropertyValue("--bullet-code-preview-marker-offset"),
      ).toBe(kind === "empty-no-line-box" ? "0px" : "10px");
      measure();
      expect(
        opening.style.getPropertyValue("--bullet-code-preview-marker-offset"),
      ).toBe(kind === "empty-no-line-box" ? "0px" : "10px");
      opening.classList.remove("bullet-plugin-code-preview-opening");
      measure();
      expect(
        opening.style.getPropertyValue("--bullet-code-preview-marker-offset"),
      ).toBe(kind === "empty-no-line-box" ? "0px" : "10px");
      plugin.destroy();
      expect(
        opening.style.getPropertyValue("--bullet-code-preview-height"),
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

test("remeasures async previews and native class resets without observing its own style writes", () => {
  const state = EditorState.create({ doc: "\t- ```js" });
  const line = Object.assign(
    makeLine(
      ["HyperMD-codeblock", "HyperMD-codeblock-begin", "HyperMD-list-line"],
      { position: 0, markerEnd: 164 },
    ),
    { nodeType: 1, closest: () => null },
  );
  const frames: FrameRequestCallback[] = [];
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
          ...makeAnimationWindow(frames),
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
  const plugin = new NestedCodeBlockLayoutPluginValue(
    view as never,
    names(BEGIN),
  );
  frames[0](0);
  measurements[0].write(measurements[0].read());
  notify([{ target: line, type: "attributes" }]);
  expect(frames).toHaveLength(1);
  line.classList.remove("bullet-plugin-nested-code-block");
  notify([{ target: line, type: "attributes" }]);
  expect(frames).toHaveLength(2);
  frames[1](0);
  measurements[1].write(measurements[1].read());
  notify([{ target: { nodeType: 1, closest: () => ({}) }, type: "childList" }]);
  expect(frames).toHaveLength(3);
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
  expect(frames).toHaveLength(3);
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
      marked.push(state.doc.sliceString(from, to));
    });

    // The empty body row is transparent to ownership lookup; the closing
    // fence is not. A later list-like line must not inherit this block.
    expect(marked).toEqual(["a"]);
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
  const frames: FrameRequestCallback[] = [];
  const measurements: Measurement[] = [];
  const view = {
    state,
    visibleRanges: [{ from: state.doc.line(3).from, to: state.doc.line(4).to }],
    contentDOM: { querySelectorAll: () => [blank, content] },
    posAtDOM: (element: { position: number }) => element.position,
    coordsAtPos: () => ({ left: 148.5, right: 148.5 }),
    dom: { ownerDocument: { defaultView: makeAnimationWindow(frames) } },
    requestMeasure: (measurement: Measurement) =>
      measurements.push(measurement),
  };
  const plugin = new NestedCodeBlockLayoutPluginValue(
    view as never,
    names(BEGIN, CONTENT, "HyperMD-codeblock", CONTENT, END),
  );
  frames[0](0);
  measurements[0].write(measurements[0].read());

  for (const element of [blank, content]) {
    expect(element.classList.contains("bullet-plugin-nested-code-block")).toBe(
      true,
    );
    expect(
      element.style.getPropertyValue("--bullet-nested-code-block-inset"),
    ).toBe("calc(48.5px + var(--list-padding-inline-start))");
  }
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
    const frames: FrameRequestCallback[] = [];
    Object.assign(doc.defaultView, makeAnimationWindow(frames));
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
    const plugin = new NestedCodeBlockLayoutPluginValue(
      view as never,
      names(BEGIN, CONTENT),
    );
    frames[0](0);
    const measure = () => measurements[0].write(measurements[0].read());
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
    const frames: FrameRequestCallback[] = [];
    const measurements: Measurement[] = [];
    const created: Array<{
      className: string;
      textContent: string;
      style: ReturnType<typeof makeStyle>;
    }> = [];
    let indentWidth = zoomIndent ? 36 : 72;
    const doc = {
      defaultView: {
        ...makeAnimationWindow(frames),
        getComputedStyle: () => ({ marginInlineEnd: "4.8px" }),
      },
      createTextNode: (text: string) => ({ textContent: text }),
    };
    const create = () => {
      const element = {
        ownerDocument: doc,
        className: "",
        textContent: "",
        style: makeStyle(),
        setAttribute: jest.fn(),
        appendChild: jest.fn(),
        remove: jest.fn(),
        getBoundingClientRect: () => ({
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
    const plugin = new NestedCodeBlockLayoutPluginValue(
      view as never,
      names(BEGIN, null, null, END),
      () => (zoomIndent ? { indent: zoomIndent } : null),
    );
    frames[0](0);
    const measure = () => measurements[0].write(measurements[0].read());
    measure();
    expect(
      blank.style.getPropertyValue("--bullet-nested-code-block-inset"),
    ).toBe(`${indentWidth + 28.2}px`);
    expect(blank.classList.contains("bullet-plugin-nested-code-block")).toBe(
      true,
    );
    expect(
      created
        .filter((e) => e.className === "bullet-plugin-code-indent-unit")
        .map((e) => e.textContent),
    ).toEqual(zoomIndent === " " ? ["\t", "\t"] : [zoomIndent ? "\t" : "\t\t"]);
    indentWidth += 4;
    measure();
    expect(
      blank.style.getPropertyValue("--bullet-nested-code-block-inset"),
    ).toBe(`${indentWidth + 28.2}px`);
    plugin.destroy();
  },
);
