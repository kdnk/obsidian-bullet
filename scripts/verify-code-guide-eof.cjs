const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");

const output = process.argv[2];
fs.mkdirSync(output);
const note = `pages/code-guide-eof-${randomUUID()}.md`;
const text =
  "- Verification scratch\n\t- hello\n\t\t- hello\n\t\t\t- ```\n\t\t\t  hello\n\t\t\t  hell\n\t\t\t  ```\n\t\t\t\t- hello\n\t\t\t\t\t- ```\n\t\t\t\t\t  hello\n\t\t\t\t\t\t  hello\n\t\t\t\t\t  hello\n\t\t\t\t\t\t  hello\n\t\t\t\t\t  \n\t\t\t\t\t  ```\n";
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  font: app.getBaseFontSize(),
  shiki: !!app.plugins.plugins["shiki-highlighter"],
  settings: app.plugins.plugins["shiki-highlighter"]?.settings,
}));
const results = [];
const failures = [];
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (note) => {
    window.__codeEofLeaf = app.workspace.getLeaf("tab");
    await window.__codeEofLeaf.openFile(await app.vault.create(note, ""));
  }, note);
  for (const mode of ["native", "shiki", "numbers"]) {
    evaluate(async (mode) => {
      if (mode === "native")
        await app.plugins.disablePlugin("shiki-highlighter");
      else {
        await app.plugins.enablePlugin("shiki-highlighter");
        const plugin = app.plugins.plugins["shiki-highlighter"];
        plugin.settings.ecDefaultShowLineNumbers = mode === "numbers";
        await plugin.reloadHighlighter();
      }
    }, mode);
    for (const font of [16, 24, 30]) {
      const record = { name: `${mode}-${font}` };
      try {
        evaluate(
          async ({ text, font }) => {
            window.focus();
            app.setBaseFontSize(font);
            const editor = app.workspace.activeLeaf.view.editor;
            editor.setValue(text + "- tail");
            editor.setCursor({ line: 13, ch: 7 });
            editor.focus();
            await new Promise((resolve) => setTimeout(resolve, 300));
            editor.replaceRange("", { line: 15, ch: 0 }, { line: 15, ch: 6 });
            await new Promise((resolve) => setTimeout(resolve, 300));
          },
          { text, font },
        );
        record.geometry = evaluate(async (text) => {
          const view = app.workspace.activeLeaf.view;
          const cm = view.editor.cm;
          await view.save();
          const assertText = view.editor.getValue();
          if (assertText !== text || (await app.vault.read(view.file)) !== text)
            throw Error("Source changed");
          const rows = [...cm.contentDOM.querySelectorAll(".cm-line")];
          const row = (number) =>
            rows.find(
              (el) => cm.state.doc.lineAt(cm.posAtDOM(el)).number === number,
            );
          const opening = row(9);
          const closing = row(15);
          const outer = opening.querySelector(
            ".bullet-plugin-outer-list-guide",
          );
          if (!outer || !closing)
            throw Error("Visible source code card required");
          const paint = getComputedStyle(outer, "::before");
          const start =
            outer.getBoundingClientRect().top + parseFloat(paint.top);
          const end = start + parseFloat(paint.height);
          const bottom = closing.getBoundingClientRect().bottom;
          if (Math.abs(end - bottom) > 0.51)
            throw Error("Outer guide retained a stale height");
          const covered = rows
            .filter((el) => {
              const n = cm.state.doc.lineAt(cm.posAtDOM(el)).number;
              return n > 9 && n <= 15;
            })
            .map((el) => ({
              text: el.textContent,
              hidden: [
                ...el.querySelectorAll(".bullet-plugin-outer-list-guide"),
              ].every(
                (g) => getComputedStyle(g, "::before").visibility === "hidden",
              ),
            }));
          if (covered.some((row) => !row.hidden))
            throw Error("Body duplicates opening outer guide");
          const x =
            outer.getBoundingClientRect().right -
            parseFloat(paint.right) -
            parseFloat(paint.borderRightWidth) / 2;
          const top = row(1).getBoundingClientRect().top + 4;
          return {
            start,
            end,
            bottom,
            covered,
            dpr: devicePixelRatio,
            clip: {
              x: Math.floor(x - 2),
              y: Math.ceil(top),
              width: 5,
              height: Math.floor(bottom - top - 2),
              scale: 1,
            },
          };
        }, text);
        const shot = cdp("Page.captureScreenshot", {
          format: "png",
          clip: record.geometry.clip,
        });
        fs.writeFileSync(
          `${output}/${record.name}.png`,
          Buffer.from(shot.data, "base64"),
        );
        record.pixels = evaluate(
          async (data, geometry) => {
            const bitmap = await createImageBitmap(
              new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], {
                type: "image/png",
              }),
            );
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const ctx = canvas.getContext("2d");
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            const pixels = ctx.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            ).data;
            const values = [];
            for (let y = 0; y < canvas.height; y++) {
              let value = 0;
              for (let x = 0; x < canvas.width; x++)
                value = Math.max(value, pixels[(y * canvas.width + x) * 4]);
              values.push(value);
            }
            const reference = Math.max(...values.slice(4, 12));
            const from =
              Math.ceil((geometry.start - geometry.clip.y) * geometry.dpr) + 1;
            const to =
              Math.floor((geometry.end - geometry.clip.y) * geometry.dpr) - 1;
            return {
              reference,
              maximum: Math.max(...values),
              minimum: Math.min(...values.slice(from, to)),
              nativeBoundaryMinimum: Math.min(...values),
            };
          },
          shot.data,
          record.geometry,
        );
        assert(
          record.pixels.maximum <= record.pixels.reference + 3,
          "Outer guide has doubled bright paint",
        );
        assert(
          record.pixels.minimum >= record.pixels.reference - 5,
          "Outer guide has a dark gap",
        );
      } catch (error) {
        record.error = error.stack;
        failures.push({ name: record.name, error: error.message });
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
    async ({ original, note }) => {
      window.__codeEofLeaf?.detach();
      delete window.__codeEofLeaf;
      app.setBaseFontSize(original.font);
      if (original.shiki) {
        await app.plugins.enablePlugin("shiki-highlighter");
        const plugin = app.plugins.plugins["shiki-highlighter"];
        plugin.settings = original.settings;
        await plugin.reloadHighlighter();
      } else await app.plugins.disablePlugin("shiki-highlighter");
      const leaf = app.workspace.getLeafById(original.leaf);
      if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.fileManager.trashFile(file);
    },
    { original, note },
  );
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
}
console.log(JSON.stringify({ results: results.length, failures }));
assert.equal(failures.length, 0);
