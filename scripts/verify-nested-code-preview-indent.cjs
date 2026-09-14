// Run serially against the deployed test build with Shiki installed.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const notePath = `pages/code-preview-indent-${randomUUID()}.md`;
const selectedCase = process.argv
  .find((arg) => arg.startsWith("--case="))
  ?.slice(7);
const cases = [
  {
    name: "root",
    opening: "- ```js",
    raw: ["  hello", "    nested"],
    want: ["hello", "  nested"],
    close: "  ```",
  },
  {
    name: "deep",
    opening: "\t\t\t- ```js",
    raw: ["\t\t\t  hello", "\t\t\t    nested", "", "\t\t\t  \tinside"],
    want: ["hello", "  nested", "", "\tinside"],
    close: "\t\t\t  ```",
  },
  {
    name: "partial-tab",
    opening: "- ```js",
    raw: ["\thello", "\t  nested"],
    want: ["  hello", "    nested"],
    close: "  ```",
  },
  {
    name: "ordered",
    opening: "\t10. ```js",
    raw: ["\t\thello", "\t\t  nested"],
    want: ["hello", "  nested"],
    close: "\t    ```",
  },
  {
    name: "blank-boundaries",
    opening: "\t- ```js",
    raw: ["", "\t  ", "\t  hello", "\t  ", "\t    nested", ""],
    renderedRaw: ["\t  hello", "", "\t    nested"],
    want: ["hello", "", "  nested"],
    close: "\t  ```",
  },
  {
    name: "hanging",
    opening: "- ```js preserveIndent=false hangingIndent=3",
    raw: ["  hello", "    nested"],
    want: ["hello", "  nested"],
    close: "  ```",
    preserveIndent: false,
    hangingIndent: 3,
  },
  {
    name: "wrapped",
    opening: "\t- ```js hangingIndent=2",
    raw: ["\t  // " + "long code ".repeat(40) + "end", "\t    nested"],
    want: ["// " + "long code ".repeat(40) + "end", "  nested"],
    close: "\t  ```",
    hangingIndent: 2,
  },
  {
    name: "terminal",
    opening: "\t- ```bash",
    raw: ["\t  # comment", "\t  echo one", "\t  echo two"],
    want: ["# comment", "echo one", "echo two"],
    copy: "echo one\necho two",
    rawCopy: "echo one\n\t  echo two",
    close: "\t  ```",
  },
  {
    name: "outside-list",
    opening: "```js",
    raw: ["  hello", "    nested"],
    want: ["  hello", "    nested"],
    close: "```",
  },
].filter((spec) => !selectedCase || spec.name === selectedCase);
assert.ok(cases.length, "Unknown test case");
const original = evaluate(() => ({
  file: app.workspace.getActiveFile()?.path,
  shiki: !!app.plugins.plugins["shiki-highlighter"],
  settings: app.plugins.plugins["shiki-highlighter"]?.settings,
  listStyles: app.plugins.plugins.bullet.settings.betterListsStyles,
}));
assert.equal(
  original.listStyles,
  true,
  "Start with Bullet list styles enabled",
);
const results = [];
const failures = [];
let created = false;
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (notePath) => {
    if (!app.vault.getAbstractFileByPath("pages"))
      await app.vault.createFolder("pages");
    const file = await app.vault.create(notePath, "");
    await app.workspace.getLeaf(false).openFile(file);
    if (!app.plugins.plugins["shiki-highlighter"]) {
      await app.plugins.loadManifest(".obsidian/plugins/shiki-highlighter");
      await app.plugins.enablePlugin("shiki-highlighter");
    }
  }, notePath);
  created = true;
  for (const numbers of [false, true]) {
    evaluate(async (numbers) => {
      const shiki = app.plugins.plugins["shiki-highlighter"];
      shiki.settings.ecDefaultShowLineNumbers = numbers;
      shiki.settings.ecDefaultWrap = true;
      await shiki.reloadHighlighter();
    }, numbers);
    for (const spec of cases) {
      const text = [
        "- parent",
        "\t- child",
        "\t\t- grandchild",
        "",
        spec.opening,
        ...spec.raw,
        spec.close,
        "",
        "- end",
      ].join("\n");
      evaluate((text) => {
        const ed = app.workspace.activeLeaf.view.editor;
        ed.setValue(text);
        ed.focus();
        ed.setCursor(ed.lastLine(), 5);
        ed.scrollIntoView(
          { from: { line: 4, ch: 0 }, to: { line: ed.lastLine(), ch: 5 } },
          true,
        );
      }, text);
      for (const phase of [
        "preview",
        "after-editing",
        "reconfigured",
        "styles-disabled",
        "styles-enabled",
        "shiki-reloaded",
      ]) {
        if (phase === "after-editing") {
          evaluate(async () => {
            const ed = app.workspace.activeLeaf.view.editor;
            ed.setCursor(5, ed.getLine(5).length);
            await new Promise((resolve) => setTimeout(resolve, 200));
            ed.setCursor(ed.lastLine(), 5);
          });
        } else if (phase === "reconfigured") {
          evaluate(() => app.workspace.updateOptions());
        } else if (phase.startsWith("styles-")) {
          evaluate((enabled) => {
            app.plugins.plugins.bullet.settings.betterListsStyles = enabled;
          }, phase === "styles-enabled");
        } else if (phase === "shiki-reloaded") {
          evaluate(async () => {
            await app.plugins.plugins["shiki-highlighter"].reloadHighlighter();
          });
        }
        const sample = evaluate(async () => {
          await new Promise((resolve) => setTimeout(resolve, 400));
          const cm = app.workspace.activeLeaf.view.editor.cm;
          const embed = cm.contentDOM.querySelector(".cm-preview-code-block");
          const code = embed?.querySelector(".expressive-code");
          return {
            visible: document.visibilityState,
            text: cm.state.doc.toString(),
            lines: [...(code?.querySelectorAll(".ec-line .code") ?? [])].map(
              (e) => (e.textContent === "\n" ? "" : e.textContent),
            ),
            copy: code
              ?.querySelector("button[data-code]")
              ?.getAttribute("data-code")
              .replaceAll("\x7f", "\n"),
            indents: [...(code?.querySelectorAll(".ec-line") ?? [])].map((e) =>
              e.style.getPropertyValue("--ecIndent"),
            ),
            maxLine: code
              ?.querySelector("pre")
              ?.style.getPropertyValue("--ecMaxLine"),
          };
        });
        results.push({ name: spec.name, numbers, phase, ...sample });
        const wanted =
          phase === "styles-disabled"
            ? (spec.renderedRaw ?? spec.raw)
            : spec.want;
        for (const [label, actual, want] of [
          ["visibility", sample.visible, "visible"],
          ["source", sample.text, text],
          ["display", sample.lines, wanted],
          [
            "copy",
            sample.copy,
            (phase === "styles-disabled" ? spec.rawCopy : spec.copy) ??
              wanted.join("\n"),
          ],
          [
            "wrapping indents",
            sample.indents.map((value) => Number.parseFloat(value) || 0),
            wanted.map(
              (line) =>
                (spec.preserveIndent === false
                  ? 0
                  : line.match(/^\s*/)[0].length) + (spec.hangingIndent ?? 0),
            ),
          ],
          [
            "wrapping width",
            sample.maxLine,
            `${Math.max(...wanted.map((line) => line.length))}ch`,
          ],
        ]) {
          try {
            assert.deepEqual(actual, want);
          } catch {
            failures.push(
              `${spec.name}/${numbers}/${phase}: ${label}: ${JSON.stringify(actual)} != ${JSON.stringify(want)}`,
            );
          }
        }
      }
      fs.writeFileSync(
        path.join(output, `${spec.name}-${numbers}.png`),
        Buffer.from(cdp("Page.captureScreenshot").data, "base64"),
      );
    }
  }
} finally {
  evaluate(
    async (original, notePath, created) => {
      app.plugins.plugins.bullet.settings.betterListsStyles =
        original.listStyles;
      const shiki = app.plugins.plugins["shiki-highlighter"];
      if (shiki && original.settings) {
        shiki.settings = original.settings;
        await shiki.reloadHighlighter();
      }
      if (!original.shiki && shiki)
        await app.plugins.disablePlugin("shiki-highlighter");
      if (original.file)
        await app.workspace
          .getLeaf(false)
          .openFile(app.vault.getAbstractFileByPath(original.file));
      const file = app.vault.getAbstractFileByPath(notePath);
      if (created && file) await app.vault.delete(file);
    },
    original,
    notePath,
    created,
  );
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify({ results, failures }, null, 2),
  );
}
assert.deepEqual(failures, []);
console.log(`PASS: ${results.length} preview, copy, and source checks`);
