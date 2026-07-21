import {
  codeFolding,
  foldEffect,
  foldedRanges,
  unfoldEffect,
} from "@codemirror/language";
import { EditorState, StateEffect } from "@codemirror/state";

import {
  NativeFoldScrollPluginValue,
  NativeFoldScrollState,
} from "../NativeFoldScroll";

function makeClassList(classNames: string[] = []) {
  const values = new Set(classNames);
  return {
    contains: (className: string) => values.has(className),
  };
}

function makeDocument(classNames: string[] = []) {
  return { body: { classList: makeClassList(classNames) } };
}

function makeView(state: EditorState, document = makeDocument()) {
  const listeners = new Map<string, (event: Event) => void>();
  const readScrollHeight = jest.fn(() => 2000);
  const scrollDOM = { clientHeight: 1163 };
  Object.defineProperty(scrollDOM, "scrollHeight", { get: readScrollHeight });
  const contentDOM = {
    addEventListener: jest.fn(
      (eventName: string, listener: (event: Event) => void) => {
        listeners.set(eventName, listener);
      },
    ),
    removeEventListener: jest.fn(),
    style: { paddingBottom: "100px" },
  };
  return {
    contentDOM,
    defaultLineHeight: 24,
    documentPadding: { top: 0 },
    dom: {
      ownerDocument: { ...document, defaultView: { setTimeout: jest.fn() } },
    },
    listeners,
    readScrollHeight,
    scrollDOM,
    state,
  };
}

const nativeControl = (matchingSelector: string) => ({
  closest: jest.fn((selector: string) =>
    selector.includes(matchingSelector) ? {} : null,
  ),
});

