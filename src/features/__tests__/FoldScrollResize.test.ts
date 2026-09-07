import {
  EditorState,
  StateEffect,
  Transaction,
  TransactionSpec,
} from "@codemirror/state";
import { EditorView, ViewUpdate } from "@codemirror/view";

import { getEventListeners } from "node:events";

import {
  FoldScrollResizePluginValue,
  foldScrollResize,
} from "../FoldScrollResize";

type ScrollTarget = ReturnType<EditorView["scrollSnapshot"]>["value"];
type MeasureRequest = NonNullable<Parameters<EditorView["requestMeasure"]>[0]>;
const nativeView = EditorView.prototype as unknown as {
  measure(flush?: boolean): void;
  readMeasured(): void;
};

function makeWindow() {
  const window = Object.assign(new EventTarget(), {
    devicePixelRatio: 2,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => undefined,
    queueMicrotask,
  });
  const removeEventListener = window.removeEventListener.bind(window);
  // Node 22 only honors capture removal through the object form; browsers
  // also honor the equivalent boolean accepted by Window.
  window.removeEventListener = (type, listener, options) =>
    removeEventListener(
      type,
      listener,
      typeof options === "boolean" ? { capture: options } : options,
    );
  return window;
}

function setup(
  window = makeWindow(),
  doc = "- a\n- b\n- c\n- d\n- e\n- f\n- g\n- h\n- i\n- j",
) {
  const transactions: Transaction[] = [];
  const appliedTargets: ScrollTarget[] = [];
  const layout = { lineHeight: 48 };
  const blockAtHeight = (height: number) => {
    const index = Math.min(
      view.state.doc.lines - 1,
      Math.max(0, Math.floor(height / layout.lineHeight)),
    );
    return {
      from: view.state.doc.line(index + 1).from,
      top: index * layout.lineHeight,
    };
  };
  const view = {
    state: EditorState.create({
      doc,
      extensions: foldScrollResize(),
    }),
    dom: { ownerDocument: { defaultView: window } },
    win: window,
    scaleY: 1,
    scrollDOM: {
      clientWidth: 900,
      clientHeight: 600,
      scrollHeight: 100000,
      scrollTop: 336,
      scrollLeft: 0,
      getBoundingClientRect: () => ({ top: 0 }),
    },
    // Properties occupy 192px before the document in the shared scroller.
    get documentTop() {
      return 192 - view.scrollDOM.scrollTop;
    },
    lineBlockAtHeight: (height: number) =>
      EditorView.prototype.lineBlockAtHeight.call(view as never, height),
    viewState: {
      scrollTarget: null as ScrollTarget | null,
      scrollTop: 336,
      scrollAnchorPos: 0,
      scrollAnchorHeight: -1,
      editorHeight: 600,
      heightMap: {
        get height() {
          return view.state.doc.lines * layout.lineHeight;
        },
      },
      lineBlockAtHeight: blockAtHeight,
      lineBlockAt: (position: number) => {
        const line = view.state.doc.lineAt(position);
        return { from: line.from, top: (line.number - 1) * layout.lineHeight };
      },
      scrollAnchorAt: (scrollTop: number) => blockAtHeight(scrollTop + 8),
      measure: () => {
        view.viewState.scrollTop = view.scrollDOM.scrollTop;
        return 0;
      },
      update: (update: ViewUpdate, target: ScrollTarget | null) => {
        // Map the old height-map anchor before adopting the edited document.
        // Native measure then applies its height delta after custom callbacks.
        const anchor = view.viewState.scrollAnchorAt(view.viewState.scrollTop);
        view.viewState.scrollAnchorPos = update.changes.mapPos(anchor.from, -1);
        view.viewState.scrollAnchorHeight = anchor.top;
        view.state = update.state;
        view.viewState.scrollTarget = target;
      },
    },
    // Keep the native effect and its mapping; substitute browser geometry only.
    scrollSnapshot: () =>
      EditorView.prototype.scrollSnapshot.call(view as never),
    measureScheduled: -1,
    measureRequests: [] as MeasureRequest[],
    measure: (flush = true) => nativeView.measure.call(view as never, flush),
    readMeasured: () => nativeView.readMeasured.call(view as never),
    requestMeasure: (request?: Parameters<EditorView["requestMeasure"]>[0]) => {
      EditorView.prototype.requestMeasure.call(view as never, request);
    },
    plugin: () => plugin,
    // Run native transaction/scroll-target handling while leaving DOM rendering
    // to the controlled geometry and measurement queue above.
    destroyed: false,
    updateState: 0,
    hasFocus: false,
    bidiCache: [],
    observer: { clear: () => undefined, forceFlush: () => undefined },
    inputState: { notifiedFocused: false, update: () => undefined },
    docView: {
      update: () => false,
      updateSelection: () => undefined,
      scrollIntoView: (target: ScrollTarget) => {
        appliedTargets.push(target);
        const block = view.viewState.lineBlockAt(target.range.head);
        view.scrollDOM.scrollTop =
          block.top - target.yMargin + (target.isSnapshot ? 0 : 192);
      },
    },
    mountStyles: () => undefined,
    updateAttrs: () => false,
    showAnnouncements: () => undefined,
    updatePlugins: (update: ViewUpdate) => plugin.update(update),
    dispatch: (spec: TransactionSpec) => {
      const transaction = view.state.update(spec);
      EditorView.prototype.update.call(view as never, [transaction]);
      transactions.push(transaction);
    },
  };
  const plugin = new FoldScrollResizePluginValue(view as never);
  const beginMeasurement = () => {
    view.updateState = 1;
    const writes = view.measureRequests.splice(0).map((request) => {
      const value = request.read(view as never);
      return () => request.write?.(value, view as never);
    });
    return () => {
      view.updateState = 2;
      writes.forEach((write) => write());
      view.updateState = 0;
      view.measureScheduled = -1;
    };
  };
  const layoutUpdate = (): ViewUpdate => {
    const transaction = view.state.update({});
    return {
      view: view as never,
      state: transaction.state,
      startState: transaction.startState,
      changes: transaction.changes,
      transactions: [],
      viewportChanged: true,
      viewportMoved: false,
      heightChanged: true,
      geometryChanged: true,
      focusChanged: false,
      docChanged: false,
      selectionSet: false,
    };
  };
  const finishLayout = () => {
    const update = layoutUpdate();
    for (const listener of view.state.facet(EditorView.updateListener))
      listener(update);
  };
  return {
    view,
    window,
    plugin,
    layout,
    transactions,
    appliedTargets,
    beginMeasurement,
    finishLayout,
    geometryChanged: () => plugin.update(layoutUpdate()),
    flushMeasurements: () => view.measure(false),
    resize: () => window.dispatchEvent(new Event("resize")),
  };
}

