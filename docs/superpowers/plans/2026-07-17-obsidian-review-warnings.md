# Obsidian Review Warnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every reported Obsidian source warning while preserving Obsidian 1.12.7, mobile, popout-window, persisted-settings, and test-bundle compatibility.

**Architecture:** Add local lint coverage for the current Obsidian review rules, then fix each warning at its source. Keep runtime process access behind a typed optional environment module, keep settings searchable through declarative definitions with a legacy display fallback, and replace APIs newer than the configured ES2015 library with typed equivalents.

**Tech Stack:** TypeScript 5.9, Jest 30, ESLint 10, eslint-plugin-obsidianmd 0.4.1, Obsidian 1.13 type definitions, Rollup 4, GitButler CLI.

## Global Constraints

- Preserve `manifest.json` `minAppVersion: "1.12.7"`.
- Preserve every `SettingsObject` key and serialized value.
- Preserve the imperative `display()` fallback for Obsidian versions before 1.13.0.
- Use the owner document's window for DOM creation and runtime metadata.
- Do not add Node runtime dependencies to the production bundle.
- Keep `console.warn`, `console.error`, and explicitly gated `console.debug`; remove routine load and unload logs.
- Use `but` for every version-control write.
- Work on `codex/obsidian-review-warnings`.
- Do not include the existing mobile-control uncommitted changes in this branch.

---

### Task 1: Reproduce Obsidian review rules locally

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `eslint.config.mjs`

**Interfaces:**

- Produces: `npm run lint` coverage for `src/**/*.ts` and `jest/*.ts`.
- Produces: local failures for `obsidianmd/no-global-this`, `obsidianmd/prefer-create-el`, `obsidianmd/settings-tab/prefer-setting-definitions`, console logging, unsafe operations, and unnecessary assertions.

- [x] **Step 1: Upgrade the Obsidian ESLint plugin**

Run:

```bash
npm install --save-dev eslint-plugin-obsidianmd@^0.4.1
```

Expected: `package.json` requests `^0.4.1`, and the lockfile resolves 0.4.1.

- [x] **Step 2: Extend the lint contract**

Change the script to:

```json
"lint": "prettier --check src jest/*.ts && eslint src jest/*.ts --max-warnings=0"
```

Add these rules to the typed TypeScript configuration:

```js
"@typescript-eslint/no-unnecessary-type-assertion": "warn",
"obsidianmd/no-global-this": "warn",
"obsidianmd/prefer-create-el": "warn",
"obsidianmd/settings-tab/prefer-setting-definitions": "warn",
"obsidianmd/settings-tab/require-display": "warn",
"no-console": ["warn", { allow: ["warn", "error", "debug"] }],
```

Keep the existing project-aware parser options and unsafe-value rules.

- [x] **Step 3: Run lint and verify RED**

Run:

```bash
npm run lint
```

Expected: FAIL with the reported `globalThis`, console, `createElement`, and missing `getSettingDefinitions()` warnings.

- [x] **Step 4: Commit the lint contract after the production fixes are green**

Do not commit yet.

The dependency and lint configuration belong in the final warning-cleanup commit so the branch never records a knowingly failing lint state.

---

### Task 2: Deepen logging and runtime-environment modules

**Files:**

- Modify: `src/services/Logger.ts`
- Create: `src/services/__tests__/Logger.test.ts`
- Modify: `src/__mocks__.ts`
- Modify: `src/services/__tests__/Parser.test.ts`
- Modify: `src/testPlatform.ts`
- Modify: `src/__tests__/testPlatform.test.ts`
- Modify: `src/ObsidianBulletPluginWithTests.ts`
- Modify: `src/__tests__/ObsidianBulletPluginWithTests.test.ts`
- Modify: `src/features/SystemInfo.ts`
- Create: `src/features/__tests__/SystemInfo.test.ts`
- Modify: `src/ObsidianBulletPlugin.ts`

**Interfaces:**

