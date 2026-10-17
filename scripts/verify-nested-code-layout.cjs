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
  "\t\t\tconst b = 2",
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
    ["preview-hover", 13, 0],
    ["editing", 6, 0],
    ["editing-hover", 6, 0],
    ["preview-again", 13, 0],
    ...(long
      ? [
          ["bottom", lastBlock + 13, lastBlock],
          ["bottom-editing", lastBlock + 6, lastBlock],
          ["back-at-top", 13, 0],
        ]
      : []),
  ]) {
    cdp("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 1,
      y: 1,
    });
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
    if (phase.includes("hover")) {
      const target = evaluate(async (lineNumber) => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const cm = app.workspace.activeLeaf.view.editor.cm;
        const line = [...cm.contentDOM.querySelectorAll(".cm-line")].find(
          (element) =>
            cm.state.doc.lineAt(cm.posAtDOM(element)).number === lineNumber,
        );
        const guides = line?.querySelectorAll(".cm-indent") ?? [];
        const guide = guides[guides.length - 1];
        if (!guide) throw Error(`Missing hover guide on line ${lineNumber}`);
        const bounds = guide.getBoundingClientRect();
        return {
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2,
        };
      }, offset + 9);
      cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...target });
    }
    const sample = evaluate(async (offset) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const cm = app.workspace.activeLeaf.view.editor.cm;
      const line = (n) =>
        [...cm.contentDOM.querySelectorAll(".cm-line")].find(
          (e) => cm.state.doc.lineAt(cm.posAtDOM(e)).number === n,
        );
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
      const rect = (e) => e?.getBoundingClientRect();
      const guides = (e) =>
        [...e.querySelectorAll(".cm-indent")].map((e) => {
          const box = rect(e);
          const paint = getComputedStyle(e, "::before");
          const clipValues = paint.clipPath
            .match(/^inset\(([^)]+)\)$/)?.[1]
            .trim()
            .split(/\s+/)
            .map((value) => Number.parseFloat(value));
          const clipTop = clipValues?.[0] ?? 0;
          const clipBottom =
            clipValues?.length === 2
              ? clipValues[0]
              : (clipValues?.[2] ?? clipTop);
          const paintTop =
            box.top + (Number.parseFloat(paint.insetBlockStart) || 0);
          const paintHeight = Number.parseFloat(paint.height) || box.height;
          const backgroundPaint =
            paint.backgroundColor !== "transparent" &&
            paint.backgroundColor !== "rgba(0, 0, 0, 0)";
          return {
            className: e.className,
            x: box.x,
            width: box.width,
            margin: Number.parseFloat(paint.marginInlineStart),
            paintX:
              box.x +
              Number.parseFloat(paint.marginInlineStart) +
              Number.parseFloat(paint.borderInlineStartWidth || "0") / 2,
            paintTop: paintTop + clipTop,
            paintBottom: paintTop + paintHeight - clipBottom,
            paintThickness: Math.max(
              Number.parseFloat(paint.borderInlineEndWidth) || 0,
              backgroundPaint ? Number.parseFloat(paint.width) || 0 : 0,
            ),
            paintVisible:
              paint.content !== "none" &&
              paint.display !== "none" &&
              paint.visibility !== "hidden" &&
              Number.parseFloat(paint.opacity || "1") > 0,
            owner: !!e.closest(".bullet-plugin-code-owner-prefix"),
          };
        });
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
                  bulletCenter:
                    paintedMarkerBounds(bullet).y +
                    paintedMarkerBounds(bullet).height / 2,
                  textCenter:
                    rect(nativeContent).y + rect(nativeContent).height / 2,
                  openingHeight: rect(start).height,
                  closingHeight: rect(line(body + 1)).height,
                }
              : null,
            opening,
            preview: embed
              ? {
                  bulletCenter:
                    paintedMarkerBounds(bullet).y +
                    paintedMarkerBounds(bullet).height / 2,
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
                  previewBottom: rect(embed).bottom,
                  openingTop: rect(start).top,
                  lineNumbers: embed.querySelectorAll(".ln").length,
                }
              : null,
            embedded: !!embed,
            bullet: rect(start.querySelector(".list-bullet"))?.x,
            bulletCenter:
              paintedMarkerBounds(bullet).x +
              paintedMarkerBounds(bullet).width / 2,
            bulletCenterY:
              paintedMarkerBounds(bullet).y +
              paintedMarkerBounds(bullet).height / 2,
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
        dpr: devicePixelRatio,
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
          entry.nativePreview.openingHeight > 0 &&
            entry.nativePreview.closingHeight > 0,
          `${label}: native fences retain navigable line boxes`,
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
          p.openingTop + p.guideHeight >= p.previewBottom - 0.6,
          `${label}: native guide covers preview in indentation area`,
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
        for (const siblingGuide of entry.siblingGuides.filter(
          (guide) => guide.paintVisible,
        )) {
          const openingGuide = entry.guides.find(
            (guide) =>
              guide.paintVisible &&
              Math.abs(guide.paintX - siblingGuide.paintX) < 0.6,
          );
          check(
            kind === "opening"
              ? openingGuide
              : guides.some(
                  (guide) =>
                    guide.paintVisible &&
                    Math.abs(guide.paintX - siblingGuide.paintX) < 0.6,
                ),
            `${label}: ${kind} ancestor guide at ${siblingGuide.paintX}px`,
          );
          if (kind !== "opening" || !openingGuide) continue;
          check(
            openingGuide.paintBottom >= siblingGuide.paintTop - 0.6,
            `${label}: ancestor guide at ${siblingGuide.paintX}px covers the code card through its next sibling`,
          );
          check(
            openingGuide.paintBottom <= siblingGuide.paintTop + 0.6,
            `${label}: ancestor guide at ${siblingGuide.paintX}px stops at its next sibling`,
          );
          check(
            Math.abs(openingGuide.paintBottom - siblingGuide.paintTop) < 0.02,
            `${label}: ancestor guide at ${siblingGuide.paintX}px has a non-overlapping seam`,
          );
          check(
            Math.abs(
              openingGuide.paintBottom * sample.dpr -
                Math.round(openingGuide.paintBottom * sample.dpr),
            ) < 0.02,
            `${label}: ancestor guide at ${siblingGuide.paintX}px ends on a device-pixel boundary`,
          );
          check(
            Math.abs(
              openingGuide.paintThickness - siblingGuide.paintThickness,
            ) < 0.1,
            `${label}: ancestor guide at ${siblingGuide.paintX}px keeps one thickness across the code card`,
          );
        }
      }
      if (entry.opening === offset + 6 && entry.nativePreview) {
        check(
          !entry.bodyGuides?.some(
            (guide) =>
              guide.paintVisible &&
              Math.abs(guide.paintX - entry.bulletCenter) < 3,
          ),
          `${label}: code continuation guide paint is hidden in preview`,
        );
      }
      if (entry.opening === offset + 6 && phase.includes("editing")) {
        const ownerGuide = entry.bodyGuides?.find(
          (guide) =>
            guide.owner &&
            guide.paintVisible &&
            Math.abs(guide.paintX - entry.bulletCenter) < 3,
        );
        check(
          ownerGuide,
          `${label}: code continuation guide paint is restored while editing`,
        );
        check(
          ownerGuide?.paintTop >= entry.bulletCenterY - 0.6,
          `${label}: code continuation guide starts at the bullet center while editing`,
        );
        check(
          ownerGuide?.paintBottom > entry.bulletCenterY + 0.6,
          `${label}: code continuation guide continues below the bullet while editing`,
        );
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
  evaluate(
    (text, notePath) => {
      window.focus();
      const leaf = app.workspace
        .getLeavesOfType("markdown")
        .find((leaf) => leaf.view.file?.path === notePath);
      const editor = leaf?.view.editor;
      if (!editor) throw Error(`Missing verifier note editor for ${notePath}`);
      app.workspace.setActiveLeaf(leaf, { focus: true });
      editor.setValue(text);
      editor.focus();
      editor.setCursor({ line: 15, ch: 3 });
      editor.scrollIntoView(
        { from: { line: 0, ch: 0 }, to: { line: 15, ch: 3 } },
        true,
      );
    },
    edgeText,
    notePath,
  );
  const edges = evaluate(async (notePath) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const leaf = app.workspace
      .getLeavesOfType("markdown")
      .find((leaf) => leaf.view.file?.path === notePath);
    const editor = leaf?.view.editor;
    if (!editor) throw Error(`Missing verifier note editor for ${notePath}`);
    const cm = editor.cm;
    const line = (n) =>
      [...cm.contentDOM.querySelectorAll(".cm-line")].find(
        (e) => cm.state.doc.lineAt(cm.posAtDOM(e)).number === n,
      );
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
        opening.querySelector(".list-number") ??
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
      const r = paintedMarkerBounds(marker);
      const guidePaint = (guide) => {
        const box = bounds(guide);
        const paint = getComputedStyle(guide, "::before");
        const clipTop =
          parseFloat(paint.clipPath.match(/^inset\(([^ )]+)/)?.[1]) || 0;
        const top =
          box.top + (parseFloat(paint.insetBlockStart) || 0) + clipTop;
        return {
          x:
            box.x +
            (parseFloat(paint.marginInlineStart) || 0) +
            (parseFloat(paint.borderInlineStartWidth) || 0) / 2,
          top,
          bottom: top + (parseFloat(paint.height) || box.height),
        };
      };
      const siblingGuides = [
        ...line(sibling).querySelectorAll(".cm-indent"),
      ].map(guidePaint);
      const indentDiagnostics = (element) =>
        [...element.querySelectorAll(".cm-indent")].map((guide) => {
          const rect = bounds(guide);
          return {
            x: rect.x,
            top: rect.top,
            height: rect.height,
            className: guide.className,
            parentClass: guide.parentElement?.className ?? "",
          };
        });
      const guideSpans = [...opening.querySelectorAll(".cm-indent")].flatMap(
        (guide) => {
          const paint = guidePaint(guide);
          const continuation = siblingGuides.find(
            (candidate) => Math.abs(candidate.x - paint.x) < 0.6,
          );
          return continuation
            ? [{ bottom: paint.bottom, nextTop: continuation.top }]
            : [];
        },
      );
      return {
        opening: n,
        embedded,
        height: bounds(line(sibling)).top - bounds(opening).top,
        markerBottom: r.bottom,
        nextTop: bounds(line(sibling)).top,
        markerCenter: r.top + r.height / 2,
        codeCenter: first ? first.top + first.height / 2 : null,
        diagnostics: {
          openingClass: opening.className,
          siblingClass: line(sibling).className,
          openingIndents: indentDiagnostics(opening),
          siblingIndents: indentDiagnostics(line(sibling)),
          openingIndentHeight: getComputedStyle(opening).getPropertyValue(
            "--bullet-code-indent-guide-height",
          ),
          openingOuterHeight: getComputedStyle(opening).getPropertyValue(
            "--bullet-code-outer-guide-height",
          ),
          siblingIndentClip: getComputedStyle(line(sibling)).getPropertyValue(
            "--bullet-code-indent-guide-seam-clip",
          ),
          siblingOuterClip: getComputedStyle(line(sibling)).getPropertyValue(
            "--bullet-code-outer-guide-seam-clip",
          ),
        },
        guideSpans,
        previewBottom: embedded ? bounds(next).bottom : null,
        openingTop: bounds(opening).top,
      };
    });
    const plugin = cm.plugins
      .map((p) => p.value)
      .find((p) => typeof p?.measureLines === "function");
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
    return {
      entries,
      dpr: devicePixelRatio,
      idleMeasures,
      text: cm.state.doc.toString(),
    };
  }, notePath);
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
    if (e.embedded) {
      check(
        e.guideSpans.length > 0 &&
          e.guideSpans.every(
            (guide) =>
              guide.bottom >= e.previewBottom - 0.6 &&
              Math.abs(guide.bottom - guide.nextTop) < 0.02 &&
              Math.abs(
                guide.bottom * edges.dpr - Math.round(guide.bottom * edges.dpr),
              ) < 0.02,
          ),
        `edge case ${e.opening}: guide covers preview through its next sibling`,
      );
    }
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
