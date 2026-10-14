const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

if (!process.argv[2]) throw Error("Pass a fresh output directory");
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const note = `code-positions-${randomUUID()}.md`;
const fixture =
  "- parent\n\t- ```yaml\n\t  alpha\n\t  bravo\n\t  charlie\n\t  ```\n- after";
const phases = [
  { name: "preview", line: 6 },
  { name: "opening-edit", line: 1 },
  { name: "first-body", line: 2 },
  { name: "second-body", line: 3 },
  { name: "preview-again", line: 6 },
];
const vimRows = [
  { name: "opening", line: 1 },
  { name: "first-body", line: 2 },
  { name: "second-body", line: 3 },
  { name: "closing", line: 5 },
];
const results = [],
  failures = [];
const original = evaluate(() => {
  if (
    !app.plugins.plugins.bullet?.settings.betterListsStyles ||
    !document.body.classList.contains("bullet-plugin-better-lists")
  )
    throw Error("Bullet list styles must be active");
  return {
    leaf: app.workspace.activeLeaf.id,
    vim: app.vault.config.vimMode ?? false,
    shiki: !!app.plugins.plugins["shiki-highlighter"],
    settings: app.plugins.plugins["shiki-highlighter"]?.settings,
  };
});
let fixtureLeaf;

function guard() {
  evaluate((note) => {
    window.focus();
    if (
      !document.title.includes("vault") ||
      document.title.includes("base") ||
      document.visibilityState !== "visible"
    )
      throw Error("Wrong vault window");
    const view = app.workspace.activeLeaf.view;
    if (view.file?.path !== note) throw Error("Wrong fixture note");
    const editor = view.editor;
    editor.focus();
    const cm = editor.cm;
    const caret = cm.coordsAtPos(cm.state.selection.main.head);
    const viewport = cm.scrollDOM.getBoundingClientRect();
    if (
      !caret ||
      caret.top < viewport.top ||
      caret.bottom > viewport.bottom ||
      caret.left < viewport.left ||
      caret.right > viewport.right
    )
      throw Error("Caret is outside the editor viewport");
  }, note);
}

function keypress(key) {
  guard();
  for (const type of ["keyDown", "keyUp"])
    cdp("Input.dispatchKeyEvent", {
      type,
      key,
      code:
        key === "Escape"
          ? "Escape"
          : key === "0"
            ? "Digit0"
            : `Key${key.toUpperCase()}`,
      windowsVirtualKeyCode:
        key === "Escape" ? 27 : key.toUpperCase().charCodeAt(0),
    });
}

function setup(line, reset = true, text = fixture) {
  keypress("Escape");
  evaluate(
    async (fixture, line, reset) => {
      const editor = app.workspace.activeLeaf.view.editor;
      if (reset) editor.setValue(fixture);
      editor.setCursor({
        line,
        ch: Math.max(0, editor.getLine(line).length - 1),
      });
      editor.scrollIntoView(
        { from: { line: 0, ch: 0 }, to: { line: editor.lastLine(), ch: 0 } },
        true,
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
    },
    text,
    line,
    reset,
  );
}

function sample() {
  return evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 160));
    const editor = app.workspace.activeLeaf.view.editor;
    const cm = editor.cm;
    const opening = cm.contentDOM.querySelector(".HyperMD-codeblock-begin");
    const marker = opening?.querySelector(".list-bullet");
    const rect = (element) => {
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    };
    function paintedMarkerBounds(element) {
      const box = element?.getBoundingClientRect();
      if (!box || !element.matches(".list-bullet")) return box;
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
    const openingBounds = rect(opening),
      markerBounds = paintedMarkerBounds(marker);
    const embed = opening?.nextElementSibling?.matches(".cm-preview-code-block")
      ? opening.nextElementSibling
      : null;
    return {
      doc: editor.getValue(),
      cursor: editor.getCursor(),
      caret: cm.coordsAtPos(cm.state.selection.main.head),
      opening: openingBounds,
      marker: markerBounds,
      markerCenter:
        markerBounds && openingBounds
          ? {
              x: markerBounds.x + markerBounds.width / 2 - openingBounds.x,
              y: markerBounds.y + markerBounds.height / 2 - openingBounds.y,
            }
          : null,
      embedded: !!embed,
      numbers: embed?.querySelectorAll(".ln").length ?? 0,
      rows: [...cm.contentDOM.querySelectorAll(".HyperMD-codeblock")].map(
        (row) => ({
          text: row.textContent,
          rect: rect(row),
        }),
      ),
    };
  });
}

function screenshot(name) {
  fs.writeFileSync(
    path.join(output, `${name}.png`),
    Buffer.from(
      cdp("Page.captureScreenshot", { format: "png" }).data,
      "base64",
    ),
  );
}

