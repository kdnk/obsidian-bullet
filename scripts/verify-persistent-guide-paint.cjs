const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");

const output = process.argv[2];
fs.mkdirSync(output);
const note = `pages/persistent-guide-paint-${randomUUID()}.md`;
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  shiki: !!app.plugins.plugins["shiki-highlighter"],
  settings: app.plugins.plugins["shiki-highlighter"]?.settings,
  action: app.plugins.plugins.bullet.settings.getValues().listLineAction,
}));
const results = [];
const failures = [];
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (note) => {
    app.plugins.plugins.bullet.settings.setValue(
      "listLineAction",
      "toggle-folding",
    );
    window.__persistentPaintLeaf = app.workspace.getLeaf("tab");
    await window.__persistentPaintLeaf.openFile(
      await app.vault.create(note, ""),
    );
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
    for (const [kind, blank] of [
      ["space", " "],
      ["tab", "\t"],
      ["tab-space", "\t "],
      ["tabs", "\t\t"],
    ]) {
      const name = `${mode}-${kind}`;
      const text = `- parent\n\t\t- \`\`\`js\n\t\t  before\n${blank}\n\t\t  \`\`\``;
      const record = { name };
      try {
        record.geometry = evaluate(
          async ({ text, blank }) => {
            const view = app.workspace.activeLeaf.view,
              editor = view.editor,
              cm = editor.cm;
            editor.setValue(text);
            editor.setCursor({ line: 3, ch: blank.length });
            window.focus();
            editor.focus();
            await new Promise((resolve) => setTimeout(resolve, 350));
            await view.save();
            if (
              editor.getValue() !== text ||
              (await app.vault.read(view.file)) !== text
            )
              throw Error("Markdown changed");
            const rows = [...cm.contentDOM.querySelectorAll(".cm-line")];
            const row = (n) =>
              rows.find(
                (e) => cm.state.doc.lineAt(cm.posAtDOM(e)).number === n,
              );
            const guide = row(2).querySelector(".cm-indent");
            if (!guide) throw Error("Native reference guide required");
            const paint = getComputedStyle(guide, "::before");
            const first = row(1).getBoundingClientRect(),
              last = row(5).getBoundingClientRect();
            return {
              x:
                row(2).getBoundingClientRect().left +
                parseFloat(paint.left) +
                parseFloat(paint.marginInlineStart),
              rows: [2, 3, 5].map((n) => {
                const e = row(n),
                  b = e.getBoundingClientRect();
                return {
                  number: n,
                  top: b.top + 3,
                  bottom: b.bottom - 3,
                  promoted: e.querySelectorAll(
                    ".bullet-plugin-persistent-indent-guide",
                  ).length,
                };
              }),
              clip: {
                x: Math.max(0, first.left - 24),
                y: Math.max(0, first.top - 6),
                width: Math.min(600, innerWidth - first.left + 24),
                height: Math.min(
                  innerHeight - first.top,
                  last.bottom - first.top + 24,
                ),
                scale: 1,
              },
            };
          },
          { text, blank },
        );
        const shot = cdp("Page.captureScreenshot", {
          format: "png",
          clip: record.geometry.clip,
        });
        fs.writeFileSync(
          `${output}/${name}.png`,
          Buffer.from(shot.data, "base64"),
        );
        record.pixels = evaluate(
          async (data, geometry) => {
            const bitmap = await createImageBitmap(
              new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], {
                type: "image/png",
              }),
            );
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
              ctx = canvas.getContext("2d");
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            const pixels = ctx.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            ).data;
            const scale = canvas.width / geometry.clip.width;
            const value = (x, y) => {
              const i = (y * canvas.width + x) * 4;
              return Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
            };
            return geometry.rows.map((row) => {
              const center = Math.round((geometry.x - geometry.clip.x) * scale),
                values = [];
              for (
                let y = Math.ceil((row.top - geometry.clip.y) * scale);
                y < Math.floor((row.bottom - geometry.clip.y) * scale);
                y++
              ) {
                const background = Math.max(
                  value(center - Math.round(8 * scale), y),
                  value(center + Math.round(8 * scale), y),
                );
                let ridge = 0;
                for (
                  let x = center - Math.ceil(4 * scale);
                  x <= center + Math.ceil(4 * scale);
                  x++
                )
                  ridge = Math.max(ridge, value(x, y) - background);
                values.push(ridge);
              }
              return {
                number: row.number,
                minimum: Math.min(...values),
                maximum: Math.max(...values),
              };
            });
          },
          shot.data,
          record.geometry,
        );
        const low = Math.min(...record.pixels.map((r) => r.minimum)),
          high = Math.max(...record.pixels.map((r) => r.maximum));
        assert(low >= 12, "Reference native guide must remain painted");
        assert(high - low <= 8, "Native guide has overlapping or uneven paint");
        assert(
          record.geometry.rows.every((r) => r.promoted === 0),
          "Native guide must not acquire a duplicate fallback",
        );
      } catch (error) {
        record.error = error.stack;
        failures.push({ name, error: error.message });
      }
      results.push(record);
    }
  }
  if (!process.argv.includes("--color-only")) {
    const text =
      "- parent\n\t- branch A\n\t\t- grandchild A\n\t- branch B\n\t\t- grandchild B\n\t- leaf";
    evaluate(async (text) => {
      await app.plugins.disablePlugin("shiki-highlighter");
      const e = app.workspace.activeLeaf.view.editor;
      e.setValue(text);
      e.setCursor({ line: 0, ch: 8 });
      window.focus();
      e.focus();
      await new Promise((r) => setTimeout(r, 350));
    }, text);
    for (const collapsed of [true, false]) {
      const point = evaluate(() => {
        const cm = app.workspace.activeLeaf.view.editor.cm;
        const row = [...cm.contentDOM.querySelectorAll(".cm-line")].find(
          (e) => cm.state.doc.lineAt(cm.posAtDOM(e)).number === 6,
        );
        const guide = row?.querySelector(".cm-hmd-list-indent > .cm-indent");
        if (!guide) throw Error("Guide needed to reopen folded children");
        const b = row.getBoundingClientRect(),
          p = getComputedStyle(guide, "::before");
        const point = {
          x: b.left + parseFloat(p.left) + parseFloat(p.marginInlineStart) + 1,
          y: b.top + b.height / 2,
        };
        window.__persistentPaintTarget = guide;
        return point;
      });
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
        evaluate((point) => {
          window.focus();
          if (
            !document.title.includes("vault") ||
            document.title.includes("base")
          )
            throw Error("Wrong focused vault");
          if (
            document
              .elementFromPoint(point.x, point.y)
              ?.closest(".cm-indent") !== window.__persistentPaintTarget
          )
            throw Error("Guide hit target changed");
        }, point);
        cdp("Input.dispatchMouseEvent", {
          type,
          ...point,
          button: type === "mouseMoved" ? "none" : "left",
          clickCount: type === "mouseMoved" ? 0 : 1,
        });
      }
      const state = evaluate(async (text) => {
        await new Promise((r) => setTimeout(r, 350));
        const view = app.workspace.activeLeaf.view,
          e = view.editor,
          cm = e.cm;
        await view.save();
        const rows = [...cm.contentDOM.querySelectorAll(".cm-line")];
        const row = (n) =>
          rows.find((r) => cm.state.doc.lineAt(cm.posAtDOM(r)).number === n);
        if (e.getValue() !== text || (await app.vault.read(view.file)) !== text)
          throw Error("Folding changed Markdown");
        return {
          collapsed: [2, 4].map(
            (n) => !!row(n)?.querySelector(".cm-fold-indicator.is-collapsed"),
          ),
          grandchildren: [3, 5].filter((n) => !!row(n)),
          leaf: !!row(6)?.querySelector(".list-bullet"),
          parent: !!row(1)?.querySelector(".list-bullet"),
          persistent: cm.contentDOM.querySelectorAll(
            ".bullet-plugin-persistent-indent-guide",
          ).length,
          reopeningGuide: !!row(6)?.querySelector(
            ".cm-hmd-list-indent > .cm-indent",
          ),
        };
      }, text);
      results.push({ name: `folded-${collapsed}`, state });
      assert.deepEqual(state.collapsed, [collapsed, collapsed]);
      assert.deepEqual(state.grandchildren, collapsed ? [] : [3, 5]);
      assert(
        state.leaf && state.parent,
        "Parent and leaf retain native bullets",
      );
      assert(
        state.reopeningGuide,
        "Children retain a clickable reopening guide",
      );
      fs.writeFileSync(
        `${output}/folded-${collapsed}.png`,
        Buffer.from(
          cdp("Page.captureScreenshot", { format: "png" }).data,
          "base64",
        ),
      );
    }
  }
} finally {
  fs.writeFileSync(
    `${output}/results.json`,
    JSON.stringify({ results, failures }, null, 2),
  );
  evaluate(
    async ({ original, note }) => {
      window.__persistentPaintLeaf?.detach();
      delete window.__persistentPaintLeaf;
      delete window.__persistentPaintTarget;
      app.plugins.plugins.bullet.settings.setValue(
        "listLineAction",
        original.action,
      );
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
console.log(JSON.stringify({ cases: results.length, failures }));
assert.equal(failures.length, 0);
