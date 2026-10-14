#!/usr/bin/env node
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  cdp,
  evaluate,
} = require("../../../../scripts/obsidian-scroll-driver.cjs");

if (!process.argv[2])
  throw Error("Usage: verify-desktop-drag.cjs <fresh-output-directory>");
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const id = randomUUID();
const key = `__bulletDesktopDrag_${id.replaceAll("-", "")}`;
const sourceText = "- [ ] parent\n\t- child\n- keep";
const targetText = "- destination\n\t- sibling\n- target keep";
const sourceAfter = "- keep";
const targetAfter =
  "- destination\n\t- [ ] parent\n\t\t- child\n\t- sibling\n- target keep";
fs.writeFileSync(
  path.join(output, "fixture.json"),
  JSON.stringify(
    {
      source: { path: `desktop-drag-source-${id}.md`, text: sourceText },
      target: { path: `desktop-drag-target-${id}.md`, text: targetText },
    },
    null,
    2,
  ) + "\n",
);
const results = [];
const failures = [];
let initial;
let focusEmulated = false;
let viewportOverridden = false;
let pressed = false;
let lastPoint;

function settle() {
  evaluate(async () => new Promise((resolve) => setTimeout(resolve, 250)));
}

function guard() {
  evaluate(() => {
    window.focus();
    if (!document.title.includes("vault") || document.title.includes("base"))
      throw Error("Test vault title guard");
    if (document.visibilityState !== "visible")
      throw Error("Hidden test renderer");
  });
}

function mouse(type, point, buttons, side, selector) {
  guard();
  evaluate(
    (key, point, side, selector) => {
      const cm = window[key][side].view.editor.cm;
      const hit = document.elementFromPoint(point.x, point.y);
      if (!hit || !cm.dom.contains(hit))
        throw Error(`Pointer outside ${side} editor`);
      if (selector && !hit.closest(selector))
        throw Error(`Occluded pointer target: ${selector}`);
    },
    key,
    point,
    side,
    selector ?? null,
  );
  lastPoint = { point, side };
  if (type === "mousePressed") pressed = true;
  cdp("Input.dispatchMouseEvent", {
    type,
    ...point,
    button: "left",
    buttons,
    clickCount: 1,
  });
  if (type === "mouseReleased") pressed = false;
}

