const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const note = `pages/editing-selections-${randomUUID()}.md`;
const numberedSiblings = Array.from(
  { length: 9 },
  (_, i) => `${i + 1}. item`,
).join("\n");
const fixtures = [
  {
    name: "split separated items at multiple cursors",
    text: "- one\n\n- two",
    cursors: [
      { line: 0, ch: 5 },
      { line: 2, ch: 5 },
    ],
    key: "Enter",
    expected: "- one\n- \n\n- two\n- ",
    typed: "- one\n- X\n\n- two\n- X",
  },
  {
    name: "indent separated items at multiple cursors",
    text: "- one\n\n- two",
    cursors: [
      { line: 0, ch: 5 },
      { line: 2, ch: 5 },
    ],
    key: "Tab",
    expected: "\t- one\n\n\t- two",
    typed: "\t- oneX\n\n\t- twoX",
  },
  {
    name: "outdent separated items at multiple cursors",
    text: "\t- one\n\n\t- two",
    cursors: [
      { line: 0, ch: 6 },
      { line: 2, ch: 6 },
    ],
    key: "Tab",
    shift: true,
    expected: "- one\n\n- two",
    typed: "- oneX\n\n- twoX",
  },
  {
    name: "replace selected parent task text",
    text: "- [x] abc\n\t- child",
    line: 0,
    from: 6,
    to: 9,
    key: "Enter",
    expected: "- [x] \n- [ ] \n\t- child",
    typed: "- [x] \n- [ ] X\n\t- child",
  },
  {
    name: "indent selected numbered text across marker widths",
    text: `${numberedSiblings}\n10. abcdef`,
    line: 9,
    from: 4,
    to: 7,
    key: "Tab",
    expected: `${numberedSiblings}\n\t1. abcdef`,
    typed: `${numberedSiblings}\n\t1. Xdef`,
  },
  {
    name: "outdent selected numbered text across marker widths",
    text: `${numberedSiblings}\n\t1. abcdef`,
    line: 9,
    from: 4,
    to: 7,
    key: "Tab",
    shift: true,
    expected: `${numberedSiblings}\n10. abcdef`,
    typed: `${numberedSiblings}\n10. Xdef`,
  },
  {
    name: "outdent at code indentation boundary",
    text: "- owner\n  ```\n      code\n  ```",
    line: 2,
    from: 2,
    to: 2,
    key: "Tab",
    shift: true,
    expected: "- owner\n  ```\n  code\n  ```",
    typed: "- owner\n  ```\n  Xcode\n  ```",
  },
  {
    name: "preserve minimum code container",
    text: "- owner\n  ```\n  code\n  ```",
    line: 2,
    from: 2,
    to: 2,
    key: "Tab",
    shift: true,
    noChange: true,
    expected: "- owner\n  ```\n  code\n  ```",
    typed: "- owner\n  ```\n  Xcode\n  ```",
  },
  {
    name: "replace selection with continuation",
    text: "- abcdef",
    line: 0,
    from: 4,
    to: 6,
    key: "Enter",
    shift: true,
    expected: "- ab\n  ef",
    typed: "- ab\n  Xef",
  },
  {
    name: "continue tab-separated bullet",
    text: "-\tabcdef",
    line: 0,
    from: 4,
    to: 6,
    key: "Enter",
    shift: true,
    expected: "-\tab\n    ef",
    typed: "-\tab\n    Xef",
  },
  {
    name: "continue nested tab-separated bullet",
    text: "- parent\n\t-\tabcdef",
    line: 1,
    from: 5,
    to: 7,
    key: "Enter",
    shift: true,
    expected: "- parent\n\t-\tab\n\t    ef",
    typed: "- parent\n\t-\tab\n\t    Xef",
  },
  {
    name: "continue tab-separated numbered item",
    text: "9.\tabcdef",
    line: 0,
    from: 5,
    to: 7,
    key: "Enter",
    shift: true,
    expected: "9.\tab\n    ef",
    typed: "9.\tab\n    Xef",
  },
  {
    name: "continue numbered item across tab stop",
    text: " 10.\tabcdef",
    line: 0,
    from: 7,
    to: 9,
    key: "Enter",
    shift: true,
    expected: " 10.\tab\n        ef",
    typed: " 10.\tab\n        Xef",
  },
  {
    name: "replace task prefix selection with sibling",
    text: "- [x] abcdef",
    line: 0,
    from: 6,
    to: 9,
    key: "Enter",
    expected: "- [x] \n- [ ] def",
    typed: "- [x] \n- [ ] Xdef",
  },
  {
    name: "indent selected parent and child",
    text: "- first\n- second\n\t- child",
    line: 1,
    from: 2,
    to: 8,
    key: "Tab",
    expected: "- first\n\t- second\n\t\t- child",
    typed: "- first\n\t- X\n\t\t- child",
  },
  {
    name: "outdent selected parent and child",
    text: "- first\n\t- second\n\t\t- child",
    line: 1,
    from: 3,
    to: 9,
    key: "Tab",
    shift: true,
    expected: "- first\n- second\n\t- child",
    typed: "- first\n- X\n\t- child",
  },
  {
    name: "indent nested code body",
    text: "- parent\n\t- ```js\n\t  abcdef\n\t  ```",
    line: 2,
    from: 5,
    to: 5,
    key: "Tab",
    expected: "- parent\n\t- ```js\n\t\t  abcdef\n\t  ```",
    typed: "- parent\n\t- ```js\n\t\t  abXcdef\n\t  ```",
  },
  {
    name: "outdent nested code body",
    text: "- parent\n\t- ```js\n\t\t  abcdef\n\t  ```",
    line: 2,
    from: 6,
    to: 6,
    key: "Tab",
    shift: true,
    expected: "- parent\n\t- ```js\n\t  abcdef\n\t  ```",
    typed: "- parent\n\t- ```js\n\t  abXcdef\n\t  ```",
  },
];

