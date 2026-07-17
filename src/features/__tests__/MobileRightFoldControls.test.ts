import { Platform } from "obsidian";

import {
  codeFolding,
  foldEffect,
  foldedRanges,
  unfoldEffect,
} from "@codemirror/language";
import { EditorState, StateEffect } from "@codemirror/state";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MobileNativeFoldScroll,
  MobileRightFoldControls,
  MobileRightFoldControlsPluginValue,
} from "../MobileRightFoldControls";

jest.mock(
  "obsidian",
  () => ({
    Platform: { isMobile: true },
  }),
  { virtual: true },
);

function makeClassList() {
  const values = new Set<string>();
  return {
    add: jest.fn((...classes: string[]) => {
      classes.forEach((className) => values.add(className));
    }),
    remove: jest.fn((...classes: string[]) => {
      classes.forEach((className) => values.delete(className));
    }),
    contains: (className: string) => values.has(className),
  };
}

function makeDocument() {
  return { body: { classList: makeClassList() } };
}

function parseCssRules(styles: string) {
  const withoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(
    ([, selectors, declarations]) =>
      selectors.split(",").map((selector) => ({
        declarations,
        selector: selector.replace(/\s+/g, " ").trim(),
      })),
  );
}

function hasCssProperty(
  declarations: string,
  propertyPattern: RegExp,
): boolean {
  return declarations.split(";").some((declaration) => {
    const separator = declaration.indexOf(":");
    return (
      separator >= 0 &&
      propertyPattern.test(declaration.slice(0, separator).trim())
    );
  });
}

function makePlugin() {
  type WorkspaceHandler = (...args: never[]) => void;
  const eventHandlers = new Map<string, WorkspaceHandler[]>();
  const workspace = {
    on: jest.fn((eventName: string, handler: WorkspaceHandler) => {
      const handlers = eventHandlers.get(eventName) ?? [];
      handlers.push(handler);
      eventHandlers.set(eventName, handlers);
      return { eventName, handler };
    }),
  };

  return {
    eventHandlers,
    plugin: {
      app: { workspace },
      registerEditorExtension: jest.fn<void, [unknown[]]>(),
      registerEvent: jest.fn(),
    },
  };
}

