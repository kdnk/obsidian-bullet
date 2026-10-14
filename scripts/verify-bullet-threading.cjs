const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

const output = process.argv[2];
if (!output)
  throw Error(
    "Usage: node scripts/verify-bullet-threading.cjs <fresh-output-directory>",
  );
fs.mkdirSync(output);
const note = `bullet-threading-${randomUUID()}.md`;
const fixture = [
  "- work",
  "\t- project",
  "\t\t- selected item",
  "\t\t- sibling",
  "\t- other branch",
  "- unrelated root",
  "\t- [ ] task parent",
  "\t\t- [ ] task child",
  "- ordered root",
  "\t1. numbered parent",
  "\t\t1. numbered child",
  "- code owner",
  "\t```text",
  "\t- literal code marker",
  "\t```",
].join("\n");
const initial = evaluate(() => ({
  leaf: app.workspace.activeLeaf?.id,
  settings: app.plugins.plugins.bullet.settings.getValues(),
  settingsPopout: app.vault.getConfig("settingsPopoutWindow"),
  shiki: !!app.plugins.plugins["shiki-highlighter"],
  shikiSettings: app.plugins.plugins["shiki-highlighter"]?.settings,
}));
const results = [];
fs.writeFileSync(
  path.join(output, "fixture.json"),
  JSON.stringify({ note, fixture }, null, 2),
);

function settle() {
  evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}