function check(name, predicate) {
  try {
    predicate();
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

function savedMarkdown() {
  return evaluate(async (note) => {
    const file = app.vault.getAbstractFileByPath(note);
    const editor = app.workspace.activeLeaf.view.editor;
    for (let attempt = 0; attempt < 30; attempt++) {
      const value = await app.vault.read(file);
      if (value === editor.getValue()) return value;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error("Editor changes were not saved");
  }, note);
}

function clickControl(selector) {
  const target = () =>
    evaluate(
      async (note, selector) => {
        window.focus();
        if (
          !document.title.includes("vault") ||
          document.title.includes("base") ||
          document.visibilityState !== "visible"
        )
          throw Error("Wrong vault window");
        const view = app.workspace.activeLeaf.view;
        if (view.file?.path !== note) throw Error("Wrong fixture note");
        const cm = view.editor.cm;
        function paintedMarkerBounds(element) {
          const box = element?.getBoundingClientRect();
          if (!box || !element.matches(".list-bullet")) return box;
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
        let diagnostic;
        const deadline = performance.now() + 10000;
        do {
          const row = [...cm.contentDOM.querySelectorAll(".cm-line")].find(
            (row) => cm.state.doc.lineAt(cm.posAtDOM(row)).number === 2,
          );
          const control = row?.querySelector(selector);
          const candidates = control
            ? selector === ".list-bullet"
              ? [paintedMarkerBounds(control)]
              : [control.querySelector("svg"), control]
                  .filter(Boolean)
                  .map((element) => element.getBoundingClientRect())
            : [];
          const points = candidates.flatMap((rect) =>
            [0.5, 0.2, 0.8].flatMap((x) =>
              [0.5, 0.2, 0.8].map((y) => ({
                x: rect.x + rect.width * x,
                y: rect.y + rect.height * y,
              })),
            ),
          );
          const point = points.find((point) =>
            control.contains(document.elementFromPoint(point.x, point.y)),
          );
          if (point) return point;
          diagnostic = {
            row: row?.outerHTML,
            bounds: candidates.map((rect) => rect.toJSON()),
            hits: points.map(
              (point) => document.elementFromPoint(point.x, point.y)?.outerHTML,
            ),
          };
          await new Promise((resolve) => setTimeout(resolve, 50));
        } while (performance.now() < deadline);
        throw Error(
          `Source control is absent or covered: ${selector} ${JSON.stringify(diagnostic)}`,
        );
      },
      note,
      selector,
    );
  const hover = evaluate((note) => {
    window.focus();
    if (
      !document.title.includes("vault") ||
      document.title.includes("base") ||
      document.visibilityState !== "visible"
    )
      throw Error("Wrong vault window");
    const view = app.workspace.activeLeaf.view;
    if (view.file?.path !== note) throw Error("Wrong fixture note");
    const cm = view.editor.cm;
    const row = [...cm.contentDOM.querySelectorAll(".cm-line")].find(
      (row) => cm.state.doc.lineAt(cm.posAtDOM(row)).number === 2,
    );
    const rect = row.getBoundingClientRect();
    const point = {
      x: rect.x + Math.min(80, rect.width / 2),
      y: rect.y + rect.height / 2,
    };
    if (!row.contains(document.elementFromPoint(point.x, point.y)))
      throw Error("Covered opening row");
    return point;
  }, note);
  cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...hover });
  cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...target() });
  const point = target();
  cdp("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    buttons: 1,
    clickCount: 1,
    ...point,
  });
  const release = target();
  assert.ok(
    Math.hypot(release.x - point.x, release.y - point.y) < 1,
    "Control moved before pointer release",
  );
  cdp("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    buttons: 0,
    clickCount: 1,
    ...point,
  });
  return point;
}

function controlState() {
  return evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const editor = app.workspace.activeLeaf.view.editor;
    const cm = editor.cm;
    const row = [...cm.contentDOM.querySelectorAll(".cm-line")].find(
      (row) => cm.state.doc.lineAt(cm.posAtDOM(row)).number === 2,
    );
    const feature = app.plugins.plugins.bullet.features.find(
      (feature) => feature.constructor.name === "ListZoom",
    );
    if (!feature) throw Error("Missing ListZoom feature");
    const range = feature.range(cm.state);
    return {
      doc: editor.getValue(),
      zoom: range ? { from: range.from, to: range.to } : null,
      folded: !!row?.querySelector(".cm-fold-indicator.is-collapsed"),
      visibleCodeRows:
        cm.contentDOM.querySelectorAll(".HyperMD-codeblock").length,
    };
  });
}