function focus() {
  evaluate((note) => {
    window.focus();
    const view = app.workspace.activeLeaf.view;
    if (
      !document.title.includes(" - vault - ") ||
      document.visibilityState !== "visible" ||
      view.file?.path !== note ||
      app.isVimEnabled() ||
      view.editor.cm.cm
    )
      throw Error("Wrong native editing context");
    view.editor.focus();
    if (document.activeElement !== view.editor.cm.contentDOM)
      throw Error("Expected editor must own focus");
  }, note);
}

function keypress(key, modifiers = 0) {
  const code = key === "z" ? "KeyZ" : key;
  const windowsVirtualKeyCode = { Enter: 13, Tab: 9, z: 90 }[key];
  for (const type of ["keyDown", "keyUp"]) {
    focus();
    cdp("Input.dispatchKeyEvent", {
      type,
      key,
      code,
      windowsVirtualKeyCode,
      modifiers,
    });
  }
}

function sample() {
  return evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const editor = app.workspace.activeLeaf.view.editor;
    return { doc: editor.getValue(), selections: editor.listSelections() };
  });
}

const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  vim: app.vault.config.vimMode ?? false,
  hasVim: Object.hasOwn(app.vault.config, "vimMode"),
  shiki: !!app.plugins.plugins["shiki-highlighter"],
}));
const results = [];
const failures = [];
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (note) => {
    app.vault.setConfig("vimMode", false);
    await app.vault.saveConfig();
    app.workspace.updateOptions();
    app.workspace.leftSplit.collapse();
    app.workspace.rightSplit.collapse();
    await app.workspace
      .getLeaf("tab")
      .openFile(await app.vault.create(note, ""));
  }, note);
  for (const shiki of [false, true]) {
    evaluate(async (enabled) => {
      if (enabled) {
        await app.plugins.loadManifest(".obsidian/plugins/shiki-highlighter");
        await app.plugins.enablePlugin("shiki-highlighter");
      } else await app.plugins.disablePlugin("shiki-highlighter");
      if (!!app.plugins.plugins["shiki-highlighter"] !== enabled)
        throw Error("Shiki state did not change");
      app.vault.setConfig("vimMode", false);
      await app.vault.saveConfig();
      app.workspace.updateOptions();
    }, shiki);
    for (const fixture of fixtures) {
      for (const reverse of !fixture.cursors && fixture.from === fixture.to
        ? [false]
        : [false, true]) {
        const name = `${fixture.name}-${shiki ? "shiki" : "native"}-${reverse ? "reverse" : "forward"}`;
        evaluate(
          async (fixture, reverse) => {
            const editor = app.workspace.activeLeaf.view.editor;
            editor.setValue(fixture.text);
            if (fixture.cursors) {
              const Selection = editor.cm.state.selection.constructor;
              editor.cm.dispatch({
                selection: Selection.create(
                  fixture.cursors.map((position) =>
                    Selection.cursor(editor.posToOffset(position)),
                  ),
                  reverse ? 1 : 0,
                ),
              });
            } else {
              editor.setSelection(
                { line: fixture.line, ch: reverse ? fixture.to : fixture.from },
                { line: fixture.line, ch: reverse ? fixture.from : fixture.to },
              );
            }
            editor.focus();
            await new Promise((resolve) => setTimeout(resolve, 150));
          },
          fixture,
          reverse,
        );
        const before = sample();
        keypress(fixture.key, fixture.shift ? 8 : 0);
        const after = sample();
        fs.writeFileSync(
          path.join(output, `${name}.png`),
          Buffer.from(
            cdp("Page.captureScreenshot", { format: "png" }).data,
            "base64",
          ),
        );
        if (!fixture.noChange) keypress("z", 4);
        const undone = sample();
        if (!fixture.noChange) keypress("z", 12);
        const redone = sample();
        focus();
        cdp("Input.insertText", { text: "X" });
        const typed = sample();
        const saved = evaluate(async (note) => {
          const file = app.vault.getAbstractFileByPath(note);
          const editor = app.workspace.activeLeaf.view.editor;
          for (let attempt = 0; attempt < 30; attempt++) {
            const text = await app.vault.read(file);
            if (text === editor.getValue()) return text;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          throw Error("Editor changes were not saved");
        }, note);
        const result = { name, before, after, undone, redone, typed, saved };
        results.push(result);
        try {
          assert.equal(before.doc, fixture.text);
          assert.equal(after.doc, fixture.expected);
          assert.equal(undone.doc, fixture.text);
          assert.equal(redone.doc, fixture.expected);
          assert.equal(typed.doc, fixture.typed);
          assert.equal(saved, fixture.typed);
          if (fixture.cursors) {
            assert.equal(after.selections.length, fixture.cursors.length);
            assert.deepEqual(undone.selections, before.selections);
            assert.deepEqual(redone.selections, after.selections);
          }
          console.log(`PASS ${name}`);
        } catch (error) {
          failures.push({ name, error: error.message });
          console.log(`FAIL ${name}: ${error.message}`);
        }
      }
    }
  }
  assert.equal(failures.length, 0, `${failures.length} editing checks failed`);
} finally {
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify({ results, failures }, null, 2),
  );
  evaluate(
    async (note, original) => {
      app.workspace.activeLeaf.detach();
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.trash(file, true);
      if (original.shiki) await app.plugins.enablePlugin("shiki-highlighter");
      else await app.plugins.disablePlugin("shiki-highlighter");
      app.vault.setConfig(
        "vimMode",
        original.hasVim ? original.vim : undefined,
      );
      await app.vault.saveConfig();
      app.workspace.updateOptions();
      const leaf = app.workspace.getLeafById(original.leaf);
      if (leaf) app.workspace.setActiveLeaf(leaf);
    },
    note,
    original,
  );
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
}
