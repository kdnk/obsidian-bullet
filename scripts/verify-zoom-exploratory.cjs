// Exploratory, real-Obsidian checks. Deploy build-with-tests before running.
// Uses only the repository vault. Pass a fresh output directory for regression runs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cdp: requestCdp } = require("./obsidian-scroll-driver.cjs");
const vault = path.resolve(__dirname, "../vault");
const output = path.resolve(
  process.argv[2] || "docs/testing/2026-09-10-zoom-exploratory",
);
fs.mkdirSync(output, { recursive: true });
const note = `zoom-explore-${randomUUID().slice(0, 8)}.md`;
const fixture =
  "---\nkind: zoom-test\n---\n- work\n\t- project\n\t\t- task\n\t\t- [ ] checkbox\n\t\t- branch\n\t\t\t- deep\n\t- other\n- personal";
const results = [];

function cdp(method, params) {
  try {
    return requestCdp(method, params);
  } catch (error) {
    // The CLI can print a complete response, then fail to exit. Only accept a
    // fully parsed response in that case; a missing/partial response still fails.
    if (error.code !== "ETIMEDOUT" || !error.stdout?.trim()) throw error;
    let response;
    try {
      response = JSON.parse(error.stdout);
    } catch {
      throw error;
    }
    results.push({
      name: "cli-exit-timeout",
      status: "observation",
      detail: { method, responseReceived: true },
    });
    return response;
  }
}