function keypress(keyName, code, modifiers = 0, keyCode = 27) {
  for (const type of ["keyDown", "keyUp"]) {
    guard();
    cdp("Input.dispatchKeyEvent", {
      type,
      key: keyName,
      code,
      modifiers,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
  }
}

function screenshot(name) {
  fs.writeFileSync(
    path.join(output, `${name}.png`),
    Buffer.from(
      cdp("Page.captureScreenshot", { format: "png" }).data,
      "base64",
    ),
  );
}

function snapshot(name) {
  const state = evaluate((key) => {
    const state = window[key];
    const target = state.target.view.editor.cm;
    const zone = document.querySelector(".bullet-plugin-drop-zone");
    const rect = zone?.getBoundingClientRect();
    return {
      source: state.source.view.editor.getValue(),
      target: state.target.view.editor.getValue(),
      destinationActive: app.workspace.activeLeaf === state.target,
      destinationFocused: target.contentDOM.contains(document.activeElement),
      dragging: document.body.classList.contains("bullet-plugin-dragging"),
      dropZone:
        !!zone && getComputedStyle(zone).display !== "none" && rect.width > 0,
    };
  }, key);
  results.push({ name, ...state });
  return state;
}

function documents(state, source, target) {
  assert.equal(state.source, source, "Exact source Markdown");
  assert.equal(state.target, target, "Exact destination Markdown");
}

function noDrag(state) {
  assert.equal(state.dragging, false, "No active Bullet drag");
  assert.equal(state.dropZone, false, "No remaining drop indicator");
}

function start(selector) {
  // API setup selects a different source row so Live Preview exposes the task controls.
  evaluate((key) => {
    const leaf = window[key].source;
    app.workspace.setActiveLeaf(leaf, { focus: true });
    leaf.view.editor.setCursor({ line: 2, ch: 6 });
    leaf.view.editor.focus();
  }, key);
  settle();
  const point = evaluate(
    (key, selector) => {
      const cm = window[key].source.view.editor.cm;
      const element = cm.contentDOM.querySelector(selector);
      if (!element) throw Error(`Missing source control: ${selector}`);
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    },
    key,
    selector,
  );
  mouse("mouseMoved", point, 0, "source", selector);
  mouse("mousePressed", point, 1, "source", selector);
  mouse("mouseMoved", { x: point.x + 12, y: point.y + 2 }, 1, "source");
  settle();
}

function destination() {
  return evaluate((key) => {
    const cm = window[key].target.view.editor.cm;
    const coords = cm.coordsAtPos(cm.state.doc.line(2).from, -1);
    const first = cm.contentDOM.querySelector(".cm-line");
    const indent = cm.contentDOM.querySelector(".cm-indent");
    if (!coords || !first || !indent)
      throw Error("Missing destination drop geometry");
    return {
      x: first.getBoundingClientRect().left + indent.offsetWidth,
      y: coords.top - 8,
    };
  }, key);
}

try {
  initial = evaluate(() => {
    for (const cls of ["bullet-plugin-better-lists", "bullet-plugin-dnd"])
      if (!document.body.classList.contains(cls))
        throw Error(`Required setting disabled: ${cls}`);
    if (document.body.classList.contains("bullet-plugin-dragging"))
      throw Error("Existing drag must finish first");
    return {
      leaf: app.workspace.activeLeaf?.id,
      left: app.workspace.leftSplit.collapsed,
      right: app.workspace.rightSplit.collapsed,
      dpr: devicePixelRatio,
    };
  });
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  focusEmulated = true;
  cdp("Emulation.setDeviceMetricsOverride", {
    width: 1100,
    height: 850,
    deviceScaleFactor: initial.dpr,
    mobile: false,
  });
  viewportOverridden = true;
  // API setup owns only these UUID scratch notes and their two new leaves.
  evaluate(
    async (key, id, sourceText, targetText) => {
      const state = (window[key] = { files: [], source: null, target: null });
      const source = await app.vault.create(
        `desktop-drag-source-${id}.md`,
        sourceText,
      );
      state.files.push(source);
      const target = await app.vault.create(
        `desktop-drag-target-${id}.md`,
        targetText,
      );
      state.files.push(target);
      state.source = app.workspace.getLeaf("tab");
      await state.source.openFile(source);
      await state.source.setViewState({
        type: "markdown",
        state: { file: source.path, mode: "source", source: false },
      });
      app.workspace.setActiveLeaf(state.source, { focus: true });
      state.target = app.workspace.getLeaf("split", "vertical");
      await state.target.openFile(target);
      await state.target.setViewState({
        type: "markdown",
        state: { file: target.path, mode: "source", source: false },
      });
      state.target.view.editor.setCursor({ line: 2, ch: 13 });
      app.workspace.leftSplit.collapse();
      app.workspace.rightSplit.collapse();
    },
    key,
    id,
    sourceText,
    targetText,
  );
  settle();

  start(".task-list-item-checkbox");
  noDrag(snapshot("checkbox-after-threshold"));
  let drop = destination();
  mouse("mouseMoved", drop, 1, "target");
  noDrag(snapshot("checkbox-at-destination"));
  mouse("mouseReleased", drop, 0, "target");
  settle();
  documents(snapshot("checkbox-release"), sourceText, targetText);
  screenshot("checkbox-release");

  start(".bullet-plugin-task-bullet .list-bullet");
  assert.equal(snapshot("cancel-drag-started").dragging, true);
  drop = destination();
  mouse("mouseMoved", drop, 1, "target");
  settle();
  assert.equal(snapshot("cancel-drop-indicator").dropZone, true);
  keypress("Escape", "Escape");
  const canceled = snapshot("escape-before-release");
  noDrag(canceled);
  documents(canceled, sourceText, targetText);
  mouse("mouseReleased", drop, 0, "target");
  settle();
  const released = snapshot("escape-after-release");
  noDrag(released);
  documents(released, sourceText, targetText);
  screenshot("escape-canceled");

  start(".bullet-plugin-task-bullet .list-bullet");
  assert.equal(snapshot("move-started").dragging, true);
  drop = destination();
  mouse("mouseMoved", drop, 1, "target");
  settle();
  assert.equal(snapshot("move-drop-indicator").dropZone, true);
  screenshot("before-drop");
  mouse("mouseReleased", drop, 0, "target");
  const moved = snapshot("immediate-drop-focus");
  assert.equal(
    moved.destinationActive,
    true,
    "Drop activates destination leaf before any API focus change",
  );
  assert.equal(
    moved.destinationFocused,
    true,
    "Drop focuses destination content DOM before any API focus change",
  );
  noDrag(moved);
  documents(moved, sourceAfter, targetAfter);
  screenshot("after-drop");

  keypress("z", "KeyZ", 4, 90);
  settle();
  documents(snapshot("paired-undo"), sourceText, targetText);
  keypress("z", "KeyZ", 12, 90);
  settle();
  documents(snapshot("paired-redo"), sourceAfter, targetAfter);
  screenshot("paired-redo");
  const saved = evaluate(async (key) => {
    const state = window[key];
    await state.source.view.save();
    await state.target.view.save();
    return {
      source: await app.vault.read(state.source.view.file),
      target: await app.vault.read(state.target.view.file),
    };
  }, key);
  documents(saved, sourceAfter, targetAfter);
  results.push({ name: "saved-markdown", ...saved });
} catch (error) {
  failures.push(error.stack ?? String(error));
  process.exitCode = 1;
  try {
    screenshot("failure");
  } catch (captureError) {
    failures.push(`Failure screenshot: ${captureError.stack ?? captureError}`);
  }
} finally {
  if (pressed) {
    try {
      keypress("Escape", "Escape");
      mouse("mouseReleased", lastPoint.point, 0, lastPoint.side);
    } catch (error) {
      failures.push(`Drag cleanup: ${error.stack ?? error}`);
      process.exitCode = 1;
    }
  }
  try {
    if (initial)
      evaluate(
        async (key, initial) => {
          const state = window[key];
          if (state) {
            for (const leaf of [state.target, state.source]) {
              if (!leaf) continue;
              await leaf.view.save?.();
              leaf.detach();
            }
            for (const file of state.files)
              if (app.vault.getAbstractFileByPath(file.path) === file)
                await app.vault.trash(file, false);
            delete window[key];
          }
          if (!initial.left) app.workspace.leftSplit.expand();
          if (!initial.right) app.workspace.rightSplit.expand();
          const leaf = initial.leaf && app.workspace.getLeafById(initial.leaf);
          if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
        },
        key,
        initial,
      );
    results.push({ name: "scratch-cleanup", pass: true });
  } catch (error) {
    failures.push(`Cleanup: ${error.stack ?? error}`);
    process.exitCode = 1;
  } finally {
    for (const [enabled, method, params] of [
      [viewportOverridden, "Emulation.clearDeviceMetricsOverride", {}],
      [focusEmulated, "Emulation.setFocusEmulationEnabled", { enabled: false }],
    ]) {
      if (!enabled) continue;
      try {
        cdp(method, params);
      } catch (error) {
        failures.push(`Emulation cleanup: ${error.stack ?? error}`);
        process.exitCode = 1;
      }
    }
    fs.writeFileSync(
      path.join(output, "results.json"),
      JSON.stringify({ results, failures }, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({ output, checks: results.length, failures }, null, 2),
    );
  }
}
