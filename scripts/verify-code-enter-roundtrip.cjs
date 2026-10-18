const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");

const output = process.argv[2];
fs.mkdirSync(output);
const note = `pages/code-enter-roundtrip-${randomUUID()}.md`;
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  vim: app.vault.config.vimMode,
  shiki: !!app.plugins.plugins["shiki-highlighter"],
}));
const results = [];
const failures = [];
const inputs = [];
let vim = false;
const fixtures = [
  {
    name: "reported five-space code indent",
    text: "- a- Threading test \n  - Parent \n    - Selected item\n    -  \n```\n     llo  \n\n```\n      -",
    cursor: { line: 5, ch: 8 },
    entered:
      "- a- Threading test \n  - Parent \n    - Selected item\n    -  \n```\n     llo\n       \n\n```\n      -",
    enterCursor: { line: 6, ch: 5 },
    typed:
      "- a- Threading test \n  - Parent \n    - Selected item\n    -  \n```\n     lloX  \n\n```\n      -",
  },
  {
    name: "root code indent",
    text: "```\n     llo\n```",
    cursor: { line: 1, ch: 8 },
    entered: "```\n     llo\n     \n```",
    enterCursor: { line: 2, ch: 5 },
    typed: "```\n     lloX\n```",
  },
  {
    name: "attached fence with partial tab",
    text: "- parent\n\t- ```\n\t\tllo\n\t  ```",
    cursor: { line: 2, ch: 5 },
    entered: "- parent\n\t- ```\n\t\tllo\n\t\t\n\t  ```",
    enterCursor: { line: 3, ch: 2 },
    typed: "- parent\n\t- ```\n\t\tlloX\n\t  ```",
  },
  {
    name: "continuation fence with trailing spaces",
    text: "- title\n  ```\n\tllo  \n  ```",
    cursor: { line: 2, ch: 4 },
    entered: "- title\n  ```\n\tllo\n\t  \n  ```",
    enterCursor: { line: 3, ch: 1 },
    typed: "- title\n  ```\n\tlloX  \n  ```",
  },
];

function focus() {
  evaluate((vim) => {
    window.focus();
    const editor = app.workspace.activeLeaf.view.editor;
    editor.focus();
    if (
      !document.title.includes(" - vault - ") ||
      document.title.includes("base") ||
      !editor.cm.hasFocus ||
      app.isVimEnabled() !== vim ||
      !!editor.cm.cm !== vim
    )
      throw Error("Test editor input guard");
  }, vim);
}

function key(key, modifiers = 0) {
  const codes = { Enter: 13, Backspace: 8, Escape: 27, i: 73, z: 90 };
  focus();
  evaluate(() => {
    window.__codeEnterReceived = [];
    const target = app.workspace.activeLeaf.view.editor.cm.contentDOM;
    const receive = (event) => {
      window.__codeEnterReceived.push({
        type: event.type,
        key: event.key,
        composing: event.isComposing,
        editorTarget: event.target === target,
      });
    };
    target.addEventListener("keydown", receive, true);
    target.addEventListener("keyup", receive, true);
    window.__codeEnterDispose = () => {
      target.removeEventListener("keydown", receive, true);
      target.removeEventListener("keyup", receive, true);
    };
  });
  for (const type of ["keyDown", "keyUp"])
    cdp("Input.dispatchKeyEvent", {
      type,
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      windowsVirtualKeyCode: codes[key],
      modifiers,
    });
  const received = evaluate(() => {
    window.__codeEnterDispose();
    delete window.__codeEnterDispose;
    const received = window.__codeEnterReceived;
    delete window.__codeEnterReceived;
    return received;
  });
  inputs.push({ key, modifiers, received });
  assert.deepEqual(
    received.map((event) => [event.type, event.key, event.editorTarget]),
    [
      ["keydown", key, true],
      ["keyup", key, true],
    ],
    "Native key did not reach the test editor",
  );
}

