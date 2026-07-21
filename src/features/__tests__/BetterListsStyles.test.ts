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
      onChange: jest.fn((keys: unknown, callback?: () => void) => {
        settingsCallbacks.push(callback ?? (keys as () => void));
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

    expect(settings.onChange).toHaveBeenCalledWith(
      ["styleLists"],
      expect.any(Function),
    );
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

  test("renders the default-theme bullet as a seven-pixel circle", () => {
    const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
    const declarations = styles.match(
      /\.bullet-plugin-better-lists\s+\.list-bullet::after\s*\{([^}]*)\}/,
    )?.[1];
    const collapsedDeclarations = styles.match(
      /body\.bullet-plugin-better-lists\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-list-line\s+\.is-collapsed\s*~\s*\.cm-formatting-list\s+\.list-bullet::after\s*\{([^}]*)\}/,
    )?.[1];
    const normalized = declarations?.replace(/\s+/g, " ").trim();

    expect(normalized).toBe(
      "position: absolute; z-index: 1; width: 7px; height: 7px; border-radius: 50%; background-color: var(--text-muted); transition: none;",
    );
    expect(collapsedDeclarations?.replace(/\s+/g, " ").trim()).toBe(
      "background-color: var(--text-muted); box-shadow: none; transition: none;",
    );
  });

  test("adds an immediate eighteen-pixel halo only to foldable desktop bullets", () => {
    const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
    const bullet = styles.match(
      /\.bullet-plugin-better-lists\s+\.list-bullet\s*\{([^}]*)\}/,
    )?.[1];
    const halo = styles.match(
      /body:not\(\.is-mobile\)\.bullet-plugin-better-lists\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-list-line:has\(\.cm-fold-indicator\)\s+\.list-bullet:hover::before\s*\{([^}]*)\}/,
    )?.[1];
    const normalizedHalo = halo?.replace(/\s+/g, " ").trim();

    expect(bullet?.replace(/\s+/g, " ").trim()).toBe("position: relative;");
    expect(normalizedHalo).toBe(
      'content: ""; position: absolute; inset-block-start: calc(50% - 9px); inset-inline-start: calc(50% - 9px); width: 18px; height: 18px; border-radius: 50%; background-color: color-mix(in srgb, var(--text-muted) 38%, transparent); pointer-events: none;',
    );
    expect(normalizedHalo).not.toMatch(
      /\b(?:transition|animation|opacity)\s*:/,
    );
    expect(styles).not.toMatch(
      /\.bullet-plugin-better-lists\s+\.markdown-preview-view[^{}]*\.list-bullet:hover::before/,
    );
    expect(styles).not.toMatch(
      /body\.is-mobile\.bullet-plugin-better-lists[^{}]*\.list-bullet:hover::before/,
    );
  });
});
