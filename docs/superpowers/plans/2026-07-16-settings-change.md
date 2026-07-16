# Settings Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Notify settings subscribers once and only when one of their declared persisted keys changes.

**Architecture:** Settings owns keyed subscriptions and batches reset changes into one SettingsChange. Feature subscribers declare persisted-key dependencies at registration while storage data and public getters remain compatible.

**Tech Stack:** TypeScript 5.9, Jest 30, Obsidian settings UI.

## Global Constraints

- Preserve SettingsObject keys and serialized values.
- Preserve boolean stickCursor migration.
- Keep callbacks synchronous.
- Keep removeCallback compatibility for lifecycle cleanup.
- Do not save automatically from setters.

---

### Task 1: Keyed and batched Settings notifications

**Files:**
- Modify: src/services/Settings.ts
- Modify: src/services/__tests__/Settings.test.ts

**Interfaces:**
- Produces: SettingsKey = keyof SettingsObject
- Produces: SettingsChange = { keys: ReadonlySet<SettingsKey> }
- Changes: onChange(keys: readonly SettingsKey[], callback: Callback): void
- Retains: removeCallback(callback: Callback): void

- [x] **Step 1: Write failing notification tests**

Add tests for same-value no-op, key filtering, multi-key subscription, one reset notification, and unsubscribe.

~~~ts
const callback = jest.fn();
settings.onChange(["listLines", "outerListLines"], callback);
settings.debug = true;
expect(callback).not.toHaveBeenCalled();
settings.verticalLines = false;
expect(callback).toHaveBeenCalledTimes(1);
expect(callback.mock.calls[0]?.[0].keys).toEqual(new Set(["listLines"]));
~~~

For reset, first change three values, clear the mock, call reset, and assert one callback with all three keys.

- [x] **Step 2: Run Settings tests and confirm RED**

Run: SKIP_OBSIDIAN=1 npx jest src/services/__tests__/Settings.test.ts --runInBand

Expected: FAIL because onChange does not accept keys and reset notifies per key.

- [x] **Step 3: Implement keyed subscriptions**

~~~ts
export type SettingsKey = keyof SettingsObject;

export interface SettingsChange {
  keys: ReadonlySet<SettingsKey>;
}

type Callback = (change: SettingsChange) => void;

interface Subscription {
  keys: ReadonlySet<SettingsKey>;
  callback: Callback;
}
~~~

Store subscriptions by callback so removeCallback remains direct.

Notify a subscription only when one changed key is present in its dependency set.

- [x] **Step 4: Implement same-value no-op and patch batching**

Create private assign and update methods that compare Object.is, record changed keys, mutate values, and call notify once.

Use it from a single setter and reset.

~~~ts
private assign<K extends SettingsKey>(
  key: K,
  value: SettingsObject[K],
  changed: Set<SettingsKey>,
): void {
  if (!Object.is(this.values[key], value)) {
    this.values[key] = value;
    changed.add(key);
  }
}

private update(patch: Partial<SettingsObject>): void {
  const changed = new Set<SettingsKey>();
  for (const key of Object.keys(patch) as SettingsKey[]) {
    const value = patch[key];
    if (value !== undefined) this.assign(key, value, changed);
  }
  if (changed.size > 0) this.notify(changed);
}
~~~

- [x] **Step 5: Run Settings tests and confirm GREEN**

Run: SKIP_OBSIDIAN=1 npx jest src/services/__tests__/Settings.test.ts --runInBand

Expected: PASS.

- [x] **Step 6: Commit the Settings interface**

Commit: refactor(settings): notify keyed changes once

### Task 2: Declare feature dependencies

**Files:**
- Modify: src/features/VerticalLines.ts
- Modify: src/features/GuideFolding.ts
- Modify: src/features/BetterListsStyles.ts
- Modify: src/features/VimOBehaviourOverride.ts
- Modify: src/features/DragAndDrop.ts
- Modify: corresponding feature tests

**Interfaces:**
- Consumes: Settings.onChange(keys, callback)
- Key sets:
  - VerticalLines and GuideFolding: listLines, outerListLines, listLineAction
  - BetterListsStyles: styleLists
  - VimOBehaviourOverride: betterVimO
  - DragAndDrop: dnd

- [x] **Step 1: Update failing subscription assertions**

For each feature test, assert the exact dependency array.

~~~ts
expect(settings.onChange).toHaveBeenCalledWith(
  ["listLines", "outerListLines", "listLineAction"],
  expect.any(Function),
);
~~~

- [x] **Step 2: Run feature tests and confirm RED**

Run: SKIP_OBSIDIAN=1 npx jest src/features --runInBand

Expected: subscription assertions fail with the old callback-only calls.

- [x] **Step 3: Update production subscriptions**

Pass the exact persisted keys listed in Interfaces to each onChange call.

Keep removeCallback calls unchanged.

- [x] **Step 4: Run feature tests and confirm GREEN**

Run: SKIP_OBSIDIAN=1 npx jest src/features --runInBand

Expected: PASS.

- [x] **Step 5: Add the unrelated-change regression**

In GuideFolding tests, trigger a debug-only settings change and assert requestMeasure and decoration dispatch are not called.

Then trigger listLineAction and assert synchronization occurs once.

- [x] **Step 6: Run unit tests and lint**

Run: npm run test:unit -- --runInBand

Run: npm run lint

Expected: zero failures and zero warnings.

- [x] **Step 7: Commit feature dependencies**

Commit: perf(settings): scope feature subscriptions

### Task 3: Integration verification

**Files:**
- Modify only if needed: specs/features/*.spec.md

**Interfaces:**
- No new interface

- [x] **Step 1: Build with tests**

Run: npm run build-with-tests

Expected: Rollup exits zero.

- [x] **Step 2: Run the full integration suite safely**

Backup vault/test.md outside the vault and record its hash.

Run: npm test -- --runInBand

Expected: all specs pass.

Wait for the vault renderer to exit, restore the fixture, wait, and confirm the original hash.

- [x] **Step 3: Commit a regression spec only if required**

Commit: test(settings): cover scoped change notifications

## Execution evidence

- Completed in `43b62ad` and `4edb450`, with unloaded Vim callback ownership corrected in `d77f2b0`.
- Settings patches batch exact changed keys, same-value writes are no-ops, feature subscribers receive only their declared keys, and every feature-owned callback is removed on unload.
- Final fresh verification at `36326fd`: 44/44 unit suites and 414/414 tests passed; lint, TypeScript, production build, and test build exited zero. The full integration run passed 63/63 suites with 529 passed and 14 skipped tests.
- No Markdown regression was added because the Markdown DSL cannot observe callback dispatch or measurement counts; focused unit lifecycle and unrelated-key tests provide the discriminating coverage, while the full integration suite verifies production behavior.
- The fixture was restored after renderer exit and a delayed-save window to 4,588 bytes and SHA-256 `3b41a8cfcfc20a345fa3b2d33a909f1fb00bdd00d2302223bedefc0ed9c96f0b`.
- The complete range `5686196..36326fd` received final review approval with no Critical, Important, or Minor findings.
