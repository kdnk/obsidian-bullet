// Run separately from other renderer checks, with native rendering and with
// Shiki line numbers on/off. One tall block exercises an offscreen opener;
// repeating short blocks cannot exercise that layout path.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

if (!process.argv[2])
  throw Error(
    "Usage: node scripts/verify-nested-code-long-block.cjs <fresh-output-directory>",
  );
const output = path.resolve(process.argv[2]);
if (fs.existsSync(output)) throw Error("Use a fresh output directory");
fs.mkdirSync(output, { recursive: true });
const notePath = `nested-code-long-${randomUUID()}.md`;
const key = `__bulletLongCode${randomUUID().replaceAll("-", "")}`;
const bodyCount = 180;
const blankViewport = process.argv.includes("--blank-viewport");
const partialZoom = process.argv.includes("--partial-zoom");
const zoomParent = process.argv.includes("--zoom-parent") || partialZoom;
const body = Array.from({ length: bodyCount }, (_, i) => {
  if ((blankViewport && i >= 35 && i <= 145) || [45, 90, 135].includes(i))
    return "";
  if ([46, 91, 136].includes(i)) return "\t\t  ";
  return `\t\t  const row${i} = ${i};`;
});
const header = partialZoom
  ? ["- work", "  - area", "      - project"]
  : ["- root", "\t- parent"];
