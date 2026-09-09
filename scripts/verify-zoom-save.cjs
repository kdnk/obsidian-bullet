// Deploy build-with-tests to the repository vault first. Pass an installed
// Linter main.js to exercise its actual diff application without enabling it.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { evaluate } = require("./obsidian-scroll-driver.cjs");

const linterBundle = process.argv[2];
if (!linterBundle)
  throw Error("Usage: node scripts/verify-zoom-save.cjs <linter-main.js>");
const note = `zoom-save-${randomUUID().slice(0, 8)}.md`;
const before =
  "---\nmodified: old\n---\n- work\n\t- project\n\t\t- task  \n\t- other\n- personal";
const after =
  "---\nmodified: new timestamp\n---\n- work\n\t- project\n\t\t- task\n\t- other\n- personal\n";
const initial = evaluate(() => app.workspace.activeLeaf.id);

function sample() {
  return evaluate(() => {
    const editor = window.__zoomSaveCheck.leaf.view.editor;
    return {
      doc: editor.getValue(),
      target:
        editor.cm.dom.querySelector(
          '.bullet-zoom-breadcrumbs [aria-current="location"]',
        )?.textContent ?? null,
      visible: editor.cm.contentDOM.textContent,
      cursorLine: editor.getLine(editor.getCursor().line),
    };
  });
}

try {
  evaluate(
    async (note, before, bundle) => {
      // Only updateEditor/endOfDocument are used. UI classes are inert stubs;
      // the Linter diff algorithm and the Obsidian editor are real.
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
      const linter = Object.create(
        (module.exports.default ?? module.exports).prototype,
      );
      const file = await app.vault.create(note, before);
      const leaf = app.workspace.getLeaf("tab");
      window.__zoomSaveCheck = { linter, leaf, file, second: null };
      await leaf.openFile(file);
      const editor = leaf.view.editor;
      editor.setCursor({ line: 4, ch: 3 });
      app.commands.executeCommandById("bullet:zoom-in");
      await new Promise((resolve) => setTimeout(resolve, 350));
    },
    note,
    before,
    linterBundle,
  );
  assert.equal(sample().target, "project");

  evaluate(
    async (before, after) => {
      const { linter, leaf } = window.__zoomSaveCheck;
      linter.updateEditor(before, after, leaf.view.editor);
      await leaf.view.save();
      await new Promise((resolve) => setTimeout(resolve, 500));
    },
    before,
    after,
  );
  const linted = sample();
  assert.equal(linted.doc, after);
  assert.equal(linted.target, "project");
  assert.equal(linted.cursorLine, "\t- project");
  assert.ok(!linted.visible.includes("personal"));
  assert.ok(!linted.visible.includes("other"));
  console.log(
    "PASS Linter timestamp, whitespace and EOF changes preserve zoom and cursor",
  );

  evaluate(async (after) => {
    const { linter, leaf } = window.__zoomSaveCheck;
    linter.updateEditor(after, after, leaf.view.editor);
    await leaf.view.save();
    await new Promise((resolve) => setTimeout(resolve, 350));
  }, after);
  assert.equal(sample().target, "project");
  console.log("PASS no-diff save preserves zoom");

  evaluate(async () => {
    const check = window.__zoomSaveCheck;
    check.second = app.workspace.getLeaf("split", "vertical");
    await check.second.openFile(check.file);
    check.second.view.editor.replaceRange(
      "office",
      { line: 3, ch: 2 },
      { line: 3, ch: 6 },
    );
    await check.second.view.save();
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
  assert.equal(sample().target, null);
  assert.equal(sample().doc, after.replace("work", "office"));
  console.log("PASS another pane's hidden edit is synchronized and exits zoom");
} finally {
  evaluate(
    async (initial, note) => {
      const check = window.__zoomSaveCheck;
      if (check) {
        if (check.second) {
          await check.second.view.save();
          check.second.detach();
        }
        await check.leaf.view.save();
        check.leaf.detach();
      }
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.trash(file, true);
      const leaf = app.workspace.getLeafById(initial);
      if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
      delete window.__zoomSaveCheck;
    },
    initial,
    note,
  );
}