function verifyControls(mode) {
  const text = fixture.replace("\n- after", "\n\t\t- child\n- after");
  const samples = [];
  results.push({ kind: "controls", mode, samples });
  setup(2, true, text);
  const before = controlState();
  assert.equal(before.zoom, null);
  assert.equal(before.folded, false);
  screenshot(`${mode}-source-controls-before`);
  const marker = clickControl(".list-bullet");
  const zoomed = controlState();
  const zoomSaved = savedMarkdown();
  samples.push({
    control: "marker",
    before,
    point: marker,
    after: zoomed,
    saved: zoomSaved,
  });
  screenshot(`${mode}-source-marker-zoom`);
  check(`${mode}/source marker click`, () => {
    assert.equal(
      zoomed.zoom?.from,
      text.indexOf("\t- ```"),
      "Marker must zoom the code item",
    );
    assert.equal(zoomed.doc, text);
    assert.equal(zoomSaved, text);
  });
  assert.equal(
    evaluate(() => app.commands.executeCommandById("bullet:zoom-reset")),
    true,
    "Zoom reset command must be available",
  );
  setup(2, false, text);
  for (const folded of [true, false]) {
    const before = controlState();
    const point = clickControl(".cm-fold-indicator .collapse-indicator");
    const after = controlState();
    const saved = savedMarkdown();
    samples.push({ control: "chevron", folded, before, point, after, saved });
    screenshot(`${mode}-source-chevron-${folded ? "folded" : "unfolded"}`);
    check(`${mode}/source chevron ${folded}`, () => {
      assert.equal(after.folded, folded, "Chevron must toggle native folding");
      assert.equal(after.zoom, null, "Chevron must not zoom the item");
      assert.equal(after.doc, text);
      assert.equal(saved, text);
      assert.ok(
        folded
          ? after.visibleCodeRows < before.visibleCodeRows
          : after.visibleCodeRows > before.visibleCodeRows,
        "Code rows must fold and unfold",
      );
    });
  }
}

function verifyLayout(mode, shape, text, steps) {
  const layout = [];
  results.push({ kind: "layout", mode, shape, samples: layout });
  for (const phase of steps) {
    setup(phase.line, phase === steps[0], text);
    const state = sample();
    layout.push({ phase: phase.name, ...state });
    screenshot(`${mode}-${shape}-${phase.name}`);
    check(`${mode}/${shape}/${phase.name} Markdown`, () =>
      assert.equal(state.doc, text),
    );
    check(`${mode}/${shape}/${phase.name} renderer`, () => {
      assert.equal(
        state.embedded,
        mode !== "native" && phase.name.startsWith("preview"),
      );
      if (state.embedded && shape !== "empty")
        assert.equal(state.numbers > 0, mode === "numbers");
    });
    check(`${mode}/${shape}/${phase.name} marker`, () => {
      assert.ok(
        state.markerCenter && layout[0].markerCenter,
        "List marker must be visible",
      );
      for (const axis of ["x", "y"])
        assert.ok(
          Math.abs(state.markerCenter[axis] - layout[0].markerCenter[axis]) <=
            1,
          `Marker ${axis} moved ${state.markerCenter[axis] - layout[0].markerCenter[axis]}px`,
        );
    });
  }
  const saved = savedMarkdown();
  check(`${mode}/${shape} saved Markdown`, () => assert.equal(saved, text));
}

