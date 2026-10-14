const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");

const output = process.argv[2];
assert.ok(output, "Supply a fresh output directory");
fs.mkdirSync(output);
const note = `fence-prefixes-${randomUUID()}.md`;
const fixtures = [
  { name: "tab", opening: "-\t```js", indent: "\t", openingCh: 2 },
  { name: "spaces", opening: "-   ```js", indent: "    ", openingCh: 4 },
  { name: "ordered", opening: "10.   ```js", indent: "      ", openingCh: 6 },
  { name: "baseline", opening: "- ```js", indent: "  ", openingCh: 2 },
];
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  vim: app.vault.config.vimMode ?? false,
  shiki: !!app.plugins.plugins["shiki-highlighter"],
  shikiSettings: app.plugins.plugins["shiki-highlighter"]?.settings,
}));
let leaf;
const results = [];
fs.writeFileSync(
  path.join(output, "fixture.json"),
  JSON.stringify({ note, fixtures }, null, 2),
);

function guard() {
  evaluate((note) => {
    window.focus();
    if (
      !document.title.includes("vault") ||
      document.title.includes("base") ||
      document.visibilityState !== "visible" ||
      app.workspace.activeLeaf.view.file.path !== note
    )
      throw Error("Wrong verification window or note");
  }, note);
}

function key(key, code, keyCode, modifiers = 0) {
  for (const type of ["keyDown", "keyUp"]) {
    guard();
    cdp("Input.dispatchKeyEvent", {
      type,
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
      modifiers,
    });
  }
  evaluate(async () => new Promise((resolve) => setTimeout(resolve, 80)));
}

function type(text) {
  guard();
  cdp("Input.insertText", { text });
}

function setup(text, line, vim) {
  evaluate(
    async (text, line, vim) => {
      app.vault.setConfig("vimMode", vim);
      app.workspace.updateOptions();
      const editor = app.workspace.activeLeaf.view.editor;
      editor.setValue(text);
      editor.setCursor({ line, ch: editor.getLine(line).length });
      editor.focus();
      await new Promise((resolve) => setTimeout(resolve, 180));
    },
    text,
    line,
    vim,
  );
}

function snapshot(name) {
  const state = evaluate(async () => {
    const view = app.workspace.activeLeaf.view;
    await view.save();
    return {
      doc: view.editor.getValue(),
      cursor: view.editor.getCursor(),
      saved: await app.vault.read(view.file),
    };
  });
  results.push({ name, ...state });
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(results, null, 2),
  );
  assert.equal(state.saved, state.doc, `${name}: saved Markdown`);
  return state;
}

try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  leaf = evaluate(async (note) => {
    const leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(await app.vault.create(note, ""));
    return leaf.id;
  }, note);
  for (const mode of ["native", "shiki", "numbered"]) {
    evaluate(async (mode) => {
      const id = "shiki-highlighter";
      if (mode === "native") await app.plugins.disablePlugin(id);
      else {
        if (!app.plugins.plugins[id]) await app.plugins.enablePlugin(id);
        if (!app.plugins.plugins[id]) throw Error("Shiki must be installed");
        app.plugins.plugins[id].settings.ecDefaultShowLineNumbers =
          mode === "numbered";
        await app.plugins.plugins[id].reloadHighlighter();
      }
    }, mode);
    for (const fixture of fixtures) {
      const lines = [
        fixture.opening,
        fixture.indent + "code",
        fixture.indent + "```",
      ];
      const text = lines.join("\n");
      for (const line of [0, 1, 2]) {
        const name = `${mode}-${fixture.name}-vim-${line}`;
        setup(text, line, true);
        key("Escape", "Escape", 27);
        key("0", "Digit0", 48);
        for (let i = 0; i < 3; i++) key("h", "KeyH", 72);
        const ch = line === 0 ? fixture.openingCh : fixture.indent.length;
        assert.deepEqual(
          snapshot(name + "-boundary").cursor,
          { line, ch },
          name,
        );
        key("i", "KeyI", 73);
        type("X");
        const expected = [...lines];
        expected[line] =
          expected[line].slice(0, ch) + "X" + expected[line].slice(ch);
        assert.equal(snapshot(name + "-typed").doc, expected.join("\n"), name);
      }
      setup(text, 1, false);
      key("Tab", "Tab", 9, 8);
      assert.equal(snapshot(`${mode}-${fixture.name}-outdent`).doc, text);
      type("Y");
      const typed = [lines[0], lines[1] + "Y", lines[2]].join("\n");
      assert.equal(
        snapshot(`${mode}-${fixture.name}-following-input`).doc,
        typed,
      );
      key("z", "KeyZ", 90, 4);
      assert.equal(snapshot(`${mode}-${fixture.name}-undo`).doc, text);
      key("z", "KeyZ", 90, 12);
      assert.equal(snapshot(`${mode}-${fixture.name}-redo`).doc, typed);
      fs.writeFileSync(
        path.join(output, `${mode}-${fixture.name}.png`),
        Buffer.from(
          cdp("Page.captureScreenshot", { format: "png" }).data,
          "base64",
        ),
      );
    }
  }
} finally {
  evaluate(
    async (original, note, leaf) => {
      if (leaf) app.workspace.getLeafById(leaf)?.detach();
      app.vault.setConfig("vimMode", original.vim);
      app.workspace.updateOptions();
      const id = "shiki-highlighter";
      if (original.shiki) {
        if (!app.plugins.plugins[id]) await app.plugins.enablePlugin(id);
        app.plugins.plugins[id].settings = original.shikiSettings;
        await app.plugins.plugins[id].reloadHighlighter();
      } else await app.plugins.disablePlugin(id);
      const previous = app.workspace.getLeafById(original.leaf);
      if (previous) app.workspace.setActiveLeaf(previous);
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.trash(file, true);
    },
    original,
    note,
    leaf,
  );
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
}
console.log(JSON.stringify({ checks: results.length, failures: [] }));