describe("MobileRightFoldControls", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as { isMobile: boolean }).isMobile = true;
  });

  test("manages the body class across setting changes and documents", async () => {
    const mainDocument = makeDocument();
    const popoutDocument = makeDocument();
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: mainDocument,
    });
    const { eventHandlers, plugin } = makePlugin();
    const callbacks: Array<() => void> = [];
    const settings = {
      mobileRightFoldControls: true,
      onChange: jest.fn((keys: unknown, callback?: () => void) => {
        callbacks.push(callback ?? (keys as () => void));
      }),
      removeCallback: jest.fn(),
    };
    const feature = new MobileRightFoldControls(
      plugin as never,
      settings as never,
    );

    await feature.load();

    const registeredExtensions =
      plugin.registerEditorExtension.mock.calls[0]?.[0];
    expect(registeredExtensions).toHaveLength(2);
    expect(settings.onChange).toHaveBeenCalledWith(
      ["mobileRightFoldControls"],
      expect.any(Function),
    );
    expect(
      mainDocument.body.classList.contains(
        "bullet-plugin-mobile-right-fold-controls",
      ),
    ).toBe(true);

    for (const handler of eventHandlers.get("window-open") ?? []) {
      handler({} as never, { document: popoutDocument } as never);
    }
    expect(
      popoutDocument.body.classList.contains(
        "bullet-plugin-mobile-right-fold-controls",
      ),
    ).toBe(true);

    settings.mobileRightFoldControls = false;
    callbacks[0]?.();

    expect(
      mainDocument.body.classList.contains(
        "bullet-plugin-mobile-right-fold-controls",
      ),
    ).toBe(false);
    expect(
      popoutDocument.body.classList.contains(
        "bullet-plugin-mobile-right-fold-controls",
      ),
    ).toBe(false);

    settings.mobileRightFoldControls = true;
    callbacks[0]?.();
    await feature.unload();

    expect(
      mainDocument.body.classList.contains(
        "bullet-plugin-mobile-right-fold-controls",
      ),
    ).toBe(false);
    expect(
      popoutDocument.body.classList.contains(
        "bullet-plugin-mobile-right-fold-controls",
      ),
    ).toBe(false);
    expect(settings.removeCallback).toHaveBeenCalledWith(expect.any(Function));
  });

  test("does not apply the body class on desktop", async () => {
    (Platform as { isMobile: boolean }).isMobile = false;
    const mainDocument = makeDocument();
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: mainDocument,
    });
    const { plugin } = makePlugin();
    const settings = {
      mobileRightFoldControls: true,
      onChange: jest.fn(),
      removeCallback: jest.fn(),
    };
    const feature = new MobileRightFoldControls(
      plugin as never,
      settings as never,
    );

    await feature.load();

    expect(
      mainDocument.body.classList.contains(
        "bullet-plugin-mobile-right-fold-controls",
      ),
    ).toBe(false);
  });

  test.each([
    ["list", ".HyperMD-list-line .cm-fold-indicator .collapse-indicator"],
    ["heading", ".HyperMD-header .cm-fold-indicator .collapse-indicator"],
  ])(
    "restores scroll reserve before a native %s fold click",
    (_name, matchingSelector) => {
      const listeners = new Map<string, (event: Event) => void>();
      const readScrollHeight = jest.fn(() => 2000);
      const scrollDOM = { clientHeight: 1163 };
      Object.defineProperty(scrollDOM, "scrollHeight", {
        get: readScrollHeight,
      });
      const contentDOM = {
        addEventListener: jest.fn(
          (eventName: string, listener: (event: Event) => void) => {
            listeners.set(eventName, listener);
          },
        ),
        removeEventListener: jest.fn(),
        style: { paddingBottom: "100px" },
      };
      const view = {
        contentDOM,
        defaultLineHeight: 24,
        documentPadding: { top: 0 },
        dom: {
          ownerDocument: {
            body: {
              classList: {
                contains: (className: string) =>
                  className === "bullet-plugin-mobile-right-fold-controls",
              },
            },
          },
        },
        scrollDOM,
      };
      const nativeFoldScroll = { prepare: jest.fn() };
      const pluginValue = new MobileRightFoldControlsPluginValue(
        view as never,
        nativeFoldScroll as never,
      );
      const preventDefault = jest.fn();
      const stopPropagation = jest.fn();
      const target = {
        closest: jest.fn((selector: string) =>
          selector.includes(matchingSelector) ? {} : null,
        ),
      };

      listeners.get("pointerdown")?.({
        target,
        preventDefault,
        stopPropagation,
        type: "pointerdown",
      } as unknown as MouseEvent);

      expect(contentDOM.style.paddingBottom).toBe("1138.5px");
      expect(readScrollHeight).toHaveBeenCalledTimes(1);
      expect(nativeFoldScroll.prepare).not.toHaveBeenCalled();
      expect(preventDefault).not.toHaveBeenCalled();
      expect(stopPropagation).not.toHaveBeenCalled();
      expect(contentDOM.addEventListener).toHaveBeenCalledWith(
        "pointerdown",
        expect.any(Function),
        true,
      );

      listeners.get("click")?.({
        target,
        preventDefault,
        stopPropagation,
        type: "click",
      } as unknown as MouseEvent);

      expect(readScrollHeight).toHaveBeenCalledTimes(2);
      expect(nativeFoldScroll.prepare).toHaveBeenCalledWith(view);
      expect(nativeFoldScroll.prepare).toHaveBeenCalledTimes(1);
      pluginValue.destroy();

      expect(contentDOM.removeEventListener).toHaveBeenCalledWith(
        "click",
        expect.any(Function),
        true,
      );
      expect(contentDOM.removeEventListener).toHaveBeenCalledWith(
        "pointerdown",
        expect.any(Function),
        true,
      );
    },
  );

  test("leaves scroll reserve unchanged outside the mobile control", () => {
    const listeners = new Map<string, (event: Event) => void>();
    const contentDOM = {
      addEventListener: jest.fn(
        (eventName: string, listener: (event: Event) => void) => {
          listeners.set(eventName, listener);
        },
      ),
      removeEventListener: jest.fn(),
      style: { paddingBottom: "100px" },
    };
    const classNames = new Set<string>();
    const view = {
      contentDOM,
      defaultLineHeight: 24,
      documentPadding: { top: 0 },
      dom: {
        ownerDocument: {
          body: {
            classList: {
              contains: (className: string) => classNames.has(className),
            },
          },
        },
      },
      scrollDOM: { clientHeight: 1163 },
    };
    const pluginValue = new MobileRightFoldControlsPluginValue(
      view as never,
      { prepare: jest.fn() } as never,
    );
    const target = {
      closest: jest.fn().mockReturnValue({}),
    };

    listeners.get("click")?.({
      target,
    } as unknown as MouseEvent);

    expect(contentDOM.style.paddingBottom).toBe("100px");

    classNames.add("bullet-plugin-mobile-right-fold-controls");
    target.closest.mockReturnValue(null);
    listeners.get("click")?.({
      target,
    } as unknown as MouseEvent);

    expect(contentDOM.style.paddingBottom).toBe("100px");

    pluginValue.destroy();
  });

  test.each([
    ["fold", foldEffect],
    ["unfold", unfoldEffect],
  ])(
    "keeps a corrected scroll snapshot for the asynchronous native %s transaction",
    async (_name, nativeEffect) => {
      const snapshotType = StateEffect.define<string>();
      const snapshot = snapshotType.of("viewport");
      const nativeFoldScroll = new MobileNativeFoldScroll(
        jest.fn().mockReturnValue(snapshot),
      );
      const state = EditorState.create({
        doc: "- parent\n  - child",
        extensions: [nativeFoldScroll.extension],
      });
      const view = {
        dom: {
          ownerDocument: {
            defaultView: { setTimeout: jest.fn() },
          },
        },
        state,
      };

      nativeFoldScroll.prepare(view as never);
      await Promise.resolve();
      const transaction = state.update({
        effects: nativeEffect.of({ from: 8, to: 17 }),
      });

      expect(transaction.effects).toHaveLength(2);
      expect(transaction.effects).toContain(snapshot);
      expect(
        transaction.effects.some((effect) => effect.is(nativeEffect)),
      ).toBe(true);
    },
  );

  test("keeps a corrected scroll snapshot when moving the selection implicitly unfolds its range", () => {
    const snapshotType = StateEffect.define<string>();
    const snapshot = snapshotType.of("viewport");
    const nativeFoldScroll = new MobileNativeFoldScroll(
      jest.fn().mockReturnValue(snapshot),
    );
    const state = EditorState.create({
      doc: "- parent\n  - child",
      extensions: [codeFolding(), nativeFoldScroll.extension],
      selection: { anchor: 10 },
    });
    const foldedState = state.update({
      effects: foldEffect.of({ from: 8, to: 17 }),
    }).state;
    const view = {
      dom: {
        ownerDocument: {
          defaultView: { setTimeout: jest.fn() },
        },
      },
      state: foldedState,
    };

    expect(foldedRanges(foldedState).size).toBe(1);
    nativeFoldScroll.prepare(view as never);
    const selectionTransaction = foldedState.update({
      selection: { anchor: 10 },
    });

    expect(foldedRanges(selectionTransaction.state).size).toBe(0);
    expect(selectionTransaction.effects).toContain(snapshot);
  });

  test.each([
    ["fold", foldEffect],
    ["unfold", unfoldEffect],
  ])(
    "carries a corrected scroll snapshot across an intermediate selection transaction before native %s",
    (_name, nativeEffect) => {
      const snapshotType = StateEffect.define<string>();
      const snapshot = snapshotType.of("viewport");
      const nativeFoldScroll = new MobileNativeFoldScroll(
        jest.fn().mockReturnValue(snapshot),
      );
      const state = EditorState.create({
        doc: "- parent\n  - child",
        extensions: [nativeFoldScroll.extension],
      });
      const view = {
        dom: {
          ownerDocument: {
            defaultView: { setTimeout: jest.fn() },
          },
        },
        state,
      };

      nativeFoldScroll.prepare(view as never);
      const selectionTransaction = state.update({
        selection: { anchor: 2 },
      });
      const nativeTransaction = selectionTransaction.state.update({
        effects: nativeEffect.of({ from: 8, to: 17 }),
      });

      expect(nativeTransaction.effects).toHaveLength(2);
      expect(nativeTransaction.effects).toContain(snapshot);
      expect(
        nativeTransaction.effects.some((effect) => effect.is(nativeEffect)),
      ).toBe(true);
    },
  );

  test.each([
    ["fold", foldEffect],
    ["unfold", unfoldEffect],
  ])(
    "expires a corrected scroll snapshot after an intermediate selection before later %s",
    (_name, nativeEffect) => {
      const snapshotType = StateEffect.define<string>();
      const snapshot = snapshotType.of("viewport");
      const timeoutCallbacks: Array<() => void> = [];
      const nativeFoldScroll = new MobileNativeFoldScroll(
        jest.fn().mockReturnValue(snapshot),
      );
      const state = EditorState.create({
        doc: "- parent\n  - child",
        extensions: [nativeFoldScroll.extension],
      });
      const view = {
        dom: {
          ownerDocument: {
            defaultView: {
              setTimeout: jest.fn((callback: () => void) => {
                timeoutCallbacks.push(callback);
                return 1;
              }),
            },
          },
        },
        state,
      };

      nativeFoldScroll.prepare(view as never);
      const selectionTransaction = state.update({
        selection: { anchor: 2 },
      });
      timeoutCallbacks[0]?.();
      const nativeTransaction = selectionTransaction.state.update({
        effects: nativeEffect.of({ from: 8, to: 17 }),
      });

      expect(nativeTransaction.effects).toHaveLength(1);
      expect(nativeTransaction.effects).not.toContain(snapshot);
      expect(
        nativeTransaction.effects.some((effect) => effect.is(nativeEffect)),
      ).toBe(true);
    },
  );

  test("does not let an older timeout expire a newer snapshot for the same state", () => {
    const snapshotType = StateEffect.define<string>();
    const oldSnapshot = snapshotType.of("old viewport");
    const newSnapshot = snapshotType.of("new viewport");
    const timeoutCallbacks: Array<() => void> = [];
    const nativeFoldScroll = new MobileNativeFoldScroll(
      jest
        .fn()
        .mockReturnValueOnce(oldSnapshot)
        .mockReturnValueOnce(newSnapshot),
    );
    const state = EditorState.create({
      doc: "- parent\n  - child",
      extensions: [nativeFoldScroll.extension],
    });
    const view = {
      dom: {
        ownerDocument: {
          defaultView: {
            setTimeout: jest.fn((callback: () => void) => {
              timeoutCallbacks.push(callback);
              return timeoutCallbacks.length;
            }),
          },
        },
      },
      state,
    };

    nativeFoldScroll.prepare(view as never);
    nativeFoldScroll.prepare(view as never);
    timeoutCallbacks[0]?.();
    const nativeTransaction = state.update({
      effects: foldEffect.of({ from: 8, to: 17 }),
    });

    expect(nativeTransaction.effects).toContain(newSnapshot);
    expect(nativeTransaction.effects).not.toContain(oldSnapshot);
  });
});