try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  fixtureLeaf = evaluate(
    async (note, fixture) => {
      await app.plugins.loadManifest(".obsidian/plugins/shiki-highlighter");
      if (!app.plugins.manifests["shiki-highlighter"])
        throw Error("Install Shiki Highlighter in the test vault");
      app.vault.setConfig("vimMode", true);
      app.workspace.updateOptions();
      const leaf = app.workspace.getLeaf("tab");
      await leaf.openFile(await app.vault.create(note, fixture));
      await leaf.setViewState({
        type: "markdown",
        state: { file: note, mode: "source", source: false },
      });
      leaf.view.editor.setCursor({ line: 6, ch: 3 });
      leaf.view.editor.focus();
      await new Promise((resolve) => setTimeout(resolve, 250));
      return leaf.id;
    },
    note,
    fixture,
  );

  for (const mode of ["native", "shiki", "numbers"]) {
    evaluate(async (mode) => {
      app.vault.setConfig("vimMode", false);
      app.workspace.updateOptions();
      const id = "shiki-highlighter";
      if (mode === "native") await app.plugins.disablePlugin(id);
      else {
        if (!app.plugins.plugins[id]) await app.plugins.enablePlugin(id);
        const plugin = app.plugins.plugins[id];
        plugin.settings.ecDefaultShowLineNumbers = mode === "numbers";
        await plugin.reloadHighlighter();
      }
      if (!!app.plugins.plugins[id] !== (mode !== "native"))
        throw Error("Shiki state mismatch");
    }, mode);
    verifyLayout(mode, "multiline", fixture, phases);
    verifyLayout(mode, "empty", "- parent\n\t- ```yaml\n\t  ```\n- after", [
      { name: "preview", line: 3 },
      { name: "opening-edit", line: 1 },
      { name: "closing-edit", line: 2 },
      { name: "preview-again", line: 3 },
    ]);
    verifyLayout(
      mode,
      "blank-first",
      "- parent\n\t- ```yaml\n\t  \n\t  alpha\n\t  ```\n- after",
      [
        { name: "preview", line: 5 },
        { name: "opening-edit", line: 1 },
        { name: "first-body", line: 2 },
        { name: "second-body", line: 3 },
        { name: "preview-again", line: 5 },
      ],
    );
    verifyControls(mode);
    const vim = [];
    results.push({ kind: "vim", mode, samples: vim });
    evaluate(() => {
      app.vault.setConfig("vimMode", true);
      app.workspace.updateOptions();
    });
    for (const row of vimRows) {
      setup(row.line);
      keypress("0");
      const zero = sample();
      for (let press = 0; press < 5; press++) keypress("h");
      const left = sample();
      screenshot(`${mode}-${row.name}-left`);
      keypress("i");
      guard();
      cdp("Input.insertText", { text: "X" });
      const typed = sample();
      const saved = savedMarkdown();
      screenshot(`${mode}-${row.name}-typed`);
      vim.push({ row: row.name, line: row.line, zero, left, typed, saved });
      const expected = fixture.split("\n");
      expected[row.line] =
        expected[row.line].slice(0, 3) + "X" + expected[row.line].slice(3);
      for (const [motion, state] of [
        ["0", zero],
        ["h", left],
      ]) {
        check(`${mode}/${row.name}/${motion} prefix`, () => {
          assert.equal(state.doc, fixture);
          assert.deepEqual(state.cursor, { line: row.line, ch: 3 });
        });
        check(`${mode}/${row.name}/${motion} left edge`, () => {
          assert.ok(
            state.caret && vim[0].zero.caret,
            "Caret must be measurable",
          );
          assert.ok(
            Math.abs(state.caret.left - vim[0].zero.caret.left) <= 1,
            `Editable left edge differs by ${state.caret.left - vim[0].zero.caret.left}px`,
          );
        });
      }
      check(`${mode}/${row.name}/typing`, () => {
        assert.equal(
          typed.doc,
          expected.join("\n"),
          "Vim i must preserve the raw container prefix",
        );
        assert.deepEqual(typed.cursor, { line: row.line, ch: 4 });
        assert.equal(
          saved,
          expected.join("\n"),
          "Saved Markdown must retain the exact prefix",
        );
      });
    }
  }
} catch (error) {
  failures.push(`Drive failed: ${error.stack ?? error.message}`);
} finally {
  try {
    evaluate(
      async (original, note, fixtureLeaf) => {
        const ownedLeaf =
          app.workspace.getLeafById(fixtureLeaf) ??
          app.workspace
            .getLeavesOfType("markdown")
            .find((leaf) => leaf.view.file?.path === note);
        ownedLeaf?.detach();
        app.vault.setConfig("vimMode", original.vim);
        app.workspace.updateOptions();
        if (original.shiki) {
          if (!app.plugins.plugins["shiki-highlighter"])
            await app.plugins.enablePlugin("shiki-highlighter");
          const plugin = app.plugins.plugins["shiki-highlighter"];
          plugin.settings = original.settings;
          await plugin.reloadHighlighter();
        } else await app.plugins.disablePlugin("shiki-highlighter");
        const leaf = app.workspace.getLeafById(original.leaf);
        if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
        const file = app.vault.getAbstractFileByPath(note);
        if (file) await app.vault.trash(file, true);
      },
      original,
      note,
      fixtureLeaf,
    );
  } catch (error) {
    failures.push(`Cleanup failed: ${error.stack ?? error.message}`);
  } finally {
    try {
      cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
    } catch (error) {
      failures.push(`Focus cleanup failed: ${error.message}`);
    }
    fs.writeFileSync(
      path.join(output, "results.json"),
      JSON.stringify(
        {
          setup:
            "Editor API creates fixtures and positions selection; Vim keys, typing, marker and chevron clicks use native CDP input; zoom-reset command restores the full note between pointer cases",
          results,
          failures,
        },
        null,
        2,
      ),
    );
  }
}
console.log(
  JSON.stringify(
    {
      output,
      cases: results.reduce((n, result) => n + result.samples.length, 0),
      failures,
    },
    null,
    2,
  ),
);
assert.equal(
  failures.length,
  0,
  "Nested code marker positions and Vim left boundaries must remain stable",
);
