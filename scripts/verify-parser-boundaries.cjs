const assert = require("node:assert/strict");
const fs = require("node:fs");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");
const output = process.argv[2];
assert.ok(
  output,
  "Usage: node scripts/verify-parser-boundaries.cjs <fresh-output-directory>",
);
fs.mkdirSync(output);
const original = evaluate(() => ({
  text: app.workspace.activeLeaf.view.editor.getValue(),
  cursor: app.workspace.activeLeaf.view.editor.getCursor(),
  vim: app.vault.config.vimMode,
}));
function setup(text, cursor) {
  evaluate(
    async (text, cursor) => {
      window.focus();
      app.vault.setConfig("vimMode", false);
      app.workspace.updateOptions();
      const e = app.workspace.activeLeaf.view.editor;
      e.setValue(text);
      e.setCursor(cursor);
      e.focus();
      await new Promise((r) => setTimeout(r, 200));
      if (
        !document.title.includes("vault") ||
        document.title.includes("base") ||
        document.visibilityState !== "visible" ||
        !e.cm.hasFocus
      )
        throw Error("Focus guard");
    },
    text,
    cursor,
  );
}
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  const text = ["* * *", "  ```js", "code", "  ```"].join("\n");
  setup(text, { line: 2, ch: 4 });
  cdp("Input.insertText", { text: "x" });
  const typing = evaluate(async () => {
    const v = app.workspace.activeLeaf.view;
    await v.save();
    return { doc: v.editor.getValue(), saved: await app.vault.read(v.file) };
  });
  setup("- parent\n  \n  note", { line: 2, ch: 6 });
  const guides = evaluate(() =>
    Array.from(
      app.workspace.activeLeaf.view.editor.cm.contentDOM.querySelectorAll(
        ".cm-line",
      ),
    ).map((line) => ({
      text: line.textContent,
      guides: Array.from(
        line.querySelectorAll(".bullet-plugin-outer-list-guide"),
      ).map((x) => ({ start: x.dataset.chunkStart, end: x.dataset.chunkEnd })),
    })),
  );
  fs.writeFileSync(
    output + "/result.json",
    JSON.stringify({ typing, guides }, null, 2),
  );
  fs.writeFileSync(
    output + "/guides.png",
    Buffer.from(
      cdp("Page.captureScreenshot", { format: "png" }).data,
      "base64",
    ),
  );
  assert.equal(typing.doc, text.replace("code", "codex"));
  assert.equal(typing.saved, typing.doc);
  assert.equal(guides[0].guides.length, 1);
} finally {
  evaluate(async (original) => {
    const v = app.workspace.activeLeaf.view;
    v.editor.setValue(original.text);
    v.editor.setCursor(original.cursor);
    app.vault.setConfig("vimMode", original.vim);
    app.workspace.updateOptions();
    await v.save();
  }, original);
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
}
