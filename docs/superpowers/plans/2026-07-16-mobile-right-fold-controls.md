# Mobile Right Fold Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move each native fold control to the right edge of its foldable list row in mobile Live Preview, behind a default-on setting that users can disable.

**Architecture:** Add one persisted boolean setting and one independent `MobileRightFoldControls` feature that manages a body class through the existing `DocumentBodyClass` helper. Use CSS to reposition Obsidian's native `.collapse-indicator` relative to its `.cm-line`, and use a capture-phase ViewPlugin to restore CodeMirror's bottom scroll reserve before native pointer interaction without replacing the native fold transaction.

**Tech Stack:** TypeScript 5.9, Obsidian API 1.12, Obsidian Live Preview DOM, CSS, Jest 30, Rollup.

## Global Constraints

- The accepted design is `docs/superpowers/specs/2026-07-16-mobile-right-fold-controls-design.md`.
- Use normal `git` on the default branch and push the verified implementation directly to `origin/main`.
- The setting name is `Show fold controls on the right on mobile`.
- The setting description is `Move fold controls to the right edge in Live Preview on mobile.`
- The persisted key is `mobileRightFoldControls`, its type is `boolean`, and its default is `true`.
- Apply the feature only when `Platform.isMobile` is true and the setting is enabled.
- Affect only Live Preview list rows that contain a native `.cm-fold-indicator`.
- Reuse the native `.collapse-indicator`; do not add DOM, decorations, overlays, folding transactions, timers, coordinate measurement, or delayed scroll synchronization.
- Observe `pointerdown` in the capture phase and retain `click` as a fallback, but do not prevent default or stop propagation.
- Before native folding, restore the CodeMirror bottom reserve only when the real DOM value is smaller, then read `scrollDOM.scrollHeight` so the reserve reaches layout before the native handler changes document height.
- Use a 48px-wide right-edge control and reserve the same inline-end width on foldable rows.
- Keep the expanded icon pointing down and override the collapsed icon to point left with `rotate(90deg)`.
- Restore `visibility: visible` and `pointer-events: auto` while the mobile feature is active so vertical-line settings cannot suppress the right-edge control.
- Do not change desktop, Reading view, heading chevrons, native folding semantics, or vertical-guide folding semantics.
- Run source unit tests with `npm run test:unit` or `SKIP_OBSIDIAN=1`.
- Run `npm run build-with-tests` before `.spec.md` integration tests or the full suite.
- Back up `vault/test.md` outside the vault before the full suite, wait for the `vault=vault` renderer to exit before restoring it, and verify the restored hash after a delay.
- Install manual verification artifacts only into `vault/.obsidian/plugins/bullet/`.
- Every Obsidian CLI command must include `vault=vault`.
- Do not change version fields.

---

## File Map

- Modify `src/services/Settings.ts`: persist and notify the new default-on boolean setting.
- Modify `src/services/__tests__/Settings.test.ts`: verify migration default and change notification.
- Modify `src/features/SettingsTab.ts`: expose the user-facing toggle.
- Modify `src/features/__tests__/SettingsTab.test.ts`: verify copy, default state, mutation, and save.
- Modify `src/ObsidianBulletPluginWithTests.ts`: decode the new boolean in the renderer test command bridge.
- Modify `src/__tests__/ObsidianBulletPluginWithTests.test.ts`: reject malformed values for the new bridge key.
- Create `src/features/MobileRightFoldControls.ts`: own the mobile-and-setting body-class lifecycle.
- Create `src/features/FoldScroll.ts`: share the bottom-reserve calculation between guide folding and native mobile chevrons.
- Modify `src/features/GuideFolding.ts`: consume the shared bottom-reserve module.
- Create `src/features/__tests__/MobileRightFoldControls.test.ts`: verify platform gating, settings updates, document lifecycle, unload cleanup, and CSS contracts.
- Modify `src/ObsidianBulletPlugin.ts`: register the new feature.
- Modify `src/__tests__/ObsidianBulletPlugin.test.ts`: lock the feature wiring.
- Modify `styles.css`: reposition and expose the native list fold control.
- Modify `AGENTS.md` only if verification reveals a reusable mobile Live Preview diagnostic or constraint not already recorded.

---

### Task 1: Persist and expose the setting

**Files:**

