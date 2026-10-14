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

function setup(line) {
  keypress("Escape");
  evaluate(
    async (fixture, line) => {
      const editor = app.workspace.activeLeaf.view.editor;
      editor.setValue(fixture);
      editor.setCursor({ line, ch: editor.getLine(line).length - 1 });
      editor.scrollIntoView(
        { from: { line: 0, ch: 0 }, to: { line: 6, ch: 0 } },
        true,
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
    },
    fixture,
    line,
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
    const openingBounds = rect(opening),
      markerBounds = rect(marker);
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
    const layout = [];
    results.push({ kind: "layout", mode, samples: layout });
    for (const phase of phases) {
      setup(phase.line);
      const state = sample();
      layout.push({ phase: phase.name, ...state });
      screenshot(`${mode}-${phase.name}`);
      check(`${mode}/${phase.name} Markdown`, () =>
        assert.equal(state.doc, fixture),
      );
      check(`${mode}/${phase.name} renderer`, () => {
        assert.equal(
          state.embedded,
          mode !== "native" && phase.name.startsWith("preview"),
        );
        if (state.embedded) assert.equal(state.numbers > 0, mode === "numbers");
      });
      check(`${mode}/${phase.name} marker`, () => {
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
      const saved = evaluate(async (note) => {
        const file = app.vault.getAbstractFileByPath(note);
        const editor = app.workspace.activeLeaf.view.editor;
        for (let attempt = 0; attempt < 30; attempt++) {
          const value = await app.vault.read(file);
          if (value === editor.getValue()) return value;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw Error("Editor changes were not saved");
      }, note);
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
            "Editor API creates fixture and positions selection; Vim keys and typing use native CDP input",
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
