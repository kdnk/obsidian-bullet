const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");

const output = process.argv[2];
assert(output, "A fresh output directory is required");
assert(
  fs.existsSync(path.resolve("vault/.obsidian/bullet-verification-lock")),
  "Start a managed verification lifecycle first",
);
fs.mkdirSync(output);
const note = `pages/code-selection-gap-${randomUUID()}.md`;
const fixture = [
  "- hello",
  "\t- hello",
  "\t\t- ```",
  "\t\t  hello",
  "\t\t  \thello",
  "\t\t  ```",
  "\t\t- hello",
  "\t\t\t- hello",
  "\t\t- hello",
  "\t\t- ",
].join("\n");
let text = process.argv.includes("--spaces")
  ? fixture.replace(/\t/g, "    ")
  : fixture;
if (process.argv.includes("--shallow-close")) {
  const lines = text.split("\n");
  lines[5] = "        ```";
  text = lines.join("\n");
}
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  font: app.getBaseFontSize(),
  vim: app.vault.config.vimMode,
  shiki: !!app.plugins.plugins["shiki-highlighter"],
  settings: app.plugins.plugins["shiki-highlighter"]?.settings,
}));
const results = [];
const failures = [];
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(
    async (note, text) => {
      const leaf = app.workspace.getLeaf("tab");
      window.__codeSelectionGapLeaf = leaf;
      await leaf.openFile(await app.vault.create(note, text));
      await leaf.setViewState({
        type: "markdown",
        state: { file: note, mode: "source", source: false },
      });
      app.vault.setConfig("vimMode", false);
      app.workspace.updateOptions();
      if (!document.body.classList.contains("bullet-plugin-better-lists"))
        throw Error("List styling must be enabled");
    },
    note,
    text,
  );
  for (const mode of ["native", "shiki", "numbers"]) {
    evaluate(async (mode) => {
      const id = "shiki-highlighter";
      if (mode === "native") await app.plugins.disablePlugin(id);
      else {
        if (!app.plugins.plugins[id]) await app.plugins.enablePlugin(id);
        const plugin = app.plugins.plugins[id];
        if (!plugin) throw Error("Shiki must be installed");
        plugin.settings.ecDefaultShowLineNumbers = mode === "numbers";
        await plugin.reloadHighlighter();
      }
    }, mode);
    for (const font of [16, 24, 30]) {
      for (const phase of ["preview", "selection", "preview-again"]) {
        const record = { name: `${mode}-${font}-${phase}` };
        try {
          record.geometry = evaluate(
            async (font, phase, text) => {
              window.focus();
              app.setBaseFontSize(font);
              const view = window.__codeSelectionGapLeaf.view;
              const editor = view.editor;
              editor.focus();
              if (phase === "selection")
                editor.setSelection({ line: 4, ch: 0 }, { line: 5, ch: 0 });
              else editor.setCursor({ line: 9, ch: 4 });
              editor.scrollIntoView(
                { from: { line: 0, ch: 0 }, to: { line: 9, ch: 4 } },
                true,
              );
              await new Promise((resolve) => setTimeout(resolve, 350));
              if (
                !document.title.includes("vault") ||
                document.title.includes("base") ||
                document.visibilityState !== "visible" ||
                !editor.cm.hasFocus ||
                app.getBaseFontSize() !== font ||
                editor.getValue() !== text
              )
                throw Error("Visible fixture editor required");
              const cm = editor.cm;
              const rect = (bounds) => ({
                left: bounds.left,
                right: bounds.right,
                top: bounds.top,
                bottom: bounds.bottom,
                width: bounds.width,
                height: bounds.height,
              });
              const paint = (element) => {
                const style = getComputedStyle(element, "::before");
                return {
                  className: element.className,
                  text: element.textContent,
                  bounds: rect(element.getBoundingClientRect()),
                  display: style.display,
                  visibility: style.visibility,
                  content: style.content,
                  position: style.position,
                  inset: style.inset,
                  marginInlineStart: style.marginInlineStart,
                  marginInlineEnd: style.marginInlineEnd,
                  boxSizing: style.boxSizing,
                  parentBounds: element.parentElement
                    ? rect(element.parentElement.getBoundingClientRect())
                    : null,
                  width: style.width,
                  height: style.height,
                  borderRight: style.borderRight,
                  clipPath: style.clipPath,
                  background: style.background,
                  opacity: style.opacity,
                  transform: style.transform,
                };
              };
              const rows = [...cm.contentDOM.querySelectorAll(".cm-line")].map(
                (element) => {
                  const source = cm.state.doc.lineAt(cm.posAtDOM(element));
                  const characters = [];
                  if (source.number === 4 || source.number === 5) {
                    const walker = document.createTreeWalker(
                      element,
                      NodeFilter.SHOW_TEXT,
                    );
                    let node;
                    while ((node = walker.nextNode())) {
                      for (let offset = 0; offset < node.length; offset++) {
                        const range = document.createRange();
                        range.setStart(node, offset);
                        range.setEnd(node, offset + 1);
                        characters.push({
                          text: node.data[offset],
                          position: cm.posAtDOM(node, offset) - source.from,
                          bounds: [...range.getClientRects()].map(rect),
                        });
                      }
                    }
                  }
                  return {
                    line: source.number,
                    source: source.text,
                    html: element.outerHTML,
                    bounds: rect(element.getBoundingClientRect()),
                    background: getComputedStyle(element).backgroundImage,
                    marks: [
                      ...element.querySelectorAll(
                        ".bullet-plugin-nested-code-block-content",
                      ),
                    ].map((mark) => ({
                      text: mark.textContent,
                      bounds: rect(mark.getBoundingClientRect()),
                      padding: getComputedStyle(mark).paddingInlineStart,
                      font: getComputedStyle(mark).font,
                    })),
                    guides: [
                      ...element.querySelectorAll(
                        ".cm-hmd-list-indent, .cm-indent-spacing, .cm-indent, .bullet-plugin-outer-list-guide",
                      ),
                    ].map(paint),
                    characters,
                  };
                },
              );
              const first = rows[0]?.bounds;
              const last = rows.at(-1)?.bounds;
              if (!first || !last) throw Error("Mounted fixture rows required");
              const x = Math.max(0, Math.floor(first.left - 20));
              const y = Math.max(0, Math.floor(first.top - 10));
              await view.save();
              return {
                title: document.title,
                selection: editor.listSelections(),
                nativeSelection: (() => {
                  const selection = document.getSelection();
                  return selection?.rangeCount
                    ? [...selection.getRangeAt(0).getClientRects()].map(rect)
                    : [];
                })(),
                selectionPaint: [
                  ...cm.dom.querySelectorAll(".cm-selectionBackground"),
                ].map((element) => rect(element.getBoundingClientRect())),
                rows,
                saved: await app.vault.read(view.file),
                clip: {
                  x,
                  y,
                  width: Math.min(760, innerWidth - x),
                  height: Math.min(innerHeight - y, last.bottom - y + 12),
                  scale: 1,
                },
              };
            },
            font,
            phase,
            text,
          );
          fs.writeFileSync(
            `${output}/${record.name}.png`,
            Buffer.from(
              cdp("Page.captureScreenshot", {
                format: "png",
                clip: record.geometry.clip,
              }).data,
              "base64",
            ),
          );
          assert.equal(record.geometry.saved, text, "Saved Markdown changed");
          if (process.argv.includes("--shallow-close")) {
            const child = record.geometry.rows.find((row) => row.line === 8);
            assert.ok(child, "Ordinary child row must be mounted");
            assert.ok(
              !child.html.includes("bullet-plugin-code-content-indent"),
              "Ordinary list indentation must not receive code-content roles",
            );
            const ancestors = child.guides.filter((guide) =>
              guide.className.split(" ").includes("cm-indent"),
            );
            assert.equal(ancestors.length, 3, "Three ancestor guides required");
            assert.ok(
              ancestors.every((guide) => guide.visibility === "visible"),
              "Ordinary child ancestor guides must remain visible",
            );
          }
          if (phase === "selection") {
            assert.deepEqual(record.geometry.selection, [
              { anchor: { line: 4, ch: 0 }, head: { line: 5, ch: 0 } },
            ]);
            assert(
              record.geometry.rows.find((row) => row.line === 5)?.characters
                .length > 0,
              "Selected code source must be mounted",
            );
            if (process.argv.includes("--spaces")) {
              const row = record.geometry.rows.find((row) => row.line === 5);
              const code = row.characters.filter((char) => char.position >= 10);
              const first = code[0].bounds[0];
              const glyph = code.find((char) => char.text === "h").bounds[0];
              assert.ok(
                Math.abs(glyph.left - first.left - 4 * glyph.width) < 1,
                "Four literal spaces must occupy four code columns",
              );
              for (let index = 1; index < code.length; index++)
                assert.ok(
                  Math.abs(
                    code[index].bounds[0].left -
                      code[index - 1].bounds[0].right,
                  ) < 1,
                  "Selected code characters must have no internal layout gap",
                );
            }
          }
        } catch (error) {
          record.error = String(error);
          failures.push(`${record.name}: ${error}`);
        }
        results.push(record);
      }
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
          try {
            const leaf = window.__codeSelectionGapLeaf;
            if (leaf) {
              try {
                await leaf.view.save();
              } finally {
                leaf.detach();
                delete window.__codeSelectionGapLeaf;
              }
            }
          } finally {
            const file = app.vault.getAbstractFileByPath(note);
            if (file) await app.fileManager.trashFile(file);
          }
        } finally {
          app.setBaseFontSize(original.font);
          app.vault.setConfig("vimMode", original.vim);
          app.workspace.updateOptions();
          try {
            if (original.shiki) {
              await app.plugins.enablePlugin("shiki-highlighter");
              const plugin = app.plugins.plugins["shiki-highlighter"];
              Object.assign(plugin.settings, original.settings);
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