- Produces: `LogSink = (method: string, ...args: unknown[]) => void`.
- Changes: `new Logger(settings, sink?)`, where the default sink calls `console.debug`.
- Produces: `TestPlatformEnvironment` with optional `TEST_PLATFORM`, `TEST_PLATFORM_WS_PORT`, and `TEST_PLATFORM_WS_TOKEN`.
- Produces: `getTestPlatformEnvironment(win?: Window): TestPlatformEnvironment`.
- Changes: `getTestPlatformWsUrl(environment?: TestPlatformEnvironment): string`.
- Produces: `getRuntimeProcessInfo(win: Window): { arch: string | null; platform: string | null }`.

- [x] **Step 1: Write failing Logger tests**

Add:

```ts
test("does not call the sink when debug is disabled", () => {
  const sink = jest.fn();
  const logger = new Logger({ debug: false } as Settings, sink);

  logger.log("parse", "value");

  expect(sink).not.toHaveBeenCalled();
});

test("forwards debug logs through the injected sink", () => {
  const sink = jest.fn();
  const logger = new Logger({ debug: true } as Settings, sink);

  logger.log("parse", "value");

  expect(sink).toHaveBeenCalledWith("parse", "value");
});
```

- [x] **Step 2: Write failing runtime-environment tests**

Extend `testPlatform.test.ts` so URL generation receives an explicit environment object.

Add a process-less window case:

```ts
expect(getTestPlatformEnvironment({} as Window)).toEqual({});
```

Update the plugin lifecycle fixture window to expose:

```ts
process: { env: process.env },
```

Add System Information helper tests:

```ts
expect(
  getRuntimeProcessInfo({
    process: { arch: "arm64", platform: "darwin" },
  } as unknown as Window),
).toEqual({ arch: "arm64", platform: "darwin" });

expect(getRuntimeProcessInfo({} as Window)).toEqual({
  arch: null,
  platform: null,
});
```

- [x] **Step 3: Run focused tests and verify RED**

Run:

```bash
npm run test:unit -- --runInBand \
  src/services/__tests__/Logger.test.ts \
  src/__tests__/testPlatform.test.ts \
  src/__tests__/ObsidianBulletPluginWithTests.test.ts \
  src/features/__tests__/SystemInfo.test.ts
```

Expected: FAIL because the injectable sink and runtime helpers do not exist.

- [x] **Step 4: Implement the Logger seam**

Use:

```ts
export type LogSink = (method: string, ...args: unknown[]) => void;

const consoleDebugSink: LogSink = (method, ...args) => {
  console.debug(method, ...args);
};

export class Logger {
  constructor(
    private settings: Settings,
    private sink: LogSink = consoleDebugSink,
  ) {}

  log(method: string, ...args: unknown[]) {
    if (this.settings.debug) {
      this.sink(method, ...args);
    }
  }
}
```

Change `makeLogger` to accept an optional `LogSink` and construct a real Logger with debug enabled.

Parser tests pass a Jest mock as the sink instead of casting `Logger.log` to a Jest function.

- [x] **Step 5: Implement the test-platform environment module**

Augment the test window locally:

```ts
type TestPlatformWindow = Window & {
  process?: { env?: TestPlatformEnvironment };
};
```

Read it safely:

```ts
export function getTestPlatformEnvironment(
  win: Window = window,
): TestPlatformEnvironment {
  return (win as TestPlatformWindow).process?.env ?? {};
}
```

Use one environment value in both `onload()` and `prepareSettings()`.

Do not reference the global `process` from production source files.

- [x] **Step 6: Implement safe System Information metadata**

Use the modal's owning window:

```ts
export function getRuntimeProcessInfo(win: Window) {
  const processInfo = (win as Window & {
    process?: { arch?: unknown; platform?: unknown };
  }).process;

  return {
    arch: typeof processInfo?.arch === "string" ? processInfo.arch : null,
    platform:
      typeof processInfo?.platform === "string" ? processInfo.platform : null,
  };
}
```

Call it with `this.contentEl.win`.

- [x] **Step 7: Remove routine plugin lifecycle logs**

