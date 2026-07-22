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
      app: {
        workspace,
        vault: { config: { cssTheme: "" } },
      },
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
    const feature = new BetterListsStyles(plugin as never, settings as never);

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
    expect(workspace.on).not.toHaveBeenCalledWith(
      "css-change",
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

  test("applies list styling with a custom theme", async () => {
    const mainDocument = makeDocument();
    Object.defineProperty(global, "activeDocument", {
      configurable: true,
      value: mainDocument,
    });

    const { plugin } = makePlugin();
    plugin.app.vault.config.cssTheme = "Minimal";
    const settings = {
      betterListsStyles: true,
      onChange: jest.fn(),
      removeCallback: jest.fn(),
    };
    const feature = new BetterListsStyles(plugin as never, settings as never);

    await feature.load();

    expect(
      mainDocument.body.classList.contains("bullet-plugin-better-lists"),
    ).toBe(true);

    await feature.unload();
  });

  test("renders a theme-aware bullet as a seven-pixel circle", () => {
    const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
    const declarations = styles.match(
      /\.bullet-plugin-better-lists\s+\.list-bullet::after\s*\{([^}]*)\}/,
    )?.[1];
    const foldableDeclarations = styles.match(
      /body:not\(\.is-mobile\)\.bullet-plugin-better-lists\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-list-line:has\(\.cm-fold-indicator\)\s+\.list-bullet::after\s*\{([^}]*)\}/,
    )?.[1];
    const collapsedDeclarations = styles.match(
      /body:not\(\.is-mobile\)\.bullet-plugin-better-lists\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-list-line\s+\.is-collapsed\s*~\s*\.cm-formatting-list\s+\.list-bullet::after\s*\{([^}]*)\}/,
    )?.[1];
    const normalized = declarations?.replace(/\s+/g, " ").trim();

    expect(normalized).toBe(
      "position: absolute; z-index: 1; width: 7px; height: 7px; border-radius: 50%; background-color: var(--text-muted);",
    );
    expect(foldableDeclarations?.replace(/\s+/g, " ").trim()).toBe(
      "transition: none;",
    );
    expect(collapsedDeclarations?.replace(/\s+/g, " ").trim()).toBe(
      "background-color: var(--text-muted); box-shadow: none; transition: none;",
    );
  });

  test("shares an immediate muted halo between hovered and collapsed desktop bullets", () => {
    const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
    const bullet = styles.match(
      /\.bullet-plugin-better-lists\s+\.list-bullet\s*\{([^}]*)\}/,
    )?.[1];
    const sharedHalo = styles.match(
      /body:not\(\.is-mobile\)\.bullet-plugin-better-lists\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-list-line:has\(\.cm-fold-indicator\)\s+\.list-bullet:hover::before,\s*body:not\(\.is-mobile\)\.bullet-plugin-better-lists\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-list-line\s+\.is-collapsed\s*~\s*\.cm-formatting-list\s+\.list-bullet::before,\s*body:not\(\s*\.is-mobile\s*\)\.bullet-plugin-better-lists\.bullet-plugin-dnd\.bullet-plugin-dragging\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.bullet-plugin-dragging-source-line\s+\.list-bullet::before\s*\{([^}]*)\}/,
    )?.[1];
    const dragSourceSelector = styles.match(
      /(body:not\(\s*\.is-mobile\s*\)\.bullet-plugin-better-lists\.bullet-plugin-dnd\.bullet-plugin-dragging\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.bullet-plugin-dragging-source-line\s+\.list-bullet::before)\s*\{/,
    )?.[1];
    const normalizedHalo = sharedHalo?.replace(/\s+/g, " ").trim();
    const normalizedDragSourceSelector = dragSourceSelector
      ?.replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .trim();

    expect(bullet?.replace(/\s+/g, " ").trim()).toBe("position: relative;");
    expect(normalizedHalo).toBe(
      'content: ""; position: absolute; inset-block-start: calc(50% - 9px); inset-inline-start: calc(50% - 9px); width: 18px; height: 18px; border-radius: 50%; background-color: color-mix(in srgb, var(--text-muted) 38%, transparent); pointer-events: none;',
    );
    expect(normalizedHalo).not.toMatch(
      /\b(?:transition|animation|opacity|outline|box-shadow)\s*:/,
    );
    expect(normalizedDragSourceSelector).toBe(
      "body:not(.is-mobile).bullet-plugin-better-lists.bullet-plugin-dnd.bullet-plugin-dragging .markdown-source-view.mod-cm6.is-live-preview .cm-line.bullet-plugin-dragging-source-line .list-bullet::before",
    );
    expect(styles).not.toMatch(
      /\.bullet-plugin-better-lists\s+\.markdown-preview-view[^{}]*\.list-bullet(?::hover)?::before/,
    );
    expect(styles).not.toMatch(
      /body\.is-mobile\.bullet-plugin-better-lists[^{}]*\.list-bullet(?::hover)?::before/,
    );
    expect(styles).not.toMatch(
      /\.markdown-preview-view[^{}]*\.bullet-plugin-dragging-source-line[^{}]*\.list-bullet::before/,
    );
    expect(styles).not.toMatch(
      /body\.is-mobile[^{}]*\.bullet-plugin-dragging-source-line[^{}]*\.list-bullet::before/,
    );
  });

  test("keeps styled desktop chevrons clear of the halo", () => {
    const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
    const spacingDeclarations = styles.match(
      /body:not\(\.is-mobile\)\.bullet-plugin-better-lists\s+\.markdown-source-view\.mod-cm6\.is-live-preview\s+\.cm-line\.HyperMD-list-line:has\(\.cm-fold-indicator\)\s+\.cm-fold-indicator\s+\.collapse-indicator\s*\{([^}]*)\}/,
    )?.[1];

    expect(spacingDeclarations?.replace(/\s+/g, " ").trim()).toBe(
      "inset-inline-start: -7px;",
    );
    expect(styles).not.toMatch(
      /body\.is-mobile\.bullet-plugin-better-lists[^{}]*\.collapse-indicator\s*\{/,
    );
    expect(styles).not.toMatch(
      /\.bullet-plugin-better-lists[^{}]*\.HyperMD-header[^{}]*\.collapse-indicator\s*\{/,
    );
  });
});
