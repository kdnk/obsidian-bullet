# Drag Measurement Locality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Delete the one-caller measurement module and test its behavior through DragAndDrop planning.

**Architecture:** Left-padding measurement becomes a private DragAndDrop implementation detail used by DragAndDropState. Existing DOM fallbacks remain unchanged, but tests observe resulting planning state instead of a standalone helper.

**Tech Stack:** TypeScript 5.9, Jest 30, CodeMirror 6 DOM mocks.

## Global Constraints

- Preserve rendered-line precedence over scroller fallback.
- Preserve scroller padding and zero fallbacks.
- Do not add a new production export for testing.
- Preserve pop-out document ownership.

---

### Task 1: Move measurement coverage to DragAndDrop

**Files:**
- Modify: src/features/__tests__/DragAndDrop.test.ts
- Delete: src/features/__tests__/dragAndDropMeasurements.test.ts

**Interfaces:**
- Consumes: existing DragAndDrop and DragAndDropState test fixtures
- Produces: no production interface

- [x] **Step 1: Add failing planning assertions**

Add three fixtures for rendered line, scroller fallback, and missing DOM.

After drag state creation, calculate the nearest drop variant and assert its left coordinate includes the measured padding.

~~~ts
expect(state.getDropVariants()).toEqual(
  expect.arrayContaining([expect.objectContaining({ left: expectedLeft })]),
);
~~~

If the current fixture cannot reach state, observe the drop-zone left style after mouse movement instead.

- [x] **Step 2: Run DragAndDrop tests and confirm RED**

Run: SKIP_OBSIDIAN=1 npx jest src/features/__tests__/DragAndDrop.test.ts --runInBand

Expected: at least one new assertion fails before the fixture supplies the fallback DOM.

- [x] **Step 3: Complete the integrated fixture**

Provide cm-line, cm-scroller, getBoundingClientRect, ownerDocument.defaultView, and computed padding through the existing fake EditorView.

Confirm the three tests fail if getDragAndDropLeftPadding always returns zero.

- [x] **Step 4: Run DragAndDrop tests and confirm GREEN with current production code**

Run: SKIP_OBSIDIAN=1 npx jest src/features/__tests__/DragAndDrop.test.ts --runInBand

Expected: PASS.

### Task 2: Collapse the shallow module

**Files:**
- Modify: src/features/DragAndDrop.ts
- Delete: src/features/dragAndDropMeasurements.ts

**Interfaces:**
- Removes: getDragAndDropLeftPadding export
- Adds: private file-local getDragAndDropLeftPadding

- [x] **Step 1: Move the helper implementation**

Move getDragAndDropLeftPadding, isElementLike, and getComputedStyleFor into DragAndDrop.ts near DragAndDropState.

Remove the import from dragAndDropMeasurements.

- [x] **Step 2: Delete the shallow files**

Delete dragAndDropMeasurements.ts and its direct test file.

- [x] **Step 3: Run focused tests**

Run: SKIP_OBSIDIAN=1 npx jest src/features/__tests__/DragAndDrop.test.ts --runInBand

Expected: PASS with the integrated measurement cases.

- [x] **Step 4: Run unit tests and lint**

Run: npm run test:unit -- --runInBand

Run: npm run lint

Expected: zero failures and no stale imports.

- [x] **Step 5: Commit**

Commit: refactor(drag-and-drop): localize layout measurement

## Execution evidence

- Completed in `f0c1d21` and `f75f0f6`; the direct measurement module and its direct test were removed, and rendered-line, scroller-padding, and missing-DOM behavior now run through `DragAndDrop`.
- Final fresh verification at `36326fd`: `npm run test:unit -- --runInBand` passed 44/44 suites and 414/414 tests; `npm run lint`, `npx tsc --noEmit --pretty false`, `npm run build`, and `npm run build-with-tests` exited zero.
- The final full integration run passed 63/63 suites with 529 passed and 14 skipped tests.
- The complete range `5686196..36326fd` received final review approval with no Critical, Important, or Minor findings.
