const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { cdp } = require("./obsidian-scroll-driver.cjs");

if (!process.argv[2]) throw Error("Pass a fresh output directory");
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output);
const vault = path.resolve(__dirname, "../vault");
const note = `mobile-code-fold-${randomUUID()}.md`;
const fixture =
  "- ordinary\n\t- child\n- ```js\n  one\n      two\n  ```\n\t- child\n- after";
const phases = [
  { name: "preview", line: 7, ch: 7 },
  { name: "opening-edit", line: 2, ch: 7 },
  { name: "body-edit", line: 3, ch: 5 },
  { name: "preview-again", line: 7, ch: 7 },
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
function sample(name) {
  const state = evaluate(async (note) => {
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
          bodyFold: row.classList.contains("bullet-plugin-code-body-fold"),
          wrapperDisplay: getComputedStyle(parent).display,
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
  }, note);
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
function assertControls(state) {
  for (const row of state.rows.filter((row) => row.bodyFold)) {
    assert.equal(row.wrapperDisplay, "none", "Code body controls stay hidden");
    assert.equal(row.svg.width, 0, "Code body SVG has no paint box");
    assert.equal(row.svg.height, 0, "Code body SVG has no hit box");
  }
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
      app.workspace.activeLeaf.view.file?.path !== note
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
      evaluate((phase) => {
        app.commands.executeCommandById("editor:unfold-all");
        const editor = app.workspace.activeLeaf.view.editor;
        editor.setCursor({ line: phase.line, ch: phase.ch });
        editor.scrollTo(0, 0);
      }, phase);
      settle();
      const name = `${mode}-${phase.name}`;
      assert.equal(assertControls(sample(name)).collapsed, false);
      tapCode();
      assert.equal(assertControls(sample(`${name}-folded`)).collapsed, true);
      tapCode();
      assert.equal(assertControls(sample(`${name}-unfolded`)).collapsed, false);
    }
  }
  assert(
    results.some((state) => state.rows.some((row) => row.bodyFold)),
    "The fixture must exercise native code-body fold controls",
  );
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
