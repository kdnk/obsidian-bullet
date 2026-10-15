#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { cdp } = require("../../../../scripts/obsidian-scroll-driver.cjs");

if (!process.argv[2]) throw Error("Pass a fresh output directory");
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output);
const vault = path.resolve(__dirname, "../../../../vault");
const note = `mobile-code-source-${randomUUID()}.md`;
const fixture =
  "- ordinary\n\t- child\n- ```js\n  one\n  two\n  ```\n\t- child\n- after";
const phases = [
  { name: "opening-edit", line: 2, ch: 7 },
  { name: "body-edit", line: 3, ch: 5 },
];
const results = [];

function evaluate(fn, ...args) {
  const response = cdp("Runtime.evaluate", {
    expression: `(async()=>{if(app.vault.adapter.getBasePath()!==${JSON.stringify(vault)}||app.vault.config.useTab!==true||app.vault.config.tabSize!==4)throw Error('Test vault guard');return (${fn.toString()})(...${JSON.stringify(args)});})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails)
    throw Error(
      response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text,
    );
  return response.result.value;
}
function settle() {
  evaluate(
    async () => await new Promise((resolve) => setTimeout(resolve, 800)),
  );
}
function reload() {
  execFileSync("obsidian-cli", ["vault=vault", "open", `path=${note}`]);
  execFileSync("obsidian-cli", ["vault=vault", "plugin:reload", "id=bullet"]);
  settle();
}
function sample(name, phase) {
  const state = evaluate(async (note, phase) => {
    window.focus();
    if (
      !document.title.includes(" - vault - ") ||
      document.visibilityState !== "visible"
    )
      throw Error("Wrong visible vault");
    const view = app.workspace.activeLeaf.view;
    if (view.file?.path !== note) throw Error("Wrong fixture note");
    await view.save();
    const cm = view.editor.cm;
    const sourceRow = [...cm.contentDOM.querySelectorAll(".cm-line")].find(
      (row) => cm.state.doc.lineAt(cm.posAtDOM(row)).number === phase.line + 1,
    );
    const glyphs = [];
    if (sourceRow) {
      const walker = document.createTreeWalker(sourceRow, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        for (let offset = 0; offset < node.textContent.length; offset++) {
          const text = node.textContent[offset];
          if (/\s/.test(text)) continue;
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          const rect = range.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0)
            glyphs.push({ text, bounds: rect.toJSON() });
        }
      }
    }
    const source = {
      focused: cm.hasFocus,
      cursor: view.editor.getCursor(),
      previewCount: cm.contentDOM.querySelectorAll(".cm-preview-code-block").length,
      rowFont: sourceRow ? getComputedStyle(sourceRow).fontSize : null,
      glyphs,
    };
    const rows = [...cm.contentDOM.querySelectorAll(".cm-line")]
      .filter((row) => row.querySelector(".collapse-indicator"))
      .map((row) => {
        const parent = row.querySelector(".cm-fold-indicator");
        const control = row.querySelector(".collapse-indicator");
        const bounds = control.getBoundingClientRect();
        const bullet = row.querySelector(".list-bullet");
        let bulletY = null;
        if (bullet) {
          const box = bullet.getBoundingClientRect();
          const css = getComputedStyle(bullet, "::after");
          const height = parseFloat(css.height);
          const length = (value, size) =>
            value.endsWith("%")
              ? (parseFloat(value) * size) / 100
              : parseFloat(value);
          const [, dy = "0px"] =
            css.translate === "none" ? [] : css.translate.split(/\s+/);
          const transform =
            css.transform === "none"
              ? new DOMMatrix()
              : new DOMMatrix(css.transform);
          bulletY =
            box.y +
            (css.top === "auto"
              ? box.height / 2
              : length(css.top, box.height) + height / 2) +
            length(dy, height) +
            transform.f;
        }
        return {
          line: cm.state.doc.lineAt(cm.posAtDOM(row)).number,
          row: row.getBoundingClientRect().toJSON(),
          control: bounds.toJSON(),
          svg: control.querySelector("svg").getBoundingClientRect().toJSON(),
          bulletY,
          collapsed: parent.classList.contains("is-collapsed"),
          parentTransform: getComputedStyle(parent).transform,
          typography: Object.fromEntries(
            [
              "font-size",
              "line-height",
              "--font-text-size",
              "--line-height-normal",
              "--list-spacing",
            ].map((key) => [
              key,
              {
                row: getComputedStyle(row).getPropertyValue(key),
                control: getComputedStyle(control).getPropertyValue(key),
              },
            ]),
          ),
          hit: control.contains(
            document.elementFromPoint(
              bounds.x + bounds.width / 2,
              bounds.y + bounds.height / 2,
            ),
          ),
        };
      });
    return {
      source,
      mobile: document.body.classList.contains("is-mobile"),
      right: document.body.classList.contains(
        "bullet-plugin-mobile-right-fold-controls",
      ),
      doc: view.editor.getValue(),
      saved: await app.vault.read(view.file),
      clientWidth: cm.scrollDOM.clientWidth,
      scrollWidth: cm.scrollDOM.scrollWidth,
      rows,
    };
  }, note, phase);
  results.push({ name, ...state });
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(results, null, 2),
  );
  fs.writeFileSync(
    path.join(output, `${name}.png`),
    Buffer.from(
      cdp("Page.captureScreenshot", { format: "png" }).data,
      "base64",
    ),
  );
  assert.equal(state.mobile, true);
  assert.equal(state.right, true);
  assert.equal(state.doc, fixture);
  assert.equal(state.saved, fixture);
  assert.equal(state.scrollWidth, state.clientWidth);
  return state;
}
function assertSource(state, phase) {
  assert.equal(state.source.focused, true, "CodeMirror owns editor focus");
  assert.equal(state.source.cursor.line, phase.line, "Cursor remains on requested source row");
  assert.equal(state.source.previewCount, 0, "Code is source, not a processor preview");
  assert.ok(parseFloat(state.source.rowFont) > 0, "Source row has a visible font");
  const expected = phase.name === "opening-edit" ? "```" : "one";
  const paintedText = state.source.glyphs.map((glyph) => glyph.text).join("");
  assert.ok(paintedText.includes(expected),
    `Visible source glyphs include ${expected}`);
}
function focusSource(phase) {
  evaluate((note, phase) => {
    window.focus();
    if (!document.title.includes(" - vault - ") ||
        document.visibilityState !== "visible" ||
        app.workspace.activeLeaf.view.file?.path !== note ||
        !document.body.classList.contains("is-mobile"))
      throw Error("Wrong visible mobile fixture");
    const editor = app.workspace.activeLeaf.view.editor;
    editor.focus();
    editor.setCursor({ line: phase.line, ch: phase.ch });
    editor.scrollTo(0, 0);
  }, note, phase);
  settle();
}
function assertControls(state) {
  const ordinary = state.rows.find((row) => row.line === 1);
  const code = state.rows.find((row) => row.line === 3);
  assert.ok(ordinary && code, "Both native fold controls exist");
  for (const row of [ordinary, code]) {
    assert.ok(
      Math.abs(row.control.x - row.row.right) < 1,
      "Control starts at the row's right edge",
    );
    assert.ok(
      Math.abs(row.control.width - 15) < 1,
      "Control remains 15px wide",
    );
    assert.ok(
      Math.abs(row.svg.right - row.control.right) < 1,
      "Chevron stays inside the control",
    );
    assert.ok(row.hit, "Native control receives the touch");
  }
  assert.ok(
    Math.abs(code.control.height - ordinary.control.height) < 1,
    "Code control keeps a full text-line hit area",
  );
  assert.ok(
    Math.abs(code.control.y + code.control.height / 2 - code.bulletY) < 2,
    "Code chevron aligns with the painted bullet",
  );
  return code;
}
function tapCode() {
  const point = evaluate((note) => {
    window.focus();
    if (
      !document.title.includes(" - vault - ") ||
      document.visibilityState !== "visible" ||
      app.workspace.activeLeaf.view.file?.path !== note ||
      !document.body.classList.contains("is-mobile")
    )
      throw Error("Wrong visible fixture");
    const cm = app.workspace.activeLeaf.view.editor.cm;
    const row = [...cm.contentDOM.querySelectorAll(".cm-line")].find(
      (row) => cm.state.doc.lineAt(cm.posAtDOM(row)).number === 3,
    );
    const control = row.querySelector(".collapse-indicator");
    const bounds = control.getBoundingClientRect();
    const x = bounds.x + bounds.width / 2,
      y = bounds.y + bounds.height / 2;
    if (!control.contains(document.elementFromPoint(x, y)))
      throw Error("Fold tap blocked");
    return { x, y };
  }, note);
  cdp("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...point, id: 1, radiusX: 2, radiusY: 2 }],
  });
  cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  settle();
}

const original = evaluate(() => ({
  workspace: app.workspace.getLayout(),
  mobile: document.body.classList.contains("is-mobile"),
  right: app.plugins.plugins.bullet.settings.mobileRightFoldControls,
  vim: app.vault.config.vimMode ?? false,
  shiki: !!app.plugins.plugins["shiki-highlighter"],
}));
assert.equal(original.mobile, false, "Start in desktop mode");
let shikiSettings;
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  shikiSettings = evaluate(
    async (note, fixture) => {
      if (!app.plugins.plugins["shiki-highlighter"])
        await app.plugins.enablePlugin("shiki-highlighter");
      const settings = { ...app.plugins.plugins["shiki-highlighter"].settings };
      await app.vault.create(note, fixture);
      app.vault.setConfig("vimMode", false);
      app.workspace.updateOptions();
      return settings;
    },
    note,
    fixture,
  );
  evaluate(() => app.emulateMobile(true));
  execFileSync("sleep", ["2"]);
  cdp("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  cdp("Emulation.setTouchEmulationEnabled", { enabled: true });
  reload();
  evaluate(async () => {
    app.workspace.leftSplit.collapse();
    app.workspace.rightSplit.collapse();
    app.plugins.plugins.bullet.settings.mobileRightFoldControls = true;
    await app.workspace.activeLeaf.setViewState({
      type: "markdown",
      state: {
        file: app.workspace.activeLeaf.view.file.path,
        mode: "source",
        source: false,
      },
    });
  });
  for (const mode of ["native", "shiki", "numbers"]) {
    evaluate(async (mode) => {
      if (mode === "native")
        await app.plugins.disablePlugin("shiki-highlighter");
      else {
        if (!app.plugins.plugins["shiki-highlighter"])
          await app.plugins.enablePlugin("shiki-highlighter");
        const plugin = app.plugins.plugins["shiki-highlighter"];
        plugin.settings.ecDefaultShowLineNumbers = mode === "numbers";
        await plugin.reloadHighlighter();
      }
    }, mode);
    for (const phase of phases) {
      evaluate(() => app.commands.executeCommandById("editor:unfold-all"));
      focusSource(phase);
      const name = `${mode}-${phase.name}`;
      const editing = sample(name, phase);
      assertSource(editing, phase);
      assert.equal(assertControls(editing).collapsed, false);
      tapCode();
      assert.equal(assertControls(sample(`${name}-folded`, phase)).collapsed, true);
      tapCode();
      focusSource(phase);
      const unfolded = sample(`${name}-unfolded`, phase);
      assertSource(unfolded, phase);
      assert.equal(assertControls(unfolded).collapsed, false);
    }
  }
} finally {
  cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
  cdp("Emulation.clearDeviceMetricsOverride");
  evaluate(() => app.emulateMobile(false));
  execFileSync("sleep", ["2"]);
  reload();
  evaluate(
    async (original, settings, note) => {
      app.plugins.plugins.bullet.settings.mobileRightFoldControls =
        original.right;
      if (settings) {
        if (!app.plugins.plugins["shiki-highlighter"])
          await app.plugins.enablePlugin("shiki-highlighter");
        const plugin = app.plugins.plugins["shiki-highlighter"];
        Object.assign(plugin.settings, settings);
        await plugin.reloadHighlighter();
      }
      if (!original.shiki) await app.plugins.disablePlugin("shiki-highlighter");
      app.vault.setConfig("vimMode", original.vim);
      app.workspace.updateOptions();
      await app.workspace.changeLayout(original.workspace);
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.trash(file, true);
    },
    original,
    shikiSettings,
    note,
  );
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
}
console.log(JSON.stringify({ samples: results.length, failure: null }));
