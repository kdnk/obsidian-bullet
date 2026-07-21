import { Decoration, DecorationSet, ViewPlugin } from "@codemirror/view";

import { GUIDE_FOLDING_SCROLL_PAST_END_EXTENSION } from "../GuideFolding";
import { VerticalLines } from "../VerticalLines";

const mockGuideFoldingFactory = jest.fn<
  { decorations: DecorationSet },
  [unknown, unknown, unknown]
>(() => ({
  decorations: Decoration.none,
}));

jest.mock("../GuideFolding", () => ({
  GUIDE_FOLDING_SCROLL_PAST_END_EXTENSION: {},
  GuideFoldingPluginValue: jest.fn(
    (settings: unknown, parser: unknown, view: unknown) =>
      mockGuideFoldingFactory(settings, parser, view),
  ),
}));

function makeClassList() {
  const values = new Set<string>();

  return {
    add: jest.fn((...classes: string[]) => {
      for (const className of classes) {
        values.add(className);
      }
    }),
    remove: jest.fn((...classes: string[]) => {
      for (const className of classes) {
        values.delete(className);
      }
    }),
    contains: (value: string) => values.has(value),
  };
}

function makeDocument() {
  return {
    body: {
      classList: makeClassList(),
    },
  };
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
    updateOptions: jest.fn(),
  };

  return {
    eventHandlers,
    plugin: {
      app: { workspace },
      registerEditorExtension: jest.fn<void, [unknown]>(),
      registerEvent: jest.fn(),
    },
    workspace,
  };
}

