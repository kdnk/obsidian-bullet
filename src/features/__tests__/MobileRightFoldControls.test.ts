import { Platform } from "obsidian";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MobileRightFoldControls } from "../MobileRightFoldControls";

jest.mock("obsidian", () => ({ Platform: { isMobile: true } }), {
  virtual: true,
});

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

    expect(plugin.registerEditorExtension).not.toHaveBeenCalled();
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

test("keeps desktop guide-hover hit targeting out of mobile controls", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
  const guideHoverRules = parseCssRules(styles).filter(
    ({ selector }) =>
      selector.includes(
        ".bullet-plugin-vertical-lines-action-toggle-folding",
      ) &&
      selector.includes(
        ".cm-line.HyperMD-list-line:has(.cm-fold-indicator):hover",
      ),
  );

  expect(guideHoverRules).toHaveLength(3);
  expect(
    guideHoverRules.every(({ selector }) =>
      selector.startsWith(
        "body:not(.is-mobile).bullet-plugin-vertical-lines-action-toggle-folding ",
      ),
    ),
  ).toBe(true);
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
