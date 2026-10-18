const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");

const output = process.argv[2];
assert(output, "A fresh output directory is required");
fs.mkdirSync(output);
const fontArgument = process.argv.find((arg) => arg.startsWith("--font="));
const fonts = fontArgument
  ? [Number(fontArgument.split("=")[1])]
  : [16, 24, 30];
assert(fonts.every((font) => Number.isFinite(font) && font >= 12));
const note = `pages/code-guide-x-${randomUUID()}.md`;
const text = [
  "- Verification scratch",
  "\t- hello",
  "\t\t- hello",
  "\t\t\t- ```",
  "\t\t\t  hello",
  "\t\t\t  hell",
  "\t\t\t  ```",
  "\t\t\t\t- hello",
  "\t\t\t\t\t- ```",
  "\t\t\t\t\t  hello",
  "\t\t\t\t\t\t  hello",
  "\t\t\t\t\t  ```",
  "- tail",
].join("\n");
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
    window.__codeGuideXLeaf = app.workspace.getLeaf("tab");
    await window.__codeGuideXLeaf.openFile(await app.vault.create(note, ""));
  }, note);
  for (const font of fonts) {
    evaluate((font) => app.setBaseFontSize(font), font);
    for (const mode of ["native", "shiki", "numbers"]) {
      const record = { name: `${mode}-${font}`, font, mode };
      try {
        evaluate(async (mode) => {
          if (mode === "native")
            await app.plugins.disablePlugin("shiki-highlighter");
          else {
            await app.plugins.enablePlugin("shiki-highlighter");
            const plugin = app.plugins.plugins["shiki-highlighter"];
            if (!plugin) throw Error("Shiki must be installed");
            plugin.settings.ecDefaultShowLineNumbers = mode === "numbers";
            await plugin.reloadHighlighter();
          }
        }, mode);
        record.geometry = evaluate(async (text) => {
          const view = app.workspace.activeLeaf.view;
          const editor = view.editor;
          const cm = editor.cm;
          editor.setValue(text);
          editor.setCursor({ line: 5, ch: 9 });
          window.focus();
          editor.focus();
          await new Promise((resolve) => setTimeout(resolve, 450));
          await view.save();
          if (document.visibilityState !== "visible")
            throw Error("The tested renderer must be visible");
          if (
            editor.getValue() !== text ||
            (await app.vault.read(view.file)) !== text
          )
            throw Error("Saved Markdown changed");
          const rows = [...cm.contentDOM.querySelectorAll(".cm-line")];
          const row = (number) =>
            rows.find(
              (element) =>
                cm.state.doc.lineAt(cm.posAtDOM(element)).number === number,
            );
          const closing = row(7);
          const following = row(8);
          if (!closing || !following)
            throw Error("Both comparison rows must be visible");
          const native = [
            ...following.querySelectorAll(".cm-hmd-list-indent .cm-indent"),
          ].find((element) => {
            const range = document.createRange();
            range.setStart(element.closest(".cm-hmd-list-indent"), 0);
            range.setEndBefore(element);
            return range.toString() === "\t\t\t";
          });
          if (!native)
            throw Error(
              "Native guide with exactly three preceding tabs required",
            );
          let container = native.parentElement;
          while (container && getComputedStyle(container).position === "static")
            container = container.parentElement;
          if (!container)
            throw Error("Native pseudo-element containing block required");
          const box = (element) => {
            const rect = element.getBoundingClientRect();
            return {
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
            };
          };
          const paint = getComputedStyle(native, "::before");
          const number = (value) => parseFloat(value) || 0;
          const borderLeft = number(paint.borderLeftWidth);
          const borderRight = number(paint.borderRightWidth);
          const paddingLeft = number(paint.paddingLeft);
          const paddingRight = number(paint.paddingRight);
          const cssWidth = number(paint.width);
          const outerWidth =
            paint.boxSizing === "border-box"
              ? cssWidth
              : cssWidth +
                borderLeft +
                borderRight +
                paddingLeft +
                paddingRight;
          const nativeCenter =
            container.getBoundingClientRect().left +
            container.clientLeft +
            number(paint.left) +
            number(paint.marginLeft) +
            outerWidth -
            borderRight / 2;
          const custom = getComputedStyle(closing);
          const customWidth =
            number(custom.getPropertyValue("--indentation-guide-width")) || 1;
          const customCenter =
            closing.getBoundingClientRect().left +
            number(custom.backgroundPositionX) +
            customWidth / 2;
          if (!closing.classList.contains("bullet-plugin-code-owner-guide"))
            throw Error("Closing row must own a painted guide");
          if (paint.visibility !== "visible" || borderRight <= 0)
            throw Error("Native reference must paint its right border");
          const closingBox = box(closing),
            followingBox = box(following);
          return {
            native: {
              box: box(native),
              container: box(container),
              containerClass: container.className,
              clientLeft: container.clientLeft,
              center: nativeCenter,
              paint: Object.fromEntries(
                [
                  "left",
                  "right",
                  "marginLeft",
                  "marginRight",
                  "width",
                  "paddingLeft",
                  "paddingRight",
                  "borderLeftWidth",
                  "borderRightWidth",
                  "boxSizing",
                  "transform",
                  "visibility",
                ].map((key) => [key, paint[key]]),
              ),
            },
            custom: {
              box: closingBox,
              center: customCenter,
              backgroundPositionX: custom.backgroundPositionX,
              width: customWidth,
            },
            samples: [
              { name: "custom", y: (closingBox.top + closingBox.bottom) / 2 },
              { name: "native", y: followingBox.bottom - 4 },
            ],
            clip: {
              x: 0,
              y: 0,
              width: innerWidth,
              height: innerHeight,
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
              new Blob(
                [
                  Uint8Array.from(atob(data), (character) =>
                    character.charCodeAt(0),
                  ),
                ],
                { type: "image/png" },
              ),
            );
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = canvas.getContext("2d");
            context.drawImage(bitmap, 0, 0);
            bitmap.close();
            const scale = canvas.width / geometry.clip.width;
            const pixels = context.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            ).data;
            const low = Math.floor((geometry.native.center - 8) * scale);
            const high = Math.ceil((geometry.native.center + 8) * scale);
            return {
              scale,
              profiles: geometry.samples.map((sample) => {
                const y = Math.floor(sample.y * scale);
                const value = (x) => {
                  const offset = (y * canvas.width + x) * 4;
                  return (
                    (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) /
                    3
                  );
                };
                const background = (value(low) + value(high)) / 2;
                const columns = Array.from(
                  { length: high - low + 1 },
                  (_, index) => ({
                    x: low + index + 0.5,
                    contrast: Math.max(0, value(low + index) - background),
                  }),
                );
                const ridge = columns.filter((column) => column.contrast >= 5);
                const total = ridge.reduce(
                  (sum, column) => sum + column.contrast,
                  0,
                );
                return {
                  name: sample.name,
                  y,
                  columns,
                  peak: Math.max(...columns.map((column) => column.contrast)),
                  center: total
                    ? ridge.reduce(
                        (sum, column) => sum + column.x * column.contrast,
                        0,
                      ) / total
                    : null,
                };
              }),
            };
          },
          shot.data,
          record.geometry,
        );
        assert(
          record.pixels.profiles.every((profile) => profile.peak >= 12),
          "Both guide strokes must be visible in the captured pixels",
        );
        assert(
          Math.abs(
            record.geometry.custom.center - record.geometry.native.center,
          ) <= 0.05,
          "Owned and native guide centers differ by more than 0.05 CSS px",
        );
        assert(
          Math.abs(
            record.pixels.profiles[0].center - record.pixels.profiles[1].center,
          ) <= 0.25,
          "Painted guide centers differ by more than 0.25 physical px",
        );
      } catch (error) {
        record.error = error.stack;
        failures.push({ name: record.name, error: error.message });
      }
      fs.writeFileSync(
        `${output}/${record.name}.json`,
        JSON.stringify(record, null, 2),
      );
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
        window.__codeGuideXLeaf?.detach();
        delete window.__codeGuideXLeaf;
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