describe("VerticalLines", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("manages folding and enhanced-hover classes independently across documents", async () => {
    const mainDocument = makeDocument();
    const popoutDocument = makeDocument();
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: mainDocument,
    });

    const { eventHandlers, plugin, workspace } = makePlugin();
    const settingsCallbacks = new Map<string, () => void>();
    const settings = {
      verticalLinesAction: "toggle-folding",
      enhancedVerticalLineHover: true,
      onChange: jest.fn((keys: unknown, callback?: () => void) => {
        settingsCallbacks.set(
          (keys as string[]).join(","),
          callback ?? (keys as () => void),
        );
      }),
      removeCallback: jest.fn(),
    };

    const feature = new VerticalLines(
      plugin as never,
      settings as never,
      {} as never,
    );

    await feature.load();

    expect(settings.onChange).toHaveBeenCalledWith(
      ["listLineAction"],
      expect.any(Function),
    );
    expect(settings.onChange).toHaveBeenCalledWith(
      ["enhanceVerticalLineHover"],
      expect.any(Function),
    );
    expect(plugin.registerEditorExtension).toHaveBeenCalled();
    expect(workspace.on).toHaveBeenCalledWith(
      "window-open",
      expect.any(Function),
    );
    expect(workspace.on).toHaveBeenCalledWith(
      "window-close",
      expect.any(Function),
    );
    expect(
      mainDocument.body.classList.contains(
        "bullet-plugin-vertical-lines-action-toggle-folding",
      ),
    ).toBe(true);
    expect(
      mainDocument.body.classList.contains(
        "bullet-plugin-enhanced-vertical-line-hover",
      ),
    ).toBe(true);

    for (const handler of eventHandlers.get("window-open") ?? []) {
      handler({} as never, { document: popoutDocument } as never);
    }
    expect(
      popoutDocument.body.classList.contains(
        "bullet-plugin-vertical-lines-action-toggle-folding",
      ),
    ).toBe(true);
    expect(
      popoutDocument.body.classList.contains(
        "bullet-plugin-enhanced-vertical-line-hover",
      ),
    ).toBe(true);

    const actionSettingsCallback = settingsCallbacks.get("listLineAction");
    const hoverSettingsCallback = settingsCallbacks.get(
      "enhanceVerticalLineHover",
    );
    if (!actionSettingsCallback || !hoverSettingsCallback) {
      throw new Error("Expected settings callbacks to be registered");
    }

    settings.enhancedVerticalLineHover = false;
    hoverSettingsCallback();

    expect(
      mainDocument.body.classList.contains(
        "bullet-plugin-vertical-lines-action-toggle-folding",
      ),
    ).toBe(true);
    expect(
      mainDocument.body.classList.contains(
        "bullet-plugin-enhanced-vertical-line-hover",
      ),
    ).toBe(false);

    settings.verticalLinesAction = "none";
    actionSettingsCallback();

    expect(
      mainDocument.body.classList.contains(
        "bullet-plugin-vertical-lines-action-toggle-folding",
      ),
    ).toBe(false);
    expect(
      popoutDocument.body.classList.contains(
        "bullet-plugin-vertical-lines-action-toggle-folding",
      ),
    ).toBe(false);

    settings.enhancedVerticalLineHover = true;
    hoverSettingsCallback();

    expect(
      mainDocument.body.classList.contains(
        "bullet-plugin-enhanced-vertical-line-hover",
      ),
    ).toBe(true);

    settings.verticalLinesAction = "toggle-folding";
    actionSettingsCallback();

    expect(
      mainDocument.body.classList.contains(
        "bullet-plugin-vertical-lines-action-toggle-folding",
      ),
    ).toBe(true);

    await feature.unload();

    expect(
      mainDocument.body.classList.contains(
        "bullet-plugin-vertical-lines-action-toggle-folding",
      ),
    ).toBe(false);
    expect(
      popoutDocument.body.classList.contains(
        "bullet-plugin-vertical-lines-action-toggle-folding",
      ),
    ).toBe(false);
    expect(
      popoutDocument.body.classList.contains(
        "bullet-plugin-enhanced-vertical-line-hover",
      ),
    ).toBe(false);
    expect(settings.removeCallback).toHaveBeenCalledWith(
      actionSettingsCallback,
    );
    expect(settings.removeCallback).toHaveBeenCalledWith(hoverSettingsCallback);
  });

  test("reserves scroll-past-end space only while guide folding is enabled", async () => {
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: makeDocument(),
    });
    const { plugin, workspace } = makePlugin();
    const settingsCallbacks: Array<() => void> = [];
    const settings = {
      verticalLinesAction: "toggle-folding",
      enhancedVerticalLineHover: true,
      onChange: jest.fn((keys: unknown, callback?: () => void) => {
        settingsCallbacks.push(callback ?? (keys as () => void));
      }),
      removeCallback: jest.fn(),
    };
    const feature = new VerticalLines(
      plugin as never,
      settings as never,
      {} as never,
    );

    await feature.load();

    const registeredExtensions = plugin.registerEditorExtension.mock
      .calls[0]?.[0] as unknown[];
    expect(registeredExtensions).toContain(
      GUIDE_FOLDING_SCROLL_PAST_END_EXTENSION,
    );
    expect(workspace.updateOptions).not.toHaveBeenCalled();

    const settingsCallback = settingsCallbacks[0];
    if (!settingsCallback) {
      throw new Error("Expected settings callback to be registered");
    }

    settings.verticalLinesAction = "none";
    settingsCallback();

    expect(registeredExtensions).not.toContain(
      GUIDE_FOLDING_SCROLL_PAST_END_EXTENSION,
    );
    expect(workspace.updateOptions).toHaveBeenCalledTimes(1);

    settings.verticalLinesAction = "toggle-folding";
    settingsCallback();

    expect(registeredExtensions).toContain(
      GUIDE_FOLDING_SCROLL_PAST_END_EXTENSION,
    );
    expect(workspace.updateOptions).toHaveBeenCalledTimes(2);
  });

  test("exposes plugin value decorations through the view plugin", async () => {
    const { plugin } = makePlugin();
    const settings = {
      outerVerticalLines: true,
      verticalLinesAction: "none",
      enhancedVerticalLineHover: true,
      onChange: jest.fn(),
      removeCallback: jest.fn(),
    };
    const viewPluginApi = ViewPlugin as unknown as {
      define: (...args: unknown[]) => unknown;
    };
    const define = jest.spyOn(viewPluginApi, "define");
    const feature = new VerticalLines(
      plugin as never,
      settings as never,
      {} as never,
    );

    await feature.load();

    const lastCall = define.mock.calls[define.mock.calls.length - 1];
    const spec = lastCall?.[1] as
      | {
          decorations?: (value: {
            decorations: DecorationSet;
          }) => DecorationSet;
        }
      | undefined;
    define.mockRestore();
    const decorations = Decoration.none;
    expect(spec?.decorations?.({ decorations })).toBe(decorations);
  });

  test("constructs the guide folding plugin value from the registered view plugin", async () => {
    const { plugin } = makePlugin();
    const settings = {
      outerVerticalLines: true,
      verticalLinesAction: "none",
      enhancedVerticalLineHover: true,
      onChange: jest.fn(),
      removeCallback: jest.fn(),
    };
    const parser = {};
    const view = {
      contentDOM: {
        addEventListener: jest.fn(),
        querySelector: jest.fn().mockReturnValue(null),
        querySelectorAll: jest.fn().mockReturnValue([]),
      },
      requestMeasure: jest.fn(),
    };
    const viewPluginApi = ViewPlugin as unknown as {
      define: (...args: unknown[]) => unknown;
    };
    const define = jest.spyOn(viewPluginApi, "define");
    const feature = new VerticalLines(
      plugin as never,
      settings as never,
      parser as never,
    );

    await feature.load();

    const lastCall = define.mock.calls[define.mock.calls.length - 1];
    const createPluginValue = lastCall?.[0] as
      | ((view: unknown) => unknown)
      | undefined;
    createPluginValue?.(view);
    define.mockRestore();
    const guideFoldingFactory = mockGuideFoldingFactory;
    expect(guideFoldingFactory).toHaveBeenCalledWith(settings, parser, view);
  });
});
