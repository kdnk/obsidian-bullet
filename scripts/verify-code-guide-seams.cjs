const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");

const output = process.argv[2];
assert(output, "A fresh output directory is required");
fs.mkdirSync(output);
const hover = process.argv.includes("--hover");
const ordered = process.argv.includes("--ordered");
const zoomArgument = process.argv.find((arg) => arg.startsWith("--zoom="));
const zoom = zoomArgument ? Number(zoomArgument.split("=")[1]) : null;
assert(zoom === null || Number.isFinite(zoom));
const note = `pages/code-guide-seams-${randomUUID()}.md`;
const marker = ordered ? "1." : "-";
const text = [
  "- a- Threading test",
  `\t${marker} Parent`,
  `\t\t${marker} Selected item`,
  "\t\t" + marker + " ```",
  "\t\t\tllo",
  "\t\t\t  ",
  "\t\t" + " ".repeat(marker.length + 1) + "```",
  `\t\t${marker} `,
  `\t\t\t${marker} `,
  "",
].join("\n");
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
    async ({ note, text, zoom }) => {
      if (zoom !== null) require("electron").webFrame.setZoomLevel(zoom);
      window.__guideSeamLeaf = app.workspace.getLeaf("tab");
      await window.__guideSeamLeaf.openFile(await app.vault.create(note, text));
      await window.__guideSeamLeaf.setViewState({
        type: "markdown",
        state: { file: note, mode: "source", source: false },
      });
      app.workspace.activeLeaf.view.editor.setCursor({ line: 8, ch: 5 });
    },
    { note, text, zoom },
  );
  for (const mode of ["native", "shiki", "numbers"]) {
    evaluate(async (mode) => {
      const id = "shiki-highlighter";
      if (mode === "native") await app.plugins.disablePlugin(id);
      else {
        if (!app.plugins.plugins[id]) await app.plugins.enablePlugin(id);
        const plugin = app.plugins.plugins[id];
        if (!plugin) throw Error("Shiki must be installed");
        plugin.settings.ecDefaultShowLineNumbers = mode === "numbers";
        await plugin.reloadHighlighter();
      }
    }, mode);
    for (const font of [16, 24, 30]) {
      const name = `${mode}-${font}`;
      const record = { name, hover };
      try {
        const target = evaluate(async (font) => {
          window.focus();
          app.setBaseFontSize(font);
          const editor = app.workspace.activeLeaf.view.editor;
          editor.focus();
          editor.setCursor({ line: 8, ch: 5 });
          editor.scrollIntoView(
            { from: { line: 0, ch: 0 }, to: { line: 8, ch: 5 } },
            true,
          );
          await new Promise((resolve) => setTimeout(resolve, 400));
          if (
            !document.title.includes("vault") ||
            document.title.includes("base") ||
            document.visibilityState !== "visible"
          )
            throw Error("Visible test vault required");
          const cm = editor.cm;
          const sibling = [...cm.contentDOM.querySelectorAll(".cm-line")].find(
            (el) => cm.state.doc.lineAt(cm.posAtDOM(el)).number === 8,
          );
          const guide = [
            ...sibling.querySelectorAll(".cm-hmd-list-indent > .cm-indent"),
          ].at(-1);
          if (!guide) throw Error("Native ancestor guide target required");
          const box = guide.getBoundingClientRect();
          const point = {
            x: box.left + box.width / 2,
            y: box.top + box.height / 2,
          };
          if (document.elementFromPoint(point.x, point.y) !== guide)
            throw Error("Native guide hit target required");
          return point;
        }, font);
        evaluate(() => {
          window.focus();
          if (
            !document.title.includes("vault") ||
            document.title.includes("base")
          )
            throw Error("Test title required");
          window.__guideSeamPointer = null;
          document.addEventListener(
            "pointermove",
            (event) => {
              window.__guideSeamPointer = {
                x: event.clientX,
                y: event.clientY,
              };
            },
            { once: true, capture: true },
          );
        });
        const pointer = hover ? target : { x: 10, y: 10 };
        cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...pointer });
        record.geometry = evaluate(async (text) => {
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          const view = app.workspace.activeLeaf.view,
            cm = view.editor.cm;
          await view.save();
          if (
            view.editor.getValue() !== text ||
            (await app.vault.read(view.file)) !== text
          )
            throw Error("Fixture changed");
          if (document.visibilityState !== "visible")
            throw Error("Visible renderer required");
          const rows = [...cm.contentDOM.querySelectorAll(".cm-line")];
          const row = (number) =>
            rows.find(
              (el) => cm.state.doc.lineAt(cm.posAtDOM(el)).number === number,
            );
          const opening = row(4),
            sibling = row(8);
          if (!opening || !sibling) throw Error("Both seam rows required");
          const value = (s) => parseFloat(s) || 0;
          const bounds = (element) => {
            const css = getComputedStyle(element, "::before");
            let container = element;
            while (
              container &&
              getComputedStyle(container).position === "static"
            )
              container = container.parentElement;
            if (!container) throw Error("Positioned guide container required");
            const rect = container.getBoundingClientRect(),
              owner = getComputedStyle(container);
            const borderLeft = value(css.borderLeftWidth),
              borderRight = value(css.borderRightWidth);
            const width =
              value(css.width) +
              (css.boxSizing === "border-box"
                ? 0
                : borderLeft +
                  borderRight +
                  value(css.paddingLeft) +
                  value(css.paddingRight));
            const containingWidth =
              rect.width -
              value(owner.borderLeftWidth) -
              value(owner.borderRightWidth);
            const left =
              rect.left +
              value(owner.borderLeftWidth) +
              (css.left === "auto"
                ? containingWidth -
                  value(css.right) -
                  value(css.marginRight) -
                  width
                : value(css.left) + value(css.marginLeft));
            const paintedWidth = borderRight || borderLeft || width;
            return {
              center:
                left +
                (borderRight
                  ? width - borderRight / 2
                  : borderLeft
                    ? borderLeft / 2
                    : width / 2),
              width: paintedWidth,
              top:
                rect.top +
                value(owner.borderTopWidth) +
                value(css.top) +
                value(css.marginTop),
              height: value(css.height),
              clip: css.clipPath,
            };
          };
          const prefix = (guide) => {
            const range = document.createRange();
            range.setStart(guide.closest(".cm-hmd-list-indent"), 0);
            range.setEndBefore(guide);
            return range.toString();
          };
          const openingGuides = [
            ...opening.querySelectorAll(".cm-hmd-list-indent > .cm-indent"),
          ];
          const followingGuides = [
            ...sibling.querySelectorAll(".cm-hmd-list-indent > .cm-indent"),
          ];
          const ancestors = openingGuides.map((guide) => {
            const raw = prefix(guide),
              next = followingGuides.find(
                (candidate) => prefix(candidate) === raw,
              );
            if (!next)
              throw Error(
                "Continuous ancestor with the same raw prefix required",
              );
            return {
              prefix: raw,
              opening: bounds(guide),
              following: bounds(next),
            };
          });
          const outerBefore = opening.querySelector(
              ".bullet-plugin-outer-list-guide",
            ),
            outerAfter = sibling.querySelector(
              ".bullet-plugin-outer-list-guide",
            );
          if (!outerBefore || !outerAfter)
            throw Error("Continuous outer guides required");
          ancestors.unshift({
            prefix: "outer",
            opening: bounds(outerBefore),
            following: bounds(outerAfter),
          });
          return {
            width: innerWidth,
            seam: sibling.getBoundingClientRect().top,
            ancestors,
            received: window.__guideSeamPointer,
            dpr: devicePixelRatio,
            zoom: require("electron").webFrame.getZoomLevel(),
          };
        }, text);
        assert(
          record.geometry.received,
          "Renderer received native pointer movement",
        );
        assert.equal(
          record.geometry.ancestors.length,
          3,
          "Two list ancestors and one outer guide span the seam",
        );
        const shot = cdp("Page.captureScreenshot", { format: "png" });
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
              context = canvas.getContext("2d");
            context.drawImage(bitmap, 0, 0);
            bitmap.close();
            const scale = canvas.width / geometry.width,
              pixels = context.getImageData(
                0,
                0,
                canvas.width,
                canvas.height,
              ).data;
            const value = (x, y) => {
              const i = (y * canvas.width + x) * 4;
              return Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
            };
            const seam = Math.round(geometry.seam * scale);
            return {
              scale,
              guides: geometry.ancestors.map((guide) => {
                const from = Math.floor(
                    (Math.min(guide.opening.center, guide.following.center) -
                      4) *
                      scale,
                  ),
                  to = Math.ceil(
                    (Math.max(guide.opening.center, guide.following.center) +
                      4) *
                      scale,
                  );
                const background = value(from, seam - 4);
                const columns = Array.from(
                  { length: to - from + 1 },
                  (_, i) => {
                    const x = from + i,
                      reference = Math.max(
                        value(x, seam - 5),
                        value(x, seam + 5),
                      );
                    const samples = Array.from({ length: 9 }, (_, j) =>
                      value(x, seam - 4 + j),
                    );
                    return {
                      x,
                      reference,
                      minimum: Math.min(...samples),
                      maximum: Math.max(...samples),
                    };
                  },
                ).filter((column) => column.reference >= background + 18);
                return { prefix: guide.prefix, columns };
              }),
            };
          },
          shot.data,
          record.geometry,
        );
        for (let i = 0; i < record.geometry.ancestors.length; i++) {
          const geometry = record.geometry.ancestors[i],
            pixels = record.pixels.guides[i];
          assert(
            Math.abs(geometry.opening.center - geometry.following.center) <=
              0.05,
            "Native ancestor centers match across the seam",
          );
          assert(
            pixels.columns.length > 0,
            "Continuous ancestor paint is visible",
          );
          for (const column of pixels.columns) {
            assert(
              column.maximum <= column.reference + 2,
              `${name}: bright guide seam at pixel ${column.x}: ${column.maximum} > ${column.reference}`,
            );
            assert(
              column.minimum >= column.reference - 2,
              `${name}: dark guide gap at pixel ${column.x}: ${column.minimum} < ${column.reference}`,
            );
          }
        }
        console.log(`PASS ${name}`);
      } catch (error) {
        record.error = error.stack;
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
  try {
    evaluate(
      async ({ original, note, text }) => {
        const view = window.__guideSeamLeaf?.view;
        if (view?.editor.getValue() !== text)
          throw Error("Verification changed Markdown");
        await view.save();
        const file = app.vault.getAbstractFileByPath(note);
        if ((await app.vault.read(file)) !== text)
          throw Error("Saved Markdown changed");
        window.__guideSeamLeaf.detach();
        delete window.__guideSeamLeaf;
        delete window.__guideSeamPointer;
        app.setBaseFontSize(original.font);
        require("electron").webFrame.setZoomLevel(original.zoom);
        if (original.shiki) {
          if (!app.plugins.plugins["shiki-highlighter"])
            await app.plugins.enablePlugin("shiki-highlighter");
          const plugin = app.plugins.plugins["shiki-highlighter"];
          plugin.settings = original.settings;
          await plugin.reloadHighlighter();
        } else await app.plugins.disablePlugin("shiki-highlighter");
        const leaf = app.workspace.getLeafById(original.leaf);
        if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
        await app.fileManager.trashFile(file);
      },
      { original, note, text },
    );
  } finally {
    cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
  }
}
console.log(JSON.stringify({ results: results.length, failures }));
assert.equal(failures.length, 0, `${failures.length} code guide seam failures`);