test("mirrors native mobile heading fold controls without widening the editor", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
  const featureRules = parseCssRules(styles).filter(({ selector }) =>
    selector.includes(".bullet-plugin-mobile-right-fold-controls"),
  );
  const rowPaddingRules = featureRules.filter(({ declarations, selector }) => {
    const compounds = selector.split(" ");
    const targetCompound = compounds[compounds.length - 1];
    return (
      targetCompound.includes(".HyperMD-list-line") &&
      hasCssProperty(declarations, /^padding-inline-end$/)
    );
  });
  const editorOverflowRules = featureRules.filter(
    ({ declarations, selector }) =>
      (selector.includes(".cm-scroller") || selector.includes(".cm-content")) &&
      hasCssProperty(declarations, /^overflow(?:-[xy])?$/),
  );
  const parentDeclarations = styles.match(
    /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\s+\.HyperMD-list-line\s+\.cm-fold-indicator\s*\{([^}]*)\}/,
  )?.[1];
  const controlDeclarations = styles.match(
    /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-list-line:has\(\.cm-fold-indicator\)\s+\.cm-fold-indicator\s+\.collapse-indicator\s*\{([^}]*)\}/,
  )?.[1];
  const collapsedDeclarations = styles.match(
    /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\s+\.HyperMD-list-line\s+\.cm-fold-indicator\.is-collapsed\s+\.collapse-indicator\s+svg\.svg-icon\s*\{([^}]*)\}/,
  )?.[1];

  expect(rowPaddingRules).toEqual([]);
  expect(parentDeclarations).toContain("position: static;");
  expect(controlDeclarations).toContain("display: flex;");
  expect(controlDeclarations).toContain("box-sizing: border-box;");
  expect(controlDeclarations).toContain("align-items: center;");
  expect(controlDeclarations).toContain("justify-content: flex-start;");
  expect(controlDeclarations).toContain("top: 0;");
  expect(controlDeclarations).toContain("inset-inline-end: -15px;");
  expect(controlDeclarations).toContain("width: 15px;");
  expect(controlDeclarations).toMatch(
    /height:\s*calc\(\s*1lh\s*\+\s*var\(--list-spacing,\s*0px\)\s*\+\s*var\(--list-spacing,\s*0px\)\s*\);/,
  );
  expect(controlDeclarations).not.toContain("height: 100%;");
  expect(controlDeclarations).toContain("padding-inline-start: 5px;");
  expect(controlDeclarations).toContain("padding-inline-end: 0;");
  expect(controlDeclarations).not.toContain("translate");
  expect(controlDeclarations).toContain("opacity: 1;");
  expect(controlDeclarations).toContain("visibility: visible;");
  expect(controlDeclarations).toContain("pointer-events: auto;");
  expect(controlDeclarations).toContain("z-index: 2;");
  expect(collapsedDeclarations).toContain("transform: rotate(90deg);");
  expect(styles).not.toMatch(
    /\.bullet-plugin-mobile-right-fold-controls[^{]*\.markdown-preview-view/,
  );
  expect(editorOverflowRules).toEqual([]);
});

