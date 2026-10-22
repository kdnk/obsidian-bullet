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
const hover = process.argv.includes("--hover");
const preview = process.argv.includes("--preview");
const zoomArgument = process.argv.find((arg) => arg.startsWith("--zoom="));
const zoom = zoomArgument ? Number(zoomArgument.split("=")[1]) : null;
assert(zoom === null || Number.isFinite(zoom));
const note = `pages/code-guide-x-${randomUUID()}.md`;
const extraRows = process.argv.includes("--offscreen-opening") ? 160 : 0;
const lines = [
  "- Verification scratch",
  "\t- hello",
  "\t\t- hello",
  preview ? "\t\t\t- ```js" : "\t\t\t- ```",
  "\t\t\t  hello",
  "\t\t\t  hell",
  "\t\t\t  ```",
  "\t\t\t\t- hello",
  "\t\t\t\t\t- ```",
  "\t\t\t\t\t  hello",
  "\t\t\t\t\t\t  hello",
  "\t\t\t\t\t  ```",
  "- tail",
];
if (extraRows) lines.splice(6, 0, ...Array(extraRows).fill("\t\t\t  hello"));
const text = lines.join("\n");
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  font: app.getBaseFontSize(),
  zoom: require("electron").webFrame.getZoomLevel(),
  shiki: !!app.plugins.plugins["shiki-highlighter"],
  settings: app.plugins.plugins["shiki-highlighter"]?.settings,
}));
const results = [];
const failures = [];
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(
    async ({ note, zoom }) => {
      if (zoom !== null) require("electron").webFrame.setZoomLevel(zoom);
      window.__codeGuideXLeaf = app.workspace.getLeaf("tab");
      await window.__codeGuideXLeaf.openFile(await app.vault.create(note, ""));
    },
    { note, zoom },
  );
  for (const font of fonts) {
    evaluate((font) => app.setBaseFontSize(font), font);
    for (const mode of ["native", "shiki", "numbers"]) {
      const record = { name: `${mode}-${font}`, font, mode, hover, preview };
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
        evaluate(
          async ({ text, preview, extraRows }) => {
            const view = app.workspace.activeLeaf.view,
              editor = view.editor;
            editor.setValue(text);
            editor.setCursor(
              preview ? { line: 12, ch: 6 } : { line: 5, ch: 9 },
            );
            window.focus();
            editor.focus();
            await new Promise((resolve) => setTimeout(resolve, 450));
            if (extraRows) {
              editor.setCursor({ line: extraRows + 5, ch: 9 });
              editor.scrollIntoView(
                { from: editor.getCursor(), to: editor.getCursor() },
                true,
              );
              await new Promise((resolve) => setTimeout(resolve, 400));
            }
            await view.save();
            if (
              !document.title.includes("vault") ||
              document.title.includes("base") ||
              document.visibilityState !== "visible"
            )
              throw Error("Visible test vault required");
            if (
              editor.getValue() !== text ||
              (await app.vault.read(view.file)) !== text
            )
              throw Error("Saved Markdown changed");
          },
          { text, preview, extraRows },
        );
        const target = evaluate((followingLine) => {
          window.focus();
          if (
            !document.title.includes("vault") ||
            document.title.includes("base")
          )
            throw Error("Test title required");
          const cm = app.workspace.activeLeaf.view.editor.cm;
          const row = [...cm.contentDOM.querySelectorAll(".cm-line")].find(
            (el) =>
              cm.state.doc.lineAt(cm.posAtDOM(el)).number === followingLine,
          );
          const guide = [
            ...row.querySelectorAll(".cm-hmd-list-indent .cm-indent"),
          ].find((el) => {
            const range = document.createRange();
            range.setStart(el.closest(".cm-hmd-list-indent"), 0);
            range.setEndBefore(el);
            return range.toString() === "\t\t\t";
          });
          if (!guide) throw Error("Native guide target required");
          const box = guide.getBoundingClientRect(),
            point = {
              x: box.left + box.width / 2,
              y: box.top + box.height / 2,
            };
          if (document.elementFromPoint(point.x, point.y) !== guide)
            throw Error("Native guide hit target required");
          window.__codeGuideXPointer = null;
          document.addEventListener(
            "pointermove",
            (event) => {
              window.__codeGuideXPointer = {
                x: event.clientX,
                y: event.clientY,
              };
            },
            { once: true, capture: true },
          );
          return point;
        }, 8 + extraRows);
        cdp("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          ...(hover ? target : { x: 10, y: 10 }),
        });
        record.geometry = evaluate(async (extraRows) => {
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          const cm = app.workspace.activeLeaf.view.editor.cm;
          const rows = [...cm.contentDOM.querySelectorAll(".cm-line")];
          const row = (number) =>
            rows.find(
              (element) =>
                cm.state.doc.lineAt(cm.posAtDOM(element)).number === number,
            );
          const opening = row(4);
          const closing = row(7 + extraRows) ?? opening;
          const following = row(8 + extraRows);
          if (extraRows && opening)
            throw Error("Opening source row must be virtualized");
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
            (borderRight > 0
              ? outerWidth - borderRight / 2
              : borderLeft > 0
                ? borderLeft / 2
                : outerWidth / 2);
          const processor = opening?.classList.contains(
            "bullet-plugin-code-preview-owner-guide",
          );
          const owner = processor ? opening : closing;
          if (
            !owner ||
            !owner.matches(
              ".bullet-plugin-code-owner-guide, .bullet-plugin-code-preview-owner-guide",
            )
          )
            throw Error("Code owner paint required");
          const custom = getComputedStyle(
            owner,
            processor ? "::after" : undefined,
          );
          const customWidth = number(
            processor ? custom.width : custom.backgroundSize,
          );
          const customLeft = number(
            processor ? custom.left : custom.backgroundPositionX,
          );
          const customCenter =
            owner.getBoundingClientRect().left + customLeft + customWidth / 2;
          if (paint.visibility !== "visible")
            throw Error("Native reference must be visible");
          const nativeWidth = borderRight || borderLeft || outerWidth;
          const ownerBox = box(owner);
          const ownerSample = processor
            ? ownerBox.top + number(custom.top) + number(custom.height) / 2
            : (ownerBox.top + ownerBox.bottom) / 2;
          const followingBox = box(following);
          return {
            native: {
              box: box(native),
              container: box(container),
              containerClass: container.className,
              clientLeft: container.clientLeft,
              center: nativeCenter,
              width: nativeWidth,
              classes: native.className,
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
                  "borderRightColor",
                  "borderLeftColor",
                  "backgroundColor",
                ].map((key) => [key, paint[key]]),
              ),
            },
            custom: {
              box: ownerBox,
              center: customCenter,
              backgroundPositionX: custom.backgroundPositionX,
              backgroundImage: custom.backgroundImage,
              backgroundColor: custom.backgroundColor,
              classes: owner.className,
              width: customWidth,
            },
            seamY: followingBox.top,
            samples: [
              { name: "custom", y: ownerSample },
              { name: "native", y: followingBox.bottom - 4 },
            ],
            received: window.__codeGuideXPointer,
            dpr: devicePixelRatio,
            clip: {
              x: 0,
              y: 0,
              width: innerWidth,
              height: innerHeight,
              scale: 1,
            },
          };
        }, extraRows);
        assert(
          record.geometry.received,
          "Renderer received native pointer movement",
        );
        const shot = cdp("Page.captureScreenshot", {
          format: "png",
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
            const seamY = Math.floor(geometry.seamY * scale);
            const seamProfile = (y) =>
              Array.from({ length: high - low + 1 }, (_, index) => {
                const offset = (y * canvas.width + low + index) * 4;
                return (
                  (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3
                );
              });
            const reference = seamProfile(seamY - 6);
            const seam = Array.from({ length: 9 }, (_, index) => {
              const y = seamY - 4 + index;
              const values = seamProfile(y);
              return {
                y,
                values,
                maximumDifference: Math.max(
                  ...values.map((value, index) =>
                    Math.abs(value - reference[index]),
                  ),
                ),
              };
            });
            return {
              scale,
              seam: { reference, rows: seam },
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
                  total,
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
            record.geometry.custom.width - record.geometry.native.width,
          ) <= 0.02,
          "Owned and native painted widths differ by more than 0.02 CSS px",
        );
        assert(
          record.pixels.profiles[0].columns.every(
            (column, index) =>
              Math.abs(
                column.contrast -
                  record.pixels.profiles[1].columns[index].contrast,
              ) <= 2,
          ),
          "Owned and native stroke columns differ by more than two intensity units",
        );
        assert(
          Math.abs(
            record.geometry.custom.center - record.geometry.native.center,
          ) <= 0.005,
          "Owned and native guide centers differ by more than 0.005 CSS px",
        );
        assert(
          Math.abs(
            record.pixels.profiles[0].center - record.pixels.profiles[1].center,
          ) <= 0.25,
          "Painted guide centers differ by more than 0.25 physical px",
        );
        assert(
          record.pixels.seam.rows.every((row) => row.maximumDifference <= 2),
          "Code-owner and native child guide have a gap, offset or doubled seam",
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
        delete window.__codeGuideXPointer;
        app.setBaseFontSize(original.font);
        require("electron").webFrame.setZoomLevel(original.zoom);
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
