const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

if (!process.argv[2])
  throw Error(
    "Usage: node scripts/verify-nested-code-redraw.cjs <fresh-output-directory>",
  );
const output = path.resolve(process.argv[2]);
if (fs.existsSync(output)) throw Error("Use a fresh output directory");
fs.mkdirSync(output, { recursive: true });
const notePath = `pages/Code redraw ${randomUUID()}.md`;
const results = [];
const failures = [];
let original;
let created = false;
let savedShikiSettings;

function run(fn, ...args) {
  return evaluate(
    new Function(
      "...args",
      `
    window.focus();
    if (!/\\bvault\\b/.test(document.title) || /\\b(?:base|core)\\b/.test(document.title) ||
        document.visibilityState !== "visible") throw Error("Visible test vault guard");
    return (${fn.toString()})(...args);
  `,
    ),
    ...args,
  );
}
function check(condition, label, message) {
  if (!condition) failures.push(`${label}: ${message}`);
}
const span = (values) => Math.max(...values) - Math.min(...values);

try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  original = run(() => ({
    state: app.workspace.activeLeaf.getViewState(),
    cursor: app.workspace.activeLeaf.view.editor?.getCursor(),
    scroll: app.workspace.activeLeaf.view.editor?.getScrollInfo(),
    shiki: !!app.plugins.plugins["shiki-highlighter"],
    settings: app.plugins.plugins["shiki-highlighter"]?.settings,
    readableLineLength: app.vault.config.readableLineLength,
    left: app.workspace.leftSplit.collapsed,
    right: app.workspace.rightSplit.collapsed,
    dpr: devicePixelRatio,
    listStyles: app.plugins.plugins.bullet.settings.betterListsStyles,
  }));
  assert.equal(original.listStyles, true, "Enable Bullet list styles first");
  savedShikiSettings = original.settings;
  cdp("Emulation.setDeviceMetricsOverride", {
    width: 700,
    height: 800,
    deviceScaleFactor: original.dpr,
    mobile: false,
  });
  run(async (notePath) => {
    app.workspace.leftSplit.collapse();
    app.workspace.rightSplit.collapse();
    app.vault.config.readableLineLength = false;
    app.workspace.updateOptions();
    await app.vault.create(notePath, "");
  }, notePath);
  created = true;
  run(async (notePath) => {
    await app.workspace.activeLeaf.openFile(
      app.vault.getAbstractFileByPath(notePath),
    );
    const view = app.workspace.activeLeaf.view;
    await view.setState(
      { ...view.getState(), mode: "source", source: false },
      { history: false },
    );
  }, notePath);
  for (const mode of ["native", "plain", "numbers"]) {
    const settings = run(async (mode) => {
      const id = "shiki-highlighter";
      if (mode === "native") {
        if (app.plugins.plugins[id]) await app.plugins.disablePlugin(id);
        return null;
      }
      if (!app.plugins.plugins[id]) {
        await app.plugins.loadManifest(".obsidian/plugins/shiki-highlighter");
        await app.plugins.enablePlugin(id);
      }
      const shiki = app.plugins.plugins[id];
      if (!shiki) throw Error("Installed Shiki fixture required");
      const before = JSON.parse(JSON.stringify(shiki.settings));
      shiki.settings.ecDefaultShowLineNumbers = mode === "numbers";
      shiki.settings.ecDefaultWrap = false;
      await shiki.reloadHighlighter();
      return before;
    }, mode);
    if (!savedShikiSettings && settings) savedShikiSettings = settings;
    for (const language of ["", "java"]) {
      const text = [
        "- parent",
        "\t- ```" + language,
        "\t  // short",
        "\t  // " + "unwrapped_code ".repeat(24),
        "\t  ```",
        "- tail",
      ].join("\n");
      run(async (text) => {
        const editor = app.workspace.activeLeaf.view.editor;
        editor.setValue(text);
        editor.setCursor({ line: 5, ch: 6 });
        editor.scrollTo(0, 0);
        await new Promise((resolve) => setTimeout(resolve, 700));
      }, text);
      for (const editing of [false, true]) {
        const label = `${mode}-${language || "unlabeled"}-${editing ? "editing" : "preview"}`;
        const sample = run(async (editing) => {
          const editor = app.workspace.activeLeaf.view.editor;
          const cm = editor.cm;
          editor.setCursor(editing ? { line: 2, ch: 8 } : { line: 5, ch: 6 });
          editor.scrollTo(0, 0);
          await new Promise((resolve) => setTimeout(resolve, 650));
          const frames = [];
          for (let i = 0; i < 120; i++) {
            if (i % 3 === 0) cm.dispatch({});
            await new Promise(requestAnimationFrame);
            const rows = [
              ...cm.contentDOM.querySelectorAll(".cm-line.HyperMD-codeblock"),
            ].map((element) => {
              const line = cm.state.doc.lineAt(cm.posAtDOM(element));
              const bounds = element.getBoundingClientRect();
              const css = getComputedStyle(element, "::before");
              const offset = line.text.search(/\S/);
              const first = cm.coordsAtPos(line.from + Math.max(0, offset));
              const last = cm.coordsAtPos(line.to);
              return {
                line: line.number,
                height: bounds.height,
                lineHeight: parseFloat(getComputedStyle(element).lineHeight),
                glyphX: first?.left,
                glyphY: first?.top,
                endY: last?.top,
                backgroundWidth: parseFloat(css.width),
                painted: css.content !== "none" && css.content !== "normal",
              };
            });
            frames.push({ rows, scrollTop: cm.scrollDOM.scrollTop });
          }
          const embed = cm.contentDOM.querySelector(".cm-preview-code-block");
          return {
            frames,
            text: editor.getValue(),
            embed: !!embed,
            scrollWidth: cm.scrollDOM.scrollWidth,
            clientWidth: cm.scrollDOM.clientWidth,
          };
        }, editing);
        const native = mode === "native" || !language || editing;
        check(sample.text === text, label, "Markdown changed");
        check(sample.embed === !native, label, "unexpected preview renderer");
        check(
          span(sample.frames.map((frame) => frame.scrollTop)) <= 1,
          label,
          "redraw moves the viewport",
        );
        if (native) {
          for (const number of [2, 3, 4, 5]) {
            const rows = sample.frames.map((frame) =>
              frame.rows.find((row) => row.line === number),
            );
            check(rows.every(Boolean), label, `source row ${number} missing`);
            if (rows.some((row) => !row)) continue;
            check(
              rows.every((row) => row.painted && row.backgroundWidth > 0),
              label,
              `row ${number} loses its background`,
            );
            check(
              span(rows.map((row) => row.backgroundWidth)) <= 1,
              label,
              `row ${number} background jitters`,
            );
            check(
              span(rows.map((row) => row.glyphX)) <= 1,
              label,
              `row ${number} text moves horizontally`,
            );
            check(
              span(rows.map((row) => row.glyphY)) <= 1,
              label,
              `row ${number} text or marker moves vertically`,
            );
            if (number === 3 || number === 4) {
              check(
                rows.every(
                  (row) =>
                    Math.abs(row.endY - row.glyphY) <= 1 &&
                    row.height <= row.lineHeight + 1,
                ),
                label,
                `code row ${number} wraps`,
              );
            }
          }
          check(
            sample.scrollWidth > sample.clientWidth + 100,
            label,
            "long code is not horizontally reachable",
          );
          const end = run(async () => {
            const editor = app.workspace.activeLeaf.view.editor;
            const cm = editor.cm;
            editor.scrollTo(cm.scrollDOM.scrollWidth, cm.scrollDOM.scrollTop);
            await new Promise((resolve) => setTimeout(resolve, 250));
            const line = cm.state.doc.line(4);
            const glyph = cm.coordsAtPos(line.to);
            const viewport = cm.scrollDOM.getBoundingClientRect();
            const element = [
              ...cm.contentDOM.querySelectorAll(".cm-line"),
            ].find(
              (element) =>
                cm.state.doc.lineAt(cm.posAtDOM(element)).number === 4,
            );
            const bounds = element?.getBoundingClientRect();
            const css = element && getComputedStyle(element, "::before");
            const backgroundEnd =
              bounds && css
                ? bounds.left + parseFloat(css.left) + parseFloat(css.width)
                : null;
            return {
              scrollLeft: cm.scrollDOM.scrollLeft,
              glyph: glyph && { left: glyph.left, right: glyph.right },
              viewport: { left: viewport.left, right: viewport.right },
              backgroundEnd,
            };
          });
          sample.horizontalEnd = end;
          check(
            end.scrollLeft > 100 &&
              end.glyph &&
              end.glyph.left >= end.viewport.left &&
              end.glyph.right <= end.viewport.right,
            label,
            "horizontal scroll cannot reveal the final code token",
          );
          check(
            end.glyph && end.backgroundEnd >= end.glyph.right - 1,
            label,
            "background does not cover the horizontally scrolled code",
          );
          run(() => app.workspace.activeLeaf.view.editor.scrollTo(0, 0));
        }
        results.push({ label, ...sample });
        fs.writeFileSync(
          path.join(output, `${label}.png`),
          Buffer.from(
            cdp("Page.captureScreenshot", { format: "png" }).data,
            "base64",
          ),
        );
      }
    }
  }
} finally {
  try {
    if (original)
      run(
        async ({ original, settings, notePath, created }) => {
          const id = "shiki-highlighter";
          if (original.shiki && !app.plugins.plugins[id])
            await app.plugins.enablePlugin(id);
          const shiki = app.plugins.plugins[id];
          if (shiki && settings) {
            shiki.settings = settings;
            await shiki.reloadHighlighter();
          }
          if (!original.shiki && shiki) await app.plugins.disablePlugin(id);
          app.vault.config.readableLineLength = original.readableLineLength;
          app.workspace.updateOptions();
          await app.workspace.activeLeaf.setViewState(original.state);
          const editor = app.workspace.activeLeaf.view.editor;
          if (editor && original.cursor) editor.setCursor(original.cursor);
          if (editor && original.scroll)
            editor.scrollTo(original.scroll.left, original.scroll.top);
          if (!original.left) app.workspace.leftSplit.expand();
          if (!original.right) app.workspace.rightSplit.expand();
          const file = app.vault.getAbstractFileByPath(notePath);
          if (created && file) await app.vault.delete(file);
        },
        { original, settings: savedShikiSettings, notePath, created },
      );
  } finally {
    cdp("Emulation.clearDeviceMetricsOverride");
    cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
    fs.writeFileSync(
      path.join(output, "results.json"),
      JSON.stringify({ results, failures }, null, 2),
    );
    console.log(
      JSON.stringify({ output, cases: results.length, failures }, null, 2),
    );
  }
}
assert.deepEqual(failures, [], "Nested code redraw regressions");