Delete the `console.log` calls from `onload()` and `unloadFeatures()`.

Keep existing error logging.

- [x] **Step 8: Run focused tests and verify GREEN**

Run the command from Step 3.

Expected: all focused tests pass.

---

### Task 3: Remove ES2015 type gaps and native DOM creation

**Files:**

- Modify: `src/features/GuideFolding.ts`
- Modify: `src/features/__tests__/GuideFolding.test.ts`
- Modify: `src/features/DragAndDrop.ts`
- Modify: `src/features/__tests__/DragAndDrop.test.ts`
- Modify: `src/services/Parser.ts`
- Modify: `src/operations/RecoverCursorAfterFoldedNavigation.ts`

**Interfaces:**

- No new external interface.
- Preserves guide decoration order, folding transaction order, drag-zone structure, and parser fold-root semantics.

- [x] **Step 1: Update DOM ownership tests first**

Change GuideFolding's document mock from `ownerDocument.createElement` to:

```ts
ownerDocument: {
  win: {
    createSpan: jest.fn(() => element),
  },
},
```

Change DragAndDrop's document mock from `createElement` to:

```ts
win: {
  createDiv: jest.fn(() => makeElement()),
},
```

Assert that two divs are created for the drag zone and one span is created for each outer guide widget.

- [x] **Step 2: Run DOM-focused tests and verify RED**

Run:

```bash
npm run test:unit -- --runInBand \
  src/features/__tests__/GuideFolding.test.ts \
  src/features/__tests__/DragAndDrop.test.ts
```

Expected: FAIL because production still calls native `createElement`.

- [x] **Step 3: Replace native DOM creation**

Use:

```ts
const element = view.dom.ownerDocument.win.createSpan();
const dropZonePadding = doc.win.createDiv();
const dropZone = doc.win.createDiv();
```

Keep all existing classes, data attributes, styles, and append order.

- [x] **Step 4: Replace `flatMap` without changing order**

Build decoration ranges with nested loops:

```ts
const ranges = [];
for (const chunk of chunks) {
  for (let line = chunk.startLine; line <= chunk.endLine; line++) {
    ranges.push(
      Decoration.widget({
        widget: new OuterListGuideWidget(chunk),
        side: -1,
      }).range(doc.line(line + 1).from),
    );
  }
}
```

Build resolved fold targets with a typed array and `push`.

- [x] **Step 5: Replace `NodeList.forEach`**

Use:

```ts
for (const element of Array.from(contentDOM.querySelectorAll(selector))) {
  // existing class mutation
}
```

Change every `querySelectorAll(...).forEach` in GuideFolding.

Set iteration can remain unchanged because it is part of ES2015.

- [x] **Step 6: Replace array `includes`**

Use:

```ts
foldedLines.indexOf(l) !== -1
previousFoldedLines.indexOf(previousCursor.line) === -1
```

Preserve the existing booleans and branches.

- [x] **Step 7: Run focused tests and lint**

Run:

```bash
npm run test:unit -- --runInBand \
  src/features/__tests__/GuideFolding.test.ts \
  src/features/__tests__/DragAndDrop.test.ts \
  src/services/__tests__/Parser.test.ts \
  src/operations/__tests__/RecoverCursorAfterFoldedNavigation.test.ts

npx eslint \
  src/features/GuideFolding.ts \
  src/features/DragAndDrop.ts \
  src/services/Parser.ts \
  src/operations/RecoverCursorAfterFoldedNavigation.ts \
  --max-warnings=0
```

Expected: focused tests pass, and no unsafe or `prefer-create-el` warning remains in these files.

---

### Task 4: Add searchable settings with a legacy fallback

**Files:**

- Modify: `src/features/SettingsTab.ts`
- Modify: `src/features/__tests__/SettingsTab.test.ts`
- Modify: `src/services/Settings.ts`
- Modify: `src/services/__tests__/Settings.test.ts`

**Interfaces:**