function snapshot(name) {
  const state = evaluate(() => {
    const { first } = window.__bulletThreadingCheck;
    const cm = first.view.editor.cm;
    function paintedMarkerBounds(element) {
      const box = element.getBoundingClientRect();
      if (!element.matches(".list-bullet")) return box;
      const css = getComputedStyle(element, "::after");
      const width = parseFloat(css.width),
        height = parseFloat(css.height);
      const length = (value, size) =>
        value.endsWith("%")
          ? (parseFloat(value) * size) / 100
          : parseFloat(value);
      const [dx = "0px", dy = "0px"] =
        css.translate === "none" ? [] : css.translate.split(/\s+/);
      const transform =
        css.transform === "none"
          ? new DOMMatrix()
          : new DOMMatrix(css.transform);
      const x =
        box.x +
        (css.left === "auto"
          ? box.width / 2
          : length(css.left, box.width) + width / 2) +
        length(dx, width) +
        transform.e;
      const y =
        box.y +
        (css.top === "auto"
          ? box.height / 2
          : length(css.top, box.height) + height / 2) +
        length(dy, height) +
        transform.f;
      if (![x, y, width, height].every(Number.isFinite))
        throw Error("Unmeasurable native bullet paint");
      return new DOMRect(x - width / 2, y - height / 2, width, height);
    }
    const anchor = (index) => {
      const row = Array.from(cm.contentDOM.children).find(
        (row) =>
          row.classList.contains("cm-line") &&
          cm.state.doc.lineAt(cm.posAtDOM(row, 0)).number === Number(index) + 1,
      );
      const markers = row?.querySelectorAll(
        ".list-bullet, .list-number, .task-list-item-checkbox",
      );
      for (const marker of markers ?? []) {
        const bounds = paintedMarkerBounds(marker);
        if (bounds?.width > 0 && bounds.height > 0)
          return {
            x: (bounds.left + bounds.right) / 2,
            y: (bounds.top + bounds.bottom) / 2,
            source: marker.getBoundingClientRect().toJSON(),
          };
      }
      return null;
    };
    return {
      note: first.view.file.path,
      doc: cm.state.doc.toString(),
      cursor: first.view.editor.getCursor(),
      layers: cm.dom.querySelectorAll(".bullet-plugin-threading-layer").length,
      codePreviews: cm.contentDOM.querySelectorAll(".cm-preview-code-block")
        .length,
      codeLineNumbers: cm.contentDOM.querySelectorAll(
        ".cm-preview-code-block .ln",
      ).length,
      edges: Array.from(
        cm.dom.querySelectorAll(".bullet-plugin-thread-edge"),
        (el) => {
          const css = getComputedStyle(el);
          return {
            rect: el.getBoundingClientRect().toJSON(),
            color: css.borderLeftColor,
            pointerEvents: css.pointerEvents,
            parent: el.dataset.parentLine,
            child: el.dataset.childLine,
            parentAnchor: anchor(el.dataset.parentLine),
            childAnchor: anchor(el.dataset.childLine),
          };
        },
      ),
    };
  });
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

function assertAnchors(state) {
  for (const edge of state.edges) {
    assert.ok(
      edge.parentAnchor && edge.childAnchor,
      "Visible endpoints have native marker bounds",
    );
    if (edge.parentAnchor && edge.childAnchor) {
      assert.ok(
        Math.abs(edge.rect.left - edge.parentAnchor.x) < 1,
        "Thread starts at parent marker",
      );
      assert.ok(
        Math.abs(edge.rect.top - edge.parentAnchor.y - 4) < 1,
        "Thread starts below parent marker",
      );
      assert.ok(
        Math.abs(edge.rect.right - edge.childAnchor.x + 4) < 1,
        "Thread ends beside child marker",
      );
      assert.ok(
        Math.abs(edge.rect.bottom - edge.childAnchor.y) < 1,
        "Thread ends at child marker height",
      );
    }
  }
}

function nativeClickControl(line, selector) {
  const hover = evaluate((line) => {
    window.focus();
    if (
      !document.title.includes(" - vault - ") ||
      document.visibilityState !== "visible"
    )
      throw Error("Test renderer focus guard");
    const cm = window.__bulletThreadingCheck.first.view.editor.cm;
    const source = cm.state.doc.line(line + 1);
    const rect = cm.coordsAtPos(source.to);
    if (!rect) throw Error("Missing control row");
    return { x: rect.left, y: (rect.top + rect.bottom) / 2 };
  }, line);
  cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...hover });
  settle();
  const point = evaluate(
    (line, selector) => {
      window.focus();
      if (
        !document.title.includes(" - vault - ") ||
        document.visibilityState !== "visible"
      )
        throw Error("Test renderer focus guard");
      const cm = window.__bulletThreadingCheck.first.view.editor.cm;
      const row = Array.from(cm.contentDOM.children).find(
        (row) =>
          row.classList.contains("cm-line") &&
          cm.state.doc.lineAt(cm.posAtDOM(row, 0)).number === line + 1,
      );
      const control = row?.querySelector(selector);
      if (!control) throw Error(`Missing native control ${selector}`);
      const point = [control.querySelector("svg"), control]
        .filter(Boolean)
        .flatMap((element) => {
          const rect = element.getBoundingClientRect();
          return [0.5, 0.25, 0.75].flatMap((x) =>
            [0.5, 0.25, 0.75].map((y) => ({
              x: rect.left + rect.width * x,
              y: rect.top + rect.height * y,
            })),
          );
        })
        .find(({ x, y }) => control.contains(document.elementFromPoint(x, y)));
      if (!point) throw Error("Native control covered");
      return point;
    },
    line,
    selector,
  );
  cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  cdp("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...point,
    button: "left",
    clickCount: 1,
  });
  cdp("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...point,
    button: "left",
    clickCount: 1,
  });
  settle();
}

function nativeClickLine(line) {
  const target = evaluate((line) => {
    window.focus();
    if (
      !document.title.includes(" - vault - ") ||
      document.title.includes(" - base - ") ||
      document.visibilityState !== "visible"
    )
      throw Error("Test renderer focus guard");
    const { first } = window.__bulletThreadingCheck;
    app.workspace.setActiveLeaf(first, { focus: true });
    const cm = first.view.editor.cm;
    const source = cm.state.doc.line(line + 1);
    const prefix =
      source.text.match(/^[\t ]*(?:[-*+]|\d+\.)(?:[\t ]+\[[ xX]\])?[\t ]*/)?.[0]
        .length ?? 0;
    const coords = cm.coordsAtPos(source.from + prefix + 2);
    if (!coords) throw Error("Missing target coordinates");
    const x = coords.left + 1,
      y = (coords.top + coords.bottom) / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !cm.contentDOM.contains(hit))
      throw Error("Text target covered");
    return { x, y };
  }, line);
  cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...target });
  cdp("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...target,
    button: "left",
    clickCount: 1,
  });
  cdp("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...target,
    button: "left",
    clickCount: 1,
  });
  settle();
  assert.equal(
    evaluate(
      () => window.__bulletThreadingCheck.first.view.editor.getCursor().line,
    ),
    line,
  );
}

