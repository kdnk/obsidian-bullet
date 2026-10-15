const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");
const output = process.argv[2];
fs.mkdirSync(output);
const note = `pages/code-editing-regressions-${randomUUID()}.md`;
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  vim: app.vault.config.vimMode ?? false,
  shiki: !!app.plugins.plugins["shiki-highlighter"],
}));
const results = [];
const failures = [];
const cases = [
  {
    name: "partial-tab split",
    text: "- ```js\n\tfooBAR\n  ```",
    cursor: { line: 1, ch: 4 },
    key: "Enter",
    modifiers: 8,
    expected: "- ```js\n\tfoo\n  BAR\n  ```",
    typed: "- ```js\n\tfoo\n  XBAR\n  ```",
  },
  {
    name: "partial-tab join",
    text: "- ```js\n\tfoo\n  BAR\n  ```",
    cursor: { line: 2, ch: 2 },
    key: "Backspace",
    expected: "- ```js\n\tfooBAR\n  ```",
    typed: "- ```js\n\tfooXBAR\n  ```",
  },
];
function focus() {
  evaluate(() => {
    window.focus();
    if (
      !document.title.includes(" - vault - ") ||
      document.visibilityState !== "visible"
    )
      throw Error("Wrong visible test vault");
    app.workspace.activeLeaf.view.editor.focus();
  });
}
function key(key, modifiers = 0) {
  const codes = { Enter: 13, Backspace: 8, Escape: 27, i: 73, z: 90 };
  for (const type of ["keyDown", "keyUp"]) {
    focus();
    evaluate((type) => {
      const cm = app.workspace.activeLeaf.view.editor.cm;
      if (!cm.hasFocus) throw Error("Editor does not have keyboard focus");
      window.__codeEditingReceivedKey = null;
      window.addEventListener(
        type.toLowerCase(),
        (event) => {
          window.__codeEditingReceivedKey = event.key;
        },
        { capture: true, once: true },
      );
    }, type);
    cdp("Input.dispatchKeyEvent", {
      type,
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      windowsVirtualKeyCode: codes[key],
      modifiers,
    });
    assert.equal(
      evaluate(() => window.__codeEditingReceivedKey),
      key,
      `${type} was not received by the renderer`,
    );
  }
}
function type(text) {
  focus();
  cdp("Input.insertText", { text });
}
function state() {
  return evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const v = app.workspace.activeLeaf.view;
    await v.save();
    return {
      doc: v.editor.getValue(),
      cursor: v.editor.getCursor(),
      saved: await app.vault.read(v.file),
    };
  });
}
function check(name, run) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error: error.message });
    console.log(`FAIL ${name}: ${error.message}`);
  }
}
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (note) => {
    window.__codeEditingRegressionLeaf = app.workspace.getLeaf("tab");
    await window.__codeEditingRegressionLeaf.openFile(
      await app.vault.create(note, ""),
    );
  }, note);
  for (const shiki of [false, true]) {
    evaluate(async (enabled) => {
      if (enabled) await app.plugins.enablePlugin("shiki-highlighter");
      else await app.plugins.disablePlugin("shiki-highlighter");
      app.vault.setConfig("vimMode", false);
      app.workspace.updateOptions();
    }, shiki);
    for (const fixture of cases) {
      evaluate(async (fixture) => {
        const e = app.workspace.activeLeaf.view.editor;
        e.setValue(fixture.text);
        e.setCursor(fixture.cursor);
        e.focus();
        await new Promise((resolve) => setTimeout(resolve, 150));
      }, fixture);
      const before = state();
      key(fixture.key, fixture.modifiers);
      const after = state();
      key("z", 4);
      const undone = state();
      key("z", 12);
      const redone = state();
      type("X");
      const typed = state();
      const name = `${fixture.name}-${shiki ? "shiki" : "native"}`;
      results.push({ name, before, after, undone, redone, typed });
      check(name, () => {
        assert.equal(before.doc, fixture.text);
        assert.equal(after.doc, fixture.expected);
        assert.equal(undone.doc, fixture.text);
        assert.equal(redone.doc, fixture.expected);
        assert.equal(typed.doc, fixture.typed);
        assert.equal(typed.saved, fixture.typed);
      });
    }
    for (const fixture of [
      {
        name: "blank and populated code rows",
        text: "- ```js\n\n  hello\n  ```",
        cursors: [
          { line: 1, ch: 0 },
          { line: 2, ch: 7 },
        ],
        expected: "- ```js\n  x\n  hellox\n  ```",
      },
      {
        name: "two blank code rows and outside text",
        text: "- ```js\n\n\n  ```\n",
        cursors: [
          { line: 1, ch: 0 },
          { line: 2, ch: 0 },
          { line: 4, ch: 0 },
        ],
        expected: "- ```js\n  x\n  x\n  ```\n- x",
      },
    ]) {
      evaluate(async (fixture) => {
        const editor = app.workspace.activeLeaf.view.editor;
        editor.setValue(fixture.text);
        editor.setSelections(
          fixture.cursors.map((cursor) => ({ anchor: cursor, head: cursor })),
        );
        editor.focus();
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (editor.listSelections().length !== fixture.cursors.length)
          throw Error("Multiple selections were not installed");
      }, fixture);
      type("x");
      const after = state();
      key("z", 4);
      const undone = state();
      key("z", 12);
      const redone = state();
      const name = `${fixture.name}-${shiki ? "shiki" : "native"}`;
      results.push({ name, after, undone, redone });
      check(name, () => {
        assert.equal(after.doc, fixture.expected);
        assert.equal(after.saved, fixture.expected);
        assert.equal(undone.doc, fixture.text);
        assert.equal(redone.doc, fixture.expected);
      });
    }
    for (const prefix of ["", "  "]) {
      const text = `- \`\`\`js\n${prefix}\n  \`\`\``;
      evaluate(async (text) => {
        app.vault.setConfig("vimMode", true);
        app.workspace.updateOptions();
        const e = app.workspace.activeLeaf.view.editor;
        e.setValue(text);
        e.setCursor(1, 0);
        e.focus();
        await new Promise((resolve) => setTimeout(resolve, 150));
      }, text);
      key("Escape");
      key("i");
      type("x");
      const first = state();
      type("y");
      const second = state();
      const name = `${prefix ? "indented" : "physical"}-blank-${shiki ? "shiki" : "native"}`;
      results.push({ name, first, second });
      check(name, () => {
        assert.equal(first.doc, "- ```js\n  x\n  ```");
        assert.equal(second.doc, "- ```js\n  xy\n  ```");
        assert.equal(second.saved, second.doc);
      });
      key("Escape");
    }
  }
} finally {
  fs.writeFileSync(
    `${output}/results.json`,
    JSON.stringify({ results, failures }, null, 2),
  );
  evaluate(
    async (original, note) => {
      window.__codeEditingRegressionLeaf?.detach();
      delete window.__codeEditingRegressionLeaf;
      delete window.__codeEditingReceivedKey;
      app.vault.setConfig("vimMode", original.vim);
      app.workspace.updateOptions();
      if (original.shiki) await app.plugins.enablePlugin("shiki-highlighter");
      else await app.plugins.disablePlugin("shiki-highlighter");
      const leaf = app.workspace.getLeafById(original.leaf);
      if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.trash(file, true);
    },
    original,
    note,
  );
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
}
assert.equal(failures.length, 0, `${failures.length} editing regressions`);
