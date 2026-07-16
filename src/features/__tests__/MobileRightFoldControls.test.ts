import { Platform } from "obsidian";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
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
      registerEditorExtension: jest.fn(),
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

  test("restores scroll reserve before a native list fold click", () => {
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
    const pluginValue = new MobileRightFoldControlsPluginValue(view as never);
    const preventDefault = jest.fn();
    const stopPropagation = jest.fn();
    const target = {
      closest: jest.fn((selector: string) =>
        selector === ".HyperMD-list-line .cm-fold-indicator .collapse-indicator"
          ? {}
          : null,
      ),
    };

    listeners.get("pointerdown")?.({
      target,
      preventDefault,
      stopPropagation,
    } as unknown as MouseEvent);

    expect(contentDOM.style.paddingBottom).toBe("1138.5px");
    expect(readScrollHeight).toHaveBeenCalledTimes(1);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();
    expect(contentDOM.addEventListener).toHaveBeenCalledWith(
      "pointerdown",
      expect.any(Function),
      true,
    );
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
  });

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
    const pluginValue = new MobileRightFoldControlsPluginValue(view as never);
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
});

test("moves native list fold controls to the right edge", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
  const rowDeclarations = styles.match(
    /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\s+\.HyperMD-list-line:has\(\.cm-fold-indicator\)\s*\{([^}]*)\}/,
  )?.[1];
  const parentDeclarations = styles.match(
    /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\s+\.HyperMD-list-line\s+\.cm-fold-indicator\s*\{([^}]*)\}/,
  )?.[1];
  const controlDeclarations = styles.match(
    /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-list-line:has\(\.cm-fold-indicator\)\s+\.cm-fold-indicator\s+\.collapse-indicator\s*\{([^}]*)\}/,
  )?.[1];
  const collapsedDeclarations = styles.match(
    /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\s+\.HyperMD-list-line\s+\.cm-fold-indicator\.is-collapsed\s+\.collapse-indicator\s+svg\.svg-icon\s*\{([^}]*)\}/,
  )?.[1];

  expect(rowDeclarations).toContain("box-sizing: border-box;");
  expect(rowDeclarations).toContain("padding-inline-end: 48px;");
  expect(parentDeclarations).toContain("position: static;");
  expect(controlDeclarations).toContain("display: flex;");
  expect(controlDeclarations).toContain("align-items: center;");
  expect(controlDeclarations).toContain("justify-content: center;");
  expect(controlDeclarations).toContain("top: 0;");
  expect(controlDeclarations).toContain("inset-inline-end: 0;");
  expect(controlDeclarations).toContain("width: 48px;");
  expect(controlDeclarations).toContain("height: 100%;");
  expect(controlDeclarations).toContain("padding-inline-end: 0;");
  expect(controlDeclarations).toContain("opacity: 1;");
  expect(controlDeclarations).toContain("visibility: visible;");
  expect(controlDeclarations).toContain("pointer-events: auto;");
  expect(controlDeclarations).toContain("z-index: 2;");
  expect(collapsedDeclarations).toContain("transform: rotate(90deg);");
  expect(styles).not.toMatch(
    /\.bullet-plugin-mobile-right-fold-controls[^{]*\.markdown-preview-view/,
  );
});