function settings(patch) {
  evaluate((patch) => {
    const settings = app.plugins.plugins.bullet.settings;
    for (const [key, value] of Object.entries(patch))
      settings.setValue(key, value);
  }, patch);
  settle();
}

function configureShiki(mode) {
  evaluate(async (mode) => {
    const id = "shiki-highlighter";
    if (mode === "native") {
      if (app.plugins.plugins[id]) await app.plugins.disablePlugin(id);
    } else {
      if (!app.plugins.plugins[id]) {
        await app.plugins.loadManifest(".obsidian/plugins/shiki-highlighter");
        if (!app.plugins.manifests[id])
          throw Error("Install Shiki Highlighter in the test vault");
        await app.plugins.enablePlugin(id);
      }
      const plugin = app.plugins.plugins[id];
      plugin.settings.ecDefaultShowLineNumbers = mode === "numbers";
      await plugin.reloadHighlighter();
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }, mode);
  settle();
}

function attachedCodeThreads() {
  for (const marker of ["-", "10."]) {
    const indent = " ".repeat(marker.length + 1);
    const codeFixture = [
      "- code root",
      `\t${marker} \`\`\`js`,
      `\t${indent}const value = 1;`,
      `\t${indent}\`\`\``,
      "\t\t- code descendant",
      "- unrelated sibling",
    ].join("\n");
    evaluate((doc) => {
      const editor = window.__bulletThreadingCheck.first.view.editor;
      editor.setValue(doc);
      editor.setCursor({ line: 4, ch: 8 });
      editor.scrollIntoView(
        { from: { line: 0, ch: 0 }, to: { line: 4, ch: 8 } },
        true,
      );
    }, codeFixture);
    settle();
    const kind = marker === "-" ? "unordered" : "ordered";
    for (const mode of ["native", "shiki", "numbers", "native"]) {
      const sequence = results.length;
      const selected = evaluate(() =>
        window.__bulletThreadingCheck.first.view.editor.getCursor(),
      );
      configureShiki(mode);
      let state = snapshot(`code-${kind}-${mode}-${sequence}-preview`);
      assert.deepEqual(
        state.cursor,
        selected,
        "Renderer toggle retains selection",
      );
      assert.equal(state.doc, codeFixture);
      assert.equal(state.edges.length, 2);
      assert.equal(state.codePreviews > 0, mode !== "native");
      assert.equal(state.codeLineNumbers > 0, mode === "numbers");
      assertAnchors(state);

      evaluate(() =>
        window.__bulletThreadingCheck.first.view.editor.setCursor({
          line: 2,
          ch: 8,
        }),
      );
      settle();
      state = snapshot(`code-${kind}-${mode}-${sequence}-editing`);
      assert.equal(state.doc, codeFixture);
      assert.equal(state.edges.length, 1);
      assertAnchors(state);

      evaluate(() =>
        window.__bulletThreadingCheck.first.view.editor.setCursor({
          line: 4,
          ch: 8,
        }),
      );
      settle();
      state = snapshot(`code-${kind}-${mode}-${sequence}-preview-again`);
      assert.equal(state.doc, codeFixture);
      assert.equal(state.edges.length, 2);
      assertAnchors(state);

      evaluate(() => {
        const editor = window.__bulletThreadingCheck.first.view.editor;
        editor.setCursor({ line: 1, ch: 4 });
        app.commands.executeCommandById("bullet:zoom-in");
        editor.setCursor({ line: 4, ch: 8 });
      });
      settle();
      state = snapshot(`code-${kind}-${mode}-${sequence}-zoomed`);
      assert.equal(state.doc, codeFixture);
      assert.equal(state.edges.length, 1);
      assertAnchors(state);
      evaluate(() => app.commands.executeCommandById("bullet:zoom-reset"));
      settle();
    }
  }
  evaluate((doc) => {
    const editor = window.__bulletThreadingCheck.first.view.editor;
    editor.setValue(doc);
    editor.setCursor({ line: 10, ch: 8 });
  }, fixture);
  settle();
}

try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(
    async (note, fixture) => {
      if (window.__bulletThreadingCheck)
        throw Error("Verification already running");
      const file = await app.vault.create(note, fixture);
      const first = app.workspace.getLeaf("tab");
      window.__bulletThreadingCheck = { first, file, second: null };
      await first.openFile(file);
      await first.setViewState({
        type: "markdown",
        state: { file: note, mode: "source", source: false },
      });
      first.view.editor.focus();
    },
    note,
    fixture,
  );
  settings({ bulletThreading: false, bulletThreadingColor: "#8b5cf6" });
  nativeClickLine(2);
  assert.equal(snapshot("off").layers, 0);

  evaluate(() => {
    app.setting.close();
    app.vault.setConfig("settingsPopoutWindow", false);
    app.setting.open();
    app.setting.openTabById("bullet");
  });
  settle();
  const toggle = evaluate(async () => {
    window.focus();
    if (
      !document.title.includes(" - vault - ") ||
      document.visibilityState !== "visible"
    )
      throw Error("Settings renderer guard");
    const rows = Array.from(document.querySelectorAll(".setting-item"));
    const threading = rows.find(
      (row) =>
        row.querySelector(".setting-item-name")?.textContent ===
        "Bullet threading",
    );
    const control = threading?.querySelector(".checkbox-container");
    const color = rows
      .find(
        (row) =>
          row.querySelector(".setting-item-name")?.textContent ===
          "Thread color",
      )
      ?.querySelector('input[type="color"]');
    if (!control || color?.value !== "#8b5cf6")
      throw Error("Missing settings toggle or color picker");
    control.scrollIntoView({ block: "center" });
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const rect = control.getBoundingClientRect();
    const x = (rect.left + rect.right) / 2,
      y = (rect.top + rect.bottom) / 2;
    if (!control.contains(document.elementFromPoint(x, y)))
      throw Error("Threading toggle covered");
    return { x, y };
  });
  snapshot("settings-ui");
  cdp("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...toggle,
    button: "left",
    clickCount: 1,
  });
  cdp("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...toggle,
    button: "left",
    clickCount: 1,
  });
  cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  settle();
  assert.equal(
    evaluate(() => app.plugins.plugins.bullet.settings.bulletThreading),
    true,
  );
  let state = snapshot("on-selected");
  assert.equal(state.layers, 1);
  assert.equal(state.edges.length, 2);
  assert.ok(
    state.edges.every(
      (edge) =>
        edge.rect.width > 0 &&
        edge.rect.height > 0 &&
        edge.pointerEvents === "none",
    ),
  );
  assert.equal(state.doc, fixture);
  assert.deepEqual(
    state.edges.map((edge) => [edge.parent, edge.child]),
    [
      ["0", "1"],
      ["1", "2"],
    ],
  );
  assertAnchors(state);

  nativeClickLine(4);
  assert.equal(snapshot("different-branch").edges.length, 1);
  nativeClickLine(5);
  assert.equal(snapshot("root").edges.length, 0);
  nativeClickLine(7);
  state = snapshot("tasks");
  assert.equal(state.edges.length, 2);
  assertAnchors(state);
  nativeClickControl(7, ".task-list-item-checkbox");
  assert.ok(snapshot("native-checkbox").doc.includes("\t\t- [x] task child"));
  nativeClickControl(7, ".task-list-item-checkbox");
  assert.equal(snapshot("native-checkbox-restored").doc, fixture);
  nativeClickLine(10);
  state = snapshot("ordered");
  assert.equal(state.edges.length, 2);
  assertAnchors(state);

  attachedCodeThreads();

  settings({ bulletThreadingColor: "#ff6600" });
  state = snapshot("custom-color");
  assert.ok(state.edges.every((edge) => edge.color === "rgb(255, 102, 0)"));

  settings({ styleLists: false });
  nativeClickLine(2);
  assert.equal(snapshot("native-markers").edges.length, 2);
  settings({ styleLists: true });

  nativeClickLine(2);
  nativeClickControl(1, ".collapse-indicator");
  state = snapshot("folded");
  assert.ok(
    state.edges.every((edge) => edge.child !== "2" && edge.child !== "3"),
  );
  nativeClickControl(1, ".collapse-indicator");
  nativeClickLine(2);
  assert.equal(snapshot("unfolded").edges.length, 2);

  const wrapped =
    "- work\n\t- " +
    "wrapped parent text ".repeat(30) +
    "\n\t\t- selected item";
  evaluate(
    (doc) => window.__bulletThreadingCheck.first.view.editor.setValue(doc),
    wrapped,
  );
  settle();
  nativeClickLine(2);
  state = snapshot("wrapped-parent");
  assert.equal(state.edges.length, 2);
  assertAnchors(state);
  assert.ok(state.edges[1].rect.height > state.edges[0].rect.height * 2);
  const scrollFixture = [
    "- work",
    "\t- project",
    ...Array.from({ length: 180 }, (_, index) => `\t\t- child ${index}`),
  ].join("\n");
  evaluate((doc) => {
    const { first } = window.__bulletThreadingCheck;
    first.view.editor.setValue(doc);
    first.view.editor.setCursor({ line: 2, ch: 6 });
    first.view.editor.scrollIntoView(
      { from: { line: 2, ch: 6 }, to: { line: 2, ch: 6 } },
      true,
    );
  }, scrollFixture);
  settle();
  const beforeScroll = snapshot("before-scroll");
  assert.equal(beforeScroll.edges.length, 2);
  assertAnchors(beforeScroll);
  const parentX = beforeScroll.edges[1].parentAnchor.x;
  evaluate(() => {
    const { first } = window.__bulletThreadingCheck;
    first.view.editor.setCursor({ line: 151, ch: 6 });
    first.view.editor.scrollIntoView(
      { from: { line: 151, ch: 6 }, to: { line: 151, ch: 6 } },
      true,
    );
  });
  settle();
  nativeClickLine(151);
  state = snapshot("offscreen-parent");
  assert.equal(state.edges.length, 1);
  assert.equal(state.edges[0].parent, "1");
  assert.equal(state.edges[0].child, "151");
  assert.equal(state.edges[0].parentAnchor, null);
  assert.ok(
    Math.abs(state.edges[0].rect.left - parentX) < 1,
    "Clipped parent retains its native bullet X position",
  );
  assert.ok(state.edges[0].rect.bottom <= state.edges[0].childAnchor.y + 1);
  evaluate((doc) => {
    const { first } = window.__bulletThreadingCheck;
    first.view.editor.setValue(doc);
    first.view.editor.setCursor({ line: 2, ch: 6 });
    first.view.editor.scrollIntoView(
      { from: { line: 2, ch: 6 }, to: { line: 2, ch: 6 } },
      true,
    );
  }, fixture);
  settle();

  evaluate(async (note) => {
    const { first } = window.__bulletThreadingCheck;
    await first.setViewState({
      type: "markdown",
      state: { file: note, mode: "source", source: true },
    });
  }, note);
  settle();
  assert.equal(snapshot("source-mode").edges.length, 0);
  evaluate(async (note) => {
    const { first } = window.__bulletThreadingCheck;
    await first.setViewState({
      type: "markdown",
      state: { file: note, mode: "source", source: false },
    });
  }, note);
  nativeClickLine(2);

  evaluate(() => {
    const { first } = window.__bulletThreadingCheck;
    first.view.editor.setCursor({ line: 1, ch: 5 });
    app.commands.executeCommandById("bullet:zoom-in");
  });
  settle();
  nativeClickLine(2);
  assert.equal(snapshot("zoomed").edges.length, 1);
  evaluate(() => app.commands.executeCommandById("bullet:zoom-reset"));
  settle();

  evaluate(async () => {
    const check = window.__bulletThreadingCheck;
    const second = app.workspace.getLeaf("split", "vertical");
    check.second = second;
    await second.openFile(check.file);
    second.view.editor.setCursor({ line: 4, ch: 5 });
  });
  settle();
  nativeClickLine(2);
  assert.equal(snapshot("first-pane").edges.length, 2);
  assert.equal(
    evaluate(
      () =>
        window.__bulletThreadingCheck.second.view.editor.cm.dom.querySelectorAll(
          ".bullet-plugin-thread-edge",
        ).length,
    ),
    1,
  );
  evaluate(() => {
    window.__bulletThreadingCheck.second.detach();
    window.__bulletThreadingCheck.second = null;
  });
  settle();

  evaluate(async () => {
    await app.plugins.plugins.bullet.settings.save();
    await app.plugins.disablePlugin("bullet");
    await app.plugins.loadManifest(".obsidian/plugins/bullet");
    await app.plugins.enablePlugin("bullet");
  });
  nativeClickLine(2);
  state = snapshot("reload");
  assert.equal(state.edges.length, 2);
  assert.ok(state.edges.every((edge) => edge.color === "rgb(255, 102, 0)"));
  settings({ bulletThreading: false });
  nativeClickLine(3);
  assert.equal(snapshot("disabled-again").layers, 0);
  const insertion = evaluate(() => {
    const cm = window.__bulletThreadingCheck.first.view.editor.cm;
    const pos = cm.state.selection.main.head;
    return (
      cm.state.doc.sliceString(0, pos) + "Z" + cm.state.doc.sliceString(pos)
    );
  });
  cdp("Input.insertText", { text: "Z" });
  settle();
  assert.equal(snapshot("typing-while-off").doc, insertion);
  cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Backspace",
    code: "Backspace",
    windowsVirtualKeyCode: 8,
    nativeVirtualKeyCode: 8,
  });
  cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Backspace",
    code: "Backspace",
    windowsVirtualKeyCode: 8,
    nativeVirtualKeyCode: 8,
  });
  settle();
  assert.equal(snapshot("typing-restored").doc, fixture);
  settings({ bulletThreadingColor: "#0099ff" });
  assert.equal(snapshot("color-while-off").layers, 0);
  evaluate(async () => {
    await window.__bulletThreadingCheck.first.view.save();
  });
  assert.equal(
    evaluate(async () => app.vault.read(window.__bulletThreadingCheck.file)),
    fixture,
  );
  console.log(
    JSON.stringify(
      { passed: results.map((result) => result.name), note },
      null,
      2,
    ),
  );
} finally {
  evaluate(async (initial) => {
    app.setting.close();
    app.vault.setConfig("settingsPopoutWindow", initial.settingsPopout);
    const check = window.__bulletThreadingCheck;
    if (check) {
      await check.first.view.save();
      await new Promise((resolve) => setTimeout(resolve, 750));
      check.second?.detach();
      check.first.detach();
      await app.vault.trash(check.file, true);
      delete window.__bulletThreadingCheck;
    }
    const settings = app.plugins.plugins.bullet.settings;
    for (const [key, value] of Object.entries(initial.settings))
      settings.setValue(key, value);
    await settings.save();
    if (initial.shiki) {
      if (!app.plugins.plugins["shiki-highlighter"])
        await app.plugins.enablePlugin("shiki-highlighter");
      const shiki = app.plugins.plugins["shiki-highlighter"];
      Object.assign(shiki.settings, initial.shikiSettings);
      await shiki.reloadHighlighter();
    } else if (app.plugins.plugins["shiki-highlighter"]) {
      await app.plugins.disablePlugin("shiki-highlighter");
    }
    const original = app.workspace.getLeafById(initial.leaf);
    if (original) app.workspace.setActiveLeaf(original, { focus: true });
  }, initial);
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
}
