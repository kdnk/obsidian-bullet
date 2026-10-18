const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");

const output = process.argv[2];
fs.mkdirSync(output);
const note = `pages/code-body-fold-controls-${randomUUID()}.md`;
const fontArgument = process.argv.find((arg) => arg.startsWith("--font="));
const modeArgument = process.argv.find((arg) => arg.startsWith("--mode="));
const fonts = fontArgument ? [Number(fontArgument.slice(7))] : [16, 24, 30];
const modes = modeArgument
  ? [modeArgument.slice(7)]
  : ["native", "shiki", "numbers"];
assert(fonts.every((font) => [16, 24, 30].includes(font)));
assert(modes.every((mode) => ["native", "shiki", "numbers"].includes(mode)));
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  font: app.getBaseFontSize(),
  vim: app.vault.config.vimMode ?? false,
  shiki: !!app.plugins.plugins["shiki-highlighter"],
  shikiSettings: app.plugins.plugins["shiki-highlighter"]?.settings,
}));
const fixtures = [
  { name: "base", prefix: "\t  ", child: "\t    " },
  { name: "literal-space", prefix: "\t    ", child: "\t      " },
  { name: "partial-tab", prefix: "\t\t", child: "\t\t\t" },
];
const results = [],
  failures = [];

function snapshot(text) {
  return evaluate(
    async ({ text, note }) => {
      window.focus();
      if (!document.title.includes("vault") || document.title.includes("base"))
        throw Error("Wrong vault window");
      const view = app.workspace.activeLeaf.view;
      if (view.file?.path !== note) throw Error("Wrong fixture note");
      await new Promise((resolve) => setTimeout(resolve, 250));
      await view.save();
      const editor = view.editor,
        cm = editor.cm;
      if (
        editor.getValue() !== text ||
        (await app.vault.read(view.file)) !== text
      )
        throw Error("Folding changed source Markdown");
      const bounds = (element) => {
        const b = element.getBoundingClientRect();
        return {
          left: b.left,
          right: b.right,
          top: b.top,
          bottom: b.bottom,
          width: b.width,
          height: b.height,
        };
      };
      const rows = [...cm.contentDOM.querySelectorAll(".cm-line")].map(
        (row) => {
          const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
          let node,
            glyph = null;
          while ((node = walker.nextNode())) {
            if (
              node.parentElement.closest(
                ".cm-fold-indicator,.code-block-flair,.cm-hmd-list-indent",
              )
            )
              continue;
            const offset = node.textContent.search(/\S/);
            if (offset < 0) continue;
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            const b = range.getBoundingClientRect();
            if (b.width > 0 && b.height > 0) {
              glyph = bounds(range);
              break;
            }
          }
          const indicator = row.querySelector(".cm-fold-indicator");
          const svg = indicator?.querySelector("svg");
          return {
            line: cm.state.doc.lineAt(cm.posAtDOM(row)).number,
            text: row.textContent,
            class: row.className,
            glyph,
            row: bounds(row),
            wrapper: indicator ? bounds(indicator) : null,
            wrapperTransform: indicator
              ? getComputedStyle(indicator).transform
              : null,
            svg: svg ? bounds(svg) : null,
            collapsed: indicator?.classList.contains("is-collapsed") ?? false,
            expectedGap:
              parseFloat(getComputedStyle(row).getPropertyValue("--size-4-4")) /
              2,
            contentPadding: getComputedStyle(row).getPropertyValue(
              "--bullet-code-content-padding",
            ),
            foldOffset: getComputedStyle(row).getPropertyValue(
              "--bullet-code-body-fold-offset",
            ),
          };
        },
      );
      return {
        rows,
        doc: editor.getValue(),
        cursor: editor.getCursor(),
        saved: await app.vault.read(view.file),
      };
    },
    { text, note },
  );
}

function screenshot(name) {
  fs.writeFileSync(
    `${output}/${name}.png`,
    Buffer.from(
      cdp("Page.captureScreenshot", { format: "png" }).data,
      "base64",
    ),
  );
}

