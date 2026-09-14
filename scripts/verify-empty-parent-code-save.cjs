// Deploy a Bullet build first; run serially with Shiki installed in the test
// vault. The installed formatter runs unchanged through its actual Save hook.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

if (!process.argv[2] || !process.argv[3])
  throw Error(
    "Usage: node scripts/verify-empty-parent-code-save.cjs <fresh-output-dir> <prettier-format-main.js>",
  );
const output = path.resolve(process.argv[2]);
const bundle = path.resolve(process.argv[3]);
const manifest = JSON.parse(
  fs.readFileSync(path.join(path.dirname(bundle), "manifest.json")),
);
assert.equal(manifest.id, "prettier-format");
assert.equal(manifest.version, "0.2.0");
fs.mkdirSync(output, { recursive: false });
const note = `empty-parent-save-${randomUUID()}.md`;
const cases = [
  {
    name: "child",
    parent: { line: 0, ch: 2 },
    codeLine: 2,
    source: "- parent\n\t- ```js\n\t  const child = 1;\n\t  ```\n- after",
    expected: "- \n    - ```js\n      const child = 1;\n      ```\n- after\n",
    code: ["const child = 1;"],
  },
  {
    name: "nested",
    parent: { line: 1, ch: 3 },
    savedParent: { line: 1, ch: 6 },
    codeLine: 3,
    source:
      "- outer\n\t- parent\n\t\t- ```txt\n\t\t  literal\n\t\t  ```\n- after",
    expected:
      "- outer\n    - \n        - ```txt\n          literal\n          ```\n- after\n",
    code: ["literal"],
  },
  {
    name: "repeated",
    parent: { line: 0, ch: 2 },
    codeLine: 3,
    source:
      "- parent\n\t-\n\t\t- ~~~~txt\n\t\t  - literal\n\t\t  ```\n\t\t  ~~~~\n- after",
    expected:
      "- \n    - \n        - ````txt\n          - literal\n          ```\n          ````\n- after\n",
    code: ["- literal", "```"],
  },
  {
    name: "ordered",
    parent: { line: 0, ch: 3 },
    codeLine: 2,
    source: "1. parent\n\t1. ```txt\n\t   literal\n\t   ```\n2. after",
    expected: "1. \n    1.  ```txt\n        literal\n        ```\n2.  after\n",
    code: ["literal"],
  },
];
const original = evaluate(() => {
  if (app.vault.config.vimMode)
    throw Error("Turn off Vim before this native save check");
  if (app.plugins.plugins["prettier-format"])
    throw Error("Test vault formatter must be unloaded");
  return {
    leaf: app.workspace.activeLeaf.id,
    shiki: !!app.plugins.plugins["shiki-highlighter"],
    settings: JSON.stringify(app.plugins.plugins.bullet.settings.values),
  };
});
const results = [];
function focus() {
  evaluate(() => {
    window.focus();
    if (
      !document.title.includes("vault") ||
      document.title.includes("base") ||
      document.visibilityState !== "visible"
    )
      throw Error("Wrong renderer");
    window.__emptyParentSave.leaf.view.editor.focus();
  });
}
function key(key, code, windowsVirtualKeyCode, modifiers = 0) {
  focus();
  cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    windowsVirtualKeyCode,
    modifiers,
  });
  focus();
  cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode,
    modifiers,
  });
}
function sample(waitForDisk = false) {
  return evaluate(async (waitForDisk) => {
    await new Promise((resolve) => setTimeout(resolve, 650));
    const { editor, file } = window.__emptyParentSave.leaf.view;
    // The formatter's Save hook starts asynchronously after native Save;
    // Obsidian's normal autosave persists the resulting editor transaction.
    const deadline = Date.now() + 5000;
    while (
      waitForDisk &&
      (await app.vault.read(file)) !== editor.getValue() &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      doc: editor.getValue(),
      disk: await app.vault.read(file),
      cursor: editor.getCursor(),
      code: [
        ...editor.cm.contentDOM.querySelectorAll(
          ".cm-preview-code-block .ec-line .code",
        ),
      ].map((el) => el.textContent),
      copy:
        editor.cm.contentDOM
          .querySelector(".cm-preview-code-block [data-code]")
          ?.getAttribute("data-code")
          .replaceAll("\x7f", "\n") ?? null,
      rows: [...editor.cm.contentDOM.children].map((el) => ({
        text: el.textContent,
        class: el.className,
      })),
    };
  }, waitForDisk);
}
function screenshot(name) {
  fs.writeFileSync(
    path.join(output, name + ".png"),
    Buffer.from(
      cdp("Page.captureScreenshot", { format: "png" }).data,
      "base64",
    ),
  );
}
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(
    async (note, bundle, manifest) => {
      // Stub only Obsidian UI classes; format(), its bundled Prettier/diff, and
      // patchSave() are the installed plugin's actual implementations.
      const module = { exports: {} };
      const obsidian = new Proxy({}, { get: () => class {} });
      new Function(
        "require",
        "module",
        "exports",
        require("fs").readFileSync(bundle, "utf8"),
      )(
        (name) => (name === "obsidian" ? obsidian : require(name)),
        module,
        module.exports,
      );
      const formatter = Object.create(
        (module.exports.default ?? module.exports).prototype,
      );
      formatter.app = app;
      formatter.manifest = manifest;
      formatter.settings = { formatOnSave: true, tabWidth: 4, useTabs: true };
      window.__emptyParentSave = {
        leaf: app.workspace.getLeaf("tab"),
        formatter,
      };
      app.plugins.plugins["prettier-format"] = formatter;
      app.plugins.trigger("changed");
      await window.__emptyParentSave.leaf.openFile(
        await app.vault.create(note, ""),
      );
    },
    note,
    bundle,
    manifest,
  );
  for (const shiki of [false, true]) {
    evaluate(async (shiki) => {
      if (shiki) {
        await app.plugins.loadManifest(".obsidian/plugins/shiki-highlighter");
        await app.plugins.enablePlugin("shiki-highlighter");
      } else await app.plugins.disablePlugin("shiki-highlighter");
    }, shiki);
    for (const spec of cases) {
      for (const format of spec.name === "child" ? [false, true] : [true]) {
        const label = `${shiki ? "shiki" : "native"}-${spec.name}-${format ? "format" : "save"}`;
        evaluate(
          async (spec, format) => {
            const check = window.__emptyParentSave;
            if (format) check.formatter.patchSave();
            const editor = check.leaf.view.editor;
            editor.setValue(spec.source);
            editor.setSelection(spec.parent, {
              line: spec.parent.line,
              ch: spec.parent.ch + 6,
            });
            editor.focus();
            await new Promise((resolve) => setTimeout(resolve, 150));
            const selection = editor.listSelections()[0];
            if (
              JSON.stringify(selection.anchor) !==
                JSON.stringify(spec.parent) ||
              editor.getSelection() !== "parent"
            )
              throw Error("Wrong parent selection");
          },
          spec,
          format,
        );
        key("Backspace", "Backspace", 8);
        const cleared = sample();
        assert.equal(cleared.doc, spec.source.replace("parent", ""));
        key("s", "KeyS", 83, 4);
        const saved = sample(true);
        results.push({ label, cleared, saved });
        screenshot(label);
        assert.equal(saved.doc, format ? spec.expected : cleared.doc, label);
        assert.equal(saved.disk, saved.doc, label + " disk");
        assert.deepEqual(
          saved.cursor,
          format ? (spec.savedParent ?? spec.parent) : spec.parent,
          label + " caret",
        );
        const after = saved.rows.find((row) => /after$/.test(row.text));
        assert.ok(
          after &&
            after.class.includes("HyperMD-list-line") &&
            !after.class.includes("codeblock"),
          label + " following sibling",
        );
        if (shiki) {
          assert.deepEqual(saved.code, spec.code, label + " rendered code");
          assert.equal(
            saved.copy,
            spec.code.join("\n"),
            label + " copy payload",
          );
        } else {
          assert.equal(
            saved.rows.filter((row) =>
              row.class.includes("HyperMD-codeblock-begin"),
            ).length,
            1,
            label + " code opening",
          );
          assert.equal(
            saved.rows.filter((row) =>
              row.class.includes("HyperMD-codeblock-end"),
            ).length,
            1,
            label + " code closing",
          );
        }
        if (format) {
          for (let repeat = 0; repeat < 3; repeat++) {
            key("s", "KeyS", 83, 4);
            assert.equal(sample().doc, saved.doc, label + " repeat save");
          }
          key("z", "KeyZ", 90, 4);
          assert.equal(sample().doc, cleared.doc, label + " Undo");
          key("z", "KeyZ", 90, 12);
          assert.equal(sample().doc, saved.doc, label + " Redo");
          const at = spec.savedParent ?? spec.parent;
          focus();
          cdp("Input.insertText", { text: "x" });
          const lines = saved.doc.split("\n");
          lines[at.line] =
            lines[at.line].slice(0, at.ch) + "x" + lines[at.line].slice(at.ch);
          assert.equal(
            sample().doc,
            lines.join("\n"),
            label + " next parent input",
          );
          evaluate((spec) => {
            const editor = window.__emptyParentSave.leaf.view.editor;
            editor.setCursor(
              spec.codeLine,
              editor.getLine(spec.codeLine).length,
            );
          }, spec);
          focus();
          cdp("Input.insertText", { text: "X" });
          lines[spec.codeLine] += "X";
          assert.equal(
            sample().doc,
            lines.join("\n"),
            label + " next code input",
          );
          evaluate(() => window.__emptyParentSave.formatter.revertSave());
        }
        console.log(
          "PASS " +
            label +
            (format
              ? ": source, display, history, repeated saves and input"
              : ": native Save source and display"),
        );
      }
    }
  }
} finally {
  try {
    evaluate(
      async (original, note) => {
        const check = window.__emptyParentSave;
        check?.formatter.revertSave();
        if (app.plugins.plugins["prettier-format"] === check?.formatter) {
          delete app.plugins.plugins["prettier-format"];
          app.plugins.trigger("changed");
        }
        if (check?.leaf.view.save) await check.leaf.view.save();
        check?.leaf.detach();
        const file = app.vault.getAbstractFileByPath(note);
        if (file) await app.vault.trash(file, true);
        if (original.shiki) await app.plugins.enablePlugin("shiki-highlighter");
        else await app.plugins.disablePlugin("shiki-highlighter");
        const leaf = app.workspace.getLeafById(original.leaf);
        if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
        delete window.__emptyParentSave;
        if (
          JSON.stringify(app.plugins.plugins.bullet.settings.values) !==
          original.settings
        )
          throw Error("Bullet settings changed");
      },
      original,
      note,
    );
  } finally {
    cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
    fs.writeFileSync(
      path.join(output, "results.json"),
      JSON.stringify(results, null, 2),
    );
  }
}
console.log(
  `PASS ${results.length} actual Save cases; original test-vault state restored`,
);