function state() {
  return evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const view = app.workspace.activeLeaf.view;
    await view.save();
    return {
      doc: view.editor.getValue(),
      cursor: view.editor.getCursor(),
      saved: await app.vault.read(view.file),
    };
  });
}

function screenshot(name) {
  const shot = cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${output}/${name}.png`, Buffer.from(shot.data, "base64"));
}

try {
  evaluate(async (note) => {
    window.__codeEnterLeaf = app.workspace.getLeaf("tab");
    await window.__codeEnterLeaf.openFile(await app.vault.create(note, ""));
  }, note);
  for (const useVim of [false, true]) {
    vim = useVim;
    evaluate(async (enabled) => {
      app.vault.setConfig("vimMode", enabled);
      await app.vault.saveConfig();
      app.workspace.updateOptions();
    }, vim);
    for (const shiki of [false, true]) {
      evaluate(async (enabled) => {
        if (enabled) await app.plugins.enablePlugin("shiki-highlighter");
        else await app.plugins.disablePlugin("shiki-highlighter");
      }, shiki);
      for (const fixture of fixtures) {
        const name = `${fixture.name}-${vim ? "vim" : "default"}-${shiki ? "shiki" : "native"}`;
        const record = { name, cycles: [] };
        try {
          if (vim) key("Escape");
          evaluate((fixture) => {
            const editor = app.workspace.activeLeaf.view.editor;
            editor.setValue(fixture.text);
            editor.setCursor(fixture.cursor);
            editor.focus();
          }, fixture);
          if (vim) {
            key("i");
            evaluate(
              (cursor) =>
                app.workspace.activeLeaf.view.editor.setCursor(cursor),
              fixture.cursor,
            );
          }
          record.before = state();
          assert.equal(record.before.doc, fixture.text);
          assert.deepEqual(record.before.cursor, fixture.cursor);
          if (!vim && !shiki && fixture === fixtures[0]) screenshot("before");
          for (let cycle = 0; cycle < 2; cycle++) {
            key("Enter");
            const entered = state();
            assert.equal(entered.doc, fixture.entered);
            assert.deepEqual(entered.cursor, fixture.enterCursor);
            if (!vim && !shiki && fixture === fixtures[0]) screenshot("enter");
            key("Backspace");
            const restored = state();
            record.cycles.push({ entered, restored });
            assert.equal(
              restored.doc,
              fixture.text,
              "One Backspace must reverse Enter exactly",
            );
            assert.equal(restored.saved, fixture.text);
            assert.deepEqual(restored.cursor, fixture.cursor);
            if (!vim && !shiki && fixture === fixtures[0])
              screenshot("backspace");
          }
          key("z", 4);
          record.undone = state();
          assert.equal(record.undone.doc, fixture.entered);
          key("z", 12);
          record.redone = state();
          assert.equal(record.redone.doc, fixture.text);
          assert.deepEqual(record.redone.cursor, fixture.cursor);
          focus();
          cdp("Input.insertText", { text: "X" });
          record.typed = state();
          assert.equal(record.typed.doc, fixture.typed);
          assert.equal(record.typed.saved, fixture.typed);
          console.log(`PASS ${name}`);
        } catch (error) {
          failures.push({ name, error: error.message });
          console.log(`FAIL ${name}: ${error.message}`);
        }
        results.push(record);
      }
    }
  }
} finally {
  fs.writeFileSync(
    `${output}/results.json`,
    JSON.stringify({ results, failures, inputs }, null, 2),
  );
  evaluate(
    async (original, note) => {
      window.__codeEnterDispose?.();
      delete window.__codeEnterDispose;
      delete window.__codeEnterReceived;
      window.__codeEnterLeaf?.detach();
      delete window.__codeEnterLeaf;
      app.vault.setConfig("vimMode", original.vim);
      await app.vault.saveConfig();
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
}
assert.equal(
  failures.length,
  0,
  `${failures.length} code Enter roundtrip failures`,
);