- Modify: `src/services/Settings.ts`
- Modify: `src/services/__tests__/Settings.test.ts`
- Modify: `src/features/SettingsTab.ts`
- Modify: `src/features/__tests__/SettingsTab.test.ts`
- Modify: `src/ObsidianBulletPluginWithTests.ts`
- Modify: `src/__tests__/ObsidianBulletPluginWithTests.test.ts`

**Interfaces:**

- Produces: `SettingsObject.mobileRightFoldControls: boolean`.
- Produces: `Settings.mobileRightFoldControls` getter and setter.
- Produces: renderer test command `{ k: "mobileRightFoldControls"; v: boolean }`.
- Consumes: existing `Settings.update`, `Settings.onChange`, and `Settings.save` behavior.

- [ ] **Step 1: Write failing Settings tests**

Add a migration test in `src/services/__tests__/Settings.test.ts`:

```ts
test("enables mobile right fold controls when saved data predates the setting", async () => {
  const storage = {
    loadData: jest.fn(async () => ({}) as SettingsObject),
    saveData: jest.fn(async () => undefined),
  };
  const settings = new Settings(storage);

  await settings.load();

  expect(settings.mobileRightFoldControls).toBe(true);
});
```

Add a notification test in the existing `change notifications` describe block:

```ts
test("notifies subscribers when mobile right fold controls change", () => {
  const settings = createSettings();
  const callback = jest.fn<void, [SettingsChange]>();
  settings.onChange(["mobileRightFoldControls"], callback);

  settings.mobileRightFoldControls = false;

  expect(callback).toHaveBeenCalledTimes(1);
  expect(callback.mock.calls[0]?.[0].keys).toEqual(
    new Set(["mobileRightFoldControls"]),
  );
});
```

- [ ] **Step 2: Extend the SettingsTab test with the new toggle contract**

Add `mobileRightFoldControls: true` to the fake settings object in `src/features/__tests__/SettingsTab.test.ts`.

After `tab.display()`, add:

```ts
const mobileFoldControlsSetting = mockSettingsRecords.find(
  (setting) => setting.name === "Show fold controls on the right on mobile",
);

expect(mobileFoldControlsSetting?.desc).toBe(
  "Move fold controls to the right edge in Live Preview on mobile.",
);
expect(mobileFoldControlsSetting?.toggleValue).toBe(true);

await mobileFoldControlsSetting!.toggleCallbacks[0](false);

expect(settings.mobileRightFoldControls).toBe(false);
expect(settings.save).toHaveBeenCalled();
```

- [ ] **Step 3: Lock malformed renderer command validation**

Add this case to the malformed command table in `src/__tests__/ObsidianBulletPluginWithTests.test.ts`:

```ts
["setSetting", { k: "mobileRightFoldControls", v: "true" }],
```

- [ ] **Step 4: Run focused tests and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest \
  src/services/__tests__/Settings.test.ts \
  src/features/__tests__/SettingsTab.test.ts \
  src/__tests__/ObsidianBulletPluginWithTests.test.ts \
  --runInBand
```

Expected: FAIL because `mobileRightFoldControls` does not exist in Settings, the Settings tab, or the command decoder.

- [ ] **Step 5: Implement the Settings model**

Add the key to `SettingsObject` and `DEFAULT_SETTINGS` in `src/services/Settings.ts`:

```ts
export interface SettingsObject {
  styleLists: boolean;
  debug: boolean;
  stickCursor: KeepCursorWithinContent | boolean;
  betterEnter: boolean;
  betterVimO: boolean;
  betterTab: boolean;
  selectAll: boolean;
  listLines: boolean;
  outerListLines: boolean;
  listLineAction: VerticalLinesAction;
  mobileRightFoldControls: boolean;
  dnd: boolean;
}
```

```ts
const DEFAULT_SETTINGS: SettingsObject = {
  styleLists: true,
  debug: false,
  stickCursor: "bullet-and-checkbox",
  betterEnter: true,
  betterVimO: true,
  betterTab: true,
  selectAll: true,
  listLines: true,
  outerListLines: true,
  listLineAction: "toggle-folding",
  mobileRightFoldControls: true,
  dnd: true,
};
```

Add the accessor beside the vertical-line accessors:

```ts
get mobileRightFoldControls() {
  return this.values.mobileRightFoldControls;
}

