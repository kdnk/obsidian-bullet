const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");

const output = process.argv[2];
fs.mkdirSync(output);
const blankViewport = process.argv.includes("--blank-viewport");
const longChild = process.argv.includes("--long-child");
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
const cases = longChild
  ? [
      {
        name: "virtualized-child-preview",
        text: [
          "- parent",
          "\t- ```js",
          "\t  start",
          ...Array(400).fill(""),
          "\t  end",
          "\t  ```",
          "\t\t- child",
          "- tail",
        ].join("\n"),
        opening: 2,
        closing: 405,
        cursor: 407,
        editing: false,
        ownerGuide: true,
      },
    ]
  : blankViewport
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
        ...[true, false].map((child) => ({
          name: `root-shell-${child ? "child" : "sibling"}-preview`,
          text: [
            "# Settings",
            "",
            "- ```sh",
            "  git remote add upstream <upstream-repository-url>",
            "  git remote set-url upstream --push NO-PUSH",
            "  but pull --check",
            "  but config target upstream/main --push-remote origin",
            "  ```",
            ...(child ? ["\t- child"] : []),
            "- hello",
            "\t- hello",
          ].join("\n"),
          opening: 3,
          closing: 8,
          cursor: child ? 10 : 9,
          editing: false,
          ownerGuide: true,
        })),
        {
          name: "attached-child-preview",
          text: attached,
          opening: 4,
          closing: 7,
          cursor: 17,
          editing: false,
          ownerGuide: true,
        },
        {
          name: "long-attached-child-preview",
          text: [
            "- parent",
            "\t- ```js",
            ...Array.from(
              { length: 20 },
              (_, i) => `\t  const row${i} = ${i};`,
            ),
            "\t  ```",
            "\t\t- child",
            "- tail",
          ].join("\n"),
          opening: 2,
          closing: 23,
          cursor: 25,
          editing: false,
          ownerGuide: true,
        },
        {
          name: "continuation-before-child-preview",
          text: "- parent\n\t- ```js\n\t  code\n\t  second\n\t  ```\n\t  note\n\t\t- child\n- tail",
          opening: 2,
          closing: 5,
          cursor: 8,
          editing: false,
          ownerGuide: true,
        },
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
          ownerGuide: true,
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
let calibration;

