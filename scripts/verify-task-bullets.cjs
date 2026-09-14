// Deploy build-with-tests first. Runs in the repository vault and restores state.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { cdp } = require("./obsidian-scroll-driver.cjs");
const out = path.resolve(process.argv[2]);
fs.mkdirSync(out, { recursive: false });
const mobile = process.argv.includes("--mobile");
const vault = path.resolve(__dirname, "../vault");
const note = `task-bullets-${randomUUID()}.md`;
const fixture = [
  "- ordinary",
  "- [ ] project",
  "\t- [x] completed child",
  "\t\t- deep child",
  "\t- [ ] pending child",
  "- [x] done",
  "- [-] custom",
  "- [ ] " + "wrapped task words ".repeat(16),
  "- tail",
  "```md",
  "- [ ] literal",
  "```",
].join("\n");
function evaluate(fn, ...args) {
  const r = cdp("Runtime.evaluate", {
    expression: `(async()=>{if(app.vault.adapter.getBasePath()!==${JSON.stringify(vault)}||app.vault.config.useTab!==true||app.vault.config.tabSize!==4)throw Error('Test vault guard');return (${fn.toString()})(...${JSON.stringify(args)});})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails)
    throw Error(
      r.exceptionDetails.exception?.description || r.exceptionDetails.text,
    );
  return r.result.value;
}
function settle() {
  evaluate(async () => {
    await new Promise((r) => setTimeout(r, 300));
  });
}
function focus() {
  evaluate(() => {
    window.focus();
    const leaf = window.__taskBulletCheck.leaf;
    app.workspace.setActiveLeaf(leaf, { focus: true });
    leaf.view.editor?.focus();
    if (
      !document.title.includes(" - vault - ") ||
      document.title.includes(" - base - ")
    )
      throw Error("Wrong window");
  });
}
function state() {
  return evaluate(() => {
    const v = window.__taskBulletCheck.leaf.view.editor;
    return {
      doc: v.getValue(),
      cursor: v.getCursor(),
      zoom: !!v.cm.dom.querySelector(".bullet-zoom-breadcrumbs"),
      bullets: v.cm.dom.querySelectorAll(".bullet-plugin-task-bullet").length,
    };
  });
}
function target(line, selector) {
  focus();
  return evaluate(
    (line, selector) => {
      const v = window.__taskBulletCheck.leaf.view.editor.cm;
      const pos = v.state.doc.line(line + 1).from;
      const d = v.domAtPos(pos).node;
      const el = (d.nodeType === 1 ? d : d.parentElement).closest(".cm-line");
      const target = el?.querySelector(selector);
      if (!target) throw Error("Missing target " + line + " " + selector);
      if (target.getBoundingClientRect().top < 150) v.scrollDOM.scrollTop = 0;
      else target.scrollIntoView({ block: "nearest" });
      const r = target.getBoundingClientRect();
      return {
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        w: r.width,
        h: r.height,
      };
    },
    line,
    selector,
  );
}
function click(line, selector) {
  target(line, selector);
  settle();
  let p = target(line, selector);
  if (!mobile) {
    focus();
    cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
    settle();
  }
  let ready = false;
  for (let attempt = 0; attempt < 24; attempt++) {
    ready = evaluate(
      (p, selector) => !!document.elementFromPoint(p.x, p.y)?.closest(selector),
      p,
      selector,
    );
    if (ready) break;
    settle();
    p = target(line, selector);
  }
  if (!ready) {
    screenshot("blocked-target");
    console.log(
      JSON.stringify(
        evaluate(
          (p) => ({
            point: p,
            hit: document.elementFromPoint(p.x, p.y)?.outerHTML,
            visible: document.visibilityState,
          }),
          p,
        ),
      ),
    );
  }
  assert.ok(ready, "Target must receive the tap: " + selector);
  if (mobile) {
    focus();
    cdp("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: p.x, y: p.y }],
    });
    focus();
    cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    for (const type of ["mousePressed", "mouseReleased"]) {
      focus();
      cdp("Input.dispatchMouseEvent", {
        type,
        x: p.x,
        y: p.y,
        button: "left",
        clickCount: 1,
      });
    }
  }
  settle();
}
function command(id) {
  focus();
  evaluate((id) => app.commands.executeCommandById(id), id);
  settle();
}
function keyHistory(redo) {
  for (const type of ["keyDown", "keyUp"]) {
    focus();
    cdp("Input.dispatchKeyEvent", {
      type,
      key: "z",
      code: "KeyZ",
      windowsVirtualKeyCode: 90,
      nativeVirtualKeyCode: 90,
      modifiers: redo ? 12 : 4,
    });
  }
  settle();
}
function reset() {
  command("bullet:zoom-reset");
  evaluate((fixture) => {
    const v = window.__taskBulletCheck.leaf.view.editor;
    v.setValue(fixture);
    v.setCursor({ line: 8, ch: 6 });
  }, fixture);
  settle();
}
function screenshot(name) {
  fs.writeFileSync(
    path.join(out, `${name}.png`),
    Buffer.from(
      cdp("Page.captureScreenshot", { format: "png" }).data,
      "base64",
    ),
  );
}
const result = [];
const original = evaluate(() => ({
  workspace: app.workspace.getLayout(),
  mobile: document.body.classList.contains("is-mobile"),
  styleLists: app.plugins.plugins.bullet.settings.betterListsStyles,
  active: app.workspace.activeLeaf.id,
}));
assert.equal(original.mobile, false, "Start in desktop mode");
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  if (mobile) {
    evaluate(() => app.emulateMobile(true));
    execFileSync("sleep", ["2"]);
  }
  cdp("Emulation.setDeviceMetricsOverride", {
    width: mobile ? 390 : 1000,
    height: mobile ? 844 : 1000,
    deviceScaleFactor: 1,
    mobile,
  });
  cdp("Emulation.setTouchEmulationEnabled", { enabled: mobile });
  evaluate(
    async (note, fixture) => {
      app.workspace.leftSplit.collapse();
      app.workspace.rightSplit.collapse();
      const leaf = app.workspace.getLeaf("tab");
      const file = await app.vault.create(note, fixture);
      await leaf.openFile(file);
      await leaf.setViewState({
        type: "markdown",
        state: { file: note, mode: "source", source: false },
      });
      window.__taskBulletCheck = { leaf, file };
      leaf.view.editor.setCursor({ line: 8, ch: 6 });
    },
    note,
    fixture,
  );
  evaluate(async () => {
    await app.plugins.disablePlugin("bullet");
    await app.plugins.enablePlugin("bullet");
  });
  settle();
  evaluate(async () => {
    await new Promise((r) => setTimeout(r, 5500));
  });
  assert.equal(
    evaluate(() => document.visibilityState),
    "visible",
  );
  assert.equal(state().bullets, 6);
  const geometry = evaluate(() => {
    const cm = window.__taskBulletCheck.leaf.view.editor.cm;
    const lines = Array.from(cm.contentDOM.querySelectorAll(".cm-line"));
    const ordinary = lines
      .find((e) => e.textContent.includes("ordinary"))
      .querySelector(".list-bullet")
      .getBoundingClientRect();
    return lines
      .filter((e) => e.querySelector(".bullet-plugin-task-bullet"))
      .map((e) => {
        const b = e.querySelector(".list-bullet").getBoundingClientRect(),
          c = e.querySelector("input").getBoundingClientRect();
        return {
          text: e.textContent,
          bullet: { x: b.x, right: b.right },
          checkbox: { x: c.x, right: c.right },
          ordinaryX: ordinary.x,
          height: e.getBoundingClientRect().height,
          padding: getComputedStyle(e).paddingInlineStart,
          indent: getComputedStyle(e).textIndent,
        };
      });
  });
  for (const row of geometry)
    assert.ok(row.bullet.right < row.checkbox.x, "Separate hit boxes");
  assert.equal(geometry[0].bullet.x, geometry[0].ordinaryX);
  screenshot("initial");
  result.push({ name: "geometry", geometry });
  click(1, ".task-list-item-checkbox");
  assert.equal(state().doc, fixture.replace("- [ ] project", "- [x] project"));
  assert.equal(state().zoom, false);
  click(1, ".task-list-item-checkbox");
  assert.equal(state().doc, fixture);
  click(1, ".bullet-plugin-task-bullet .list-bullet");
  assert.equal(state().zoom, true);
  assert.equal(state().doc, fixture);
  screenshot("zoomed");
  click(4, ".task-list-item-checkbox");
  assert.equal(
    state().doc,
    fixture.replace("- [ ] pending child", "- [x] pending child"),
  );
  assert.equal(state().zoom, true);
  command("bullet:zoom-reset");
  result.push({ name: "checkbox-and-zoom", pass: true });
  reset();
  evaluate(() => {
    const v = window.__taskBulletCheck.leaf.view.editor;
    v.setCursor({ line: 1, ch: 13 });
  });
  focus();
  cdp("Input.insertText", { text: "!" });
  settle();
  assert.equal(state().doc, fixture.replace("project", "project!"));
  keyHistory(false);
  assert.equal(state().doc, fixture);
  keyHistory(true);
  assert.equal(state().doc, fixture.replace("project", "project!"));
  result.push({ name: "editing-history", pass: true });
  reset();
  evaluate(async (note) => {
    await window.__taskBulletCheck.leaf.setViewState({
      type: "markdown",
      state: { file: note, mode: "source", source: true },
    });
  }, note);
  settle();
  assert.equal(state().bullets, 0);
  assert.equal(state().doc, fixture);
  evaluate(async (note) => {
    await window.__taskBulletCheck.leaf.setViewState({
      type: "markdown",
      state: { file: note, mode: "source", source: false },
    });
  }, note);
  settle();
  assert.equal(state().bullets, 6);
  evaluate(async () => {
    const s = app.plugins.plugins.bullet.settings;
    s.betterListsStyles = false;
  });
  settle();
  assert.equal(state().bullets, 0);
  evaluate(async () => {
    const s = app.plugins.plugins.bullet.settings;
    s.betterListsStyles = true;
  });
  settle();
  assert.equal(state().bullets, 6);
  evaluate(async () => {
    await app.plugins.disablePlugin("bullet");
  });
  settle();
  assert.equal(state().bullets, 0);
  evaluate(async () => {
    await app.plugins.enablePlugin("bullet");
  });
  settle();
  assert.equal(state().bullets, 6);
  result.push({ name: "source-style-reload", pass: true });
  reset();
  click(1, ".collapse-indicator svg");
  screenshot("before-fold-assert");
  const folded = evaluate(
    () => window.__taskBulletCheck.leaf.view.editor.getFoldOffsets().size,
  );
  assert.ok(folded > 0);
  assert.equal(state().doc, fixture);
  screenshot("folded");
  click(1, ".task-list-item-checkbox");
  assert.equal(state().doc, fixture.replace("- [ ] project", "- [x] project"));
  click(1, ".bullet-plugin-task-bullet .list-bullet");
  assert.equal(state().zoom, true);
  result.push({ name: "folded-task", pass: true });
  if (!mobile) {
    reset();
    const start = target(1, ".bullet-plugin-task-bullet .list-bullet");
    const end = target(8, ".list-bullet");
    for (const event of [
      { type: "mouseMoved", x: start.x, y: start.y },
      {
        type: "mousePressed",
        x: start.x,
        y: start.y,
        button: "left",
        clickCount: 1,
      },
      {
        type: "mouseMoved",
        x: end.x,
        y: end.y + 12,
        button: "left",
        buttons: 1,
      },
    ]) {
      focus();
      cdp("Input.dispatchMouseEvent", event);
      settle();
    }
    focus();
    cdp("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: end.x,
      y: end.y + 12,
      button: "left",
      clickCount: 1,
    });
    settle();
    const moved = state();
    assert.notEqual(moved.doc, fixture);
    assert.ok(
      moved.doc.includes(
        "- [ ] project\n\t- [x] completed child\n\t\t- deep child\n\t- [ ] pending child",
      ),
    );
    assert.equal(moved.zoom, false);
    result.push({ name: "drag-task-subtree", pass: true, doc: moved.doc });
  }
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify({ mobile, result }, null, 2),
  );
  console.log(JSON.stringify({ mobile, checks: result.length, output: out }));
} finally {
  try {
    evaluate(async () => {
      const s = window.__taskBulletCheck;
      if (s) {
        s.leaf.detach();
        await app.vault.trash(s.file, true);
        delete window.__taskBulletCheck;
      }
    });
  } finally {
    cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
    cdp("Emulation.clearDeviceMetricsOverride");
    if (mobile) {
      evaluate(() => app.emulateMobile(false));
      execFileSync("sleep", ["2"]);
    }
    evaluate(async (workspace) => {
      await app.workspace.changeLayout(workspace);
      await app.plugins.disablePlugin("bullet");
      await app.plugins.enablePlugin("bullet");
    }, original.workspace);
    cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
  }
}
