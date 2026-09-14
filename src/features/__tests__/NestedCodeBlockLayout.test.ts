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
    body,
    observe,
    disconnect,
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
      closing.classList.contains("bullet-plugin-code-preview-hidden-fence"),
    ).toBe(true);
    fixture.plugin.destroy();
  });

  test("restores lost preview roles before the next CodeMirror measurement without observing its own classes", () => {
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

  test("restores embed and guide roles after a partial class reset, then reveals a raw fence immediately", () => {
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

  test("restores plain roles after redraw, then removes their paint when the source fence returns", () => {
    const fixture = setup();
    try {
      fixture.opening.classList.remove(plainClass);
      fixture.embed.classList.remove(plainClass);
      fixture.notify(fixture.opening, "attributes");
      expect(fixture.opening.classList.contains(plainClass)).toBe(true);
      expect(fixture.embed.classList.contains(plainClass)).toBe(true);
      const pending = fixture.frames.length;
      fixture.frames[pending - 1](0);
      fixture.measure();
      fixture.notify(fixture.opening, "attributes");
      expect(fixture.frames).toHaveLength(pending);

      fixture.opening.setRaw(true);
      fixture.notify(fixture.opening);
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
      const pending = fixture.frames.length;
      fixture.appearance.background = "rgb(242, 236, 188)";
      fixture.notify(fixture.body, "attributes");
      expect(fixture.frames).toHaveLength(pending + 1);
      expect(
        fixture.opening.style.getPropertyValue(
          "--bullet-code-preview-background",
        ),
      ).toBe("rgb(31, 31, 40)");
      fixture.frames[pending](0);
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
    const stopped = fixture.frames.length;
    fixture.notify(fixture.body, "attributes");
    expect(fixture.frames).toHaveLength(stopped);
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

test.each([
  "unordered",
  "ordered",
  "empty",
  "empty-no-line-box",
  "empty-compact-no-line-box",
])(
  "aligns %s preview below a native-height fence after class redraw",
  (kind) => {
    const noLineBox = kind.endsWith("no-line-box");
    const compact = kind === "empty-compact-no-line-box";
    const expectedOffset = compact ? "23px" : noLineBox ? "26px" : "36px";
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
      ).toBe(expectedOffset);
      measure();
      expect(
        opening.style.getPropertyValue("--bullet-code-preview-marker-offset"),
      ).toBe(expectedOffset);
      opening.classList.remove("bullet-plugin-code-preview-opening");
      measure();
      expect(
        opening.style.getPropertyValue("--bullet-code-preview-marker-offset"),
      ).toBe(expectedOffset);
      expect(
        opening.style.getPropertyValue("--bullet-code-preview-height"),
      ).toBe(compact ? "47px" : noLineBox ? "50px" : "71px");
      if (compact) expect(marker.getBoundingClientRect().top + 24).toBe(147);
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
  const frames: FrameRequestCallback[] = [];
  const doc = {
    defaultView: makeAnimationWindow(frames),
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
  };
  const plugin = new NestedCodeBlockLayoutPluginValue(
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
    const frames: FrameRequestCallback[] = [];
    const measurements: Measurement[] = [];
    const view = {
      state,
      visibleRanges: [{ from: 0, to: state.doc.length }],
      contentDOM: { querySelectorAll: () => [opening, body] },
      posAtDOM: (element: { position: number }) => element.position,
      coordsAtPos: () => {
        throw Error("Padded cursor coordinates must not move the background");
      },
      dom: { ownerDocument: { defaultView: makeAnimationWindow(frames) } },
      requestMeasure: (measurement: Measurement) =>
        measurements.push(measurement),
    };
    const plugin = new NestedCodeBlockLayoutPluginValue(
      view as never,
      names(BEGIN, CONTENT),
    );
    frames[0](0);
    const measure = () => measurements[0].write(measurements[0].read());
    measure();
    const padding = body.style.getPropertyValue(
      "--bullet-code-content-padding",
    );
    expect(padding).toBe(
      `calc(100.22200000000001px - 88.406px + ${residual}ch + var(--size-4-4))`,
    );
    measure();
    expect(body.style.getPropertyValue("--bullet-code-content-padding")).toBe(
      padding,
    );
    expect(
      body.style.getPropertyValue("--bullet-nested-code-block-inset"),
    ).toBe("100.22200000000001px");
    plugin.destroy();
    expect(body.style.getPropertyValue("--bullet-code-content-padding")).toBe(
      "",
    );
  },
);

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
  const frames: FrameRequestCallback[] = [];
  const doc = {
    defaultView: {
      ...makeAnimationWindow(frames),
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
  const plugin = new NestedCodeBlockLayoutPluginValue(
    view as never,
    names(BEGIN, CONTENT, CONTENT, END, null),
    () => (hidden ? { indent: hidden } : null),
  );
  frames[0](0);
  const measure = () => {
    measurements[0].write(measurements[0].read());
    return first.style.getPropertyValue("--bullet-nested-code-block-end");
  };
  return {
    plugin,
    measure,
    updateOpening: (next: string) => {
      const transaction = view.state.update({
        changes: { from: 0, to: view.state.doc.line(1).to, insert: next },
      });
      view.state = transaction.state;
      view.visibleRanges = [{ from: 0, to: view.state.doc.length }];
      first.position = view.state.doc.line(2).from;
      second.position = view.state.doc.line(3).from;
      plugin.update({
        state: view.state,
        docChanged: true,
        changes: transaction.changes,
        view,
      } as never);
    },
  };
}

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

test.each(["", "\t"])(
  "fits a long unpadded closing fence from its raw continuation prefix with hidden indent %j",
  (hidden) => {
    const fixture = makeWidthFixture(
      `${hidden}- \`\`\`js`,
      `${hidden}  hi`,
      `${hidden}  yo`,
      hidden,
      { closing: `${hidden}  ${"`".repeat(20)}`, editing: true },
    );
    try {
      // 16px raw continuation + 160px fence, without the list marker's 24px inset.
      expect(fixture.measure()).toContain("calc(176px + var(--size-4-4))");
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