set mobileRightFoldControls(value: boolean) {
  this.update({ mobileRightFoldControls: value });
}
```

- [ ] **Step 6: Implement the Settings tab toggle**

Add this setting after `Fold lists from vertical indentation lines` and before `Drag-and-Drop` in `src/features/SettingsTab.ts`:

```ts
new Setting(containerEl)
  .setName("Show fold controls on the right on mobile")
  .setDesc("Move fold controls to the right edge in Live Preview on mobile.")
  .addToggle((toggle) => {
    toggle
      .setValue(this.settings.mobileRightFoldControls)
      .onChange(async (value) => {
        this.settings.mobileRightFoldControls = value;
        await this.settings.save();
      });
  });
```

- [ ] **Step 7: Extend the renderer test setting decoder**

Add this entry to `settingCommandDecoders` in `src/ObsidianBulletPluginWithTests.ts`:

```ts
mobileRightFoldControls: (value) => ({
  k: "mobileRightFoldControls",
  v: decodeBooleanSetting("mobileRightFoldControls", value),
}),
```

- [ ] **Step 8: Run focused tests and type checking**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest \
  src/services/__tests__/Settings.test.ts \
  src/features/__tests__/SettingsTab.test.ts \
  src/__tests__/ObsidianBulletPluginWithTests.test.ts \
  --runInBand
npx tsc --noEmit
```

Expected: all tests PASS and TypeScript exits 0.

- [ ] **Step 9: Commit the setting**

```bash
git add \
  src/services/Settings.ts \
  src/services/__tests__/Settings.test.ts \
  src/features/SettingsTab.ts \
  src/features/__tests__/SettingsTab.test.ts \
  src/ObsidianBulletPluginWithTests.ts \
  src/__tests__/ObsidianBulletPluginWithTests.test.ts
git commit -m "feat(settings): add mobile fold control option" -m "Why:
- Mobile users need a configurable right-edge folding affordance.
- Existing saved settings must enable the new behavior without migration work.

What:
- Add a default-on mobileRightFoldControls setting.
- Expose it in the settings tab and change notification system.
- Extend the renderer test command decoder for the new boolean key."
```

Expected: commit succeeds and the worktree is clean.

---

### Task 2: Manage the mobile body class

**Files:**

- Create: `src/features/MobileRightFoldControls.ts`
- Create: `src/features/__tests__/MobileRightFoldControls.test.ts`
- Modify: `src/ObsidianBulletPlugin.ts`
- Modify: `src/__tests__/ObsidianBulletPlugin.test.ts`

**Interfaces:**

- Consumes: `Settings.mobileRightFoldControls`.
- Consumes: `Settings.onChange(["mobileRightFoldControls"], callback)`.
- Consumes: `Platform.isMobile`.
- Consumes: `DocumentBodyClass`.
- Produces: `bullet-plugin-mobile-right-fold-controls` on managed document bodies only when mobile and enabled.

- [ ] **Step 1: Write the failing Feature lifecycle tests**

Create `src/features/__tests__/MobileRightFoldControls.test.ts` with the following setup and tests:

```ts
import { Platform } from "obsidian";

import { MobileRightFoldControls } from "../MobileRightFoldControls";

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
});
```

- [ ] **Step 2: Lock the plugin wiring**

Add this assertion to `src/__tests__/ObsidianBulletPlugin.test.ts`:

```ts
test("loads mobile right fold controls as an independent feature", () => {
  const source = readFileSync(
    join(__dirname, "../ObsidianBulletPlugin.ts"),
    "utf-8",
  );

  expect(source).toContain("new MobileRightFoldControls(this, this.settings)");
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest \
  src/features/__tests__/MobileRightFoldControls.test.ts \
  src/__tests__/ObsidianBulletPlugin.test.ts \
  --runInBand
```

Expected: FAIL because the Feature module and plugin registration do not exist.

- [ ] **Step 4: Implement `MobileRightFoldControls`**

Create `src/features/MobileRightFoldControls.ts`:

