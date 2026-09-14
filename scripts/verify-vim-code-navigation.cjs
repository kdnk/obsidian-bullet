// Exercise native Vim input against the deployed build in the repository vault.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const note = `vim-code-navigation-${randomUUID()}.md`;
const original = evaluate(() => {
  if (
    !app.plugins.plugins.bullet?.settings.betterListsStyles ||
    !document.body.classList.contains("bullet-plugin-better-lists")
  )
    throw Error("Bullet list styles must be active before Vim verification");
  return {
    leaf: app.workspace.activeLeaf.id,
    vimMode: app.vault.config.vimMode ?? false,
    shiki: !!app.plugins.plugins["shiki-highlighter"],
  };
});
const fixtures = [
  { name: "attached", text: "- before\n- ```js\n  one\n  two\n  ```\n- after" },
  {
    name: "nested",
    text: "- before\n\t- ```js\n\t  one\n\t  two\n\t  ```\n\t- after",
  },
  { name: "empty", text: "- before\n- ```js\n  ```\n- after" },
  {
    name: "blank row",
    text: "- before\n- ```js\n  one\n\n  two\n  ```\n- after",
  },
  {
    name: "continuation",
    text: "- before\n\t```js\n\tone\n\ttwo\n\t```\n- after",
  },
  { name: "root", text: "before\n```js\none\ntwo\n```\nafter" },
];
const results = [],
  failures = [];
function keypress(key) {
  evaluate(() => {
    window.focus();
    if (
      !document.title.includes("vault") ||
      document.title.includes("base") ||
      document.visibilityState !== "visible"
    )
      throw Error("Wrong vault window");
    app.workspace.activeLeaf.view.editor.focus();
  });
  for (const type of ["keyDown", "keyUp"])
    cdp("Input.dispatchKeyEvent", {
      type,
      key,
      code: key === "Escape" ? "Escape" : `Key${key.toUpperCase()}`,
      windowsVirtualKeyCode:
        key === "Escape" ? 27 : key.toUpperCase().charCodeAt(0),
    });
}
function sample() {
  return evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
    const editor = app.workspace.activeLeaf.view.editor;
    return { doc: editor.getValue(), cursor: editor.getCursor() };
  });
}
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (note) => {
    app.vault.setConfig("vimMode", true);
    app.workspace.updateOptions();
    window.__vimNavigationLeaf = app.workspace.getLeaf("tab");
    await window.__vimNavigationLeaf.openFile(await app.vault.create(note, ""));
    await window.__vimNavigationLeaf.setViewState({
      type: "markdown",
      state: { file: note, mode: "source", source: false },
    });
  }, note);
  for (const shiki of [false, true]) {
    evaluate(async (enabled) => {
      if (enabled) await app.plugins.enablePlugin("shiki-highlighter");
      else await app.plugins.disablePlugin("shiki-highlighter");
      if (!!app.plugins.plugins["shiki-highlighter"] !== enabled)
        throw Error("Shiki state mismatch");
    }, shiki);
    for (const fixture of fixtures)
      for (const key of ["j", "k"]) {
        keypress("Escape");
        const last = fixture.text.split("\n").length - 1;
        evaluate(
          async (fixture, key, last) => {
            const editor = app.workspace.activeLeaf.view.editor;
            editor.setValue(fixture.text);
            editor.setCursor({ line: key === "j" ? 0 : last, ch: 3 });
            editor.focus();
            await new Promise((resolve) => setTimeout(resolve, 160));
          },
          fixture,
          key,
          last,
        );
        const steps = [];
        for (let step = 1; step <= last; step++) {
          keypress(key);
          const actual = sample();
          const expectedLine = key === "j" ? step : last - step;
          steps.push({ expectedLine, ...actual });
          try {
            assert.equal(
              actual.cursor.line,
              expectedLine,
              "Vim must visit each code source row",
            );
            assert.equal(
              actual.doc,
              fixture.text,
              "Navigation must not change Markdown",
            );
          } catch (error) {
            failures.push(
              `${fixture.name}, Shiki=${shiki}, ${key}, step ${step}: ${error.message}`,
            );
            break;
          }
        }
        results.push({ name: fixture.name, shiki, key, steps });
      }
  }
} finally {
  keypress("Escape");
  evaluate(
    async (original, note) => {
      window.__vimNavigationLeaf?.detach();
      delete window.__vimNavigationLeaf;
      app.vault.setConfig("vimMode", original.vimMode);
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
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify({ results, failures }, null, 2),
  );
}
console.log(
  JSON.stringify({ output, cases: results.length, failures }, null, 2),
);
assert.equal(failures.length, 0, "Vim navigation must enter code blocks");