function evaluate(fn, ...args) {
  const response = cdp("Runtime.evaluate", {
    expression: `(async()=>{if(app.vault.adapter.getBasePath()!==${JSON.stringify(vault)}||app.vault.config.useTab!==true||app.vault.config.tabSize!==4)throw Error('Test vault guard');return (${fn.toString()})(...${JSON.stringify(args)});})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails)
    throw Error(
      response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text,
    );
  return response.result.value;
}
function settle() {
  evaluate(async () => {
    await new Promise((r) => setTimeout(r, 180));
  });
}
function focus() {
  evaluate(() => {
    if (!document.title.includes(" - vault - "))
      throw Error("Wrong window title");
    const check = window.__zoomExplore;
    if (app.workspace.activeLeaf !== check.leaf)
      app.workspace.setActiveLeaf(check.leaf, { focus: true });
    window.focus();
    check.leaf.view.editor.focus();
  });
}
function state() {
  return evaluate(() => {
    const editor = window.__zoomExplore.leaf.view.editor;
    const cm = editor.cm;
    const zoom = app.plugins.plugins.bullet.features.find(
      (f) => f.constructor.name === "ListZoom",
    ).zoom;
    const range = zoom.range(cm.state);
    return {
      doc: editor.getValue(),
      cursor: editor.getCursor(),
      selection: {
        from: cm.state.selection.main.from,
        to: cm.state.selection.main.to,
      },
      range: range
        ? {
            from: range.from,
            to: range.to,
            indent: range.indent,
            labels: range.ancestors.map((a) => a.label),
          }
        : null,
      breadcrumbs: [
        ...cm.dom.querySelectorAll(".bullet-zoom-breadcrumbs button"),
      ].map((b) => b.textContent),
      visible: cm.contentDOM.textContent,
      active: cm.dom
        .closest(".markdown-source-view")
        .classList.contains("bullet-zoom-active"),
      width: cm.scrollDOM.clientWidth,
      scrollWidth: cm.scrollDOM.scrollWidth,
    };
  });
}
function command(id) {
  focus();
  evaluate((id) => app.commands.executeCommandById(id), id);
  settle();
}
function cursor(label, end = true) {
  focus();
  evaluate(
    (label, end) => {
      const editor = window.__zoomExplore.leaf.view.editor;
      const line = editor
        .getValue()
        .split("\n")
        .findIndex((text) => text.trim() === label);
      if (line < 0) throw Error(`Missing line ${label}`);
      editor.setCursor({
        line,
        ch: end
          ? editor.getLine(line).length
          : editor.getLine(line).indexOf(label) + 2,
      });
    },
    label,
    end,
  );
  settle();
  assert.equal(
    evaluate(() => {
      const e = window.__zoomExplore.leaf.view.editor;
      return e.getLine(e.getCursor().line).trim();
    }),
    label,
  );
}
function prepare(text = fixture, target = "- project") {
  command("bullet:zoom-reset");
  evaluate((text) => {
    window.__zoomExplore.leaf.view.editor.setValue(text);
  }, text);
  cursor(target);
  command("bullet:zoom-in");
  assert.ok(state().range, "Fixture did not zoom");
  evaluate(async () => {
    await window.__zoomExplore.leaf.view.save();
  });
}
function key(key, code, modifiers = 0) {
  focus();
  const keyCode = {
    Enter: 13,
    Backspace: 8,
    Tab: 9,
    ArrowUp: 38,
    ArrowDown: 40,
    a: 65,
    z: 90,
  }[key];
  for (const type of ["keyDown", "keyUp"])
    cdp("Input.dispatchKeyEvent", {
      type,
      key,
      code,
      modifiers,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
  settle();
}
function type(text) {
  focus();
  cdp("Input.insertText", { text });
  settle();
}
function click(selector, label) {
  focus();
  const p = evaluate(
    (selector, label) => {
      const cm = window.__zoomExplore.leaf.view.editor.cm;
      const candidates = [...cm.contentDOM.querySelectorAll(".cm-line")];
      const line = candidates.find(
        (el) => cm.state.doc.lineAt(cm.posAtDOM(el)).text.trim() === label,
      );
      const el = line?.querySelector(selector);
      if (!el) throw Error(`Missing ${selector} on ${label}`);
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2,
        y = rect.top + rect.height / 2;
      if (!el.contains(document.elementFromPoint(x, y)))
        throw Error("Click target is occluded");
      return { x, y };
    },
    selector,
    label,
  );
  cdp("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...p,
    button: "left",
    clickCount: 1,
  });
  cdp("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...p,
    button: "left",
    clickCount: 1,
  });
  settle();
}
function screenshot(name) {
  fs.writeFileSync(
    path.join(output, `${name}.png`),
    Buffer.from(cdp("Page.captureScreenshot").data, "base64"),
  );
}
function check(name, fn) {
  if (process.env.ZOOM_CASES && !new RegExp(process.env.ZOOM_CASES).test(name))
    return;
  try {
    const detail = fn();
    results.push({ name, status: "pass", detail });
    console.log(`PASS ${name}`);
  } catch (error) {
    const detail = state();
    results.push({
      name,
      status: /ETIMEDOUT/.test(error.message)
        ? "inconclusive-transport"
        : "finding",
      error: error.message,
      detail,
    });
    screenshot(name);
    console.log(`FINDING ${name}: ${error.message}`);
  }
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
}

const initial = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  left: app.workspace.leftSplit.collapsed,
  right: app.workspace.rightSplit.collapsed,
  mobile: document.body.classList.contains("is-mobile"),
  dpr: devicePixelRatio,
}));
assert.equal(initial.mobile, false, "Start in desktop mode");
try {
  evaluate(
    async (note, fixture) => {
      const file = await app.vault.create(note, fixture);
      const leaf = app.workspace.getLeaf("tab");
      const errors = [];
      const onError = (e) => errors.push(String(e.message || e.reason));
      window.addEventListener("error", onError);
      window.addEventListener("unhandledrejection", onError);
      window.__zoomExplore = {
        leaf,
        files: [file],
        second: null,
        errors,
        onError,
      };
      await leaf.openFile(file);
      app.workspace.leftSplit.collapse();
      app.workspace.rightSplit.collapse();
    },
    note,
    fixture,
  );
  cdp("Emulation.setDeviceMetricsOverride", {
    width: 1100,
    height: 850,
    deviceScaleFactor: initial.dpr,
    mobile: false,
  });
  settle();

  check("nested-navigation", () => {
    prepare();
    cursor("- deep");
    command("bullet:zoom-in");
    assert.equal(state().range.labels.at(-1), "deep");
    command("bullet:zoom-out");
    assert.equal(state().range.labels.at(-1), "branch");
    command("bullet:zoom-out");
    assert.equal(state().range.labels.at(-1), "project");
    command("bullet:zoom-reset");
    assert.equal(state().range, null);
    assert.equal(state().doc, fixture);
  });
  check("bullet-click-and-checkbox", () => {
    prepare();
    cursor("- project");
    click(".task-list-item-checkbox", "- [ ] checkbox");
    assert.equal(state().range.labels.at(-1), "project");
    assert.ok(state().doc.includes("[x] checkbox"));
    click(".list-bullet", "- branch");
    assert.equal(state().range.labels.at(-1), "branch");
  });
  check("native-fold-within-zoom", () => {
    prepare();
    cursor("- project");
    click(".collapse-indicator", "- branch");
    assert.equal(state().range.labels.at(-1), "project");
    assert.ok(!state().visible.includes("deep"));
    click(".collapse-indicator", "- branch");
    assert.ok(state().visible.includes("deep"));
  });
  check("typing-undo-redo", () => {
    prepare();
    cursor("- task");
    type(" edited");
    assert.equal(state().doc, fixture.replace("- task", "- task edited"));
    evaluate(() => {
      setTimeout(() => window.__zoomExplore.leaf.view.editor.undo(), 0);
    });
    settle();
    assert.equal(state().doc, fixture);
    assert.ok(state().range);
    evaluate(() => {
      setTimeout(() => window.__zoomExplore.leaf.view.editor.redo(), 0);
    });
    settle();
    assert.equal(state().doc, fixture.replace("- task", "- task edited"));
    assert.ok(state().range);
  });
  check("enter-at-visible-end", () => {
    prepare();
    cursor("- deep");
    key("Enter", "Enter");
    type("new child");
    assert.equal(state().range.labels.at(-1), "project");
    assert.ok(state().visible.includes("new child"));
    assert.ok(!state().visible.includes("other"));
    assert.ok(state().doc.endsWith("\n\t- other\n- personal"));
    return state();
  });
  check("select-all-delete", () => {
    prepare();
    cursor("- task");
    for (let i = 0; i < 5; i++) key("a", "KeyA", 4);
    const selected = state();
    assert.equal(
      selected.selection.from,
      selected.range.from + selected.range.indent.length,
    );
    assert.equal(selected.selection.to, selected.range.to);
    key("Backspace", "Backspace");
    assert.ok(state().doc.startsWith("---\nkind: zoom-test\n---\n- work\n"));
    assert.ok(state().doc.endsWith("\n\t- other\n- personal"));
    return { selected, after: state() };
  });
  check("backspace-at-root-content-start", () => {
    prepare();
    cursor("- project", false);
    key("Backspace", "Backspace");
    assert.ok(state().doc.startsWith("---\nkind: zoom-test\n---\n- work\n"));
    assert.ok(state().doc.endsWith("\n\t- other\n- personal"));
    return state();
  });
  check("outdent-focused-root-boundary", () => {
    prepare();
    cursor("- project");
    key("Tab", "Tab", 8);
    // Moving the focused root changes the hidden parent; currently blocked.
    assert.equal(state().doc, fixture);
    assert.equal(state().range.labels.at(-1), "project");
    return state();
  });
  check("multiline-continuation", () => {
    prepare(
      "- work\n\t- project\n\t  continuation\n\t  \n\t  paragraph\n\t\t- child\n\t- other\n- personal",
    );
    assert.ok(state().visible.includes("continuation"));
    assert.ok(state().visible.includes("paragraph"));
    assert.ok(!state().visible.includes("other"));
    return state();
  });
  check("save-whole-document-visible-change", () => {
    prepare();
    command("bullet:zoom-reset");
    evaluate(() => {
      const e = window.__zoomExplore.leaf.view.editor;
      e.setValue(e.getValue().replace("task", "task changed"));
    });
    assert.ok(state().doc.includes("task changed"), "Unzoomed control failed");
    prepare();
    evaluate(() => {
      const e = window.__zoomExplore.leaf.view.editor;
      e.setValue(e.getValue().replace("task", "task changed"));
    });
    settle();
    assert.ok(state().doc.includes("task changed"));
    const after = state();
    if (after.range) {
      assert.ok(
        after.selection.from >= after.range.from + after.range.indent.length,
      );
      assert.ok(after.selection.to <= after.range.to);
    }
    results.push({
      name: "setValue-selection-policy",
      status: "observation",
      detail: after,
    });
    type(" next");
    assert.ok(
      state().doc.includes(" next"),
      "Typing after setValue was rejected",
    );
    if (after.range)
      assert.ok(state().range, "Typing after setValue cleared zoom");
  });
  check("replace-visible-subtree", () => {
    prepare();
    evaluate(() => {
      const e = window.__zoomExplore.leaf.view.editor;
      const z = app.plugins.plugins.bullet.features
        .find((f) => f.constructor.name === "ListZoom")
        .zoom.range(e.cm.state);
      e.cm.dispatch({
        selection: { anchor: z.from + z.indent.length, head: z.to },
      });
    });
    type("- project\n\t\t- updated task");
    assert.ok(state().doc.includes("updated task"));
    assert.ok(
      state().range,
      "Replacing visible subtree with same root cleared zoom",
    );
  });
  check("whole-replacement-with-visible-selection", () => {
    prepare();
    cursor("- project");
    evaluate(() => {
      const e = window.__zoomExplore.leaf.view.editor;
      e.cm.dispatch({
        changes: {
          from: 0,
          to: e.cm.state.doc.length,
          insert: e.getValue().replace("task", "updated task"),
        },
        selection: e.cm.state.selection,
        filter: false,
      });
    });
    settle();
    assert.ok(state().range);
    assert.ok(state().doc.includes("updated task"));
    type(" continued");
    assert.ok(state().doc.includes("project continued"));
    assert.ok(state().range);
  });
  check("mixed-indentation", () => {
    const positions = () =>
      evaluate(() => {
        const cm = window.__zoomExplore.leaf.view.editor.cm;
        return [...cm.contentDOM.querySelectorAll(".cm-line")].map((el) => ({
          text: el.textContent,
          bullet: el.querySelector(".list-bullet")?.getBoundingClientRect().x,
        }));
      });
    prepare("- work\n\t- project\n\t\t- task\n\t- other");
    cursor("- project");
    const tabs = positions();
    prepare("- work\n\t- project\n        - task\n\t- other");
    cursor("- project");
    const mixed = positions();
    results.push({
      name: "mixed-indentation-positions",
      status: "observation",
      detail: { tabs, mixed },
    });
    assert.equal(
      mixed.find((x) => x.text.includes("task")).bullet,
      tabs.find((x) => x.text.includes("task")).bullet,
      "Equivalent space indent displays at different X after zoom",
    );
  });
  check("partial-tab-indentation", () => {
    const measure = () =>
      evaluate(() => {
        const cm = window.__zoomExplore.leaf.view.editor.cm;
        return [...cm.contentDOM.querySelectorAll(".cm-line")].map((el) => ({
          text: el.textContent,
          bullet: el.querySelector(".list-bullet")?.getBoundingClientRect().x,
          guides: [...el.querySelectorAll(".cm-indent")].map((g) => ({
            text: g.textContent,
            x: g.getBoundingClientRect().x,
            parent: g.parentElement.className,
          })),
        }));
      });
    for (const [parent, child, columns] of [
      ["      ", "\t\t", 2],
      ["      ", "\t\t\t", 6],
      ["      ", "\t \t", 2],
      ["\t  ", "\t\t  ", 4],
    ]) {
      const make = (indent) =>
        `- work\n  - area\n${parent}- project\n${columns === 6 ? "        - branch\n" : ""}${indent}- task\n- other`;
      prepare(make(" ".repeat(6 + columns)));
      cursor("- project");
      const spaces = measure();
      prepare(make(child));
      command("bullet:zoom-reset");
      cursor("- project");
      const native = measure();
      command("bullet:zoom-in");
      cursor("- project");
      const mixed = measure();
      results.push({
        name: "partial-tab-positions",
        status: "observation",
        detail: { parent, child, columns, native, spaces, mixed },
      });
      const x = (lines) =>
        lines.find((line) => line.text.includes("task"))?.bullet;
      if (typeof x(native) !== "number") {
        assert.equal(x(mixed), undefined, "Zoom invented a native bullet");
        assert.equal(state().doc, make(child));
        results.push({
          name: "native-non-list-indent",
          status: "observation",
          detail: {
            parent,
            child,
            reason:
              "Obsidian does not render this prefix as a list even without zoom",
          },
        });
        continue;
      }
      assert.equal(typeof x(mixed), "number", "Child lost its native bullet");
      assert.equal(
        x(mixed),
        x(spaces),
        "Partial tab remainder differs from equivalent spaces",
      );
      assert.equal(state().doc, make(child), "Display changed Markdown");
      const guides = (lines) =>
        lines.find((line) => line.text.includes("task")).guides;
      assert.deepEqual(
        guides(mixed).map((g) => g.x),
        guides(spaces).map((g) => g.x),
        "Native guide positions differ",
      );
      assert.ok(
        guides(mixed).every((g) => g.parent.includes("cm-hmd-list-indent")),
        "A zoom mark broke native guide ancestry",
      );
      screenshot(`partial-tab-${columns}-${child.length}`);
    }
  });
  check("same-note-other-pane-visible-change", () => {
    prepare();
    evaluate(async () => {
      const check = window.__zoomExplore;
      check.second = app.workspace.getLeaf("split", "vertical");
      await check.second.openFile(check.files[0]);
      const e = check.second.view.editor;
      const line = e
        .getValue()
        .split("\n")
        .findIndex((s) => s.trim() === "- task");
      if (line < 0) throw Error("Second pane fixture not synchronized");
      e.replaceRange(" changed", { line, ch: e.getLine(line).length });
      await check.second.view.save();
    });
    settle();
    const after = state();
    evaluate(() => {
      window.__zoomExplore.second.detach();
      window.__zoomExplore.second = null;
    });
    assert.ok(after.doc.includes("task changed"));
    assert.ok(after.range, "Other pane's visible-only edit cleared zoom");
    return after;
  });
  check("note-switch-identical-content", () => {
    prepare();
    evaluate(async (fixture) => {
      const check = window.__zoomExplore;
      const file = await app.vault.create(
        check.files[0].basename + "-same.md",
        fixture,
      );
      check.files.push(file);
      await check.leaf.openFile(file);
    }, fixture);
    settle();
    assert.equal(state().range, null);
    assert.equal(state().doc, fixture);
    evaluate(async () => {
      const c = window.__zoomExplore;
      await c.leaf.openFile(c.files[0]);
    });
  });
  check("note-rename-while-zoomed", () => {
    prepare();
    evaluate(async () => {
      const file = window.__zoomExplore.files[0];
      await app.fileManager.renameFile(file, file.basename + "-renamed.md");
    });
    settle();
    assert.ok(state().range, "Renaming the same note cleared zoom");
    const renamed = state();
    assert.ok(
      renamed.breadcrumbs[0].endsWith("-renamed"),
      "Breadcrumb stayed stale until an editor transaction",
    );
    cursor("- task");
    type(" after rename");
    results.push({
      name: "rename-edit-observation",
      status: "observation",
      detail: { renamed, edited: state() },
    });
    assert.ok(state().range, "First edit after rename cleared zoom");
    assert.ok(state().breadcrumbs[0].endsWith("-renamed"));
  });
  check("plugin-reload", () => {
    prepare();
    evaluate(async () => {
      await app.plugins.disablePlugin("bullet");
      await app.plugins.enablePlugin("bullet");
    });
    settle();
    assert.equal(state().range, null);
    assert.equal(state().doc, fixture);
    cursor("- project");
    command("bullet:zoom-in");
    assert.ok(state().range);
  });
  screenshot("desktop-final");
  const errors = evaluate(() => window.__zoomExplore.errors);
  results.push({
    name: "renderer-errors",
    status: errors.length ? "finding" : "pass",
    detail: errors,
  });
} finally {
  cdp("Emulation.clearDeviceMetricsOverride");
  evaluate(async (initial) => {
    const c = window.__zoomExplore;
    if (c) {
      window.removeEventListener("error", c.onError);
      window.removeEventListener("unhandledrejection", c.onError);
      if (c.second) {
        await c.second.view.save();
        c.second.detach();
      }
      await c.leaf.view.save();
      c.leaf.detach();
      for (const file of c.files)
        if (app.vault.getAbstractFileByPath(file.path))
          await app.vault.trash(file, true);
      delete window.__zoomExplore;
    }
    if (!initial.left) app.workspace.leftSplit.expand();
    if (!initial.right) app.workspace.rightSplit.expand();
    const leaf = app.workspace.getLeafById(initial.leaf);
    if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
  }, initial);
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
}