```ts
import { Platform, Plugin } from "obsidian";

import { DocumentBodyClass } from "./DocumentBodyClass";
import { Feature } from "./Feature";

import { Settings } from "../services/Settings";

const MOBILE_RIGHT_FOLD_CONTROLS_BODY_CLASS =
  "bullet-plugin-mobile-right-fold-controls";

export class MobileRightFoldControls implements Feature {
  private bodyClass: DocumentBodyClass;

  constructor(
    private plugin: Plugin,
    private settings: Settings,
  ) {
    this.bodyClass = new DocumentBodyClass(
      this.plugin,
      MOBILE_RIGHT_FOLD_CONTROLS_BODY_CLASS,
      this.shouldApplyBodyClass,
    );
  }

  async load() {
    this.settings.onChange(["mobileRightFoldControls"], this.updateBodyClass);
    this.bodyClass.load();
  }

  async unload() {
    this.settings.removeCallback(this.updateBodyClass);
    this.bodyClass.unload();
  }

  private updateBodyClass = () => {
    this.bodyClass.update();
  };

  private shouldApplyBodyClass = () => {
    return Platform.isMobile && this.settings.mobileRightFoldControls;
  };
}
```

- [ ] **Step 5: Register the Feature**

Import `MobileRightFoldControls` in `src/ObsidianBulletPlugin.ts`:

```ts
import { MobileRightFoldControls } from "./features/MobileRightFoldControls";
```

Instantiate it after `BetterListsStyles` and before `VerticalLines`:

```ts
new MobileRightFoldControls(this, this.settings),
```

- [ ] **Step 6: Run focused tests and type checking**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest \
  src/features/__tests__/MobileRightFoldControls.test.ts \
  src/__tests__/ObsidianBulletPlugin.test.ts \
  --runInBand
npx tsc --noEmit
```

Expected: all tests PASS and TypeScript exits 0.

- [ ] **Step 7: Commit the Feature lifecycle**

```bash
git add \
  src/features/MobileRightFoldControls.ts \
  src/features/__tests__/MobileRightFoldControls.test.ts \
  src/ObsidianBulletPlugin.ts \
  src/__tests__/ObsidianBulletPlugin.test.ts
git commit -m "feat(mobile): manage right-edge fold controls" -m "Why:
- The mobile fold affordance must remain independent from vertical-guide settings.
- Body-class lifecycle and platform gating need one focused owner.

What:
- Add a MobileRightFoldControls feature backed by DocumentBodyClass.
- Apply it only on mobile while the setting is enabled.
- Register the feature and cover document, setting, desktop, and unload behavior."
```

Expected: commit succeeds and the worktree is clean.

---

### Task 3: Reposition the native fold control

**Files:**

- Modify: `src/features/__tests__/MobileRightFoldControls.test.ts`
- Modify: `styles.css`

**Interfaces:**

- Consumes: `bullet-plugin-mobile-right-fold-controls`.
- Consumes: native `.HyperMD-list-line`, `.cm-fold-indicator`, `.collapse-indicator`, and `svg.svg-icon`.
- Produces: a 48px right-edge native fold control with a left-pointing collapsed state.

- [ ] **Step 1: Add the failing CSS contract test**

Add these imports to `src/features/__tests__/MobileRightFoldControls.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
```

Add this test:

```ts
test("moves native list fold controls to the right edge", () => {
  const styles = readFileSync(join(__dirname, "../../../styles.css"), "utf8");
  const rowDeclarations = styles.match(
    /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\s+\.HyperMD-list-line:has\(\.cm-fold-indicator\)\s*\{([^}]*)\}/,
  )?.[1];
  const parentDeclarations = styles.match(
    /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\s+\.HyperMD-list-line\s+\.cm-fold-indicator\s*\{([^}]*)\}/,
  )?.[1];
  const controlDeclarations = styles.match(
    /\.bullet-plugin-mobile-right-fold-controls\s+\.markdown-source-view\.mod-cm6\s+\.HyperMD-list-line\s+\.cm-fold-indicator\s+\.collapse-indicator\s*\{([^}]*)\}/,
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
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest \
  src/features/__tests__/MobileRightFoldControls.test.ts \
  --runInBand
```

Expected: FAIL because the mobile right-edge CSS rules are absent.

- [ ] **Step 3: Add the scoped CSS**

Add the following rules after the existing list-chevron suppression rule and before the persistent-guide rules in `styles.css`:

```css
.bullet-plugin-mobile-right-fold-controls
  .markdown-source-view.mod-cm6
  .HyperMD-list-line:has(.cm-fold-indicator) {
  box-sizing: border-box;
  padding-inline-end: 48px;
}