function click(line) {
  const hover = evaluate(
    ({ line, note }) => {
      window.focus();
      if (!document.title.includes("vault") || document.title.includes("base"))
        throw Error("Wrong vault window");
      const view = app.workspace.activeLeaf.view;
      if (view.file?.path !== note) throw Error("Wrong fixture note");
      const cm = view.editor.cm;
      const row = [...cm.contentDOM.querySelectorAll(".cm-line")].find(
        (row) => cm.state.doc.lineAt(cm.posAtDOM(row)).number === line,
      );
      if (!row) throw Error(`Missing source row ${line}`);
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (
          node.parentElement.closest(".cm-fold-indicator,.cm-hmd-list-indent")
        )
          continue;
        const offset = node.textContent.search(/\S/);
        if (offset < 0) continue;
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const b = range.getBoundingClientRect();
        const point = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        if (
          b.width > 0 &&
          row.contains(document.elementFromPoint(point.x, point.y))
        )
          return point;
      }
      throw Error("No visible source glyph to hover");
    },
    { line, note },
  );
  cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...hover });
  let pressed;
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    const point = evaluate(
      async ({ line, note }) => {
        window.focus();
        if (
          !document.title.includes("vault") ||
          document.title.includes("base")
        )
          throw Error("Wrong vault window");
        const view = app.workspace.activeLeaf.view;
        if (view.file?.path !== note) throw Error("Wrong fixture note");
        const cm = view.editor.cm;
        const deadline = performance.now() + 2000;
        do {
          const row = [...cm.contentDOM.querySelectorAll(".cm-line")].find(
            (row) => cm.state.doc.lineAt(cm.posAtDOM(row)).number === line,
          );
          const control = row?.querySelector(
            ".cm-fold-indicator .collapse-indicator",
          );
          const svg = control?.querySelector("svg");
          if (svg) {
            const b = svg.getBoundingClientRect();
            const point = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
            if (
              b.width > 0 &&
              b.height > 0 &&
              control.contains(document.elementFromPoint(point.x, point.y))
            )
              return point;
          }
          await new Promise((resolve) => setTimeout(resolve, 40));
        } while (performance.now() < deadline);
        throw Error(`Fold SVG is absent or covered at source row ${line}`);
      },
      { line, note },
    );
    if (type === "mousePressed") pressed = point;
    if (type === "mouseReleased")
      assert(
        Math.hypot(point.x - pressed.x, point.y - pressed.y) < 1,
        "Native fold target moved during click",
      );
    cdp("Input.dispatchMouseEvent", {
      type,
      ...point,
      button: type === "mouseMoved" ? "none" : "left",
      buttons: type === "mousePressed" ? 1 : 0,
      clickCount: type === "mouseMoved" ? 0 : 1,
    });
  }
}

