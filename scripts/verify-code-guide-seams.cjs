const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");

const output = process.argv[2];
fs.mkdirSync(output);
const note = `pages/code-guide-seams-${randomUUID()}.md`;
const text =
  "- a- Threading test\n\t- Parent\n\t\t- Selected item\n\t\t- ```\n\t\t\tllo\n\t\t\t  \n\t\t  ```\n\t\t- \n\t\t\t- \n";
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  font: app.getBaseFontSize(),
  shiki: !!app.plugins.plugins["shiki-highlighter"],
  settings: app.plugins.plugins["shiki-highlighter"]?.settings,
}));
const results = [];
const failures = [];
try {
  evaluate(
    async (note, text) => {
      window.__guideSeamLeaf = app.workspace.getLeaf("tab");
      await window.__guideSeamLeaf.openFile(await app.vault.create(note, text));
      await window.__guideSeamLeaf.setViewState({
        type: "markdown",
        state: { file: note, mode: "source", source: false },
      });
      app.workspace.activeLeaf.view.editor.setCursor({ line: 8, ch: 5 });
    },
    note,
    text,
  );
  for (const mode of ["native", "shiki", "numbers"]) {
    evaluate(async (mode) => {
      const id = "shiki-highlighter";
      if (mode === "native") await app.plugins.disablePlugin(id);
      else {
        if (!app.plugins.plugins[id]) await app.plugins.enablePlugin(id);
        const plugin = app.plugins.plugins[id];
        plugin.settings.ecDefaultShowLineNumbers = mode === "numbers";
        await plugin.reloadHighlighter();
      }
    }, mode);
    for (const font of [16, 24, 30]) {
      const name = `${mode}-${font}`;
      const record = { name };
      try {
        record.geometry = evaluate(
          async (font, text) => {
            window.focus();
            app.setBaseFontSize(font);
            const view = app.workspace.activeLeaf.view;
            const editor = view.editor;
            editor.focus();
            editor.setCursor({ line: 8, ch: 5 });
            editor.scrollIntoView(
              { from: { line: 0, ch: 0 }, to: { line: 8, ch: 5 } },
              true,
            );
            await new Promise((resolve) => setTimeout(resolve, 500));
            if (app.getBaseFontSize() !== font || editor.getValue() !== text)
              throw Error("Fixture changed");
            const cm = editor.cm;
            const line = (number) =>
              [...cm.contentDOM.querySelectorAll(".cm-line")].find(
                (el) => cm.state.doc.lineAt(cm.posAtDOM(el)).number === number,
              );
            const opening = line(4);
            const sibling = line(8);
            const box = sibling.getBoundingClientRect();
            const inset = parseFloat(
              opening.style.getPropertyValue(
                "--bullet-nested-code-block-inset",
              ),
            );
            if (
              !inset ||
              !sibling.classList.contains("bullet-plugin-code-guide-seam")
            )
              throw Error(
                "Measured code preview and sibling seam are required",
              );
            const x = Math.floor(box.left - 24);
            return {
              clip: {
                x,
                y: Math.floor(box.top - 6),
                width: Math.floor(box.left + inset - 8 - x),
                height: 14,
                scale: 1,
              },
              opening: opening.getAttribute("style"),
              sibling: sibling.getAttribute("style"),
              dpr: devicePixelRatio,
            };
          },
          font,
          text,
        );
        const shot = cdp("Page.captureScreenshot", {
          format: "png",
          clip: record.geometry.clip,
        });
        fs.writeFileSync(
          `${output}/${name}.png`,
          Buffer.from(shot.data, "base64"),
        );
        record.pixels = evaluate(async (data) => {
          const bitmap = await createImageBitmap(
            new Blob(
              [Uint8Array.from(atob(data), (char) => char.charCodeAt(0))],
              {
                type: "image/png",
              },
            ),
          );
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = canvas.getContext("2d");
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          const { width, height } = canvas;
          const pixels = context.getImageData(0, 0, width, height).data;
          const value = (x, y) => {
            const at = (y * width + x) * 4;
            return Math.max(pixels[at], pixels[at + 1], pixels[at + 2]);
          };
          const upper = Math.floor(height * 0.15);
          const lower = Math.floor(height * 0.85);
          const background = value(0, upper);
          const columns = [];
          for (let x = 1; x < width - 1; x++) {
            const reference = Math.max(value(x, upper), value(x, lower));
            if (reference < background + 18) continue;
            const seam = [];
            for (let y = Math.floor(height * 0.3); y < height * 0.7; y++)
              seam.push(value(x, y));
            columns.push({
              x,
              reference,
              maximum: Math.max(...seam),
              minimum: Math.min(...seam),
            });
          }
          return { width, height, background, columns };
        }, shot.data);
        assert.ok(
          record.pixels.columns.length >= 3,
          "Missing guide paint samples",
        );
        for (const column of record.pixels.columns) {
          assert.ok(
            column.maximum <= column.reference + 2,
            `${name}: bright guide seam at pixel ${column.x}: ${column.maximum} > ${column.reference}`,
          );
          assert.ok(
            column.minimum >= column.reference - 2,
            `${name}: dark guide gap at pixel ${column.x}: ${column.minimum} < ${column.reference}`,
          );
        }
        console.log(`PASS ${name}`);
      } catch (error) {
        failures.push({ name, error: error.message });
        console.log(`FAIL ${name}: ${error.message}`);
      }
      results.push(record);
    }
  }
} finally {
  fs.writeFileSync(
    `${output}/results.json`,
    JSON.stringify({ results, failures }, null, 2),
  );
  evaluate(
    async (original, note, text) => {
      const view = window.__guideSeamLeaf?.view;
      if (view?.editor.getValue() !== text)
        throw Error("Verification changed Markdown");
      await view.save();
      const file = app.vault.getAbstractFileByPath(note);
      if ((await app.vault.read(file)) !== text)
        throw Error("Saved Markdown changed");
      window.__guideSeamLeaf.detach();
      delete window.__guideSeamLeaf;
      app.setBaseFontSize(original.font);
      if (original.shiki) {
        if (!app.plugins.plugins["shiki-highlighter"])
          await app.plugins.enablePlugin("shiki-highlighter");
        const plugin = app.plugins.plugins["shiki-highlighter"];
        plugin.settings = original.settings;
        await plugin.reloadHighlighter();
      } else await app.plugins.disablePlugin("shiki-highlighter");
      const leaf = app.workspace.getLeafById(original.leaf);
      if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
      await app.vault.trash(file, true);
    },
    original,
    note,
    text,
  );
}
assert.equal(failures.length, 0, `${failures.length} code guide seam failures`);