.bullet-plugin-mobile-right-fold-controls
  .markdown-source-view.mod-cm6
  .HyperMD-list-line
  .cm-fold-indicator {
  position: static;
}

.bullet-plugin-mobile-right-fold-controls
  .markdown-source-view.mod-cm6
  .HyperMD-list-line
  .cm-fold-indicator
  .collapse-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  top: 0;
  inset-inline-end: 0;
  width: 48px;
  height: 100%;
  padding-inline-end: 0;
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  z-index: 2;
}

.bullet-plugin-mobile-right-fold-controls
  .markdown-source-view.mod-cm6
  .HyperMD-list-line
  .cm-fold-indicator.is-collapsed
  .collapse-indicator
  svg.svg-icon {
  transform: rotate(90deg);
}
```

- [ ] **Step 4: Run focused static verification**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest \
  src/features/__tests__/MobileRightFoldControls.test.ts \
  src/features/__tests__/GuideFolding.test.ts \
  --runInBand
npx prettier --check styles.css src/features/__tests__/MobileRightFoldControls.test.ts
npm run lint
npx tsc --noEmit
```

Expected: every command exits 0.

- [ ] **Step 5: Commit the native control positioning**

```bash
git add styles.css src/features/__tests__/MobileRightFoldControls.test.ts
git commit -m "feat(mobile): move fold controls to the right edge" -m "Why:
- Deep indentation makes the native left-side fold target difficult to reach on mobile.
- Reusing the native control preserves Obsidian's folding behavior and state.

What:
- Position native Live Preview list controls at the right edge.
- Reserve 48px for text wrapping and expose the control over vertical-line suppression.
- Point collapsed controls left and add CSS contract coverage."
```

Expected: commit succeeds and the worktree is clean.

---

### Task 4: Preserve vertical position during native folding

**Files:**

- Create: `src/features/FoldScroll.ts`
- Modify: `src/features/GuideFolding.ts`
- Modify: `src/features/MobileRightFoldControls.ts`
- Modify: `src/features/__tests__/MobileRightFoldControls.test.ts`

**Interfaces:**

- Produces: `ensureFoldScrollReserve(view: EditorView): void`.
- Consumes: `bullet-plugin-mobile-right-fold-controls` as the interaction enablement marker.
- Preserves: Obsidian's native fold and unfold transaction.

- [ ] **Step 1: Write the failing native interaction test**

Instantiate `MobileRightFoldControlsPluginValue` with a fake `EditorView` whose `contentDOM.style.paddingBottom` is `100px`, `scrollDOM.clientHeight` is `1163`, `defaultLineHeight` is `24`, and `documentPadding.top` is `0`.

Dispatch the captured `pointerdown` listener from a target whose `closest()` resolves the native list control selector.

Assert:

```ts
expect(contentDOM.style.paddingBottom).toBe("1138.5px");
expect(readScrollHeight).toHaveBeenCalledTimes(1);
expect(preventDefault).not.toHaveBeenCalled();
expect(stopPropagation).not.toHaveBeenCalled();
```

Also verify that an absent mobile body class or a non-list target leaves `100px` unchanged, and `destroy()` removes the `pointerdown` and `click` capture listeners.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest \
  src/features/__tests__/MobileRightFoldControls.test.ts \
  --runInBand
```

Expected: FAIL because the ViewPlugin interaction and shared scroll-reserve module do not exist.

- [ ] **Step 3: Extract the shared reserve module**

Create `src/features/FoldScroll.ts`:

```ts
import { EditorView } from "@codemirror/view";