test("ordinary scrolling refreshes the next resize anchor without dispatching", () => {
  const context = setup();
  context.flushMeasurements();
  context.view.scrollDOM.scrollTop = 432;

  context.plugin.synchronize();

  expect(context.transactions).toHaveLength(0);
  context.view.scrollDOM.clientWidth = 500;
  context.view.scrollDOM.scrollTop = 192;
  context.resize();
  expect(context.transactions).toHaveLength(1);
  expect(context.transactions[0].effects[0].value).toMatchObject({
    range: { anchor: 20, head: 20 },
    yMargin: -192,
    isSnapshot: true,
  });
  context.plugin.destroy();
});

test("a width change dispatches the saved anchor once despite repeated resize notifications", () => {
  const context = setup();
  context.flushMeasurements();
  const originalDoc = context.view.state.doc;
  context.view.scrollDOM.clientWidth = 500;
  context.layout.lineHeight = 96;
  context.view.scrollDOM.scrollTop = 192;

  context.resize();
  context.resize();
  context.finishLayout();

  expect(context.transactions).toHaveLength(1);
  expect(context.transactions[0].effects[0].value).toMatchObject({
    range: { anchor: 12, head: 12 },
    yMargin: -192,
    isSnapshot: true,
  });
  expect(context.view.state.doc).toBe(originalDoc);
  context.plugin.destroy();
});

test("geometry measurement keeps the old anchor until completed layout restores it", () => {
  const context = setup();
  context.flushMeasurements();
  context.view.scrollDOM.clientWidth = 500;
  context.view.scrollDOM.scrollTop = 192;
  context.geometryChanged();

  context.flushMeasurements();
  expect(context.transactions).toHaveLength(0);
  context.finishLayout();

  expect(context.transactions).toHaveLength(1);
  expect(context.transactions[0].effects[0].value).toMatchObject({
    range: { anchor: 12, head: 12 },
    yMargin: -192,
    isSnapshot: true,
  });
  context.plugin.destroy();
});

test("replacing the document invalidates its saved anchor before a resize", () => {
  const context = setup();
  context.flushMeasurements();
  context.view.dispatch({
    changes: { from: 0, to: context.view.state.doc.length, insert: "- new" },
  });
  context.view.scrollDOM.clientWidth = 500;
  context.view.scrollDOM.scrollTop = 0;

  context.resize();
  context.flushMeasurements();
  context.finishLayout();

  expect(context.transactions).toHaveLength(1);
  expect(context.transactions[0].effects).toHaveLength(0);
  expect(context.view.state.doc.toString()).toBe("- new");
  context.plugin.destroy();
});