- Produces: `SettingsControlKey`, a literal union of the public setting properties shown in the UI.
- Produces: `getSettingDefinitions(): SettingDefinitionItem<SettingsControlKey>[]`.
- Produces: `getControlValue(key: string): unknown`.
- Produces: `setControlValue(key: string, value: unknown): Promise<void>`.
- Retains: `display(): void` for Obsidian before 1.13.0.

- [x] **Step 1: Rewrite the settings-tab test contract**

Extend the Obsidian mock's `PluginSettingTab` with callable `getSettingDefinitions`, `getControlValue`, and `setControlValue` surfaces.

After registration, assert:

```ts
const definitions = tab.getSettingDefinitions();
expect(definitions.map((definition) => definition.name)).toEqual([
  "Stick the cursor to the content",
  "Enhance the Tab key",
  "Enhance the Enter key",
  "Vim-mode o/O inserts bullets",
  "Enhance the Ctrl+A or Cmd+A behavior",
  "Improve the style of your lists",
  "Draw vertical indentation lines",
  "Draw outer list lines",
  "Fold lists from vertical indentation lines",
  "Show fold controls on the right on mobile",
  "Drag-and-Drop",
  "Debug mode",
]);
```

Assert the dropdown options and every toggle key.

Assert `getControlValue("verticalLinesActionEnabled")` returns a boolean.

Assert `setControlValue` updates the matching Settings property, converts the vertical-line action boolean, and awaits `settings.save()`.

Keep the existing `display()` test to cover Obsidian 1.12.7.

- [x] **Step 2: Add a failing generic setValue test**

Add:

```ts
test("setValue updates and notifies one generic key", () => {
  const settings = createSettings();
  const callback = jest.fn();
  settings.onChange(["debug"], callback);

  settings.setValue("debug", true);

  expect(settings.debug).toBe(true);
  expect(callback).toHaveBeenCalledTimes(1);
});
```

- [x] **Step 3: Run settings tests and verify RED**

Run:

```bash
npm run test:unit -- --runInBand \
  src/features/__tests__/SettingsTab.test.ts \
  src/services/__tests__/Settings.test.ts
```

Expected: FAIL because declarative definitions and control storage overrides do not exist.

- [x] **Step 4: Define typed control metadata**

Use a typed constant for cursor options:

```ts
const KEEP_CURSOR_OPTIONS = {
  never: "Never",
  "bullet-only": "Stick cursor out of bullets",
  "bullet-and-checkbox": "Stick cursor out of bullets and checkboxes",
} satisfies Record<KeepCursorWithinContent, string>;
```

Return declarative dropdown and toggle controls in the existing visual order.

- [x] **Step 5: Implement safe custom storage**

Use exhaustive `switch` statements in `getControlValue` and `setControlValue`.

Validate values:

```ts
function expectBooleanControlValue(key: string, value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`Expected boolean setting value for ${key}`);
  }
  return value;
}
```

Validate `KeepCursorWithinContent` by checking membership in `KEEP_CURSOR_OPTIONS`.

Save exactly once after a successful mutation.

- [x] **Step 6: Keep the legacy display fallback**

Keep `display()` and reuse `KEEP_CURSOR_OPTIONS` instead of an assertion.

Do not raise `minAppVersion`.

- [x] **Step 7: Remove the generic patch assertion**

Implement `setValue` as a direct single-key update:

```ts
setValue<T extends SettingsKey>(key: T, value: SettingsObject[T]): void {
  const changed = new Set<SettingsKey>();
  this.assign(key, value, changed);
  if (changed.size > 0) {
    this.notify(changed);
  }
}
```

- [x] **Step 8: Run settings tests and verify GREEN**

Run the command from Step 3.

Expected: all settings tests pass.

---

### Task 5: Clean the remaining test-contract warnings

**Files:**

- Modify: `jest/test-globals.type-test.ts`
- Modify: `src/ObsidianBulletPluginWithTests.ts`

**Interfaces:**

- No runtime interface change.
- Preserves compile-only verification that every semantic driver global is callable.
- Preserves both string and string-array `parseState` overloads.

- [x] **Step 1: Change the compile-only global type**