const fixture = [
  ...header,
  "\t\t- ordinary before",
  "\t\t- ```js",
  ...body,
  "\t\t  ```",
  "\t\t- ordinary after",
  "- tail",
  "",
].join("\n");
// Document line numbers below are one-based; Obsidian editor positions are not.
const openingLine = header.length + 2;
const firstBodyLine = openingLine + 1;
const closingLine = firstBodyLine + bodyCount;
const tailLine = closingLine + (zoomParent ? 1 : 2);
const middleLine = firstBodyLine + 90;
const bottomLine = firstBodyLine + 170;
let expectedText = fixture;
let originalFile;
let created = false;
const failures = [];
const results = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function position(phase, targetLine, editing = false, insert = false) {
  evaluate(
    async (key, targetLine, tailLine, editing, insert, openingLine) => {
      const view = window[key].leaf.view;
      const editor = view.editor;
      window.focus();
      editor.focus();
      const cursorLine = (editing ? targetLine : tailLine) - 1;
      editor.setCursor({
        line: cursorLine,
        ch: editor.getLine(cursorLine).length,
      });
      if (insert) editor.replaceSelection(" // audit edit");
      await new Promise((resolve) => setTimeout(resolve, 350));
      const cm = editor.cm;
      if (!editing && app.plugins.plugins["shiki-highlighter"]) {
        const rowIndex = Math.max(0, targetLine - openingLine - 1);
        const ready = () =>
          cm.contentDOM
            .querySelector(".cm-preview-code-block")
            ?.querySelectorAll(".ec-line")[rowIndex];
        if (!ready()) {
          // Create the virtualized processor host before targeting one of its
          // rows. The final offscreen-opener assertion still follows below.
          const opener = { line: openingLine - 1, ch: 0 };
          editor.scrollIntoView({ from: opener, to: opener }, true);
          await new Promise((resolve, reject) => {
            if (ready()) {
              resolve();
              return;
            }
            const observer = new MutationObserver(() => {
              if (ready()) {
                clearTimeout(timeout);
                observer.disconnect();
                resolve();
              }
            });
            const timeout = setTimeout(() => {
              observer.disconnect();
              reject(Error("Shiki target row did not render"));
            }, 5000);
            observer.observe(cm.contentDOM, { childList: true, subtree: true });
          });
        }
        // Processor rows can exist before CodeMirror finishes the measurement
        // and scroll-anchor work requested by opener navigation. Wait for its
        // geometry to settle before the single target scroll below.
        const geometry = () => {
          const block = cm.contentDOM.querySelector(".cm-preview-code-block");
          const row = block?.querySelectorAll(".ec-line")[rowIndex];
          if (!block || !row) return null;
          const blockBounds = block.getBoundingClientRect();
          const rowBounds = row.getBoundingClientRect();
          return {
            block,
            row,
            values: [
              blockBounds.top,
              blockBounds.height,
              blockBounds.width,
              rowBounds.top,
              rowBounds.height,
              rowBounds.width,
              cm.scrollDOM.scrollTop,
              cm.scrollDOM.scrollHeight,
              cm.scrollDOM.clientHeight,
            ],
          };
        };
        let previous = geometry();
        let stableFrames = 0;
        for (let frame = 1; frame <= 30 && stableFrames < 3; frame++) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const current = geometry();
          const stable =
            current &&
            previous &&
            current.block === previous.block &&
            current.row === previous.row &&
            current.values.every(
              (value, i) => Math.abs(value - previous.values[i]) < 0.25,
            );
          stableFrames = stable ? stableFrames + 1 : 0;
          previous = current;
        }
        if (stableFrames < 3)
          throw Error(
            "Shiki target geometry did not settle before single scroll",
          );
      }
      const embed = cm.contentDOM.querySelector(".cm-preview-code-block");
      if (embed) {
        const rows = embed.querySelectorAll(".ec-line");
        const row = rows[Math.max(0, targetLine - openingLine - 1)];
        if (!row) throw Error("Shiki target row is unavailable");
        const bounds = row.getBoundingClientRect();
        const viewport = cm.scrollDOM.getBoundingClientRect();
        const center =
          targetLine <= openingLine
            ? bounds.top - 80
            : bounds.top + bounds.height / 2 - cm.scrollDOM.clientHeight / 2;
        cm.scrollDOM.scrollTop += center - viewport.top;
      } else {
        const pos = {
          line: targetLine - 1,
          ch: editor.getLine(targetLine - 1).length,
        };
        editor.scrollIntoView({ from: pos, to: pos }, true);
      }
      await new Promise((resolve) => setTimeout(resolve, 450));
    },
    key,
    targetLine,
    tailLine,
    editing,
    insert,
    openingLine,
  );
  if (insert)
    expectedText = expectedText.replace(
      "const row170 = 170;",
      "const row170 = 170; // audit edit",
    );
  const sample = evaluate(
    (key, openingLine, firstBodyLine, closingLine) => {
      const editor = window[key].leaf.view.editor;
      const cm = editor.cm;
      const viewport = cm.scrollDOM.getBoundingClientRect();
      const box = (element) => {
        const r = element.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      };
      const guides = (line) =>
        [...line.querySelectorAll(".cm-indent")].map((guide) => {
          const r = box(guide);
          const css = getComputedStyle(guide, "::before");
          return {
            offset: r.left - box(line).left + parseFloat(css.marginInlineStart),
            width: r.width,
            height: parseFloat(css.height),
          };
        });
      const rows = [...cm.contentDOM.querySelectorAll(".cm-line")].map(
        (element) => {
          const line = cm.state.doc.lineAt(cm.posAtDOM(element));
          const r = box(element);
          const css = getComputedStyle(element, "::before");
          return {
            line: line.number,
            text: line.text,
            classes: element.className,
            bounds: r,
            visible: r.bottom > viewport.top && r.top < viewport.bottom,
            inset: parseFloat(css.insetInlineStart),
            background: css.backgroundColor,
            painted: css.content !== "none" && css.content !== "normal",
            guides: guides(element),
            nativePreview:
              !!element.querySelector(".code-block-flair") &&
              !element.querySelector(".cm-hmd-codeblock"),
          };
        },
      );
      const before = rows.find((r) => r.line === openingLine - 1);
      if (!window[key].reference && before) {
        const line = cm.state.doc.line(openingLine - 1);
        const coordinates = cm.coordsAtPos(line.from + 4);
        if (!coordinates) throw Error("Ordinary list reference not measurable");
        window[key].reference = {
          inset: coordinates.left - before.bounds.left,
          contentOffset:
            coordinates.left - cm.contentDOM.getBoundingClientRect().left,
          guides: before.guides,
        };
      }
      const opening = rows.find((r) => r.line === openingLine);
      const embed = cm.contentDOM.querySelector(".cm-preview-code-block");
      const pre = embed?.querySelector("pre");
      const contentBounds = box(cm.contentDOM);
      const shiki = app.plugins.plugins["shiki-highlighter"];
      return {
        text: cm.state.doc.toString(),
        shiki: !!shiki,
        zoomed: !!app.plugins.plugins.bullet.features
          .find((f) => f.constructor.name === "ListZoom")
          ?.range(cm.state),
        lineNumbers: shiki?.loadedSettings.ecDefaultShowLineNumbers ?? false,
        reference: window[key].reference,
        viewport: box(cm.scrollDOM),
        opening: opening ?? null,
        embedded: embed
          ? {
              bounds: box(embed),
              pre: pre ? box(pre) : null,
              inset: box(embed).left - contentBounds.left,
              guidesInside: embed.querySelectorAll(
                ".cm-indent,.bullet-plugin-outer-list-guide",
              ).length,
              lineNumbers: embed.querySelectorAll(".ln").length,
            }
          : null,
        rows: rows.filter(
          (r) => r.visible && r.line >= firstBodyLine && r.line < closingLine,
        ),
      };
    },
    key,
    openingLine,
    firstBodyLine,
    closingLine,
  );
  if (phase === "editing-middle") {
    sample.idleMeasures = evaluate(async (key) => {
      const cm = window[key].leaf.view.editor.cm;
      const plugin = cm.plugins
        .map((p) => p.value)
        .find((p) => p?.syntaxContext);
      let count = 0;
      const measure = plugin.measureLines;
      plugin.measureLines = function (...args) {
        count++;
        return measure.apply(this, args);
      };
      try {
        await new Promise((resolve) => setTimeout(resolve, 500));
      } finally {
        plugin.measureLines = measure;
      }
      return count;
    }, key);
    check(
      sample.idleMeasures === 0,
      `${phase}: measurements settle while idle`,
    );
  }
  results.push({ phase, ...sample });
  check(sample.zoomed === zoomParent, `${phase}: zoom state preserved`);
  check(sample.text === expectedText, `${phase}: exact document preserved`);
  check(!!sample.reference, `${phase}: ordinary list reference recorded`);
  check(
    !!sample.embedded === (sample.shiki && !editing),
    `${phase}: expected native/editing or Shiki preview renderer`,
  );
  if (targetLine > openingLine) {
    check(
      !sample.opening || sample.opening.bounds.bottom <= sample.viewport.top,
      `${phase}: opening fence is outside the viewport`,
    );
  }
  if (sample.embedded) {
    const embed = sample.embedded;
    check(
      Math.abs(embed.inset - sample.reference?.contentOffset) < 1,
      `${phase}: embed inset matches ordinary list content`,
    );
    check(
      embed.pre &&
        Math.abs(embed.pre.left - embed.bounds.left) < 1 &&
        Math.abs(embed.pre.width - embed.bounds.width) < 1,
      `${phase}: hover bounds fit the code background`,
    );
    check(embed.guidesInside === 0, `${phase}: no guides inside code`);
    check(
      embed.lineNumbers > 0 === sample.lineNumbers,
      `${phase}: configured line numbers rendered`,
    );
    // Tall processor widgets may keep their opening line in the DOM even when
    // it is above the viewport. If present, verify its native guide geometry.
    if (sample.opening) {
      for (const guide of sample.opening.guides)
        check(
          Math.abs(
            sample.opening.bounds.top + guide.height - embed.bounds.bottom,
          ) < 1,
          `${phase}: offscreen opener guide spans whole embed`,
        );
    }
  } else {
    check(sample.rows.length > 0, `${phase}: visible code body rows sampled`);
    if (!editing && sample.opening)
      check(sample.opening.nativePreview, `${phase}: native preview active`);
    for (const row of sample.rows) {
      check(
        row.painted && Math.abs(row.inset - sample.reference?.inset) < 1,
        `${phase}, line ${row.line}: background stays inside list content`,
      );
      if (!row.text.trim()) continue;
      for (const [i, reference] of sample.reference?.guides.entries() ?? []) {
        const guide = row.guides[i];
        check(
          guide &&
            Math.abs(guide.offset - reference.offset) < 0.6 &&
            Math.abs(guide.width - reference.width) < 0.6,
          `${phase}, line ${row.line}: guide ${i} matches ordinary list`,
        );
      }
    }
  }
  fs.writeFileSync(
    path.join(output, `${phase}.png`),
    Buffer.from(
      cdp("Page.captureScreenshot", { format: "png" }).data,
      "base64",
    ),
  );
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify({ results, failures }, null, 2),
  );
}

