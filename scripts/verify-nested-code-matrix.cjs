// Additional release audit: same open note, real processors, independent
// marker/body shapes, and live settings transitions. Run serially, not with Jest.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const notePath = `nested-matrix-${randomUUID()}.md`;
const original = evaluate(() => ({
  file: app.workspace.getActiveFile()?.path,
  shiki: !!app.plugins.plugins["shiki-highlighter"],
  dpr: devicePixelRatio,
  leftCollapsed: app.workspace.leftSplit.collapsed,
  rightCollapsed: app.workspace.rightSplit.collapsed,
}));
assert.equal(
  original.shiki,
  false,
  "Start with Shiki disabled; installed fixture required",
);
const results = [],
  failures = [];
const cases = [
  { name: "blank-first", body: ["", "const a = 1", ""] },
  { name: "indent-only-first", body: [" ", "const a = 1", " "] },
  { name: "star", marker: "*", body: ["const a = 1"] },
  { name: "plus", marker: "+", body: ["const a = 1"] },
  { name: "ordered-multidigit", marker: "10.", body: ["const a = 1"] },
  { name: "tilde", fence: "~~~", body: ["const a = 1"] },
  { name: "four-backticks", fence: "````", body: ["const a = 1"] },
  { name: "terminal-frame", lang: "bash", body: ["echo hello"] },
  { name: "title-frame", lang: 'js title="example.js"', body: ["const a = 1"] },
  { name: "deep", indent: "\t\t\t\t", body: ["const a = 1"] },
  {
    name: "wrapped",
    width: 440,
    body: ["const value = '" + "long code ".repeat(20) + "';"],
  },
];
function screenshot(name) {
  fs.writeFileSync(
    path.join(output, name + ".png"),
    Buffer.from(
      cdp("Page.captureScreenshot", { format: "png" }).data,
      "base64",
    ),
  );
}
function configure(mode) {
  evaluate(async (mode) => {
    const id = "shiki-highlighter";
    if (mode === "native") {
      if (app.plugins.plugins[id]) await app.plugins.disablePlugin(id);
    } else {
      if (!app.plugins.plugins[id]) {
        await app.plugins.loadManifest(".obsidian/plugins/shiki-highlighter");
        await app.plugins.enablePlugin(id);
      }
      const plugin = app.plugins.plugins[id];
      plugin.settings.ecDefaultShowLineNumbers = mode === "numbers";
      plugin.settings.ecDefaultWrap = true;
      await plugin.reloadHighlighter();
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }, mode);
}
function renderCase(spec) {
  const marker = spec.marker ?? "-",
    indent = spec.indent ?? "\t";
  const fence = spec.fence ?? "```",
    lang = spec.lang ?? "js";
  const lines = ["- parent"];
  for (let n = 1; n < indent.length; n++)
    lines.push("\t".repeat(n) + "- ancestor");
  const opening = lines.length + 1;
  lines.push(indent + marker + " " + fence + lang);
  for (const body of spec.body)
    lines.push(
      body === "" ? "" : indent + " ".repeat(marker.length + 1) + body,
    );
  lines.push(indent + " ".repeat(marker.length + 1) + fence);
  const sibling = lines.length + 1;
  const siblingMarker = /^\d+\.$/.test(marker)
    ? `${parseInt(marker, 10) + 1}.`
    : marker;
  lines.push(indent + siblingMarker + " sibling", "", "end");
  const text = lines.join("\n");
  cdp("Emulation.setDeviceMetricsOverride", {
    width: spec.width ?? 1100,
    height: 900,
    deviceScaleFactor: original.dpr,
    mobile: false,
  });
  evaluate((text) => {
    const ed = app.workspace.activeLeaf.view.editor;
    ed.setValue(text);
    ed.focus();
    ed.setCursor({ line: ed.lineCount() - 1, ch: 3 });
    ed.scrollIntoView(
      { from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } },
      true,
    );
  }, text);
  return { opening, sibling, text };
}
function sample(label, fixture, mode) {
  const value = evaluate(async ({ opening, sibling }) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const cm = app.workspace.activeLeaf.view.editor.cm;
    const line = (n) =>
      [...cm.contentDOM.querySelectorAll(".cm-line")].find(
        (e) => cm.state.doc.lineAt(cm.posAtDOM(e)).number === n,
      );
    const start = line(opening),
      after = line(sibling);
    if (!start || !after)
      return { missing: true, text: cm.state.doc.toString() };
    const next = start.nextElementSibling;
    const embed = next?.matches(".cm-preview-code-block") ? next : null;
    const rect = (e) => e?.getBoundingClientRect();
    const marker =
      start.querySelector(".list-bullet") ??
      start.querySelector(".list-number") ??
      start.querySelector(".cm-formatting-list");
    const firstRow = embed?.querySelector(".ec-line") ?? next;
    const content =
      embed?.querySelector(".ec-line .code") ??
      embed?.querySelector("code") ??
      next?.querySelector(".bullet-plugin-nested-code-block-content");
    let glyph;
    if (content) {
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const r = range.getClientRects()[0];
        if (r?.height) {
          glyph = r;
          break;
        }
      }
    }
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
    const mark = paintedMarkerBounds(marker),
      row = glyph ?? rect(firstRow),
      pre = embed?.querySelector("pre");
    const guides = (e) =>
      [...e.querySelectorAll(".cm-indent")].map((g) => ({
        x:
          rect(g).x +
          parseFloat(getComputedStyle(g, "::before").marginInlineStart),
        width: rect(g).width,
      }));
    return {
      text: cm.state.doc.toString(),
      nativePreview:
        !!start.querySelector(".code-block-flair") &&
        !start.querySelector(".cm-hmd-codeblock"),
      embedded: !!embed,
      markerCenter: mark?.y + mark?.height / 2,
      codeCenter: row?.y + row?.height / 2,
      glyph: !!glyph,
      firstRowHeight: rect(firstRow)?.height,
      guides: guides(start),
      siblingGuides: guides(after),
      inset: start.style.getPropertyValue("--bullet-nested-code-block-inset"),
      embedBounds: embed && { x: rect(embed).x, width: rect(embed).width },
      preBounds: pre && { x: rect(pre).x, width: rect(pre).width },
      numbers: embed?.querySelectorAll(".ln").length ?? 0,
      nextTop: rect(after).top,
      markerBottom: mark?.bottom,
      leaf: app.workspace.activeLeaf.id,
    };
  }, fixture);
  const found = [];
  if (value.text !== fixture.text) found.push("Markdown changed");
  if (value.missing) found.push("fixture missing from viewport");
  else {
    if (mode === "native" ? !value.nativePreview : !value.embedded)
      found.push("expected preview absent");
    if (Math.abs(value.markerCenter - value.codeCenter) >= 1)
      found.push(`marker Y delta ${value.markerCenter - value.codeCenter}`);
    if (!value.inset) found.push("nested inset absent");
    if (value.markerBottom > value.nextTop)
      found.push("marker overlaps sibling");
    value.siblingGuides.forEach((g, i) => {
      if (!value.guides[i] || Math.abs(value.guides[i].x - g.x) > 0.6)
        found.push(`guide ${i} X mismatch`);
    });
    if (value.embedded) {
      if (value.numbers > 0 !== (mode === "numbers"))
        found.push("line numbers state mismatch");
      if (
        Math.abs(value.embedBounds.x - value.preBounds.x) >= 1 ||
        Math.abs(value.embedBounds.width - value.preBounds.width) >= 1
      )
        found.push("hover host exceeds background");
    }
  }
  results.push({ label, mode, ...value, failures: found });
  failures.push(...found.map((f) => `${label}: ${f}`));
  screenshot(label);
}
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (name) => {
    app.workspace.leftSplit.collapse();
    app.workspace.rightSplit.collapse();
    await app.workspace
      .getLeaf(false)
      .openFile(await app.vault.create(name, "audit"));
  }, notePath);
  for (const mode of ["native", "plain", "numbers"]) {
    configure(mode);
    for (const spec of cases)
      sample(`${mode}-${spec.name}`, renderCase(spec), mode);
  }
  // The same exact document and editor stay open throughout processor changes.
  const live = renderCase({ name: "live", body: ["const value = 1"] });
  for (const mode of ["plain", "numbers", "native", "plain", "native"]) {
    configure(mode);
    sample(`live-${results.length}-${mode}`, live, mode);
  }
} finally {
  try {
    configure("native");
    evaluate(
      async (name, previous) => {
        const file = app.vault.getAbstractFileByPath(name);
        if (previous)
          await app.workspace.activeLeaf.openFile(
            app.vault.getAbstractFileByPath(previous),
          );
        if (file) await app.vault.trash(file, false);
      },
      notePath,
      original.file,
    );
  } finally {
    cdp("Emulation.clearDeviceMetricsOverride");
    evaluate((original) => {
      if (!original.leftCollapsed) app.workspace.leftSplit.expand();
      if (!original.rightCollapsed) app.workspace.rightSplit.expand();
    }, original);
    cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
    fs.writeFileSync(
      path.join(output, "results.json"),
      JSON.stringify({ results, failures }, null, 2),
    );
    console.log(
      JSON.stringify({ output, cases: results.length, failures }, null, 2),
    );
  }
}
assert.equal(failures.length, 0, "Additional renderer audit failures");
