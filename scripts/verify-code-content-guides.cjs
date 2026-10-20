const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");

const output = process.argv[2];
assert(output, "A fresh output directory is required");
fs.mkdirSync(output);
const note = `pages/code-content-guides-${randomUUID()}.md`;
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  vim: app.vault.config.vimMode,
  shiki: !!app.plugins.plugins["shiki-highlighter"],
  shikiSettings: app.plugins.plugins["shiki-highlighter"]?.settings,
}));
const cases = [
  { name: "standalone", opening: "```sh", prefix: "" },
  { name: "attached", opening: "- ```sh", prefix: "  " },
  { name: "nested", opening: "\t- ```sh", prefix: "\t  " },
  {
    name: "continuation",
    opening: "\t- owner\n\t  ```sh",
    prefix: "\t  ",
  },
];
const results = [];
const failures = [];
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (note) => {
    window.__codeContentGuidesLeaf = app.workspace.getLeaf("tab");
    await window.__codeContentGuidesLeaf.openFile(
      await app.vault.create(note, ""),
    );
    app.vault.setConfig("vimMode", false);
    app.workspace.updateOptions();
    if (!document.body.classList.contains("bullet-plugin-better-lists"))
      throw Error("List styling must be enabled");
  }, note);
  for (const mode of ["native", "shiki", "numbers"]) {
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
    for (const sample of cases) {
      const text = [
        "- parent",
        sample.opening,
        `${sample.prefix}\t\t\t     aaa`,
        `${sample.prefix}\t\t\t`,
        `${sample.prefix}echo end`,
        `${sample.prefix}\`\`\``,
        "- reference",
        "\t- ordinary",
        "\t\t- child",
        "- tail",
      ].join("\n");
      const bodyLine = sample.opening.split("\n").length + 1;
      const record = { name: `${mode}-${sample.name}` };
      try {
        record.before = evaluate(
          async (text, bodyLine, prefix) => {
            const view = app.workspace.activeLeaf.view;
            const editor = view.editor;
            editor.setValue(text);
            editor.setCursor({
              line: bodyLine,
              ch: editor.getLine(bodyLine).length,
            });
            window.focus();
            editor.focus();
            await new Promise((resolve) => setTimeout(resolve, 350));
            await view.save();
            if (
              !document.title.includes("vault") ||
              document.title.includes("base") ||
              document.visibilityState !== "visible" ||
              !editor.cm.hasFocus
            )
              throw Error("Visible test editor required");
            const cm = editor.cm;
            const rows = [...cm.contentDOM.querySelectorAll(".cm-line")];
            const rowAt = (line) =>
              rows.find(
                (row) =>
                  cm.state.doc.lineAt(cm.posAtDOM(row)).number === line + 1,
              );
            const paint = (element) => {
              const style = getComputedStyle(element, "::before");
              return {
                visibility: style.visibility,
                display: style.display,
                border: style.borderRightWidth,
              };
            };
            const codeRows = [rowAt(bodyLine), rowAt(bodyLine + 1)];
            if (codeRows.some((row) => !row)) throw Error("Code rows required");
            const source = codeRows.map((row) => {
              const start = cm.state.doc.lineAt(cm.posAtDOM(row)).from;
              const guides = [...row.querySelectorAll(".cm-indent")];
              return {
                text: row.textContent,
                guides: guides
                  .filter(
                    (element) => cm.posAtDOM(element) >= start + prefix.length,
                  )
                  .map(paint),
                ownerGuides: guides
                  .filter(
                    (element) => cm.posAtDOM(element) < start + prefix.length,
                  )
                  .map(paint),
                ownerPaint: getComputedStyle(row).backgroundImage,
                html: row.outerHTML,
              };
            });
            const ordinary = rows.find((row) =>
              row.textContent.includes("ordinary"),
            );
            const ordinaryGuides = [
              ...ordinary.querySelectorAll(".cm-indent"),
            ].map(paint);
            const range = document.createRange();
            const walker = document.createTreeWalker(
              codeRows[0],
              NodeFilter.SHOW_TEXT,
            );
            let node;
            let glyph;
            while ((node = walker.nextNode())) {
              const index = node.textContent.indexOf("aaa");
              if (index < 0) continue;
              range.setStart(node, index);
              range.setEnd(node, index + 3);
              const rect = range.getBoundingClientRect();
              glyph = {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
              };
              break;
            }
            const bounds = codeRows[0].getBoundingClientRect();
            return {
              source,
              ordinaryGuides,
              glyph,
              saved: await app.vault.read(view.file),
              doc: editor.getValue(),
              clip: {
                x: bounds.left,
                y: Math.max(0, bounds.top - 32),
                width: Math.min(bounds.width, innerWidth - bounds.left),
                height: 160,
                scale: 1,
              },
            };
          },
          text,
          bodyLine,
          sample.prefix,
        );
        fs.writeFileSync(
          `${output}/${record.name}.png`,
          Buffer.from(
            cdp("Page.captureScreenshot", {
              format: "png",
              clip: record.before.clip,
            }).data,
            "base64",
          ),
        );
        evaluate(
          (text, bodyLine) => {
            window.focus();
            const editor = app.workspace.activeLeaf.view.editor;
            editor.focus();
            const cursor = editor.getCursor();
            if (
              !document.title.includes("vault") ||
              document.title.includes("base") ||
              document.visibilityState !== "visible" ||
              !editor.cm.hasFocus ||
              editor.getValue() !== text ||
              cursor.line !== bodyLine ||
              cursor.ch !== editor.getLine(bodyLine).length ||
              editor.somethingSelected()
            )
              throw Error("Native input target changed");
          },
          text,
          bodyLine,
        );
        cdp("Input.insertText", { text: "x" });
        record.after = evaluate(async () => {
          const view = app.workspace.activeLeaf.view;
          await view.save();
          return {
            doc: view.editor.getValue(),
            saved: await app.vault.read(view.file),
          };
        });
        const expected = text.replace("aaa", "aaax");
        assert.equal(record.before.doc, text);
        assert.equal(record.before.saved, text);
        assert.equal(record.after.doc, expected);
        assert.equal(record.after.saved, expected);
        assert(
          record.before.glyph?.width > 0,
          "Source code glyphs must be visible",
        );
        for (const row of record.before.source) {
          assert(
            row.guides.length >= 2,
            "Literal code indentation must retain native spans",
          );
          assert.equal(
            row.guides.filter(
              (guide) =>
                guide.visibility === "visible" &&
                guide.display !== "none" &&
                parseFloat(guide.border) > 0,
            ).length,
            0,
            "Code indentation must not paint vertical guides",
          );
          if (sample.prefix.length > 0)
            assert(
              /linear-gradient/.test(row.ownerPaint) ||
                row.ownerGuides.some(
                  (guide) =>
                    guide.visibility === "visible" &&
                    parseFloat(guide.border) > 0,
                ),
              "List owner guide must remain painted",
            );
        }
        assert(
          record.before.ordinaryGuides.some(
            (guide) =>
              guide.visibility === "visible" && parseFloat(guide.border) > 0,
          ),
          "Ordinary list guides must remain painted",
        );
      } catch (error) {
        record.error = String(error);
        failures.push(`${record.name}: ${error}`);
      }
      results.push(record);
    }
  }
} finally {
  try {
    fs.writeFileSync(
      `${output}/results.json`,
      JSON.stringify({ results, failures }, null, 2),
    );
    evaluate(
      async (note, original) => {
        try {
          const leaf = window.__codeContentGuidesLeaf;
          if (leaf) {
            try {
              await leaf.view.save();
            } finally {
              leaf.detach();
              delete window.__codeContentGuidesLeaf;
            }
          }
          const file = app.vault.getAbstractFileByPath(note);
          if (file) await app.fileManager.trashFile(file);
        } finally {
          app.vault.setConfig("vimMode", original.vim);
          app.workspace.updateOptions();
          try {
            if (original.shiki) {
              await app.plugins.enablePlugin("shiki-highlighter");
              const plugin = app.plugins.plugins["shiki-highlighter"];
              Object.assign(plugin.settings, original.shikiSettings);
              await plugin.reloadHighlighter();
            } else await app.plugins.disablePlugin("shiki-highlighter");
          } finally {
            const previous = app.workspace.getLeafById(original.leaf);
            if (previous)
              app.workspace.setActiveLeaf(previous, { focus: true });
          }
        }
      },
      note,
      original,
    );
  } finally {
    cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
  }
}
console.log(JSON.stringify({ samples: results.length, failures }, null, 2));
assert.equal(failures.length, 0, failures.join("\n"));
