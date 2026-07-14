import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BetterListsStyles } from "../BetterListsStyles";

function makeClassList() {
  const values = new Set<string>();

  return {
    add: jest.fn((value: string) => {
      values.add(value);
    }),
    remove: jest.fn((value: string) => {
      values.delete(value);
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
  const eventHandlers = new Map<string, (...args: never[]) => void>();
  const workspace = {
    on: jest.fn((eventName: string, handler: (...args: never[]) => void) => {
      eventHandlers.set(eventName, handler);
      return { eventName };
    }),
  };

  return {
    eventHandlers,
    plugin: {
      app: { workspace },
      registerEvent: jest.fn(),
    },
    workspace,
  };
}

describe("BetterListsStyles", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("manages the body class for pop-out windows", async () => {
    const mainDocument = makeDocument();
    const popoutDocument = makeDocument();
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: mainDocument,
    });

    const { eventHandlers, plugin, workspace } = makePlugin();
    const settingsCallbacks: Array<() => void> = [];
    const settings = {
      betterListsStyles: true,
      onChange: jest.fn((callback: () => void) => {
        settingsCallbacks.push(callback);
      }),
      removeCallback: jest.fn(),
    };
    const obsidianSettings = {
      isDefaultThemeEnabled: jest.fn().mockReturnValue(true),
    };

    const feature = new BetterListsStyles(
      plugin as never,
      settings as never,
      obsidianSettings as never,
    );

    await feature.load();

    expect(workspace.on).toHaveBeenCalledWith(
      "window-open",
      expect.any(Function),
    );
    expect(workspace.on).toHaveBeenCalledWith(
      "window-close",
      expect.any(Function),
    );
    expect(
      mainDocument.body.classList.contains("bullet-plugin-better-lists"),
    ).toBe(true);

    eventHandlers.get("window-open")?.(
      {} as never,
      { document: popoutDocument } as never,
    );
    expect(
      popoutDocument.body.classList.contains("bullet-plugin-better-lists"),
    ).toBe(true);

    settings.betterListsStyles = false;
    const settingsCallback = settingsCallbacks[0];
    if (!settingsCallback) {
      throw new Error("Expected settings callback to be registered");
    }
    settingsCallback();

    expect(
      mainDocument.body.classList.contains("bullet-plugin-better-lists"),
    ).toBe(false);
    expect(
      popoutDocument.body.classList.contains("bullet-plugin-better-lists"),
    ).toBe(false);

    eventHandlers.get("window-close")?.(
      {} as never,
      { document: popoutDocument } as never,
    );
    await feature.unload();

    expect(
      mainDocument.body.classList.contains("bullet-plugin-better-lists"),
    ).toBe(false);
    expect(settings.removeCallback).toHaveBeenCalledWith(expect.any(Function));
  });

  test("renders a fallback circle when restored folds expose raw bullet markup", () => {
    const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
    const rawMarker = styles.match(
      /\.bullet-plugin-better-lists\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.HyperMD-list-line:not\(\.HyperMD-task-line\)\s+>\s+\.cm-formatting-list-ul:not\(:has\(\.list-bullet\)\)\s*\{([^}]*)\}/,
    )?.[1];
    const fallbackCircle = styles.match(
      /\.bullet-plugin-better-lists\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.HyperMD-list-line:not\(\.HyperMD-task-line\)\s+>\s+\.cm-formatting-list-ul:not\(:has\(\.list-bullet\)\)::after\s*\{([^}]*)\}/,
    )?.[1];
    const collapsedCircle = styles.match(
      /\.bullet-plugin-better-lists\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.HyperMD-list-line:not\(\.HyperMD-task-line\)\s+\.cm-fold-indicator\.is-collapsed\s+~\s+\.cm-formatting-list-ul:not\(:has\(\.list-bullet\)\)::after\s*\{([^}]*)\}/,
    )?.[1];

    expect(rawMarker).toContain("color: transparent;");
    expect(rawMarker).toContain("position: relative;");
    expect(fallbackCircle).toContain('content: "";');
    expect(fallbackCircle).toContain("position: absolute;");
    expect(fallbackCircle).toContain("inset-inline-start: 0;");
    expect(fallbackCircle).toContain("inset-block-start: 50%;");
    expect(fallbackCircle).toContain("width: 0.4em;");
    expect(fallbackCircle).toContain("height: 0.4em;");
    expect(fallbackCircle).toContain("border-radius: 50%;");
    expect(fallbackCircle).toContain("background-color: var(--text-muted);");
    expect(fallbackCircle).toContain("transform: translateY(-50%);");
    expect(collapsedCircle).toContain(
      "background-color: var(--list-marker-color-collapsed);",
    );
    expect(collapsedCircle).toContain(
      "box-shadow: 0 0 0 4px var(--background-modifier-active-hover);",
    );
  });
});