try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (note) => {
    app.vault.setConfig("vimMode", false);
    window.__bodyFoldLeaf = app.workspace.getLeaf("tab");
    await window.__bodyFoldLeaf.openFile(await app.vault.create(note, ""));
  }, note);
  for (const mode of modes) {
    evaluate(async (mode) => {
      if (mode === "native")
        await app.plugins.disablePlugin("shiki-highlighter");
      else {
        await app.plugins.enablePlugin("shiki-highlighter");
        const plugin = app.plugins.plugins["shiki-highlighter"];
        if (!plugin) throw Error("Shiki must be installed");
        plugin.settings.ecDefaultShowLineNumbers = mode === "numbers";
        await plugin.reloadHighlighter();
      }
    }, mode);
    for (const font of fonts)
      for (const fixture of fixtures) {
        const name = `${mode}-${font}-${fixture.name}`;
        const text = `- parent\n\t- \`\`\`js\n${fixture.prefix}hello\n${fixture.child}child\n${fixture.prefix}hello\n${fixture.child}child\n\t  \`\`\`\n- tail`;
        const record = { name, text, samples: [] };
        results.push(record);
        try {
          evaluate(
            async ({ text, font, prefix }) => {
              app.setBaseFontSize(font);
              const editor = app.workspace.activeLeaf.view.editor;
              editor.setValue(text);
              editor.setCursor({ line: 2, ch: prefix.length + 5 });
              window.focus();
              editor.focus();
              await new Promise((resolve) => setTimeout(resolve, 350));
              if (
                editor.getValue() !== text ||
                editor.getCursor().line !== 2 ||
                editor.getCursor().ch !== prefix.length + 5
              )
                throw Error("Fixture selection mismatch");
            },
            { text, font, prefix: fixture.prefix },
          );
          const before = snapshot(text);
          record.samples.push({ phase: "before", ...before });
          screenshot(`${name}-before`);
          for (const line of [3, 5]) {
            const row = before.rows.find((row) => row.line === line);
            assert(
              row?.glyph && row.svg,
              "Native code-indent fold SVG and source glyph required",
            );
            assert(
              row.class.includes("bullet-plugin-code-body-fold"),
              "Body control must use source-row layout",
            );
            const gap = row.glyph.left - (row.svg.left + row.svg.width / 2);
            assert(
              Number.isFinite(row.expectedGap) &&
                Math.abs(gap - row.expectedGap) <= 1,
              `Fold icon must occupy code gutter, measured gap ${gap}, expected ${row.expectedGap}`,
            );
            assert(
              row.svg.right < row.glyph.left,
              "Fold SVG must not overlap code text",
            );
            assert.equal(
              row.wrapperTransform,
              "none",
              "Native source-bearing fold wrapper must not move",
            );
          }
          for (const control of [
            { name: "body", line: 3, child: 4 },
            { name: "opener", line: 2, child: 3 },
          ]) {
            for (const collapsed of [true, false]) {
              click(control.line);
              const after = snapshot(text);
              record.samples.push({
                phase: `${control.name}-${collapsed ? "folded" : "unfolded"}`,
                ...after,
              });
              screenshot(
                `${name}-${control.name}-${collapsed ? "folded" : "unfolded"}`,
              );
              assert.equal(
                after.rows.find((row) => row.line === control.line)?.collapsed,
                collapsed,
                "Native arrow must toggle folded state",
              );
              assert.equal(
                after.rows.some((row) => row.line === control.child),
                !collapsed,
                "Code source child must hide and reappear",
              );
              if (!collapsed) {
                const expected = before.rows.find((row) => row.line === 3);
                const actual = after.rows.find((row) => row.line === 3);
                assert(
                  Math.abs(actual.glyph.left - expected.glyph.left) <= 1,
                  "Folding must preserve code glyph position",
                );
                assert(
                  Math.abs(actual.wrapper.left - expected.wrapper.left) <= 1,
                  "Folding must preserve native source wrapper position",
                );
              }
            }
          }
        } catch (error) {
          record.error = error.stack;
          failures.push({ name, error: error.message });
        }
      }
  }
} finally {
  fs.writeFileSync(
    `${output}/results.json`,
    JSON.stringify({ results, failures }, null, 2),
  );
  evaluate(
    async ({ original, note }) => {
      window.__bodyFoldLeaf?.detach();
      delete window.__bodyFoldLeaf;
      app.setBaseFontSize(original.font);
      app.vault.setConfig("vimMode", original.vim);
      if (original.shiki) {
        await app.plugins.enablePlugin("shiki-highlighter");
        const plugin = app.plugins.plugins["shiki-highlighter"];
        plugin.settings = original.shikiSettings;
        await plugin.reloadHighlighter();
      } else await app.plugins.disablePlugin("shiki-highlighter");
      const leaf = app.workspace.getLeafById(original.leaf);
      if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.fileManager.trashFile(file);
    },
    { original, note },
  );
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
}
console.log(JSON.stringify({ cases: results.length, failures }));
assert.equal(failures.length, 0);
