const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

if (!process.argv[2]) throw Error("Use a fresh output directory");
const output = path.resolve(process.argv[2]);
assert.equal(fs.existsSync(output), false, "Output directory must be fresh");
fs.mkdirSync(output, { recursive: true });
const note = `pages/First code paint ${randomUUID()}.md`;
const fixture = Array.from({ length: 80 }, (_, index) =>
  [
    `- parent ${index}`,
    "\t- ```",
    ...Array.from({ length: 12 }, (_, n) => `\t  // code ${index}-${n}`),
    "\t  ```",
    "",
  ].join("\n"),
).join("\n");
let original;
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  original = evaluate(() => {
    window.focus();
    if (document.visibilityState !== "visible") throw Error("Hidden renderer");
    if (!app.plugins.plugins.bullet?.settings.betterListsStyles)
      throw Error("Enable Bullet list styling");
    const editor = app.workspace.activeLeaf.view.editor;
    return {
      state: app.workspace.activeLeaf.getViewState(),
      cursor: editor.getCursor(),
      scroll: editor.getScrollInfo(),
      dpr: devicePixelRatio,
    };
  });
  cdp("Emulation.setDeviceMetricsOverride", {
    width: 1100,
    height: 900,
    deviceScaleFactor: original.dpr,
    mobile: false,
  });
  const result = evaluate(
    async (note, fixture) => {
      await app.workspace.activeLeaf.openFile(
        await app.vault.create(note, fixture),
      );
      const editor = app.workspace.activeLeaf.view.editor;
      const cm = editor.cm;
      editor.setCursor({ line: 0, ch: 5 });
      editor.scrollTo(0, 0);
      editor.focus();
      await new Promise((resolve) => setTimeout(resolve, 700));
      const target = 60 * 16 + 6;
      const position = cm.state.doc.line(target + 1).from;
      const neverVisible = !cm.visibleRanges.some(
        ({ from, to }) => from <= position && to >= position,
      );
      const cursor = { line: target, ch: editor.getLine(target).length };
      editor.setCursor(cursor);
      editor.scrollIntoView({ from: cursor, to: cursor }, true);
      const frames = [];
      for (let frame = 0; frame < 120; frame++) {
        await new Promise(requestAnimationFrame);
        const element = [...cm.contentDOM.querySelectorAll(".cm-line")].find(
          (element) =>
            cm.state.doc.lineAt(cm.posAtDOM(element)).number === target + 1,
        );
        if (!element) {
          frames.push({ frame, visible: false });
          continue;
        }
        const bounds = element.getBoundingClientRect();
        const viewport = cm.scrollDOM.getBoundingClientRect();
        const line = cm.state.doc.line(target + 1);
        const glyph = cm.coordsAtPos(line.from + line.text.search(/\S/));
        const css = getComputedStyle(element, "::before");
        frames.push({
          frame,
          visible: bounds.top < viewport.bottom && bounds.bottom > viewport.top,
          hostCode: element.classList.contains("HyperMD-codeblock"),
          pluginCode: element.classList.contains(
            "bullet-plugin-nested-code-block",
          ),
          painted:
            css.content !== "none" &&
            css.content !== "normal" &&
            parseFloat(css.width) > 0,
          glyphX: glyph?.left,
          backgroundWidth: parseFloat(css.width),
          inset: element.style.getPropertyValue(
            "--bullet-nested-code-block-inset",
          ),
          end: element.style.getPropertyValue("--bullet-nested-code-block-end"),
          padding: element.style.getPropertyValue(
            "--bullet-code-content-padding",
          ),
        });
      }
      const nativeFrames = frames.filter(
        (frame) => frame.visible && frame.hostCode,
      );
      const span = (name) =>
        Math.max(...nativeFrames.map((frame) => frame[name])) -
        Math.min(...nativeFrames.map((frame) => frame[name]));
      return {
        neverVisible,
        frames,
        preHostParse: frames.filter((frame) => frame.visible && !frame.hostCode)
          .length,
        nativeFrames: nativeFrames.length,
        missingPaint: nativeFrames.filter((frame) => !frame.painted).length,
        complete: nativeFrames.every(
          (frame) =>
            frame.pluginCode && frame.inset && frame.end && frame.padding,
        ),
        glyphXSpan: span("glyphX"),
        backgroundWidthSpan: span("backgroundWidth"),
        documentPreserved: editor.getValue() === fixture,
      };
    },
    note,
    fixture,
  );
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({ ...result, frames: result.frames.length }, null, 2),
  );
  assert.equal(
    result.neverVisible,
    true,
    "Target must be outside the initial viewport",
  );
  assert.equal(result.documentPreserved, true, "Preserve Markdown");
  assert.ok(
    result.frames.every((frame) => !frame.pluginCode || frame.hostCode),
    "Native role belongs to Obsidian",
  );
  assert.ok(result.nativeFrames > 20, "Observe native code frames");
  assert.equal(
    result.complete,
    true,
    "First native paint owns complete attributes",
  );
  assert.equal(
    result.missingPaint,
    0,
    "First native code frame has painted background",
  );
  assert.ok(result.glyphXSpan <= 1, "Native glyph position remains stable");
  assert.ok(
    result.backgroundWidthSpan <= 1,
    "Native background extent remains stable",
  );
} finally {
  if (original)
    evaluate(
      async (original, note) => {
        await app.workspace.activeLeaf.setViewState(original.state);
        const editor = app.workspace.activeLeaf.view.editor;
        editor.setCursor(original.cursor);
        editor.scrollTo(original.scroll.left, original.scroll.top);
        const file = app.vault.getAbstractFileByPath(note);
        if (file) await app.vault.trash(file, false);
      },
      original,
      note,
    );
  cdp("Emulation.clearDeviceMetricsOverride");
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
}
