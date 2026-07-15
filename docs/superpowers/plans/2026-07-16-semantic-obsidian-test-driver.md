# Semantic Obsidian Test Driver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Consolidate test commands behind a semantic driver and let Markdown integration specs click native vertical guides.

**Architecture:** A Node-side driver owns the Jest globals and delegates to one generic WebSocket transport function. The renderer owns a typed handler registry and a semantic guide resolver that dispatches the full pointer sequence.

**Tech Stack:** TypeScript 5.9, Jest 30, CommonJS Jest environment, Obsidian 1.12.7, CodeMirror 6, WebSocket.

## Global Constraints

- Preserve every existing integration action and saved editor-state syntax.
- Guide clicks dispatch mousedown, mouseup, and click in that order.
- Resolve fresh DOM for each operation and never cache coordinates or element indexes.
- Use the repository vault only for integration tests.
- Build with npm run build-with-tests before running Markdown specs.

---

### Task 1: Node-side semantic driver

**Files:**
- Create: jest/obsidian-driver.js
- Modify: jest/obsidian-environment.js
- Test: src/__tests__/jestTestConfig.test.ts

**Interfaces:**
- Consumes: runCommand(type: string, data: unknown): Promise<unknown>
- Produces: installObsidianDriver(target: object, runCommand: function): void

- [ ] **Step 1: Write the failing driver registration test**

Add a test that loads jest/obsidian-driver.js, installs it into an empty object, and asserts that applyState, clickGuide, parseState, drag, move, and drop are functions.

~~~ts
const { installObsidianDriver } = require("../../jest/obsidian-driver");
const target: Record<string, unknown> = {};
const runCommand = jest.fn();
installObsidianDriver(target, runCommand);
expect(Object.keys(target)).toEqual(
  expect.arrayContaining(["applyState", "clickGuide", "parseState", "drag", "move", "drop"]),
);
~~~

- [ ] **Step 2: Run the focused test and confirm RED**

Run: npx jest src/__tests__/jestTestConfig.test.ts --runInBand

Expected: FAIL because jest/obsidian-driver.js does not exist.

- [ ] **Step 3: Implement the driver**

Create a driver whose method names are the only Node-side command registry.

~~~js
const COMMANDS = [
  "applyState",
  "simulateKeydown",
  "insertText",
  "executeCommandById",
  "setSetting",
  "resetSettings",
  "parseState",
  "getCurrentState",
  "drag",
  "move",
  "drop",
  "waitForIdle",
  "adjustSelection",
  "clickGuide",
];

function installObsidianDriver(target, runCommand) {
  for (const command of COMMANDS) {
    target[command] = (data) => runCommand(command, data);
  }
}

module.exports = { installObsidianDriver };
~~~

Replace the repeated createCommand calls in the Jest environment with one install call bound to runCommand.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: npx jest src/__tests__/jestTestConfig.test.ts --runInBand

Expected: PASS.

- [ ] **Step 5: Commit the Node driver**

Commit: refactor(test): centralize Obsidian driver commands

### Task 2: Typed renderer command registry

**Files:**
- Modify: src/ObsidianBulletPluginWithTests.ts
- Test: src/__tests__/ObsidianBulletPluginWithTests.test.ts

**Interfaces:**
- Consumes: TestMessage with id, type, and data
- Produces: handleTestCommand(type: string, data: unknown): Promise<State | undefined>

- [ ] **Step 1: Add failing tests for registry dispatch**

Test that applyState dispatches once through the registry and that an unknown command rejects with Unknown test command.

~~~ts
const dispatch = (
  plugin as unknown as {
    handleTestCommand(type: string, data: unknown): Promise<State | undefined>;
  }
).handleTestCommand.bind(plugin);
await expect(dispatch("unknown", undefined)).rejects.toThrow(
  "Unknown test command: unknown",
);
~~~

Use this narrow structural type only in the test.

Do not add a test-only production method.

- [ ] **Step 2: Run the focused renderer test and confirm RED**

Run: npx jest src/__tests__/ObsidianBulletPluginWithTests.test.ts --runInBand

Expected: FAIL because the registry dispatcher does not exist.

- [ ] **Step 3: Replace the switch with a handler registry**

Define command data in TestCommandMap and derive TestMessage from it.