export function ensureFoldScrollReserve(view: EditorView): void {
  const expected =
    view.scrollDOM.clientHeight -
    view.defaultLineHeight -
    view.documentPadding.top -
    0.5;
  const current = Number.parseFloat(view.contentDOM.style.paddingBottom);
  if (
    Number.isFinite(expected) &&
    expected >= 0 &&
    (!Number.isFinite(current) || current < expected)
  ) {
    view.contentDOM.style.paddingBottom = `${expected}px`;
  }
}
```

Import and call this function from `GuideFolding` instead of retaining a private duplicate.

- [ ] **Step 4: Prepare the native click without consuming it**

In `MobileRightFoldControlsPluginValue`, register capture listeners for `pointerdown` and `click`.

When the feature body class is present and the event target resolves:

```ts
".HyperMD-list-line .cm-fold-indicator .collapse-indicator";
```

call:

```ts
ensureFoldScrollReserve(this.view);
void this.view.scrollDOM.scrollHeight;
```

Do not call `preventDefault()` or `stopPropagation()`.

- [ ] **Step 5: Run focused verification**

Run:

```bash
SKIP_OBSIDIAN=1 npx jest \
  src/features/__tests__/MobileRightFoldControls.test.ts \
  src/features/__tests__/GuideFolding.test.ts \
  src/features/__tests__/VerticalLines.test.ts \
  --runInBand
npm run lint
npx tsc --noEmit
```

Expected: every command exits 0.

- [ ] **Step 6: Verify the original end-of-document reproduction**

In `vault=vault`, use a note with 80 rows before a foldable parent and 80 child rows at the document end.

Set `contentDOM.style.paddingBottom` to `100px`, place the parent near the viewport top, and dispatch:

```text
pointerdown → pointerup → click
```

For fold and unfold, assert both:

```text
deltaTop = 0
deltaScroll = 0
```

- [ ] **Step 7: Commit the scroll stability fix**

```bash
git add \
  AGENTS.md \
  docs/superpowers/specs/2026-07-16-mobile-right-fold-controls-design.md \
  docs/superpowers/plans/2026-07-16-mobile-right-fold-controls.md \
  src/features/FoldScroll.ts \
  src/features/GuideFolding.ts \
  src/features/MobileRightFoldControls.ts \
  src/features/__tests__/MobileRightFoldControls.test.ts
git commit -m "fix(mobile): stabilize native fold scrolling" -m "Why:
- Obsidian replaces CodeMirror's bottom reserve with 100px after opening an editor.
- Native folding near the document end then clamps or bottom-anchors scroll position.