try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(
    async (note, font) => {
      window.__codeContinuityLeaf = app.workspace.getLeaf("tab");
      await window.__codeContinuityLeaf.openFile(
        await app.vault.create(note, ""),
      );
      app.setBaseFontSize(font);
      window.__codeContinuityPaintedX = (marker) => {
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
    },
    note,
    font,
  );
  calibration = evaluate(async () => {
    const editor = app.workspace.activeLeaf.view.editor;
    editor.setValue("- calibration\n\t- child\n- tail");
    editor.setCursor({ line: 2, ch: 6 });
    editor.scrollIntoView(
      { from: { line: 0, ch: 0 }, to: { line: 2, ch: 6 } },
      true,
    );
    window.focus();
    editor.focus();
    await new Promise((resolve) => setTimeout(resolve, 350));
    const cm = editor.cm;
    const row = (number) =>
      [...cm.contentDOM.querySelectorAll(".cm-line")].find(
        (el) => cm.state.doc.lineAt(cm.posAtDOM(el)).number === number,
      );
    const marker = row(1)?.querySelector(".list-bullet");
    const guide = row(2)?.querySelector(".cm-indent");
    if (!marker || !guide)
      throw Error("Ordinary native list calibration required");
    const paint = getComputedStyle(guide, "::before");
    const guideStyle = getComputedStyle(guide);
    if (
      guideStyle.direction !== "ltr" ||
      guideStyle.writingMode !== "horizontal-tb" ||
      paint.position !== "absolute" ||
      paint.transform !== "none" ||
      paint.translate !== "none" ||
      paint.rotate !== "none" ||
      paint.scale !== "none" ||
      paint.content === "none" ||
      paint.display === "none" ||
      paint.visibility !== "visible" ||
      Number(paint.opacity) !== 1
    )
      throw Error(
        "Native guide calibration requires visible untransformed LTR paint",
      );
    const px = (value) => {
      if (!/^-?\d+(?:\.\d+)?px$/.test(value))
        throw Error(
          `Native guide calibration requires pixel geometry: ${value}`,
        );
      return Number.parseFloat(value);
    };
    const left = px(paint.left);
    const marginLeft = px(paint.marginLeft);
    const width = px(paint.width);
    const borderLeft = px(paint.borderLeftWidth);
    const borderRight = px(paint.borderRightWidth);
    const borderCount = Number(borderLeft > 0) + Number(borderRight > 0);
    if (
      borderCount !== 1 ||
      (borderLeft > 0 && paint.borderLeftStyle !== "solid") ||
      (borderRight > 0 && paint.borderRightStyle !== "solid") ||
      px(paint.height) <= 0
    )
      throw Error(
        "Native guide calibration requires one solid vertical border",
      );
    const container =
      guideStyle.position === "static" ? guide.offsetParent : guide;
    if (!(container instanceof HTMLElement))
      throw Error("Native guide calibration requires a positioned container");
    const containerBox = container.getBoundingClientRect();
    const borderBoxWidth =
      paint.boxSizing === "border-box"
        ? width
        : width +
          px(paint.paddingLeft) +
          px(paint.paddingRight) +
          borderLeft +
          borderRight;
    const nativeGuideX =
      containerBox.left +
      container.clientLeft +
      left +
      marginLeft +
      (borderLeft > 0 ? borderLeft / 2 : borderBoxWidth - borderRight / 2);
    const parentBulletX = window.__codeContinuityPaintedX(marker);
    const nativeGuideDelta = nativeGuideX - parentBulletX;
    if (!Number.isFinite(nativeGuideDelta))
      throw Error("Native list calibration is unmeasurable");
    return {
      parentBulletX,
      nativeGuideX,
      nativeGuideDelta,
      guide: guide.getBoundingClientRect().toJSON(),
      container: {
        ...containerBox.toJSON(),
        clientLeft: container.clientLeft,
        position: getComputedStyle(container).position,
      },
      pseudo: {
        position: paint.position,
        transform: paint.transform,
        translate: paint.translate,
        rotate: paint.rotate,
        scale: paint.scale,
        left: paint.left,
        marginLeft: paint.marginLeft,
        width: paint.width,
        height: paint.height,
        boxSizing: paint.boxSizing,
        borderLeftWidth: paint.borderLeftWidth,
        borderRightWidth: paint.borderRightWidth,
        borderLeftColor: paint.borderLeftColor,
        borderRightColor: paint.borderRightColor,
        paddingLeft: paint.paddingLeft,
        paddingRight: paint.paddingRight,
      },
    };
  });
  const calibrationShot = cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(
    `${output}/native-guide-calibration.png`,
    Buffer.from(calibrationShot.data, "base64"),
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
          async (test, blankViewport, longChild, nativeGuideDelta) => {
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
            const paintedX = window.__codeContinuityPaintedX;
            const ownerX = paintedX(marker) + nativeGuideDelta;
            const ancestorX =
              test.owner > 1
                ? paintedX(row(1).querySelector(".list-bullet")) +
                  nativeGuideDelta
                : null;
            if (!Number.isFinite(ownerX))
              throw Error("Native bullet paint is unmeasurable");
            editor.setCursor({
              line: test.cursor - 1,
              ch: editor.getLine(test.cursor - 1).length,
            });
            const scrollTarget =
              test.ownerGuide && !longChild
                ? { line: test.opening - 1, ch: 0 }
                : editor.getCursor();
            editor.scrollIntoView(
              { from: scrollTarget, to: scrollTarget },
              blankViewport,
            );
            await new Promise((resolve) => setTimeout(resolve, 350));
            if (longChild) {
              const preview = cm.contentDOM.querySelector(
                ".cm-preview-code-block",
              );
              if (preview) {
                const middle = preview.querySelectorAll(".ec-line")[200];
                if (!middle) throw Error("Long processor preview required");
                cm.scrollDOM.scrollTop +=
                  middle.getBoundingClientRect().top -
                  cm.scrollDOM.getBoundingClientRect().top -
                  cm.scrollDOM.clientHeight / 2;
              } else {
                editor.scrollIntoView(
                  { from: { line: 200, ch: 0 }, to: { line: 200, ch: 0 } },
                  true,
                );
              }
              await new Promise((resolve) => setTimeout(resolve, 350));
            }
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
            if (longChild) {
              const opening = row(test.opening)?.getBoundingClientRect();
              if (opening && opening.bottom >= viewport.top)
                throw Error("Opening fence must be outside visible viewport");
              top = viewport.top + 4;
              bottom = viewport.bottom - 4;
            } else if (blankViewport) {
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
                const first =
                  body ??
                  preview?.querySelector(".ec-line")?.getBoundingClientRect();
                if (!first)
                  throw Error(
                    "First preview code row required below its bullet",
                  );
                top = first.bottom + 2;
                bottom = preview
                  ? preview.getBoundingClientRect().bottom - 2
                  : closing.bottom - 2;
                if (test.ownerGuide)
                  bottom = Math.min(bottom, viewport.bottom - 4);
              }
            }
            top = Math.max(top, viewport.top + 4);
            bottom = Math.min(bottom, viewport.bottom - 4);
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
          longChild,
          calibration.nativeGuideDelta,
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
        if (test.editing || test.ownerGuide) {
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
    JSON.stringify({ calibration, results, failures }, null, 2),
  );
  try {
    evaluate(
      async ({ original, note }) => {
        window.__codeContinuityLeaf?.detach();
        delete window.__codeContinuityLeaf;
        delete window.__codeContinuityPaintedX;
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