try {
  originalFile = evaluate(() => {
    if (!document.body.classList.contains("bullet-plugin-better-lists"))
      throw Error("Bullet list styles must be active");
    return app.workspace.getActiveFile()?.path;
  });
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(
    async (key, filePath, text) => {
      const file = await app.vault.create(filePath, text);
      const leaf = app.workspace.getLeaf(false);
      window[key] = { leaf, reference: null };
      await leaf.openFile(file);
    },
    key,
    notePath,
    fixture,
  );
  created = true;
  if (zoomParent)
    evaluate(async (key) => {
      const editor = window[key].leaf.view.editor;
      editor.setCursor({ line: 1, ch: 3 });
      app.commands.executeCommandById("bullet:zoom-in");
      await new Promise((resolve) => setTimeout(resolve, 350));
    }, key);
  position("preview-top", openingLine);
  position("preview-middle", middleLine);
  position("preview-bottom", bottomLine);
  position("editing-middle", middleLine, true);
  position("editing-bottom", bottomLine, true, true);
  position("preview-middle-again", middleLine);
  position("preview-bottom-again", bottomLine);
  position("back-at-top", openingLine);
  const lifecycle = evaluate(async (key) => {
    const cm = window[key].leaf.view.editor.cm;
    const probes = [
      ...document.querySelectorAll(".bullet-plugin-code-marker-measure"),
    ];
    const before = {
      activeCount: cm.dom.querySelectorAll(".bullet-plugin-code-marker-measure")
        .length,
      countsPerEditor: [...document.querySelectorAll(".cm-editor")].map(
        (e) => e.querySelectorAll(".bullet-plugin-code-marker-measure").length,
      ),
      guideCount: probes.reduce(
        (n, e) => n + e.querySelectorAll(".cm-indent").length,
        0,
      ),
      dimensions: probes.map((e) => ({
        width: e.getBoundingClientRect().width,
        height: e.getBoundingClientRect().height,
        visibility: getComputedStyle(e).visibility,
      })),
      scrollWidth: cm.scrollDOM.scrollWidth,
      clientWidth: cm.scrollDOM.clientWidth,
    };
    const plugin = cm.plugins.map((p) => p.value).find((p) => p?.syntaxContext);
    let idleMeasures = 0;
    const measure = plugin.measureLines;
    plugin.measureLines = function (...args) {
      idleMeasures++;
      return measure.apply(this, args);
    };
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      plugin.measureLines = measure;
    }
    let remainingAfterDisable;
    try {
      await app.plugins.disablePlugin("bullet");
      remainingAfterDisable = document.querySelectorAll(
        ".bullet-plugin-code-marker-measure",
      ).length;
    } finally {
      await app.plugins.enablePlugin("bullet");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return {
      before,
      idleMeasures,
      remainingAfterDisable,
      text: window[key].leaf.view.editor.getValue(),
    };
  }, key);
  check(
    lifecycle.before.activeCount === 1,
    "probe lifecycle: one active editor container",
  );
  check(
    lifecycle.before.countsPerEditor.every((n) => n <= 1),
    "probe lifecycle: at most one container per editor",
  );
  check(
    lifecycle.before.guideCount === 0,
    "probe lifecycle: no synthetic indent guides",
  );
  check(
    lifecycle.before.dimensions.every(
      (r) => r.width === 0 && r.height === 0 && r.visibility === "hidden",
    ),
    "probe lifecycle: nonpainted zero-size containers",
  );
  check(
    lifecycle.before.scrollWidth === lifecycle.before.clientWidth,
    "probe lifecycle: no horizontal scroll expansion",
  );
  check(
    lifecycle.idleMeasures === 0,
    "probe lifecycle: measurements settle while idle",
  );
  check(
    lifecycle.remainingAfterDisable === 0,
    "probe lifecycle: disable removes all probes",
  );
  check(
    lifecycle.text === expectedText,
    "probe lifecycle: reload preserves exact document",
  );
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify({ results, lifecycle, failures }, null, 2),
  );
  console.log(JSON.stringify({ output, failures }, null, 2));
  assert.equal(failures.length, 0, "Long nested code layout regressions");
} finally {
  try {
    if (created)
      evaluate(
        async (key, filePath, previousPath) => {
          const state = window[key];
          if (previousPath) {
            const previous = app.vault.getAbstractFileByPath(previousPath);
            if (previous) await state.leaf.openFile(previous);
          }
          const fixture = app.vault.getAbstractFileByPath(filePath);
          if (fixture) await app.vault.trash(fixture, false);
          delete window[key];
        },
        key,
        notePath,
        originalFile,
      );
  } finally {
    cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
  }
}
