const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

const output = process.argv[2];
assert.ok(
  output && path.isAbsolute(output),
  "Use a fresh absolute output directory",
);
fs.mkdirSync(output);
const note = `pages/Leaf zoom setting ${randomUUID()}.md`;
const results = [];
const initial = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  preference: app.plugins.plugins.bullet.settings.createChildOnLeafZoom,
  settingsPopout: app.vault.getConfig("settingsPopoutWindow"),
  vim: app.vault.getConfig("vimMode"),
}));

function focus() {
  evaluate(() => {
    window.focus();
    if (
      !document.title.includes(" - vault - ") ||
      document.title.includes("base")
    )
      throw Error("Test window guard");
    app.workspace.setActiveLeaf(window.__leafZoomSetting.leaf, { focus: true });
    window.__leafZoomSetting.leaf.view.editor.focus();
  });
}

function click(point) {
  for (const type of ["mousePressed", "mouseReleased"]) {
    evaluate(({ x, y }) => {
      window.focus();
      if (
        !document.title.includes(" - vault - ") ||
        document.title.includes("base")
      )
        throw Error("Test window guard");
      const target = document.elementFromPoint(x, y);
      if (
        !target?.closest(
          ".checkbox-container, .list-bullet, .bullet-zoom-breadcrumbs button",
        )
      )
        throw Error("Native click target is covered");
    }, point);
    cdp("Input.dispatchMouseEvent", {
      type,
      ...point,
      button: "left",
      clickCount: 1,
    });
  }
}

function sample(name) {
  const state = evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    const editor = window.__leafZoomSetting.leaf.view.editor;
    await window.__leafZoomSetting.leaf.view.save();
    return {
      doc: editor.getValue(),
      saved: await app.vault.read(window.__leafZoomSetting.file),
      cursor: editor.getCursor(),
      labels: Array.from(
        editor.cm.dom.querySelectorAll(".bullet-zoom-breadcrumbs button"),
        (button) => button.textContent,
      ),
      enabled: app.plugins.plugins.bullet.settings.createChildOnLeafZoom,
    };
  });
  assert.equal(state.saved, state.doc, "Saved Markdown matches the editor");
  results.push({ name, ...state });
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(results, null, 2),
  );
  fs.writeFileSync(
    path.join(output, `${name}.png`),
    Buffer.from(cdp("Page.captureScreenshot").data, "base64"),
  );
  return state;
}

function setup(prefix = "- ") {
  const doc = `- parent\n\t${prefix}leaf\n\t- sibling\n- after`;
  evaluate(async (doc) => {
    app.commands.executeCommandById("bullet:zoom-reset");
    const editor = window.__leafZoomSetting.leaf.view.editor;
    editor.setValue(doc);
    editor.setCursor({ line: 1, ch: editor.getLine(1).length });
    await new Promise((resolve) => setTimeout(resolve, 350));
  }, doc);
  focus();
  assert.equal(sample(`setup-${results.length}`).doc, doc);
  return doc;
}

function bulletClick() {
  focus();
  const point = evaluate(async () => {
    const cm = window.__leafZoomSetting.leaf.view.editor.cm;
    const line = Array.from(cm.contentDOM.querySelectorAll(".cm-line")).find(
      (row) => cm.state.doc.lineAt(cm.posAtDOM(row)).number === 2,
    );
    const target = line?.querySelector(".list-bullet");
    if (!target) throw Error("Missing native leaf bullet");
    target.scrollIntoView({ block: "center" });
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const rect = target.getBoundingClientRect();
    return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  });
  click(point);
}

function togglePreference() {
  evaluate(() => {
    app.setting.close();
    app.vault.setConfig("settingsPopoutWindow", false);
    app.setting.open();
    app.setting.openTabById("bullet");
  });
  const point = evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    const row = Array.from(document.querySelectorAll(".setting-item")).find(
      (item) =>
        item.querySelector(".setting-item-name")?.textContent ===
        "Create a child when zooming into a leaf item",
    );
    const toggle = row?.querySelector(".checkbox-container");
    if (!toggle) throw Error("Missing leaf zoom setting");
    toggle.scrollIntoView({ block: "center" });
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const rect = toggle.getBoundingClientRect();
    return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  });
  sample(`settings-${results.length}`);
  click(point);
  evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    app.setting.close();
  });
}

cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
try {
  evaluate(async (note) => {
    if (document.visibilityState !== "visible")
      throw Error("Renderer must be visible");
    app.vault.setConfig("vimMode", false);
    const settings = app.plugins.plugins.bullet.settings;
    settings.createChildOnLeafZoom = true;
    await settings.save();
    const file = await app.vault.create(note, "- leaf");
    const leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    window.__leafZoomSetting = { leaf, file };
  }, note);
  let doc = setup();
  bulletClick();
  let state = sample("enabled-bullet");
  assert.equal(state.doc, doc.replace("leaf\n", "leaf\n\t\t- \n"));
  assert.deepEqual(state.cursor, { line: 2, ch: 4 });
  assert.equal(state.labels.at(-1), "leaf");

  togglePreference();
  assert.equal(sample("disabled-live").enabled, false);
  doc = setup();
  bulletClick();
  state = sample("disabled-bullet");
  assert.equal(state.doc, doc);
  assert.deepEqual(state.cursor, { line: 1, ch: 3 });
  assert.equal(state.labels.at(-1), "leaf");
  focus();
  cdp("Input.insertText", { text: "X" });
  assert.equal(
    sample("disabled-following-input").doc,
    doc.replace("leaf", "Xleaf"),
  );

  evaluate(async () => {
    await app.plugins.disablePlugin("bullet");
    await app.plugins.enablePlugin("bullet");
  });
  assert.equal(sample("disabled-after-reload").enabled, false);
  for (const prefix of ["- ", "12. ", "- [ ] "]) {
    doc = setup(prefix);
    evaluate(() => app.commands.executeCommandById("bullet:zoom-in"));
    state = sample(`disabled-command-${results.length}`);
    assert.equal(state.doc, doc);
    assert.deepEqual(state.cursor, { line: 1, ch: 1 + prefix.length });
    assert.equal(
      state.labels.at(-1),
      prefix === "- [ ] " ? "[ ] leaf" : "leaf",
    );
    evaluate(() => app.commands.executeCommandById("bullet:zoom-out"));
    state = sample(`ancestor-${results.length}`);
    assert.equal(state.doc, doc);
    assert.equal(state.labels.at(-1), "parent");
    evaluate(() => app.commands.executeCommandById("bullet:zoom-reset"));
    assert.deepEqual(sample(`reset-${results.length}`).labels, []);
  }

  doc = setup();
  evaluate(() => app.commands.executeCommandById("bullet:zoom-in"));
  evaluate(() => {
    const editor = window.__leafZoomSetting.leaf.view.editor;
    editor.setCursor({ line: 1, ch: editor.getLine(1).length });
  });
  assert.deepEqual(sample("before-explicit-enter").cursor, {
    line: 1,
    ch: 7,
  });
  for (const type of ["keyDown", "keyUp"]) {
    focus();
    cdp("Input.dispatchKeyEvent", {
      type,
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      ...(type === "keyDown" ? { text: "\r" } : {}),
    });
  }
  state = sample("disabled-explicit-enter");
  assert.equal(state.doc, doc.replace("leaf\n", "leaf\n\t\t- \n"));
  assert.deepEqual(state.cursor, { line: 2, ch: 4 });
  focus();
  cdp("Input.insertText", { text: "child" });
  assert.equal(
    sample("disabled-enter-following-input").doc,
    doc.replace("leaf\n", "leaf\n\t\t- child\n"),
  );
  togglePreference();
  assert.equal(sample("reenabled-live").enabled, true);
  doc = setup();
  bulletClick();
  assert.equal(
    sample("reenabled-bullet").doc,
    doc.replace("leaf\n", "leaf\n\t\t- \n"),
  );
  console.log(
    JSON.stringify({ passed: results.map(({ name }) => name), output }),
  );
} finally {
  try {
    evaluate(async (initial) => {
      app.setting.close();
      app.vault.setConfig("settingsPopoutWindow", initial.settingsPopout);
      app.vault.setConfig("vimMode", initial.vim);
      const settings = app.plugins.plugins.bullet.settings;
      settings.createChildOnLeafZoom = initial.preference;
      await settings.save();
      app.commands.executeCommandById("bullet:zoom-reset");
      const check = window.__leafZoomSetting;
      if (check) {
        await check.leaf.view.save();
        check.leaf.detach();
        await app.vault.trash(check.file, true);
        delete window.__leafZoomSetting;
      }
      const leaf = app.workspace.getLeafById(initial.leaf);
      if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
    }, initial);
  } finally {
    cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
  }
}
