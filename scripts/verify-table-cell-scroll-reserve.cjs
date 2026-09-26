const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

const outputDirectory = process.argv[2];
if (!outputDirectory) {
  throw Error("Pass a fresh output directory");
}
if (fs.existsSync(outputDirectory)) {
  throw Error(`Output directory already exists: ${outputDirectory}`);
}
fs.mkdirSync(outputDirectory, { recursive: true });

const id = randomUUID();
const notePath = `bullet-table-cell-reserve-${id}.md`;
const assetPath = `bullet-table-cell-reserve-${id}.svg`;
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">' +
  '<rect width="320" height="180" fill="#4c78a8"/>' +
  '<circle cx="90" cy="90" r="55" fill="#f2cf5b"/>' +
  '<path d="M160 140L210 60l70 80z" fill="#f58518"/>' +
  "</svg>";
const embeds = Array.from(
  { length: 12 },
  () => `![[${assetPath}]]<br>`,
).join("");
const markdown = `| Name | Images |\n| --- | --- |\n| Sample | ${embeds} |`;

function screenshot(filename) {
  const response = cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(
    path.join(outputDirectory, filename),
    Buffer.from(response.data, "base64"),
  );
}

const initial = evaluate(() => ({
  file: app.workspace.getActiveFile()?.path ?? null,
  title: document.title,
  pluginVersion: app.plugins.getPlugin("bullet")?.manifest.version ?? null,
}));

try {
  evaluate(
    async (filePath, imagePath, imageSource, noteSource) => {
      const image = await app.vault.create(imagePath, imageSource);
      const note = await app.vault.create(filePath, noteSource);
      await app.workspace.getLeaf(false).openFile(note);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (!image || app.workspace.getActiveFile()?.path !== filePath) {
        throw Error("The table fixture did not open");
      }
    },
    notePath,
    assetPath,
    svg,
    markdown,
  );

  const target = evaluate(async () => {
    const cell = [...document.querySelectorAll(".table-cell-wrapper")].find(
      (element) => element.querySelectorAll("img").length >= 12,
    );
    const image = cell?.querySelector("img");
    if (!cell || !image) throw Error("The image table cell did not render");
    image.scrollIntoView({ block: "center", inline: "center" });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const bounds = image.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !cell.contains(hit)) {
      throw Error("The table cell is covered at the pointer target");
    }
    return { x, y };
  });

  screenshot("before-focus.png");
  cdp("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: target.x,
    y: target.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  cdp("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: target.x,
    y: target.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });

  const result = evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const editingCell = [...
      document.querySelectorAll(".table-cell-wrapper .cm-editor"),
    ].find((element) => element.querySelectorAll("img").length >= 12);
    if (!editingCell) throw Error("The image table cell did not enter editing");
    await Promise.all(
      [...editingCell.querySelectorAll("img")].map(
        (image) =>
          image.complete ||
          new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
          }),
      ),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const samples = [];
    for (let index = 0; index < 10; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const nested = [...
        document.querySelectorAll(".table-cell-wrapper .cm-editor"),
      ].find((element) => element.querySelectorAll("img").length >= 12);
      if (!nested) throw Error("The image table cell stopped editing");
      const scroller = nested.querySelector(".cm-scroller");
      const content = nested.querySelector(".cm-content");
      samples.push({
        height: nested.getBoundingClientRect().height,
        clientHeight: scroller.clientHeight,
        scrollHeight: scroller.scrollHeight,
        computedPaddingBottom: getComputedStyle(content).paddingBottom,
        inlinePaddingBottom: content.style.paddingBottom,
        reserve: nested.style.getPropertyValue(
          "--bullet-fold-scroll-reserve",
        ),
        reserveClass: content.classList.contains(
          "bullet-plugin-fold-scroll-reserve",
        ),
      });
    }

    const main = app.workspace.activeLeaf.view.editor.cm;
    return {
      samples,
      devicePixelRatio,
      main: {
        actual: Number.parseFloat(
          getComputedStyle(main.contentDOM).paddingBottom,
        ),
        expected:
          main.scrollDOM.clientHeight -
          main.defaultLineHeight -
          main.documentPadding.top -
          0.5,
        reserve: main.dom.style.getPropertyValue(
          "--bullet-fold-scroll-reserve",
        ),
        reserveClass: main.contentDOM.classList.contains(
          "bullet-plugin-fold-scroll-reserve",
        ),
      },
    };
  });

  screenshot("after-one-second.png");
  fs.writeFileSync(
    path.join(outputDirectory, "measurements.json"),
    `${JSON.stringify({ initial, ...result }, null, 2)}\n`,
  );

  const heights = result.samples.map(({ height }) => height);
  assert.ok(
    Math.max(...heights) - Math.min(...heights) <=
      1 / result.devicePixelRatio,
    `The nested editor height must remain stable: ${heights.join(", ")}`,
  );
  assert.ok(
    result.samples.every(({ reserveClass }) => !reserveClass),
    "The nested editor must not receive the fold reserve class",
  );
  assert.ok(
    result.samples.every(({ reserve }) => reserve === ""),
    "The nested editor must not receive the fold reserve property",
  );
  assert.ok(
    result.samples.every(
      ({ computedPaddingBottom }) =>
        Number.parseFloat(computedPaddingBottom) === 0,
    ),
    "The nested editor must not inherit the main editor reserve",
  );
  assert.ok(
    Math.abs(result.main.actual - result.main.expected) <= 1,
    `The main editor reserve must keep its formula: ${JSON.stringify(result.main)}`,
  );
  assert.equal(
    result.main.reserveClass,
    true,
    "The main editor must retain the fold reserve class",
  );
  assert.notEqual(
    result.main.reserve,
    "",
    "The main editor must retain the fold reserve property",
  );

  console.log(JSON.stringify({ initial, ...result }, null, 2));
} finally {
  evaluate(
    async (filePath, imagePath, previousPath) => {
      const active = app.workspace.activeLeaf.view;
      if (active.file?.path === filePath) await active.save();
      const previous =
        previousPath && app.vault.getAbstractFileByPath(previousPath);
      if (previous) await app.workspace.getLeaf(false).openFile(previous);
      else app.workspace.activeLeaf.detach();
      for (const temporaryPath of [filePath, imagePath]) {
        const file = app.vault.getAbstractFileByPath(temporaryPath);
        if (file) await app.vault.trash(file, false);
      }
    },
    notePath,
    assetPath,
    initial.file,
  );
}
