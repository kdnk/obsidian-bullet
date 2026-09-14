// Run against the deployed test build; checks painted, touchable breadcrumbs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { cdp } = require("./obsidian-scroll-driver.cjs");

const output = process.argv[2];
if (!output)
  throw Error(
    "Usage: node scripts/verify-zoom-breadcrumbs.cjs <fresh-output-directory> [--mobile]",
  );
fs.mkdirSync(output);
const mobile = process.argv.includes("--mobile");
const note = `Path-${randomUUID().slice(0, 8)}.md`;
const fixture =
  "- work\n\t- project\n\t\t- task\n\t\t\t- detail\n\t- other\n- personal";
const vault = path.resolve(__dirname, "../vault");
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
  evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
}
function reload() {
  execFileSync("obsidian-cli", ["vault=vault", "open", `path=${note}`]);
  execFileSync("obsidian-cli", ["vault=vault", "plugin:reload", "id=bullet"]);
  settle();
}
function focus() {
  evaluate(() => {
    window.focus();
    if (
      !document.title.includes(" - vault - ") ||
      document.title.includes(" - base - ")
    )
      throw Error("Wrong window");
    if (document.visibilityState !== "visible") throw Error("Hidden renderer");
  });
}
const results = [];
function sample(name, save = true) {
  focus();
  const state = evaluate(() => {
    const cm = app.workspace.activeLeaf.view.editor.cm;
    const panel = cm.dom.querySelector(".bullet-zoom-breadcrumbs");
    const ancestors = [];
    for (let el = panel; el; el = el.parentElement) {
      const css = getComputedStyle(el);
      ancestors.push({
        cls: el.className,
        display: css.display,
        visibility: css.visibility,
        pointerEvents: css.pointerEvents,
        rect: el.getBoundingClientRect().toJSON(),
      });
    }
    return {
      doc: cm.state.doc.toString(),
      current: panel?.querySelector("[aria-current]")?.textContent,
      buttons: Array.from(panel?.querySelectorAll("button") || [], (button) => {
        const r = button.getBoundingClientRect();
        const x = r.x + r.width / 2,
          y = r.y + r.height / 2;
        return {
          label: button.textContent,
          x,
          y,
          width: r.width,
          height: r.height,
          hit: button.contains(document.elementFromPoint(x, y)),
          hitClass: document.elementFromPoint(x, y)?.className,
        };
      }),
      ancestors,
      header: (() => {
        const el =
          app.workspace.activeLeaf.view.containerEl.querySelector(
            ".view-header",
          );
        const c = getComputedStyle(el);
        return {
          rect: el.getBoundingClientRect().toJSON(),
          position: c.position,
          top: c.top,
          transform: c.transform,
          height: c.height,
          opacity: c.opacity,
          zIndex: c.zIndex,
        };
      })(),
      variables: [
        "--header-height",
        "--safe-area-inset-top",
        "--view-header-height",
      ].map((key) => [key, getComputedStyle(cm.dom).getPropertyValue(key)]),
    };
  });
  if (!save) return state;
  results.push({ name, ...state });
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(results, null, 2),
  );
  fs.writeFileSync(
    path.join(output, `${name}.png`),
    Buffer.from(cdp("Page.captureScreenshot").data, "base64"),
  );
  return state;
}
function visible(name, current) {
  let state;
  for (let n = 0; n < 24; n++) {
    settle();
    state = sample(name, false);
    if (state.buttons.length && state.buttons.every((button) => button.hit))
      break;
    if (state.ancestors.some((el) => el.display === "none")) break;
  }
  state = sample(name);
  assert.equal(state.current, current);
  assert.equal(state.doc, fixture);
  assert.ok(state.buttons.length >= 2);
  assert.ok(
    state.buttons.every(
      (button) => button.width > 0 && button.height > 0 && button.hit,
    ),
    "Breadcrumb buttons must be visible and reachable",
  );
  return state;
}
function clickLabel(label) {
  focus();
  const point = evaluate((label) => {
    const button = Array.from(
      app.workspace.activeLeaf.view.editor.cm.dom.querySelectorAll(
        ".bullet-zoom-breadcrumbs button",
      ),
    ).find((button) => button.textContent === label);
    const r = button.getBoundingClientRect();
    const x = r.x + r.width / 2,
      y = r.y + r.height / 2;
    if (!button.contains(document.elementFromPoint(x, y)))
      throw Error("Breadcrumb tap blocked");
    return { x, y };
  }, label);
  if (mobile) {
    cdp("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...point, id: 1 }],
    });
    focus();
    cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    cdp("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...point,
      button: "left",
      clickCount: 1,
    });
    focus();
    cdp("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...point,
      button: "left",
      clickCount: 1,
    });
  }
  settle();
}
const original = evaluate(() => ({
  layout: app.workspace.getLayout(),
  mobile: document.body.classList.contains("is-mobile"),
}));
assert.equal(original.mobile, false, "Start in desktop mode");
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(
    async (note, fixture) => {
      await app.vault.create(note, fixture);
    },
    note,
    fixture,
  );
  if (mobile) {
    evaluate(() => app.emulateMobile(true));
    execFileSync("sleep", ["2"]);
  }
  cdp("Emulation.setDeviceMetricsOverride", {
    width: mobile ? 390 : 1000,
    height: 844,
    deviceScaleFactor: mobile ? 2 : 1,
    mobile,
  });
  cdp("Emulation.setTouchEmulationEnabled", { enabled: mobile });
  reload();
  evaluate(async (note) => {
    app.workspace.leftSplit.collapse();
    app.workspace.rightSplit.collapse();
    await app.workspace.activeLeaf.setViewState({
      type: "markdown",
      state: { file: note, mode: "source", source: false },
    });
    app.workspace.activeLeaf.view.editor.setCursor({ line: 2, ch: 4 });
    app.commands.executeCommandById("bullet:zoom-in");
  }, note);
  visible("zoom-task", "task");
  if (mobile) {
    evaluate(() => document.body.classList.remove("is-hidden-nav"));
    visible("header-visible", "task");
  }
  clickLabel("project");
  visible("parent-project", "project");
  clickLabel(note.slice(0, -3));
  assert.equal(sample("reset").buttons.length, 0);
  reload();
  evaluate(() => {
    app.workspace.activeLeaf.view.editor.setCursor({ line: 1, ch: 3 });
    app.commands.executeCommandById("bullet:zoom-in");
  });
  visible("after-reload", "project");
  if (mobile) {
    const nav = evaluate(() => {
      const classes = ["is-floating-nav", "auto-full-screen", "is-hidden-nav"];
      const saved = classes.filter((cls) =>
        document.body.classList.contains(cls),
      );
      document.body.classList.remove(...classes);
      return saved;
    });
    try {
      const state = visible("static-header", "project");
      assert.equal(state.header.position, "static");
      const panel = state.ancestors[0].rect;
      const button = state.buttons[0];
      assert.ok(
        panel.top >= state.header.rect.bottom,
        "Static header already reserves its own space",
      );
      assert.ok(
        button.y - button.height / 2 - panel.top < button.height,
        "Do not reserve header space twice",
      );
    } finally {
      evaluate((nav) => document.body.classList.add(...nav), nav);
    }
  }
  evaluate(async (note) => {
    app.commands.executeCommandById("bullet:zoom-reset");
    await app.workspace.activeLeaf.setViewState({
      type: "markdown",
      state: { file: note, mode: "source", source: true },
    });
    app.workspace.activeLeaf.view.editor.setCursor({ line: 1, ch: 3 });
    app.commands.executeCommandById("bullet:zoom-in");
  }, note);
  visible("source-mode", "project");
  console.log(JSON.stringify({ mobile, checks: results.length, output }));
} finally {
  evaluate(() => app.commands.executeCommandById("bullet:zoom-reset"));
  cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
  cdp("Emulation.clearDeviceMetricsOverride");
  if (mobile) {
    evaluate(() => app.emulateMobile(false));
    execFileSync("sleep", ["2"]);
  }
  reload();
  evaluate(
    async (layout, note) => {
      await app.workspace.changeLayout(layout);
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.trash(file, true);
    },
    original.layout,
    note,
  );
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
}
