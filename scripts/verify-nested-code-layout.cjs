// Run against the deployed test build, separately from other renderer tests.
// Repeat with Shiki Highlighter enabled to exercise native preview embeds.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: true });
const notePath = `nested-code-check-${randomUUID()}.md`;
const originalFile = evaluate(() => app.workspace.getActiveFile()?.path);
const block = [
  "- parent",
  "\t- ```js",
  "\t  const a = 1",
  "\t  ```",
  "\t- sibling",
  "\t\t- ```js",
  "\t\t  const b = 2",
  "\t\t  ```",
  "\t\t- deep sibling",
  "",
  "```js",
  "const outside = 3",
  "```",
  "",
].join("\n");
const long = process.argv.includes("--long");
const fixture = Array(long ? 30 : 1)
  .fill(block)
  .join("\n");
const lastBlock = long ? 29 * 14 : 0;
let expectedText = fixture;
const failures = [];
const results = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

try {
  evaluate(
    async (filePath, text) => {
      const file = await app.vault.create(filePath, text);
      await app.workspace.getLeaf(false).openFile(file);
    },
    notePath,
    fixture,
  );

  for (const [phase, cursorLine, offset] of [
    ["preview", 13, 0],
    ["editing", 6, 0],
    ["preview-again", 13, 0],
    ...(long
      ? [
          ["bottom", lastBlock + 13, lastBlock],
          ["bottom-editing", lastBlock + 6, lastBlock],
          ["back-at-top", 13, 0],
        ]
      : []),
  ]) {
    evaluate(
      (line, type) => {
        const editor = app.workspace.activeLeaf.view.editor;
        const ch = editor.getLine(line).length;
        editor.setCursor({ line, ch });
        if (type) editor.replaceSelection(" // typed");
        editor.scrollIntoView({ from: { line, ch }, to: { line, ch } }, true);
      },
      cursorLine,
      phase === "editing",
    );
    if (phase === "editing")
      expectedText = fixture.replace("const b = 2", "const b = 2 // typed");
    const sample = evaluate(async (offset) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const cm = app.workspace.activeLeaf.view.editor.cm;
      const line = (n) =>
        [...cm.contentDOM.querySelectorAll(".cm-line")].find(
          (e) => cm.state.doc.lineAt(cm.posAtDOM(e)).number === n,
        );
      const rect = (e) => e?.getBoundingClientRect();
      const guides = (e) =>
        [...e.querySelectorAll(".cm-indent")].map((e) => ({
          x: rect(e).x,
          width: rect(e).width,
          margin: Number.parseFloat(
            getComputedStyle(e, "::before").marginInlineStart,
          ),
        }));
      const entries = [
        [2, 3, 5],
        [6, 7, 9],
      ]
        .map((indices) => indices.map((n) => n + offset))
        .map(([opening, body, sibling]) => {
          const start = line(opening);
          const next = line(sibling);
          const embed = start.nextElementSibling?.matches(
            ".cm-preview-code-block",
          )
            ? start.nextElementSibling
            : null;
          return {
            opening,
            embedded: !!embed,
            bullet: rect(start.querySelector(".list-bullet"))?.x,
            siblingBullet: rect(next.querySelector(".list-bullet"))?.x,
            guides: guides(start),
            siblingGuides: guides(next),
            bodyGuides: line(body) ? guides(line(body)) : null,
            background: embed
              ? rect(embed.querySelector("pre") ?? embed.firstElementChild).x
              : rect(start).x +
                Number.parseFloat(
                  getComputedStyle(start, "::before").insetInlineStart,
                ),
            siblingContent: cm.coordsAtPos(
              cm.state.doc.line(sibling).from +
                cm.state.doc.line(sibling).text.indexOf("- ") +
                2,
            ).left,
            embedGuides:
              embed?.querySelectorAll(
                ".cm-indent,.bullet-plugin-outer-list-guide",
              ).length ?? 0,
            outer: rect(start.querySelector(".bullet-plugin-outer-list-guide"))
              ?.x,
            siblingOuter: rect(
              next.querySelector(".bullet-plugin-outer-list-guide"),
            )?.x,
          };
        });
      return {
        entries,
        shiki: !!app.plugins.plugins["shiki-highlighter"],
        text: cm.state.doc.toString(),
      };
    }, offset);
    results.push({ phase, ...sample });
    for (const entry of sample.entries) {
      const label = `${phase}, opening ${entry.opening}`;
      check(
        Math.abs(entry.bullet - entry.siblingBullet) < 0.6,
        `${label}: bullet alignment`,
      );
      check(
        Math.abs(entry.outer - entry.siblingOuter) < 0.6,
        `${label}: outer guide alignment`,
      );
      check(
        Math.abs(entry.background - entry.siblingContent) < 1,
        `${label}: background starts at list content`,
      );
      check(
        entry.embedGuides === 0,
        `${label}: no guides inside preview embed`,
      );
      if (sample.shiki)
        check(
          entry.embedded ===
            !(phase.includes("editing") && entry.opening === offset + 6),
          `${label}: expected preview/editing mode`,
        );
      for (const [kind, guides] of [
        ["opening", entry.guides],
        ["body", entry.bodyGuides],
      ]) {
        if (!guides) continue;
        for (let i = 0; i < entry.siblingGuides.length; i++) {
          const a = guides[i],
            b = entry.siblingGuides[i];
          check(
            a &&
              Math.abs(a.x + a.margin - b.x - b.margin) < 0.6 &&
              Math.abs(a.width - b.width) < 0.6,
            `${label}: ${kind} guide ${i} alignment`,
          );
        }
      }
    }
    check(
      sample.text === expectedText,
      `${phase}: only the intended code edit changes the document`,
    );
    const screenshot = cdp("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(output, `${phase}.png`),
      Buffer.from(screenshot.data, "base64"),
    );
  }
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify({ results, failures }, null, 2),
  );
  console.log(JSON.stringify({ output, failures }, null, 2));
  assert.equal(failures.length, 0, "Nested code layout regressions");
} finally {
  evaluate(
    async (filePath, previousPath) => {
      if (previousPath) {
        const previous = app.vault.getAbstractFileByPath(previousPath);
        if (previous) await app.workspace.activeLeaf.openFile(previous);
      }
      const fixture = app.vault.getAbstractFileByPath(filePath);
      if (fixture) await app.vault.trash(fixture, false);
    },
    notePath,
    originalFile,
  );
}
