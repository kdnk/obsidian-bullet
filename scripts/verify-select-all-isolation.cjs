const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const id = randomUUID();
const notes = [`pages/select-all-a-${id}.md`, `pages/select-all-b-${id}.md`];
const results = [];
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  vim: app.vault.config.vimMode ?? false,
  selectAll: app.plugins.plugins.bullet.settings.overrideSelectAllBehaviour,
}));
function activate(index) {
  evaluate((index) => {
    app.workspace.setActiveLeaf(window.__selectAllLeaves[index], {
      focus: true,
    });
    window.focus();
    if (!document.title.includes("vault") || document.title.includes("base"))
      throw Error("Wrong vault");
    const editor = window.__selectAllLeaves[index].view.editor;
    editor.focus();
    if (!editor.cm.hasFocus) throw Error("Missing editor focus");
  }, index);
}
function selectAll(index) {
  for (const type of ["keyDown", "keyUp"]) {
    activate(index);
    cdp("Input.dispatchKeyEvent", {
      type,
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      modifiers: 4,
    });
  }
}
function sample(index) {
  return evaluate((index) => {
    const e = window.__selectAllLeaves[index].view.editor;
    return {
      doc: e.getValue(),
      selections: e.listSelections(),
      selected: e.getSelection(),
    };
  }, index);
}
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (notes) => {
    app.vault.setConfig("vimMode", false);
    app.workspace.updateOptions();
    app.plugins.plugins.bullet.settings.overrideSelectAllBehaviour = true;
    window.__selectAllLeaves = [];
    for (let i = 0; i < 2; i++) {
      const leaf = app.workspace.getLeaf(i === 0 ? "tab" : "split");
      window.__selectAllLeaves.push(leaf);
      await leaf.openFile(
        await app.vault.create(
          notes[i],
          i === 0 ? "- first A\n- second A" : "- first B\n- second B",
        ),
      );
      leaf.view.editor.setCursor({ line: i === 0 ? 1 : 0, ch: 4 });
    }
  }, notes);
  selectAll(0);
  selectAll(0);
  results.push({ name: "A expanded", ...sample(0) });
  selectAll(1);
  results.push({ name: "B content", ...sample(1) });
  selectAll(0);
  const returned = sample(0);
  results.push({ name: "A returned", ...returned });
  assert.equal(returned.selected, "second A");
  activate(0);
  cdp("Input.insertText", { text: "replacement" });
  const typed = sample(0);
  results.push({ name: "replacement", ...typed });
  assert.equal(typed.doc, "- first A\n- replacement");
  const saved = evaluate(async () => {
    const view = window.__selectAllLeaves[0].view;
    await view.save();
    return app.vault.read(view.file);
  });
  assert.equal(saved, typed.doc);
  assert.equal(sample(1).doc, "- first B\n- second B");
  fs.writeFileSync(
    path.join(output, "result.png"),
    Buffer.from(
      cdp("Page.captureScreenshot", { format: "png" }).data,
      "base64",
    ),
  );
  console.log(
    "PASS independent select-all cycles and replacement in two panes",
  );
} finally {
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(results, null, 2),
  );
  evaluate(
    async (original, notes) => {
      for (const leaf of window.__selectAllLeaves ?? []) leaf.detach();
      delete window.__selectAllLeaves;
      for (const note of notes) {
        const file = app.vault.getAbstractFileByPath(note);
        if (file) await app.vault.trash(file, true);
      }
      app.plugins.plugins.bullet.settings.overrideSelectAllBehaviour =
        original.selectAll;
      app.vault.setConfig("vimMode", original.vim);
      app.workspace.updateOptions();
      const leaf = app.workspace.getLeafById(original.leaf);
      if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
    },
    original,
    notes,
  );
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
}
