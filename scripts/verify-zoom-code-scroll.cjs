// Verify source/preview transitions and painted code bounds below zoom breadcrumbs.
// Deploy build-with-tests first. Run separately from other real-editor checks.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");
const output = process.argv[2];
if (!output)
  throw Error(
    "Usage: node scripts/verify-zoom-code-scroll.cjs <fresh-output-directory>",
  );
fs.mkdirSync(output);
const note = `zoom-code-scroll-${randomUUID()}.md`;
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  shiki: !!app.plugins.plugins["shiki-highlighter"],
  numbers:
    app.plugins.plugins["shiki-highlighter"]?.settings.ecDefaultShowLineNumbers,
}));
const results = [];
let failure = null;
function cursor(line) {
  evaluate((line) => {
    window.focus();
    const editor = window.__zoomCodeScrollLeaf.view.editor;
    editor.setCursor({ line, ch: editor.getLine(line).length });
    editor.focus();
  }, line);
}
function sample(name) {
  const result = evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
    if (document.visibilityState !== "visible") throw Error("Hidden renderer");
    const editor = window.__zoomCodeScrollLeaf.view.editor;
    const cm = editor.cm;
    const panel = cm.dom.querySelector(".bullet-zoom-breadcrumbs");
    const embed = cm.contentDOM.querySelector(".cm-preview-code-block");
    const pre = embed?.querySelector("pre");
    const walker = document.createTreeWalker(
      cm.contentDOM,
      NodeFilter.SHOW_TEXT,
    );
    const nodes = [];
    let node,
      text = "";
    while ((node = walker.nextNode())) {
      nodes.push({ node, from: text.length });
      text += node.textContent;
    }
    const from = text.indexOf("const");
    let glyph = null;
    if (from >= 0) {
      const start = nodes.find(
        ({ node, from: offset }) => offset + node.textContent.length > from,
      );
      const end = nodes.find(
        ({ node, from: offset }) =>
          offset + node.textContent.length >= from + 5,
      );
      const range = document.createRange();
      range.setStart(start.node, from - start.from);
      range.setEnd(end.node, from + 5 - end.from);
      const rect = range.getBoundingClientRect();
      if (rect.height > 0) glyph = rect.toJSON();
    }
    return {
      inlineTitle: getComputedStyle(cm.scrollDOM.querySelector(".inline-title"))
        .display,
      paddingTop: getComputedStyle(cm.scrollDOM).paddingTop,
      doc: editor.getValue(),
      cursor: editor.getCursor(),
      panel: panel?.parentElement.getBoundingClientRect().toJSON(),
      panelBorder:
        panel && getComputedStyle(panel.parentElement).borderBottomWidth,
      breadcrumbBorder: panel && getComputedStyle(panel).borderBottomWidth,
      preview: pre?.getBoundingClientRect().toJSON() ?? null,
      glyph,
      flair: !!cm.contentDOM.querySelector(".code-block-flair"),
      scrollTop: cm.scrollDOM.scrollTop,
    };
  });
  results.push({ name, ...result });
  fs.writeFileSync(
    path.join(output, name + ".png"),
    Buffer.from(cdp("Page.captureScreenshot").data, "base64"),
  );
  return result;
}
function assertPreview(value, mode, text) {
  assert.equal(value.doc, text, "Changing focus must preserve Markdown");
  assert.ok(
    value.panel && value.glyph,
    "Panel and code glyphs must be rendered",
  );
  assert.ok(
    value.glyph.top >= value.panel.bottom,
    `Code glyph clipped by ${value.panel.bottom - value.glyph.top}px`,
  );
  if (mode === "native") assert.ok(value.flair, "Native preview must return");
  else {
    assert.ok(value.preview, "Shiki preview must return");
    assert.ok(
      value.preview.top >= value.panel.bottom,
      `Code background clipped by ${value.panel.bottom - value.preview.top}px`,
    );
  }
  assert.equal(value.panelBorder, "0px", "Panel must not draw a divider");
  assert.equal(
    value.breadcrumbBorder,
    "0px",
    "Breadcrumbs must not draw a divider",
  );
}
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (note) => {
    const leaf = app.workspace.getLeaf("tab");
    window.__zoomCodeScrollLeaf = leaf;
    await leaf.openFile(await app.vault.create(note, "audit"));
  }, note);
  for (const mode of ["shiki", "numbered", "native"]) {
    evaluate(async (mode) => {
      const id = "shiki-highlighter";
      if (mode === "native") {
        if (app.plugins.plugins[id]) await app.plugins.disablePlugin(id);
      } else {
        if (!app.plugins.plugins[id]) await app.plugins.enablePlugin(id);
        const plugin = app.plugins.plugins[id];
        plugin.settings.ecDefaultShowLineNumbers = mode === "numbered";
        await plugin.reloadHighlighter();
      }
    }, mode);
    for (const kind of ["code-with-child", "code-leaf", "parent"]) {
      const text = [
        "- before",
        "\t- parent",
        "\t\t- ```js",
        "\t\t  const value = 1;",
        "\t\t  ```",
        ...(kind === "code-leaf" ? [] : ["\t\t\t- child"]),
        "\t\t- sibling",
        "\t- hidden",
        "- outside",
      ].join("\n");
      evaluate(
        async (text, kind) => {
          app.commands.executeCommandById("bullet:zoom-reset");
          const editor = window.__zoomCodeScrollLeaf.view.editor;
          editor.setValue(text);
          app.commands.executeCommandById("editor:unfold-all");
          await new Promise((resolve) => setTimeout(resolve, 200));
          const line = kind === "parent" ? 1 : 2;
          editor.setCursor({ line, ch: editor.getLine(line).length });
          editor.focus();
          window.focus();
          window.__zoomCodeScrollOriginalLayout = {
            inlineTitle: getComputedStyle(
              editor.cm.scrollDOM.querySelector(".inline-title"),
            ).display,
            paddingTop: getComputedStyle(editor.cm.scrollDOM).paddingTop,
          };
          app.commands.executeCommandById("bullet:zoom-in");
        },
        text,
        kind,
      );
      const name = `${mode}-${kind}`;
      const zoomed = sample(name + "-zoom");
      if (kind === "code-leaf") assertPreview(zoomed, mode, zoomed.doc);
      for (let repeat = 0; repeat < 2; repeat++) {
        cursor(3);
        const editing = sample(name + `-editing-${repeat}`);
        assert.equal(editing.preview, null);
        assert.equal(editing.flair, false);
        cursor(5);
        assertPreview(sample(name + `-preview-${repeat}`), mode, zoomed.doc);
      }
      const layout = evaluate(() => {
        app.commands.executeCommandById("bullet:zoom-reset");
        return window.__zoomCodeScrollOriginalLayout;
      });
      const restored = sample(name + "-reset");
      assert.equal(restored.panel, undefined);
      assert.equal(restored.doc, zoomed.doc);
      assert.equal(restored.inlineTitle, layout.inlineTitle);
      assert.equal(restored.paddingTop, layout.paddingTop);
    }
  }
} catch (error) {
  failure = error.stack ?? String(error);
  throw error;
} finally {
  try {
    evaluate(
      async (original, note) => {
        const leaf = window.__zoomCodeScrollLeaf;
        if (leaf) {
          await leaf.view.save();
          leaf.detach();
          delete window.__zoomCodeScrollLeaf;
          delete window.__zoomCodeScrollOriginalLayout;
        }
        const id = "shiki-highlighter";
        if (original.shiki && !app.plugins.plugins[id])
          await app.plugins.enablePlugin(id);
        if (app.plugins.plugins[id] && original.numbers !== undefined) {
          app.plugins.plugins[id].settings.ecDefaultShowLineNumbers =
            original.numbers;
          await app.plugins.plugins[id].reloadHighlighter();
        }
        if (!original.shiki && app.plugins.plugins[id])
          await app.plugins.disablePlugin(id);
        const previous = app.workspace.getLeafById(original.leaf);
        if (previous) app.workspace.setActiveLeaf(previous, { focus: true });
        const file = app.vault.getAbstractFileByPath(note);
        if (file) await app.vault.trash(file, false);
      },
      original,
      note,
    );
  } finally {
    cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
    fs.writeFileSync(
      path.join(output, "results.json"),
      JSON.stringify({ results, failure }, null, 2),
    );
    console.log(
      JSON.stringify({ output, cases: results.length, failure }, null, 2),
    );
  }
}
