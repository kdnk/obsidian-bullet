const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const note = `pages/code-hover-${randomUUID()}.md`;
const text =
  '- parent\n\t- ```yaml\n\t  transportSocket:\n\t      name: "envoy.transport_sockets.tls"\n\t  ```\n- after';
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  shiki: !!app.plugins.plugins["shiki-highlighter"],
}));
const results = [];
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(
    async (note, text) => {
      if (!app.plugins.plugins["shiki-highlighter"])
        await app.plugins.enablePlugin("shiki-highlighter");
      if (!document.body.classList.contains("bullet-plugin-better-lists"))
        throw Error("Enable Bullet list styling");
      window.__codeHoverLeaf = app.workspace.getLeaf("tab");
      await window.__codeHoverLeaf.openFile(await app.vault.create(note, text));
      app.workspace.activeLeaf.view.editor.setCursor({ line: 5, ch: 3 });
    },
    note,
    text,
  );
  for (const mode of ["preview", "editing", "preview-again"]) {
    const target = evaluate(async (mode) => {
      window.focus();
      if (document.visibilityState !== "visible")
        throw Error("Hidden renderer");
      const editor = app.workspace.activeLeaf.view.editor;
      editor.setCursor({ line: mode === "editing" ? 2 : 5, ch: 3 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const element =
        mode === "editing"
          ? editor.cm.contentDOM.querySelector(
              ".HyperMD-codeblock:not(.HyperMD-codeblock-begin)",
            )
          : editor.cm.contentDOM.querySelector(".cm-preview-code-block");
      if (!element) throw Error(`Missing ${mode} target`);
      const r = element.getBoundingClientRect();
      const x = r.left + r.width / 2,
        y = r.top + Math.min(10, r.height / 2);
      if (!element.contains(document.elementFromPoint(x, y)))
        throw Error("Code hover target is obscured");
      return { x, y };
    }, mode);
    cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...target });
    const sample = evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const cm = app.workspace.activeLeaf.view.editor.cm;
      const embed = cm.contentDOM.querySelector(".cm-preview-code-block");
      const opening = cm.contentDOM.querySelector(".HyperMD-codeblock-begin");
      return {
        text: cm.state.doc.toString(),
        hover: embed?.matches(":hover") ?? null,
        shadow: embed ? getComputedStyle(embed).boxShadow : null,
        openingHeight: opening.getBoundingClientRect().height,
        openingLineHeight: parseFloat(getComputedStyle(opening).lineHeight),
        editControl: !!embed?.querySelector(".edit-block-button"),
        copyControl: !!embed?.querySelector("button[data-code]"),
      };
    });
    results.push({ mode, ...sample });
    fs.writeFileSync(
      path.join(output, `${mode}.png`),
      Buffer.from(
        cdp("Page.captureScreenshot", { format: "png" }).data,
        "base64",
      ),
    );
    assert.equal(sample.text, text, "Mode switching preserves Markdown");
    assert.ok(sample.openingHeight > 0, "Opening fence remains navigable");
    assert.ok(
      Math.abs(sample.openingHeight - sample.openingLineHeight) < 0.1,
      "List markers must not expand the opening code row",
    );
    if (mode !== "editing") {
      assert.equal(sample.hover, true, "Native pointer reached the preview");
      assert.equal(
        sample.shadow,
        "none",
        "No partial frame on the nested preview",
      );
      assert.ok(
        sample.editControl && sample.copyControl,
        "Native edit and copy controls remain",
      );
    }
  }
} finally {
  try {
    evaluate(
      async (original, note) => {
        window.__codeHoverLeaf?.detach();
        delete window.__codeHoverLeaf;
        const file = app.vault.getAbstractFileByPath(note);
        if (file) await app.vault.trash(file, true);
        if (!original.shiki)
          await app.plugins.disablePlugin("shiki-highlighter");
        const leaf = app.workspace.getLeafById(original.leaf);
        if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
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
console.log(`PASS: ${results.length} nested code hover states`);
