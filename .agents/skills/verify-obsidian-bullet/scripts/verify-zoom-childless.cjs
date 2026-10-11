#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const root = path.resolve(__dirname, "../../../..");
const { cdp, evaluate } = require(
  path.join(root, "scripts/obsidian-scroll-driver.cjs"),
);
const output = process.argv[2];
assert.ok(
  output && path.isAbsolute(output),
  "Use an absolute fresh output directory",
);
fs.mkdirSync(output);
const note = `pages/Zoom childless ${randomUUID()}.md`;
const fixture =
  "- work\n\t- project\n\t\t- branch\n\t\t\t- populated leaf\n\t- other\n- personal";
const expected = fixture.replace(
  "populated leaf\n",
  "populated leaf\n\t\t\t\t- \n",
);
const initial = evaluate(() => ({ leaf: app.workspace.activeLeaf.id }));
const results = [];
fs.writeFileSync(
  path.join(output, "fixture.json"),
  JSON.stringify({ note, fixture, expected }, null, 2),
);
function sample(name) {
  const state = evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    const editor = window.__zoomChildless.leaf.view.editor;
    return {
      doc: editor.getValue(),
      cursor: editor.getCursor(),
      labels: Array.from(
        editor.cm.dom.querySelectorAll(".bullet-zoom-breadcrumbs button"),
        (button) => button.textContent,
      ),
    };
  });
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
try {
  evaluate(
    async (note, fixture) => {
      const file = await app.vault.create(note, fixture);
      const leaf = app.workspace.getLeaf("tab");
      await leaf.openFile(file);
      window.__zoomChildless = { leaf, file };
      leaf.view.editor.setCursor({ line: 3, ch: 8 });
    },
    note,
    fixture,
  );
  assert.equal(sample("before").doc, fixture);
  evaluate(() => app.commands.executeCommandById("bullet:zoom-in"));
  let state = sample("leaf");
  assert.equal(state.doc, expected);
  assert.equal(state.labels.at(-1), "populated leaf");
  for (const label of ["branch", "project", "work"]) {
    evaluate(() => app.commands.executeCommandById("bullet:zoom-out"));
    state = sample(label);
    assert.equal(state.labels.at(-1), label);
    assert.equal(state.doc, expected);
  }
  evaluate(() => app.commands.executeCommandById("bullet:zoom-reset"));
  state = sample("whole-note");
  assert.deepEqual(state.labels, []);
  assert.equal(state.doc, expected);
  evaluate(async () => window.__zoomChildless.leaf.view.save());
  assert.equal(
    evaluate(async () => app.vault.read(window.__zoomChildless.file)),
    expected,
  );
  console.log(
    JSON.stringify({ passed: results.map((result) => result.name), output }),
  );
} finally {
  evaluate(async (initial) => {
    app.commands.executeCommandById("bullet:zoom-reset");
    const check = window.__zoomChildless;
    if (check) {
      await check.leaf.view.save();
      await new Promise((resolve) => setTimeout(resolve, 750));
      check.leaf.detach();
      await app.vault.trash(check.file, true);
      delete window.__zoomChildless;
    }
    const original = app.workspace.getLeafById(initial.leaf);
    if (original) app.workspace.setActiveLeaf(original, { focus: true });
  }, initial);
}