test("moves native mobile heading fold controls to the right edge", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
  const parentDeclarations = styles.match(
    /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\s+\.HyperMD-header\s+\.cm-fold-indicator\s*\{([^}]*)\}/,
  )?.[1];
  const controlDeclarations = styles.match(
    /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-header:has\(\.cm-fold-indicator\)\s+\.cm-fold-indicator\s+\.collapse-indicator\s*\{([^}]*)\}/,
  )?.[1];
  const collapsedDeclarations = styles.match(
    /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\s+\.HyperMD-header\s+\.cm-fold-indicator\.is-collapsed\s+\.collapse-indicator\s+svg\.svg-icon\s*\{([^}]*)\}/,
  )?.[1];

  expect(parentDeclarations).toContain("position: static;");
  expect(controlDeclarations).toContain("display: flex;");
  expect(controlDeclarations).toContain("box-sizing: border-box;");
  expect(controlDeclarations).toContain("align-items: center;");
  expect(controlDeclarations).toContain("justify-content: flex-start;");
  expect(controlDeclarations).toContain("top: 0;");
  expect(controlDeclarations).toContain("inset-inline-end: -15px;");
  expect(controlDeclarations).toContain("width: 15px;");
  expect(controlDeclarations).toContain("height: 1lh;");
  expect(controlDeclarations).not.toContain("height: 100%;");
  expect(controlDeclarations).toContain("padding-inline-start: 5px;");
  expect(controlDeclarations).toContain("padding-inline-end: 0;");
  expect(controlDeclarations).toContain("opacity: 1;");
  expect(controlDeclarations).toContain("visibility: visible;");
  expect(controlDeclarations).toContain("pointer-events: auto;");
  expect(controlDeclarations).toContain("z-index: 2;");
  expect(collapsedDeclarations).toContain("transform: rotate(90deg);");
});
