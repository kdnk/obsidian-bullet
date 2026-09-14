// Compare preview and editing geometry in the real editor. Run serially.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const note = `code-spacing-${randomUUID()}.md`;
const original = evaluate(() => {
  if (!document.body.classList.contains("bullet-plugin-better-lists"))
    throw Error("Bullet list styles must be active");
  return {
    leaf: app.workspace.activeLeaf.id,
    shiki: !!app.plugins.plugins["shiki-highlighter"],
    settings: app.plugins.plugins["shiki-highlighter"]?.settings,
  };
});
const results = [],
  failures = [];
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (note) => {
    window.__codeSpacingLeaf = app.workspace.getLeaf("tab");
    await window.__codeSpacingLeaf.openFile(await app.vault.create(note, ""));
    await window.__codeSpacingLeaf.setViewState({
      type: "markdown",
      state: { file: note, mode: "source", source: false },
    });
  }, note);
  for (const mode of ["native", "shiki", "numbers"]) {
    evaluate(async (mode) => {
      const id = "shiki-highlighter";
      if (mode === "native") await app.plugins.disablePlugin(id);
      else {
        if (!app.plugins.plugins[id]) await app.plugins.enablePlugin(id);
        const plugin = app.plugins.plugins[id];
        plugin.settings.ecDefaultShowLineNumbers = mode === "numbers";
        await plugin.reloadHighlighter();
      }
    }, mode);
    for (const count of [1, 3, 18]) {
      const text = [
        "- before",
        "\t- ```js",
        ...Array.from(
          { length: count },
          (_, i) => `\t  const value${i} = ${i};`,
        ),
        "\t  ```",
        "\t- after",
        "",
        "end",
      ].join("\n");
      evaluate(
        (text) => app.workspace.activeLeaf.view.editor.setValue(text),
        text,
      );
      const samples = [];
      for (const phase of [
        "preview",
        "body-editing",
        "fence-editing",
        "preview-again",
      ]) {
        const sample = evaluate(
          async (phase, count) => {
            window.focus();
            if (document.visibilityState !== "visible")
              throw Error("Renderer is hidden");
            const editor = app.workspace.activeLeaf.view.editor,
              cm = editor.cm;
            editor.focus();
            const cursorLine = phase.startsWith("preview")
              ? count + 5
              : phase === "body-editing"
                ? 2
                : 1;
            editor.setCursor({ line: cursorLine, ch: 0 });
            editor.scrollIntoView(
              { from: { line: 0, ch: 0 }, to: { line: count + 5, ch: 0 } },
              true,
            );
            await new Promise((resolve) => setTimeout(resolve, 350));
            const line = (n) =>
              [...cm.contentDOM.querySelectorAll(".cm-line")].find(
                (el) => cm.state.doc.lineAt(cm.posAtDOM(el)).number === n,
              );
            const opening = line(2),
              sibling = line(count + 4);
            const embed = opening.nextElementSibling?.matches(
              ".cm-preview-code-block",
            )
              ? opening.nextElementSibling
              : null;
            const rows = Array.from({ length: count }, (_, i) =>
              line(i + 3),
            ).filter(Boolean);
            return {
              text: editor.getValue(),
              embedded: !!embed,
              numbers: embed?.querySelectorAll(".ln").length ?? 0,
              span:
                sibling.getBoundingClientRect().top -
                opening.getBoundingClientRect().top,
              openingHeight: opening.getBoundingClientRect().height,
              rows: rows.map((el) => ({
                height: el.getBoundingClientRect().height,
                lineHeight: parseFloat(getComputedStyle(el).lineHeight),
                guides: [...el.querySelectorAll(".cm-indent")].map(
                  (indent) => ({
                    height: indent.getBoundingClientRect().height,
                    width: indent.getBoundingClientRect().width,
                  }),
                ),
              })),
            };
          },
          phase,
          count,
        );
        samples.push({ phase, ...sample });
        try {
          assert.equal(
            sample.text,
            text,
            "Mode switches must preserve Markdown",
          );
          assert.equal(
            sample.embedded,
            mode !== "native" && phase.startsWith("preview"),
          );
          if (sample.embedded)
            assert.equal(sample.numbers > 0, mode === "numbers");
          assert.ok(
            sample.openingHeight > 0,
            "Opening fence remains navigable",
          );
          if (!sample.embedded) assert.equal(sample.rows.length, count);
          for (const row of sample.rows) {
            assert.ok(
              Math.abs(row.height - row.lineHeight) < 0.1,
              `Code row height ${row.height} must match code line height ${row.lineHeight}`,
            );
            for (const guide of row.guides)
              assert.ok(
                guide.height > 0 && guide.width > 0,
                "Native guide hit boxes must remain usable",
              );
          }
          // In the test vault's default theme, preview padding totals 24px
          // while the editable closing fence occupies one 21px code row.
          assert.ok(
            Math.abs(sample.span - samples[0].span) <= 3.1,
            `Preview/editing block heights differ by ${sample.span - samples[0].span}px`,
          );
        } catch (error) {
          failures.push(`${mode}, ${count} rows, ${phase}: ${error.message}`);
        }
        if (count === 3)
          fs.writeFileSync(
            path.join(output, `${mode}-${phase}.png`),
            Buffer.from(
              cdp("Page.captureScreenshot", { format: "png" }).data,
              "base64",
            ),
          );
      }
      results.push({ mode, count, samples });
    }
  }
} finally {
  try {
    evaluate(
      async (original, note) => {
        window.__codeSpacingLeaf?.detach();
        delete window.__codeSpacingLeaf;
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
    );
  } finally {
    cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
    fs.writeFileSync(
      path.join(output, "results.json"),
      JSON.stringify({ results, failures }, null, 2),
    );
  }
}
console.log(
  JSON.stringify({ output, cases: results.length * 4, failures }, null, 2),
);
assert.equal(
  failures.length,
  0,
  "Code spacing must stay consistent when editing",
);
