// Run against the deployed build in the repository test vault.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const note = `vim-code-newlines-${randomUUID()}.md`;
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  vimMode: app.vault.config.vimMode ?? false,
  betterVimO: app.plugins.plugins.bullet.settings.overrideVimOBehaviour,
}));
const fixtures = [
  {
    name: "nested body o",
    text: "- parent\n\t- ```js\n\t  code\n\t  ```\n\t- after",
    line: 2,
    key: "o",
    indent: "\t  ",
  },
  {
    name: "nested body O",
    text: "- parent\n\t- ```js\n\t  code\n\t  ```\n\t- after",
    line: 2,
    key: "O",
    indent: "\t  ",
  },
  {
    name: "root literal marker o",
    text: "```yaml\n- literal\n```",
    line: 1,
    key: "o",
    indent: "",
  },
  {
    name: "root literal marker O",
    text: "```yaml\n- literal\n```",
    line: 1,
    key: "O",
    indent: "",
  },
  {
    name: "nested opening o",
    text: "- parent\n\t- ```js\n\t  code\n\t  ```",
    line: 1,
    key: "o",
    indent: "\t  ",
  },
  {
    name: "nested closing O",
    text: "- parent\n\t- ```js\n\t  code\n\t  ```",
    line: 3,
    key: "O",
    indent: "\t  ",
  },
  {
    name: "tab separator opening o",
    text: "-\t```js\n\tcode\n\t```",
    line: 0,
    key: "o",
    indent: " \t",
  },
  {
    name: "spaced separator opening o",
    text: "-   ```js\n    code\n    ```",
    line: 0,
    key: "o",
    indent: "    ",
  },
  {
    name: "tab separator blank o",
    text: "-\t```js\n\n\t```",
    line: 1,
    key: "o",
    indent: " \t",
  },
  {
    name: "spaced separator blank O",
    text: "-   ```js\n\n    ```",
    line: 1,
    key: "O",
    indent: "    ",
  },
  {
    name: "ordered tab separator opening o",
    text: "12.\t```js\n\tcode\n\t```",
    line: 0,
    key: "o",
    indent: "   \t",
  },
  {
    name: "physical blank body o",
    text: "- parent\n\t- ```js\n\t  code\n\n\t  ```",
    line: 3,
    key: "o",
    indent: "\t  ",
  },
  {
    name: "physical blank body O",
    text: "- parent\n\t- ```js\n\t  code\n\n\t  ```",
    line: 3,
    key: "O",
    indent: "\t  ",
  },
  {
    name: "literal marker nested o",
    text: "- parent\n\t- ```yaml\n\t  - literal\n\t  ```",
    line: 2,
    key: "o",
    indent: "\t  ",
  },
  {
    name: "underindented blank body o",
    text: "- parent\n\t- ```js\n\t\n\t  ```",
    line: 2,
    key: "o",
    indent: "\t  ",
  },
  {
    name: "continuation blank body O",
    text: "- parent\n\t```js\n\n\t```",
    line: 2,
    key: "O",
    indent: "\t",
  },
  {
    name: "code indentation o",
    text: "- parent\n\t- ```js\n\t    code\n\t  ```",
    line: 2,
    key: "o",
    indent: "\t\t",
  },
  {
    name: "continued tilde body o",
    text: "- parent\n\t~~~~yaml\n\t- literal\n\t~~~~",
    line: 2,
    key: "o",
    indent: "\t",
  },
  ...(!process.argv.includes("--native")
    ? [
        {
          name: "ordinary list o",
          text: "- parent\n\t- item\n\t- after",
          line: 1,
          key: "o",
          indent: "\t- ",
        },
        {
          name: "ordinary list O",
          text: "- parent\n\t- item\n\t- after",
          line: 1,
          key: "O",
          indent: "\t- ",
        },
        {
          name: "ordinary list after separated code o",
          text: "- ```js\n  code\n  ```\n\n- item",
          line: 4,
          key: "o",
          indent: "- ",
        },
        {
          name: "ordinary list after separated code O",
          text: "- ```js\n  code\n  ```\n\n- item",
          line: 4,
          key: "O",
          indent: "- ",
        },
        {
          name: "nested closing o creates sibling",
          text: "- parent\n\t- ```js\n\t  code\n\t  ```\n\t- after",
          line: 3,
          key: "o",
          indent: "\t- ",
        },
      ]
    : []),
];
const results = [],
  failures = [];
function keypress(key) {
  evaluate(() => {
    window.focus();
    if (!document.title.includes("vault") || document.title.includes("base"))
      throw Error("Wrong vault window");
    app.workspace.activeLeaf.view.editor.focus();
  });
  const code = key === "Escape" ? "Escape" : "KeyO";
  const windowsVirtualKeyCode = key === "Escape" ? 27 : 79;
  const modifiers = key === "O" ? 8 : 0;
  cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    windowsVirtualKeyCode,
    modifiers,
  });
  cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode,
    modifiers,
  });
}
function sample() {
  return evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const editor = app.workspace.activeLeaf.view.editor;
    return { doc: editor.getValue(), cursor: editor.getCursor() };
  });
}
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(
    async (note, native) => {
      app.plugins.plugins.bullet.settings.overrideVimOBehaviour = !native;
      app.vault.setConfig("vimMode", true);
      app.workspace.updateOptions();
      window.__vimCodeLeaf = app.workspace.getLeaf("tab");
      await window.__vimCodeLeaf.openFile(await app.vault.create(note, ""));
    },
    note,
    process.argv.includes("--native"),
  );
  for (const fixture of fixtures) {
    keypress("Escape");
    evaluate(async (fixture) => {
      const editor = app.workspace.activeLeaf.view.editor;
      editor.setValue(fixture.text);
      editor.setCursor({
        line: fixture.line,
        ch: Math.max(0, editor.getLine(fixture.line).length - 1),
      });
      editor.focus();
      await new Promise((resolve) => setTimeout(resolve, 120));
    }, fixture);
    keypress(fixture.key);
    const opened = sample();
    evaluate(() => {
      window.focus();
      if (!document.title.includes("vault") || document.title.includes("base"))
        throw Error("Wrong vault window");
    });
    cdp("Input.insertText", { text: "x" });
    const typed = sample();
    const line = fixture.line + (fixture.key === "o" ? 1 : 0);
    const lines = fixture.text.split("\n");
    lines.splice(line, 0, fixture.indent);
    const expectedOpened = {
      doc: lines.join("\n"),
      cursor: { line, ch: fixture.indent.length },
    };
    lines[line] += "x";
    const expectedTyped = {
      doc: lines.join("\n"),
      cursor: { line, ch: fixture.indent.length + 1 },
    };
    results.push({
      name: fixture.name,
      opened,
      typed,
      expectedOpened,
      expectedTyped,
    });
    try {
      assert.deepEqual(opened, expectedOpened);
      assert.deepEqual(typed, expectedTyped);
    } catch (error) {
      failures.push(`${fixture.name}: ${error.message}`);
    }
  }
} finally {
  keypress("Escape");
  evaluate(
    async (original, note) => {
      window.__vimCodeLeaf?.detach();
      delete window.__vimCodeLeaf;
      app.vault.setConfig("vimMode", original.vimMode);
      app.plugins.plugins.bullet.settings.overrideVimOBehaviour =
        original.betterVimO;
      app.workspace.updateOptions();
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
assert.equal(
  failures.length,
  0,
  "Vim code newlines must preserve code indentation and literal input",
);
