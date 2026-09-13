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
const originalFile = evaluate(() => {
  if (!document.body.classList.contains("bullet-plugin-better-lists"))
    throw Error(
      "Bullet list styles must be active before renderer verification",
    );
  return app.workspace.getActiveFile()?.path;
});
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
  // Electron can lose foreground focus while CLI checks run. Keep focus events
  // deterministic so a selected code block actually exposes its source.
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
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
        window.focus();
        const editor = app.workspace.activeLeaf.view.editor;
        editor.focus();
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
          const bullet = start.querySelector(".list-bullet");
          let firstCodeRect = null;
          if (embed) {
            const code =
              embed.querySelector(".ec-line .code") ??
              embed.querySelector("code");
            const walker = document.createTreeWalker(
              code,
              NodeFilter.SHOW_TEXT,
            );
            let node;
            while ((node = walker.nextNode())) {
              if (!node.textContent.trim()) continue;
              const range = document.createRange();
              range.selectNodeContents(node);
              firstCodeRect = range.getClientRects()[0];
              break;
            }
          }
          const nativeBody = line(body);
          const nativeContent = nativeBody?.querySelector(
            ".bullet-plugin-nested-code-block-content",
          );
          const nativePreview =
            !embed &&
            start.querySelector(".code-block-flair") &&
            !start.querySelector(".cm-hmd-codeblock");
          return {
            nativePreview: nativePreview
              ? {
                  bulletCenter: rect(bullet).y + rect(bullet).height / 2,
                  textCenter:
                    rect(nativeContent).y + rect(nativeContent).height / 2,
                  fenceHeight: rect(start).height + rect(line(body + 1)).height,
                }
              : null,
            opening,
            preview: embed
              ? {
                  bulletCenter: rect(bullet).y + rect(bullet).height / 2,
                  textCenter: firstCodeRect.y + firstCodeRect.height / 2,
                  embedLeft: rect(embed).x,
                  codeLeft: rect(embed.querySelector("pre")).x,
                  embedWidth: rect(embed).width,
                  codeWidth: rect(embed.querySelector("pre")).width,
                  guideHeight: parseFloat(
                    getComputedStyle(
                      start.querySelector(".cm-indent"),
                      "::before",
                    ).height,
                  ),
                  embedHeight: rect(embed).height,
                  lineNumbers: embed.querySelectorAll(".ln").length,
                }
              : null,
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
        lineNumbers:
          app.plugins.plugins["shiki-highlighter"]?.loadedSettings
            .ecDefaultShowLineNumbers ?? false,
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
      if (entry.nativePreview) {
        check(
          Math.abs(
            entry.nativePreview.bulletCenter - entry.nativePreview.textCenter,
          ) < 1,
          `${label}: native bullet shares first code line`,
        );
        check(
          entry.nativePreview.fenceHeight === 0,
          `${label}: hidden native fences leave no guide gaps`,
        );
      }
      if (entry.preview) {
        const p = entry.preview;
        check(
          p.lineNumbers > 0 === sample.lineNumbers,
          `${label}: line number configuration is rendered`,
        );
        check(
          Math.abs(p.bulletCenter - p.textCenter) < 1,
          `${label}: bullet shares first code line`,
        );
        check(
          Math.abs(p.embedLeft - p.codeLeft) < 1 &&
            Math.abs(p.embedWidth - p.codeWidth) < 1,
          `${label}: hover outline fits the code background`,
        );
        check(
          Math.abs(p.guideHeight - p.embedHeight) < 1,
          `${label}: native guide spans preview in indentation area`,
        );
      }
      const shouldPreview = !(
        phase.includes("editing") && entry.opening === offset + 6
      );
      if (sample.shiki)
        check(
          entry.embedded === shouldPreview,
          `${label}: expected preview/editing mode`,
        );
      else {
        check(!entry.embedded, `${label}: native renderer is active`);
        check(
          !!entry.nativePreview === shouldPreview,
          `${label}: expected native preview/editing mode`,
        );
      }
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
  // Empty native fences have no body line to own their height. Also exercise
  // ordered markers and multi-line previews independently of gutter settings.
  const edgeText = [
    "- parent",
    "\t- ```js",
    "\t  ```",
    "\t- after empty",
    "\t1. ```js",
    "\t   const first = 1",
    "\t   const second = 2",
    "\t   const third = 3",
    "\t   ```",
    "\t2. after ordered",
    "\t- ```",
    "\t  plain content",
    "\t  ```",
    "\t- after plain",
    "",
    "end",
  ].join("\n");
  evaluate((text) => {
    window.focus();
    const editor = app.workspace.activeLeaf.view.editor;
    editor.setValue(text);
    editor.focus();
    editor.setCursor({ line: 15, ch: 3 });
    editor.scrollIntoView(
      { from: { line: 0, ch: 0 }, to: { line: 15, ch: 3 } },
      true,
    );
  }, edgeText);
  const edges = evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const cm = app.workspace.activeLeaf.view.editor.cm;
    const line = (n) =>
      [...cm.contentDOM.querySelectorAll(".cm-line")].find(
        (e) => cm.state.doc.lineAt(cm.posAtDOM(e)).number === n,
      );
    const bounds = (e) => e.getBoundingClientRect();
    const entries = [
      [2, 4],
      [5, 10],
      [11, 14],
    ].map(([n, sibling]) => {
      const opening = line(n);
      const next = opening.nextElementSibling;
      const embedded = next.matches(".cm-preview-code-block");
      const marker =
        opening.querySelector(".list-bullet") ??
        opening.querySelector(".cm-formatting-list");
      const code = embedded
        ? (next.querySelector(".ec-line .code") ?? next.querySelector("code"))
        : next.querySelector(".bullet-plugin-nested-code-block-content");
      let first;
      if (code) {
        const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const r = range.getClientRects()[0];
          if (r?.height) {
            first = r;
            break;
          }
        }
      }
      const r = bounds(marker);
      return {
        opening: n,
        embedded,
        height: bounds(line(sibling)).top - bounds(opening).top,
        markerBottom: r.bottom,
        nextTop: bounds(line(sibling)).top,
        markerCenter: r.top + r.height / 2,
        codeCenter: first ? first.top + first.height / 2 : null,
        guideHeight: parseFloat(
          getComputedStyle(opening.querySelector(".cm-indent"), "::before")
            .height,
        ),
        embedHeight: embedded ? bounds(next).height : null,
      };
    });
    const plugin = cm.plugins.map((p) => p.value).find((p) => p?.styledLines);
    const original = plugin.measureLines;
    let idleMeasures = 0;
    plugin.measureLines = function (...args) {
      idleMeasures++;
      return original.apply(this, args);
    };
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      plugin.measureLines = original;
    }
    return { entries, idleMeasures, text: cm.state.doc.toString() };
  });
  results.push({ phase: "empty-and-ordered", ...edges });
  check(edges.text === edgeText, "edge cases: document preserved");
  check(
    edges.idleMeasures === 0,
    "edge cases: preview measurements settle while idle",
  );
  for (const e of edges.entries) {
    check(
      e.height > 0 && e.markerBottom <= e.nextTop,
      `edge case ${e.opening}: no overlap with next item`,
    );
    if (e.opening !== 2)
      check(
        e.codeCenter !== null && Math.abs(e.markerCenter - e.codeCenter) < 1,
        "ordered multiline: marker shares first code line",
      );
    if (e.embedded)
      check(
        Math.abs(e.guideHeight - e.embedHeight) < 1,
        `edge case ${e.opening}: guide spans whole preview`,
      );
  }
  fs.writeFileSync(
    path.join(output, "empty-and-ordered.png"),
    Buffer.from(
      cdp("Page.captureScreenshot", { format: "png" }).data,
      "base64",
    ),
  );
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify({ results, failures }, null, 2),
  );
  console.log(JSON.stringify({ output, failures }, null, 2));
  assert.equal(failures.length, 0, "Nested code layout regressions");
} finally {
  try {
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
  } finally {
    cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
  }
}