describe("NativeFoldScroll", () => {
  test.each([
    ["list", ".HyperMD-list-line .cm-fold-indicator .collapse-indicator"],
    ["heading", ".HyperMD-header .cm-fold-indicator .collapse-indicator"],
  ])(
    "stabilizes a desktop native %s chevron transaction",
    (_name, selector) => {
      const snapshotType = StateEffect.define<string>();
      const snapshot = snapshotType.of("viewport");
      const foldScroll = new NativeFoldScrollState(
        jest.fn().mockReturnValue(snapshot),
      );
      const state = EditorState.create({
        doc: "- x",
        extensions: [foldScroll.extension],
      });
      const view = makeView(state);
      const pluginValue = new NativeFoldScrollPluginValue(
        view as never,
        foldScroll,
      );
      const target = nativeControl(selector);

      view.listeners.get("pointerdown")?.({
        target,
        type: "pointerdown",
      } as unknown as Event);
      expect(view.contentDOM.style.paddingBottom).toBe("1138.5px");
      expect(view.readScrollHeight).toHaveBeenCalledTimes(1);

      view.listeners.get("click")?.({
        target,
        type: "click",
      } as unknown as Event);
      expect(view.readScrollHeight).toHaveBeenCalledTimes(2);
      const transaction = state.update({
        effects: foldEffect.of({ from: 0, to: 1 }),
      });

      expect(transaction.effects).toContain(snapshot);
      pluginValue.destroy();
    },
  );

  test.each([
    [
      "mobile controls enabled",
      ["is-mobile", "bullet-plugin-mobile-right-fold-controls"],
      true,
    ],
    ["mobile controls disabled", ["is-mobile"], false],
  ])("%s gates native fold scrolling", (_name, classes, enabled) => {
    const snapshotType = StateEffect.define<string>();
    const snapshot = snapshotType.of("viewport");
    const foldScroll = new NativeFoldScrollState(
      jest.fn().mockReturnValue(snapshot),
    );
    const state = EditorState.create({
      doc: "- x",
      extensions: [foldScroll.extension],
    });
    const view = makeView(state, makeDocument(classes));
    const pluginValue = new NativeFoldScrollPluginValue(
      view as never,
      foldScroll,
    );
    const target = nativeControl(
      ".HyperMD-list-line .cm-fold-indicator .collapse-indicator",
    );

    view.listeners.get("pointerdown")?.({
      target,
      type: "pointerdown",
    } as unknown as Event);
    view.listeners.get("click")?.({
      target,
      type: "click",
    } as unknown as Event);
    const transaction = state.update({
      effects: foldEffect.of({ from: 0, to: 1 }),
    });

    expect(view.readScrollHeight).toHaveBeenCalledTimes(enabled ? 2 : 0);
    expect(transaction.effects.includes(snapshot)).toBe(enabled);
    pluginValue.destroy();
  });

  test("does not stage a snapshot for an unrelated element", () => {
    const snapshotType = StateEffect.define<string>();
    const snapshot = snapshotType.of("viewport");
    const foldScroll = new NativeFoldScrollState(
      jest.fn().mockReturnValue(snapshot),
    );
    const state = EditorState.create({
      doc: "- x",
      extensions: [foldScroll.extension],
    });
    const view = makeView(state);
    const pluginValue = new NativeFoldScrollPluginValue(
      view as never,
      foldScroll,
    );

    view.listeners.get("click")?.({
      target: { closest: jest.fn().mockReturnValue(null) },
      type: "click",
    } as unknown as Event);
    const transaction = state.update({
      effects: foldEffect.of({ from: 0, to: 1 }),
    });

    expect(transaction.effects).not.toContain(snapshot);
    pluginValue.destroy();
  });

  test.each([
    ["fold", foldEffect],
    ["unfold", unfoldEffect],
  ])(
    "keeps a corrected snapshot for a native %s transaction",
    (_name, nativeEffect) => {
      const snapshotType = StateEffect.define<string>();
      const snapshot = snapshotType.of("viewport");
      const foldScroll = new NativeFoldScrollState(
        jest.fn().mockReturnValue(snapshot),
      );
      const state = EditorState.create({
        doc: "- x",
        extensions: [foldScroll.extension],
      });
      const view = makeView(state);

      foldScroll.prepare(view as never);
      const transaction = state.update({
        effects: nativeEffect.of({ from: 0, to: 1 }),
      });

      expect(transaction.effects).toContain(snapshot);
    },
  );

  test("keeps a corrected snapshot when selection implicitly unfolds its range", () => {
    const snapshotType = StateEffect.define<string>();
    const snapshot = snapshotType.of("viewport");
    const foldScroll = new NativeFoldScrollState(
      jest.fn().mockReturnValue(snapshot),
    );
    const state = EditorState.create({
      doc: "- parent\n  - child",
      extensions: [codeFolding(), foldScroll.extension],
      selection: { anchor: 10 },
    });
    const foldedState = state.update({
      effects: foldEffect.of({ from: 8, to: 17 }),
    }).state;
    const view = makeView(foldedState);

    foldScroll.prepare(view as never);
    const transaction = foldedState.update({ selection: { anchor: 10 } });

    expect(foldedRanges(transaction.state).size).toBe(0);
    expect(transaction.effects).toContain(snapshot);
  });

  test("carries a snapshot through an intermediate selection transaction", () => {
    const snapshotType = StateEffect.define<string>();
    const snapshot = snapshotType.of("viewport");
    const foldScroll = new NativeFoldScrollState(
      jest.fn().mockReturnValue(snapshot),
    );
    const state = EditorState.create({
      doc: "- x",
      extensions: [foldScroll.extension],
    });
    const view = makeView(state);

    foldScroll.prepare(view as never);
    const selectionTransaction = state.update({ selection: { anchor: 0 } });
    const nativeTransaction = selectionTransaction.state.update({
      effects: unfoldEffect.of({ from: 0, to: 1 }),
    });

    expect(nativeTransaction.effects).toContain(snapshot);
  });

  test("expires a snapshot after an intermediate selection before a later native transaction", () => {
    const snapshotType = StateEffect.define<string>();
    const snapshot = snapshotType.of("viewport");
    const timeoutCallbacks: Array<() => void> = [];
    const foldScroll = new NativeFoldScrollState(
      jest.fn().mockReturnValue(snapshot),
    );
    const state = EditorState.create({
      doc: "- x",
      extensions: [foldScroll.extension],
    });
    const view = makeView(state);
    view.dom.ownerDocument.defaultView.setTimeout.mockImplementation(
      (callback: () => void) => {
        timeoutCallbacks.push(callback);
        return 1;
      },
    );

    foldScroll.prepare(view as never);
    const selectionTransaction = state.update({ selection: { anchor: 0 } });
    timeoutCallbacks[0]?.();
    const nativeTransaction = selectionTransaction.state.update({
      effects: foldEffect.of({ from: 0, to: 1 }),
    });

    expect(nativeTransaction.effects).not.toContain(snapshot);
  });

  test("does not let an older timeout expire a newer snapshot", () => {
    const snapshotType = StateEffect.define<string>();
    const oldSnapshot = snapshotType.of("old viewport");
    const newSnapshot = snapshotType.of("new viewport");
    const timeoutCallbacks: Array<() => void> = [];
    const foldScroll = new NativeFoldScrollState(
      jest
        .fn()
        .mockReturnValueOnce(oldSnapshot)
        .mockReturnValueOnce(newSnapshot),
    );
    const state = EditorState.create({
      doc: "- x",
      extensions: [foldScroll.extension],
    });
    const view = makeView(state);
    view.dom.ownerDocument.defaultView.setTimeout.mockImplementation(
      (callback: () => void) => {
        timeoutCallbacks.push(callback);
        return timeoutCallbacks.length;
      },
    );

    foldScroll.prepare(view as never);
    foldScroll.prepare(view as never);
    timeoutCallbacks[0]?.();
    const transaction = state.update({
      effects: foldEffect.of({ from: 0, to: 1 }),
    });

    expect(transaction.effects).toContain(newSnapshot);
    expect(transaction.effects).not.toContain(oldSnapshot);
  });
});