test("editors in the same window restore their own viewport anchors", () => {
  const window = makeWindow();
  const first = setup(window);
  const second = setup(window);
  second.view.scrollDOM.scrollTop = 432;
  first.flushMeasurements();
  second.flushMeasurements();
  first.view.scrollDOM.clientWidth = 500;
  second.view.scrollDOM.clientWidth = 500;
  first.view.scrollDOM.scrollTop = 192;
  second.view.scrollDOM.scrollTop = 192;

  window.dispatchEvent(new Event("resize"));

  expect(first.transactions).toHaveLength(1);
  expect(second.transactions).toHaveLength(1);
  expect(first.transactions[0].effects[0].value).toMatchObject({
    range: { anchor: 12, head: 12 },
    yMargin: -192,
  });
  expect(second.transactions[0].effects[0].value).toMatchObject({
    range: { anchor: 20, head: 20 },
    yMargin: -192,
  });
  first.plugin.destroy();
  second.plugin.destroy();
});

test("destroy removes the resize listener and leaves pending measurement callbacks inert", () => {
  const context = setup();
  context.flushMeasurements();
  context.geometryChanged();
  const completePendingWrite = context.beginMeasurement();
  expect(getEventListeners(context.window, "resize")).toHaveLength(1);

  context.plugin.destroy();
  completePendingWrite();
  context.view.scrollDOM.clientWidth = 500;
  context.resize();
  context.finishLayout();

  expect(getEventListeners(context.window, "resize")).toHaveLength(0);
  expect(context.transactions).toHaveLength(0);
});

test.each(["selection reveal", "explicit scroll effect"])(
  "a pending %s survives a width change before its scheduled measurement",
  (navigation) => {
    const context = setup(
      makeWindow(),
      Array.from({ length: 100 }, (_, index) => `- row ${index}`).join("\n"),
    );
    context.view.scrollDOM.scrollTop = 1152;
    context.flushMeasurements();
    const destination = context.view.state.doc.line(80).from;
    context.view.dispatch({
      selection: { anchor: destination },
      ...(navigation === "selection reveal"
        ? { scrollIntoView: true }
        : { effects: EditorView.scrollIntoView(destination, { y: "start" }) }),
    });
    expect(context.view.viewState.scrollTarget?.range.head).toBe(destination);

    context.view.scrollDOM.clientWidth = 500;
    context.resize();

    expect(context.view.state.selection.main.head).toBe(destination);
    expect(context.appliedTargets).toHaveLength(1);
    expect(context.appliedTargets[0]).toMatchObject({
      range: { head: destination },
      isSnapshot: false,
    });
    context.plugin.destroy();
  },
);

test("an old geometry measurement cannot restore its anchor after newer navigation completes", () => {
  const context = setup(
    makeWindow(),
    Array.from({ length: 100 }, (_, index) => `- row ${index}`).join("\n"),
  );
  context.view.scrollDOM.scrollTop = 1152;
  context.flushMeasurements();
  context.geometryChanged();
  const destination = context.view.state.doc.line(30).from;
  context.view.dispatch({
    selection: { anchor: destination },
    effects: EditorView.scrollIntoView(destination, { y: "start", yMargin: 0 }),
  });

  // Native measure runs queued reads/writes before the pending target. Its
  // unchanged viewport produces no flags, so it omits the completion listener.
  context.flushMeasurements();
  expect(context.view.scrollDOM.scrollTop).toBe(1584);
  context.view.scrollDOM.clientWidth = 500;
  context.resize();

  expect(context.view.state.selection.main.head).toBe(destination);
  expect(context.view.scrollDOM.scrollTop).toBe(1584);
  expect(context.appliedTargets).toHaveLength(1);
  context.plugin.destroy();
});

test("an edit above the viewport keeps its automatic scroll correction through a resize", () => {
  const context = setup(
    makeWindow(),
    Array.from({ length: 100 }, (_, index) => `- row ${index}`).join("\n"),
  );
  context.view.scrollDOM.scrollTop = 1152;
  context.flushMeasurements();
  context.view.dispatch({ changes: { from: 0, insert: "- inserted\n" } });

  // The insertion maps the old anchor one line down. Native measure applies
  // the resulting 48px correction after the plugin's queued read/write.
  context.flushMeasurements();
  expect(context.view.scrollDOM.scrollTop).toBe(1200);
  context.view.scrollDOM.clientWidth = 500;
  context.resize();

  expect(context.view.scrollDOM.scrollTop).toBe(1200);
  expect(context.appliedTargets).toHaveLength(0);
  context.plugin.destroy();
});

test("a background effect leaves the next width change protected after its turn", async () => {
  const context = setup();
  context.flushMeasurements();
  context.view.dispatch({ effects: StateEffect.define<void>().of() });
  await Promise.resolve();
  context.view.scrollDOM.clientWidth = 500;
  context.view.scrollDOM.scrollTop = 192;

  context.resize();

  expect(context.view.scrollDOM.scrollTop).toBe(336);
  expect(context.appliedTargets).toHaveLength(1);
  expect(context.appliedTargets[0]).toMatchObject({
    range: { anchor: 12, head: 12 },
    isSnapshot: true,
  });
  context.plugin.destroy();
});