~~~ts
interface TestCommandMap {
  applyState: State | string | string[];
  simulateKeydown: string;
  insertText: string;
  executeCommandById: string;
  drag: { from: MyEditorPosition };
  move: { to: MyEditorPosition; offsetX: number; offsetY: number };
  drop: undefined;
  waitForIdle: undefined;
  adjustSelection: undefined;
  resetSettings: undefined;
  setSetting: { k: keyof SettingsObject; v: SettingsObject[keyof SettingsObject] };
  parseState: string | string[];
  getCurrentState: undefined;
  clickGuide: GuideClickOptions;
}
~~~

Build one handler object in handleTestCommand and reject missing keys before invocation.

Keep WebSocket response formatting in handleTestMessage.

- [ ] **Step 4: Run renderer tests and confirm GREEN**

Run: npx jest src/__tests__/ObsidianBulletPluginWithTests.test.ts --runInBand

Expected: PASS.

- [ ] **Step 5: Commit the renderer registry**

Commit: refactor(test): dispatch renderer commands from registry

### Task 3: Semantic guide resolver and pointer sequence

**Files:**
- Modify: src/ObsidianBulletPluginWithTests.ts
- Test: src/__tests__/ObsidianBulletPluginWithTests.test.ts
- Modify: jest/test-globals.d.ts

**Interfaces:**
- Produces: GuideClickOptions = { line: number; kind: "indent" | "outer"; prefix?: string }
- Produces: clickGuide(options: GuideClickOptions): Promise<void>

- [ ] **Step 1: Add failing resolver tests**

Create fake line DOM with two cm-indent children whose preceding text is different.

Assert that prefix selects the exact guide and that the dispatched event types equal:

~~~ts
expect(events).toEqual(["mousedown", "mouseup", "click"]);
~~~

Add invalid line, missing prefix, and missing outer guide cases that assert descriptive errors.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: npx jest src/__tests__/ObsidianBulletPluginWithTests.test.ts --runInBand

Expected: FAIL because clickGuide is not implemented.

- [ ] **Step 3: Implement fresh line and guide lookup**

Resolve the line from EditorView.domAtPos on every call.

For indent guides, calculate raw prefix by concatenating preceding sibling text in the same cm-hmd-list-indent.

For outer guides, query bullet-plugin-outer-list-guide on the resolved line.

Dispatch new MouseEvent instances with bubbles and cancelable enabled.

- [ ] **Step 4: Add the typed Jest global**

~~~ts
declare function clickGuide(options: {
  line: number;
  kind: "indent" | "outer";
  prefix?: string;
}): Promise<void>;
~~~

- [ ] **Step 5: Run renderer tests and confirm GREEN**

Run: npx jest src/__tests__/ObsidianBulletPluginWithTests.test.ts --runInBand

Expected: PASS.

- [ ] **Step 6: Commit the semantic action**

Commit: feat(test): drive native vertical guide clicks

### Task 4: Markdown action and real Obsidian regression

**Files:**
- Modify: jest/md-spec-transformer.js
- Modify: src/__tests__/jestTestConfig.test.ts
- Create: specs/features/VerticalGuideInteraction.spec.md

**Interfaces:**
- Consumes: - clickGuide: JSON
- Produces: generated clickGuide({...}) call

- [ ] **Step 1: Add a failing transformer test**

Transform a Markdown test containing:

~~~markdown
- clickGuide: {"line":2,"kind":"indent","prefix":"  "}
~~~

Assert that generated code calls clickGuide with the parsed object.

- [ ] **Step 2: Run the transformer test and confirm RED**

Run: npx jest src/__tests__/jestTestConfig.test.ts --runInBand

Expected: FAIL because clickGuide is an unknown action.

- [ ] **Step 3: Add parser and code generation**

Add parseClickGuide beside parseDrag and a clickGuide case beside the other generated actions.

Reject malformed JSON through the existing transformer error path.

- [ ] **Step 4: Run unit tests and confirm GREEN**

Run: npm run test:unit -- --runInBand

Expected: 39 or more suites pass with zero failures.

- [ ] **Step 5: Add the integration regression**

Create a Markdown fixture that starts with a saved folded branch, clicks its persistent guide with the full sequence, and asserts the child becomes visible.

Add a second click and assert the child folds again.

- [ ] **Step 6: Build and run the focused Markdown spec**

Backup vault/test.md outside the vault.

Run: npm run build-with-tests

Run: npx jest specs/features/VerticalGuideInteraction.spec.md --runInBand --forceExit

Expected: PASS.

Confirm the vault renderer has exited, restore vault/test.md, wait, and verify the restored hash.

- [ ] **Step 7: Commit the Markdown action**

Commit: test(vertical-lines): cover native guide interactions
