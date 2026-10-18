const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");

const output = process.argv[2];
fs.mkdirSync(output);
const blankViewport = process.argv.includes("--blank-viewport");
const fontArgument = process.argv.find((arg) => arg.startsWith("--font="));
const font = fontArgument ? Number(fontArgument.split("=")[1]) : 16;
assert(Number.isFinite(font) && font >= 12, "Valid font size required");
const note = `pages/code-guide-continuity-${randomUUID()}.md`;
const prefix = "\t".repeat(5);
const attached = [
  "- Verification scratch",
  "\t- hello",
  "\t\t- hello",
  "\t\t\t- ```",
  "\t\t\t  hello",
  "\t\t\t  hell",
  "\t\t\t  ```",
  "\t\t\t\t- hello",
  `${prefix}- \`\`\``,
  `${prefix}  hello`,
  `${prefix}\t  hello`,
  "",
  `${prefix}  hello`,
  `${prefix}\t  hello`,
  `${prefix}  `,
  `${prefix}  \`\`\``,
  "- tail",
].join("\n");
const cases = blankViewport
  ? [
      {
        name: "attached-blank-viewport",
        text: [
          ...attached.split("\n").slice(0, 9),
          `${prefix}  hello`,
          ...Array(400).fill(""),
          `${prefix}  \`\`\``,
          "- tail",
        ].join("\n"),
        opening: 9,
        closing: 411,
        cursor: 200,
        editing: true,
      },
    ]
  : [
      {
        name: "attached-editing",
        text: attached,
        opening: 9,
        closing: 16,
        cursor: 13,
        editing: true,
      },
      {
        name: "attached-preview",
        text: attached,
        opening: 9,
        closing: 16,
        cursor: 17,
        editing: false,
      },
      {
        name: "root-continuation",
        text: "- parent\n  ```js\n  code\n  ```\n  note",
        opening: 2,
        closing: 4,
        cursor: 5,
        owner: 1,
        editing: false,
      },
      {
        name: "nested-continuation",
        text: "- ancestor\n\t- parent\n\t  ```js\n\t  code\n\t  ```\n\t  note",
        opening: 3,
        closing: 5,
        cursor: 6,
        owner: 2,
        editing: false,
      },
    ];
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
  evaluate(
    async (note, font) => {
      window.__codeContinuityLeaf = app.workspace.getLeaf("tab");
      await window.__codeContinuityLeaf.openFile(
        await app.vault.create(note, ""),
      );
      app.setBaseFontSize(font);
    },
    note,
    font,
  );
  for (const mode of ["native", "shiki", "numbers"]) {
    evaluate(async (mode) => {
      if (mode === "native")
        await app.plugins.disablePlugin("shiki-highlighter");
      else {
        await app.plugins.enablePlugin("shiki-highlighter");
        const plugin = app.plugins.plugins["shiki-highlighter"];
        if (!plugin) throw Error("Shiki must be installed for renderer parity");
        plugin.settings.ecDefaultShowLineNumbers = mode === "numbers";
        await plugin.reloadHighlighter();
      }
    }, mode);
    for (const test of cases) {
      const record = { name: `${mode}-${test.name}-${font}`, fixture: test };
      try {
        record.geometry = evaluate(
          async (test, blankViewport) => {
            const view = app.workspace.activeLeaf.view;
            const editor = view.editor;
            editor.setValue(test.text);
            editor.setCursor({
              line: test.opening - 1,
              ch: editor.getLine(test.opening - 1).length,
            });
            editor.scrollIntoView(
              {
                from: { line: 0, ch: 0 },
                to: { line: test.opening - 1, ch: 0 },
              },
              true,
            );
            window.focus();
            editor.focus();
            await new Promise((resolve) => setTimeout(resolve, 300));
            const cm = editor.cm;
            const row = (number) =>
              [...cm.contentDOM.querySelectorAll(".cm-line")].find(
                (el) => cm.state.doc.lineAt(cm.posAtDOM(el)).number === number,
              );
            const marker = row(test.owner ?? test.opening)?.querySelector(
              ".list-bullet",
            );
            if (!marker)
              throw Error("Visible owner bullet required for calibration");
            const paintedX = (marker) => {
              const box = marker.getBoundingClientRect();
              const css = getComputedStyle(marker, "::after");
              const length = (value, size) =>
                value.endsWith("%")
                  ? (parseFloat(value) * size) / 100
                  : parseFloat(value);
              const width = parseFloat(css.width);
              const [translate = "0px"] =
                css.translate === "none" ? [] : css.translate.split(/\s+/);
              const transform =
                css.transform === "none"
                  ? new DOMMatrix()
                  : new DOMMatrix(css.transform);
              return (
                box.left +
                (css.left === "auto"
                  ? box.width / 2
                  : length(css.left, box.width) + width / 2) +
                length(translate, width) +
                transform.e
              );
            };
            const ownerX = paintedX(marker);
            const ancestorX =
              test.owner > 1
                ? paintedX(row(1).querySelector(".list-bullet"))
                : null;
            if (!Number.isFinite(ownerX))
              throw Error("Native bullet paint is unmeasurable");
            editor.setCursor({
              line: test.cursor - 1,
              ch: editor.getLine(test.cursor - 1).length,
            });
            editor.scrollIntoView(
              { from: editor.getCursor(), to: editor.getCursor() },
              blankViewport,
            );
            await new Promise((resolve) => setTimeout(resolve, 350));
            await view.save();
            if (
              editor.getValue() !== test.text ||
              (await app.vault.read(view.file)) !== test.text
            )
              throw Error("Literal Markdown changed");
            const viewport = cm.scrollDOM.getBoundingClientRect();
            const sourceRows = [
              ...cm.contentDOM.querySelectorAll(".cm-line"),
            ].map((el) => ({
              number: cm.state.doc.lineAt(cm.posAtDOM(el)).number,
              text: el.textContent,
              top: el.getBoundingClientRect().top,
              bottom: el.getBoundingClientRect().bottom,
            }));
            let top, bottom;
            if (blankViewport) {
              if (row(test.opening))
                throw Error("Opening fence must be virtualized out of DOM");
              const visible = sourceRows.filter(
                (r) =>
                  r.bottom > viewport.top + 4 && r.top < viewport.bottom - 4,
              );
              if (
                !visible.length ||
                visible.some((r) => cm.state.doc.line(r.number).text !== "")
              )
                throw Error(
                  "Viewport must contain only physically empty code rows",
                );
              top = Math.max(viewport.top + 4, visible[0].top + 2);
              bottom = Math.min(viewport.bottom - 4, visible.at(-1).bottom - 2);
            } else {
              const opening = row(test.opening)?.getBoundingClientRect();
              const closing = row(test.closing)?.getBoundingClientRect();
              const embed = cm.contentDOM.querySelectorAll(
                ".cm-preview-code-block",
              );
              const preview = [...embed].find(
                (el) =>
                  el.getBoundingClientRect().top >= opening.top &&
                  el.getBoundingClientRect().top <
                    (closing?.bottom ?? Infinity),
              );
              const body = row(test.opening + 1)?.getBoundingClientRect();
              top = test.editing ? body.bottom + 2 : opening.top + 2;
              bottom = test.editing ? closing.bottom - 2 : opening.bottom - 2;
              if (!test.owner && !test.editing) {
                if (!body)
                  throw Error(
                    "First preview code row required below its bullet",
                  );
                top = body.bottom + 2;
                bottom = preview
                  ? preview.getBoundingClientRect().bottom - 2
                  : closing.bottom - 2;
              }
            }
            if (
              !(bottom > top) ||
              top < viewport.top ||
              bottom > viewport.bottom
            )
              throw Error("Guide sample must be visible and nonempty");
            return {
              ownerX,
              ancestorX,
              top,
              bottom,
              viewportWidth: innerWidth,
              sourceRows,
              saved: test.text,
              openingAbsent: !row(test.opening),
            };
          },
          test,
          blankViewport,
        );
        const shot = cdp("Page.captureScreenshot", { format: "png" });
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
            const scale = canvas.width / geometry.viewportWidth;
            const value = (x, y) => {
              const i = (y * canvas.width + x) * 4;
              return Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
            };
            const scan = (position) => {
              const values = [];
              for (
                let y = Math.ceil(geometry.top * scale);
                y < Math.floor(geometry.bottom * scale);
                y++
              ) {
                let ridge = 0;
                const center = Math.round(position * scale);
                const background = Math.max(
                  value(center - Math.round(7 * scale), y),
                  value(center + Math.round(7 * scale), y),
                );
                for (
                  let x = center - Math.ceil(2 * scale);
                  x <= center + Math.ceil(2 * scale);
                  x++
                )
                  ridge = Math.max(ridge, value(x, y) - background);
                values.push(ridge);
              }
              return values;
            };
            const values = scan(geometry.ownerX);
            return {
              minimum: Math.min(...values),
              maximum: Math.max(...values),
              darkRows: values.filter((v) => v < 12).length,
              paintedRows: values.filter((v) => v >= 12).length,
              rows: values.length,
              scale,
              ancestorMinimum:
                geometry.ancestorX === null
                  ? null
                  : Math.min(...scan(geometry.ancestorX)),
            };
          },
          shot.data,
          record.geometry,
        );
        if (test.editing) {
          assert(record.pixels.minimum >= 12, "Owner guide has a painted gap");
          assert(
            record.pixels.maximum - record.pixels.minimum <= 8,
            "Owner guide has uneven or doubled paint",
          );
        } else
          assert(
            record.pixels.maximum < 12,
            "Owner guide protrudes into preview code card",
          );
        if (record.pixels.ancestorMinimum !== null)
          assert(
            record.pixels.ancestorMinimum >= 12,
            "Ancestor guide disappeared beside continuation card",
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
  try {
    evaluate(
      async ({ original, note }) => {
        window.__codeContinuityLeaf?.detach();
        delete window.__codeContinuityLeaf;
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
  } finally {
    cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
  }
}
console.log(JSON.stringify({ results: results.length, failures }));
assert.equal(failures.length, 0);