What:
- Share the fold scroll reserve calculation with guide folding.
- Restore and commit the reserve on native pointerdown without replacing the native transaction.
- Cover event scope, cleanup, and the end-of-document fold and unfold regression."
```

Expected: commit succeeds and the worktree is clean.

---

### Task 5: Verify the complete behavior and push

**Files:**

- Modify: `AGENTS.md` only if the verification work discovers a durable mobile Live Preview rule.
- Verify: all changed source, tests, CSS, design, and plan files.

**Interfaces:**

- Consumes: all outputs from Tasks 1 through 3.
- Produces: a verified `main` branch pushed to `origin/main`.

- [ ] **Step 1: Run the complete source verification**

Run:

```bash
npm run test:unit -- --runInBand
npm run lint
npx prettier --check styles.css docs/superpowers/specs/2026-07-16-mobile-right-fold-controls-design.md docs/superpowers/plans/2026-07-16-mobile-right-fold-controls.md
npx tsc --noEmit
npm run build-with-tests
```

Expected: every command exits 0 and `dist/main.js` contains the test build.

- [ ] **Step 2: Back up the full-test fixture**

Run:

```bash
backup_dir=$(mktemp -d /tmp/obsidian-bullet-mobile-fold-controls.XXXXXX)
cp vault/test.md "$backup_dir/test.md"
shasum -a 256 "$backup_dir/test.md"
```

Record the backup directory and hash in the terminal output.

- [ ] **Step 3: Run the full suite and production build**

Run:

```bash
npm test -- --runInBand
npm run build
```

Expected: the full Jest suite and production Rollup build exit 0.

- [ ] **Step 4: Restore the fixture safely**

First confirm that no renderer process for `vault=vault` remains.

Then run:

```bash
cp "$backup_dir/test.md" vault/test.md
sleep 2
shasum -a 256 "$backup_dir/test.md" vault/test.md
```

Expected: both hashes match after the delay.

- [ ] **Step 5: Install the production artifacts into the test vault**

Run:

```bash
mkdir -p vault/.obsidian/plugins/bullet
cp dist/main.js manifest.json styles.css vault/.obsidian/plugins/bullet/
obsidian-cli vault=vault open path=test.md
obsidian-cli vault=vault reload
obsidian-cli vault=vault eval code='JSON.stringify({title:document.title, plugin:app.plugins.enabledPlugins.has("bullet")})'
```

Expected: the title contains `vault`, does not contain `base`, and `plugin` is `true`.

- [ ] **Step 6: Verify right-edge native behavior in Live Preview**

Because the desktop runtime correctly fails `Platform.isMobile`, simulate only the mobile body class for CSS verification:

```bash
obsidian-cli vault=vault eval code='document.body.classList.add("bullet-plugin-mobile-right-fold-controls"); JSON.stringify({title:document.title, added:document.body.classList.contains("bullet-plugin-mobile-right-fold-controls")})'
```

Inspect the first foldable list row:

```bash
obsidian-cli vault=vault eval code='(()=>{const parent=document.querySelector(".HyperMD-list-line .cm-fold-indicator");const control=parent?.querySelector(".collapse-indicator");const line=parent?.closest(".HyperMD-list-line");if(!parent||!control||!line)return null;const cr=control.getBoundingClientRect();const lr=line.getBoundingClientRect();const cs=getComputedStyle(control);const ls=getComputedStyle(line);return JSON.stringify({title:document.title,parentPosition:getComputedStyle(parent).position,width:cr.width,rightGap:Math.abs(lr.right-cr.right),height:cr.height,lineHeight:lr.height,paddingInlineEnd:ls.paddingInlineEnd,opacity:cs.opacity,visibility:cs.visibility,pointerEvents:cs.pointerEvents,transform:getComputedStyle(control.querySelector("svg")).transform})})()'
```

Expected:

- title contains `vault` and not `base`;
- `parentPosition` is `static`;
- `width` is approximately 48;
- `rightGap` is approximately 0;
- `height` equals the list row height;
- `paddingInlineEnd` is `48px`;
- `opacity` is `1`;
- `visibility` is `visible`;
- `pointerEvents` is `auto`;
- expanded `transform` is `none` or an identity matrix.

Click the native control and inspect the collapsed state:

```bash
obsidian-cli vault=vault eval code='(async()=>{const control=document.querySelector(".HyperMD-list-line .cm-fold-indicator .collapse-indicator");if(!control)return null;control.click();await new Promise(resolve=>setTimeout(resolve,100));const current=document.querySelector(".HyperMD-list-line .cm-fold-indicator.is-collapsed .collapse-indicator");const result={title:document.title,collapsed:Boolean(current),transform:current?getComputedStyle(current.querySelector("svg")).transform:null,text:current?.closest(".cm-line")?.textContent};current?.click();return JSON.stringify(result)})()'
```

Expected: `collapsed` is `true`, the row text gains Obsidian's fold placeholder, and the transform matrix corresponds to `rotate(90deg)`.

- [ ] **Step 7: Verify vertical-line precedence and setting cleanup**

With the existing `bullet-plugin-vertical-lines-action-toggle-folding` body class present, confirm the mobile class keeps the control visible and interactive:

```bash
obsidian-cli vault=vault eval code='(()=>{const control=document.querySelector(".HyperMD-list-line .cm-fold-indicator .collapse-indicator");const style=control&&getComputedStyle(control);return JSON.stringify({title:document.title,vertical:document.body.classList.contains("bullet-plugin-vertical-lines-action-toggle-folding"),visibility:style?.visibility,pointerEvents:style?.pointerEvents})})()'
```

Expected: `vertical` is `true`, `visibility` is `visible`, and `pointerEvents` is `auto`.

Remove the simulated class:

```bash
obsidian-cli vault=vault eval code='document.body.classList.remove("bullet-plugin-mobile-right-fold-controls"); JSON.stringify({title:document.title,removed:!document.body.classList.contains("bullet-plugin-mobile-right-fold-controls")})'
```

Expected: `removed` is `true`, and existing desktop and vertical-line styling resumes.

- [ ] **Step 8: Review durable instructions and repository state**

Run:

```bash
git status --short --branch
git log -4 --oneline --decorate
git diff HEAD~3 --check
```

If manual verification revealed a reusable rule that future agents need, add only that rule to `AGENTS.md`, rerun relevant checks, and commit it with the implementation.

Expected: no generated `dist/main.js`, vault files, or `.superpowers` artifacts are staged or tracked.

- [ ] **Step 9: Push the verified commits**

Run:

```bash
git push origin main
git status --short --branch
```

Expected: push succeeds and status reports `main...origin/main` with no local changes.