Replace:

```ts
keyof typeof globalThis
(typeof globalThis)[K]
```

with:

```ts
keyof typeof window
(typeof window)[K]
```

- [x] **Step 2: Normalize parseState input without reassignment**

Use:

```ts
const lines = typeof content === "string" ? content.split("\n") : content;
const acc = lines.reduce(/* existing reducer */);
```

Keep the overloads and returned State unchanged.

- [x] **Step 3: Run type and focused lint checks**

Run:

```bash
npx tsc --noEmit --pretty false
npx eslint \
  jest/test-globals.type-test.ts \
  src/ObsidianBulletPluginWithTests.ts \
  src/__mocks__.ts \
  src/features/SystemInfo.ts \
  src/testPlatform.ts \
  --max-warnings=0
```

Expected: zero errors and zero warnings.

---

### Task 6: Full verification and GitButler commit

**Files:**

- Modify only if durable instructions are missing: `AGENTS.md`
- Modify: `docs/superpowers/plans/2026-07-17-obsidian-review-warnings.md`

**Interfaces:**

- No new interface.

- [x] **Step 1: Run formatting and lint**

Run:

```bash
npm run lint
```

Expected: zero warnings because `--max-warnings=0` is active.

- [x] **Step 2: Run TypeScript**

Run:

```bash
npx tsc --noEmit --pretty false
```

Expected: exit zero.

- [x] **Step 3: Run unit tests**

Run:

```bash
npm run test:unit -- --runInBand
```

Expected: all unit suites pass.

- [x] **Step 4: Build production and test bundles**

Run:

```bash
npm run build
npm run build-with-tests
```

Expected: both Rollup builds exit zero.

- [x] **Step 5: Protect the full-test fixture**

Copy `vault/test.md` outside the vault and record its SHA-256 hash.

Run:

```bash
npm test -- --runInBand
```

Expected: the full suite passes.

Wait until the `vault=vault` renderer exits, restore the fixture, wait for delayed saves, and verify the restored hash again.

- [x] **Step 6: Review the final diff**

Confirm:

- no existing mobile-control file is assigned to this branch;
- no `globalThis` remains in the reported type test;
- no routine `console.log` or `console.info` remains;
- no reported native `createElement` remains;
- no `flatMap` or array `includes` remains in the reported production paths;
- SettingsTab implements both `getSettingDefinitions()` and `display()`;
- no unsafe-rule suppression comment was added.

- [x] **Step 7: Update this plan with execution evidence**

Record exact test counts, build results, fixture hash restoration, and any AGENTS.md improvement.

Execution evidence:

- `npm run lint`: passed with zero warnings.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run test:unit -- --runInBand`: 47 suites and 438 tests passed.
- `npm run build`: production bundle built successfully.
- `npm run build-with-tests`: test bundle built successfully.
- `npm test -- --runInBand`: 66 suites passed; 553 tests passed and 14 were skipped.
- `vault/test.md`: restored after the renderer exited; SHA-256 matched the pre-test backup at `3b41a8cfcfc20a345fa3b2d33a909f1fb00bdd00d2302223bedefc0ed9c96f0b`, with both files at 4588 bytes.
- Review: no Critical or Important findings; aligned `lint:fix` with the expanded lint scope.
- `AGENTS.md`: documented `getObsidianDomWindow(doc)` as the single adapter for owner-window DOM helpers missing from the current Obsidian `Window` type.

- [x] **Step 8: Commit all selected changes**

Use `but diff` to obtain only this task's file and hunk IDs.

Commit with:

```text
fix(review): resolve Obsidian source warnings

Why:
Obsidian's current review rules found compatibility and type-safety gaps that the local lint configuration did not reproduce.

What:
Adopt searchable dual-version settings, safe runtime adapters, Obsidian DOM helpers, ES2015-compatible collection logic, and matching lint coverage.
```

- [x] **Step 9: Inspect the returned GitButler workspace state**

Expected: `codex/obsidian-review-warnings` owns only this plan, its design, and the warning-cleanup changes.
