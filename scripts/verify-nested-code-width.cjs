// Run serially against the deployed test build, with Shiki installed.
// Geometry assertions use real rendered text, including native font fallback.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

if (!process.argv[2])
  throw Error(
    "Usage: node scripts/verify-nested-code-width.cjs <fresh-output-directory> [--mode=native|plain|numbers] [--case=short|language|unicode|indent|partial-tab|empty|wrapped|editing|offscreen]",
  );
const output = path.resolve(process.argv[2]);
if (fs.existsSync(output)) throw Error("Use a fresh output directory");
fs.mkdirSync(output, { recursive: true });
const option = (name) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const selectedMode = option("mode");
const selectedCase = option("case");
const modes = ["native", "plain", "numbers"].filter(
  (mode) => !selectedMode || mode === selectedMode,
);
assert.ok(modes.length, "Unknown mode");
const notePath = `nested-code-width-${randomUUID()}.md`;
const results = [];
const failures = [];
let created = false;
let savedShikiSettings;
const original = evaluate(() => ({
  viewState: app.workspace.activeLeaf.getViewState(),
  cursor: app.workspace.activeLeaf.view.editor?.getCursor(),
  scroll: app.workspace.activeLeaf.view.editor?.getScrollInfo(),
  shiki: !!app.plugins.plugins["shiki-highlighter"],
  shikiSettings: app.plugins.plugins["shiki-highlighter"]?.settings,
  dpr: devicePixelRatio,
  left: app.workspace.leftSplit.collapsed,
  right: app.workspace.rightSplit.collapsed,
  listStyles: app.plugins.plugins.bullet.settings.betterListsStyles,
}));
savedShikiSettings = original.shikiSettings;
assert.equal(original.listStyles, true, "Enable Bullet list styles first");

// The shared transport checks vault path, desktop mode, and tab configuration.
// Focus/title/visibility are checked freshly inside every additional call.
function run(fn, ...args) {
  const guarded = new Function(
    "...args",
    `window.focus();
     if (!/\\bvault\\b/.test(document.title) || /\\bbase\\b/.test(document.title) ||
         document.visibilityState !== "visible") throw Error("Visible test vault guard");
     return (${fn.toString()})(...args);`,
  );
  return evaluate(guarded, ...args);
}
function check(condition, label, message) {
  if (!condition) failures.push(`${label}: ${message}`);
}
function screenshot(label) {
  fs.writeFileSync(
    path.join(output, `${label}.png`),
    Buffer.from(
      cdp("Page.captureScreenshot", { format: "png" }).data,
      "base64",
    ),
  );
}
function configure(mode) {
  const settings = run(async (mode) => {
    const id = "shiki-highlighter";
    if (mode === "native") {
      if (app.plugins.plugins[id]) await app.plugins.disablePlugin(id);
      return null;
    }
    if (!app.plugins.plugins[id]) {
      await app.plugins.loadManifest(".obsidian/plugins/shiki-highlighter");
      await app.plugins.enablePlugin(id);
    }
    const shiki = app.plugins.plugins[id];
    if (!shiki) throw Error("Installed Shiki fixture required");
    const before = JSON.parse(JSON.stringify(shiki.settings));
    shiki.settings.ecDefaultShowLineNumbers = mode === "numbers";
    shiki.settings.ecDefaultWrap = true;
    await shiki.reloadHighlighter();
    await new Promise((resolve) => setTimeout(resolve, 450));
    return before;
  }, mode);
  if (!savedShikiSettings && settings) savedShikiSettings = settings;
}
function makeFixture(spec, mode = "native") {
  const prefix = spec.prefix ?? "\t";
  const parents = ["- parent"];
  for (let level = 1; level < prefix.length; level++)
    parents.push("\t".repeat(level) + "- ancestor");
  const opening = parents.length + 1;
  const container = prefix + "  ";
  const raw =
    spec.raw ?? spec.body.map((line) => (line ? container + line : ""));
  // Shiki leaves language-less fences in native rendering in this fixture.
  const language = spec.language ?? (mode === "native" ? "" : "js");
  const lines = [
    ...parents,
    prefix + "- ```" + language,
    ...raw,
    container + (spec.closingFence ?? "```"),
    "- tail",
  ];
  return {
    name: spec.name,
    text: lines.join("\n"),
    opening,
    firstBody: opening + 1,
    closing: opening + raw.length + 1,
    tail: lines.length,
    contentColumn: prefix.length * 4 + 2,
    width: spec.width ?? 1100,
    compact: spec.compact !== false,
    empty: raw.length === 0,
    language,
  };
}
function load(fixture) {
  cdp("Emulation.setDeviceMetricsOverride", {
    width: fixture.width,
    height: 800,
    deviceScaleFactor: original.dpr,
    mobile: false,
  });
  run(async (fixture) => {
    const editor = app.workspace.activeLeaf.view.editor;
    editor.setValue(fixture.text);
    editor.focus();
    editor.setCursor({ line: fixture.tail - 1, ch: 6 });
    editor.scrollIntoView(
      { from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } },
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 650));
  }, fixture);
}
function sample(
  label,
  fixture,
  mode,
  { editing = false, compact = fixture.compact, visibleOnly = false } = {},
) {
  const sample = run(
    async ({ fixture, visibleOnly }) => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      const cm = app.workspace.activeLeaf.view.editor.cm;
      const box = (element) => {
        if (!element) return null;
        const { left, right, top, bottom, width, height } =
          element.getBoundingClientRect();
        return { left, right, top, bottom, width, height };
      };
      const viewport = box(cm.scrollDOM);
      const visible = (bounds) =>
        bounds.bottom > viewport.top && bounds.top < viewport.bottom;
      const rangeBoxes = (range) =>
        [...range.getClientRects()]
          .filter((r) => r.width > 0 && r.height > 0)
          .map(({ left, right, top, bottom }) => ({
            left,
            right,
            top,
            bottom,
          }));
      const codeOffset = (text) => {
        let offset = 0,
          column = 0;
        while (
          offset < text.length &&
          column < fixture.contentColumn &&
          /[ \t]/.test(text[offset])
        ) {
          column += text[offset] === "\t" ? 4 - (column % 4) : 1;
          offset++;
        }
        return offset;
      };
      const rows = [...cm.contentDOM.querySelectorAll(".cm-line")].flatMap(
        (element) => {
          const line = cm.state.doc.lineAt(cm.posAtDOM(element));
          if (line.number < fixture.opening || line.number > fixture.closing)
            return [];
          const bounds = box(element);
          const css = getComputedStyle(element, "::before");
          const width = parseFloat(css.width);
          const left = Number.isFinite(parseFloat(css.left))
            ? bounds.left + parseFloat(css.left)
            : bounds.right - parseFloat(css.right) - width;
          const body =
            line.number >= fixture.firstBody && line.number < fixture.closing;
          let glyphs = [];
          if (body && line.text.trim()) {
            const from = cm.domAtPos(line.from + codeOffset(line.text));
            const to = cm.domAtPos(line.to);
            if (element.contains(from.node) && element.contains(to.node)) {
              const range = document.createRange();
              range.setStart(from.node, from.offset);
              range.setEnd(to.node, to.offset);
              glyphs = rangeBoxes(range);
            }
          }
          const flair = element.querySelector(".code-block-flair");
          const flairStyle = flair && getComputedStyle(flair);
          const fenceGlyphs =
            !body && bounds.height > 0
              ? [...element.querySelectorAll(".cm-hmd-codeblock")].flatMap(
                  (fence) => {
                    const range = document.createRange();
                    range.selectNodeContents(fence);
                    return rangeBoxes(range);
                  },
                )
              : [];
          return [
            {
              line: line.number,
              text: line.text,
              body,
              bounds,
              visible: visible(bounds),
              styled: element.classList.contains(
                "bullet-plugin-nested-code-block",
              ),
              painted: css.content !== "none" && css.content !== "normal",
              background: { left, right: left + width, width },
              glyphs,
              fenceGlyphs,
              rawFence: !!element.querySelector(".cm-hmd-codeblock"),
              flair:
                flair &&
                flairStyle.display !== "none" &&
                flairStyle.visibility !== "hidden"
                  ? box(flair)
                  : null,
            },
          ];
        },
      );
      const embed = [
        ...cm.contentDOM.querySelectorAll(".cm-preview-code-block"),
      ].find(
        (e) => cm.state.doc.lineAt(cm.posAtDOM(e)).number === fixture.opening,
      );
      const pre = embed?.querySelector("pre");
      const ecRows = [...(embed?.querySelectorAll(".ec-line .code") ?? [])].map(
        (element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return {
            text: element.textContent,
            bounds: box(element),
            glyphs: rangeBoxes(range),
          };
        },
      );
      return {
        text: cm.state.doc.toString(),
        visibility: document.visibilityState,
        viewport,
        content: box(cm.contentDOM),
        opening: rows.find((row) => row.line === fixture.opening),
        rows: rows.filter((row) => !visibleOnly || row.visible),
        embed: embed && {
          bounds: box(embed),
          pre: box(pre),
          rows: ecRows,
          numbers: embed.querySelectorAll(".ln").length,
        },
      };
    },
    { fixture, visibleOnly },
  );
  const startFailures = failures.length;
  check(sample.text === fixture.text, label, "Markdown changed unexpectedly");
  check(sample.visibility === "visible", label, "renderer is hidden");
  check(
    Boolean(sample.embed) === (mode !== "native" && !editing),
    label,
    "unexpected renderer mode",
  );
  let background;
  let glyphs;
  if (sample.embed) {
    const { bounds, pre, numbers, rows } = sample.embed;
    check(!!pre, label, "Shiki pre is missing");
    check(
      pre &&
        Math.abs(bounds.left - pre.left) < 1 &&
        Math.abs(bounds.width - pre.width) < 1,
      label,
      "Shiki hover host and pre differ",
    );
    check(
      rows.length > 0 || fixture.empty,
      label,
      "nonempty Shiki block has no code rows",
    );
    check(
      numbers === (mode === "numbers" ? rows.length : 0),
      label,
      "line number state differs",
    );
    background = pre;
    glyphs = rows.flatMap((row) => row.glyphs);
  } else {
    const bodies = sample.rows.filter(
      (row) => row.body && row.bounds.height > 0,
    );
    const painted = bodies.length
      ? bodies
      : sample.rows.filter((row) => row.bounds.height > 0);
    check(painted.length > 0, label, "no native rows to measure");
    check(
      painted.every((row) => row.styled && row.painted),
      label,
      "native background missing",
    );
    background = painted[0]?.background;
    check(
      painted.every(
        (row) =>
          Math.abs(row.background.width - background.width) < 1 &&
          Math.abs(row.background.right - background.right) < 1,
      ),
      label,
      "native rows have different background widths",
    );
    glyphs = bodies.flatMap((row) => row.glyphs);
    if (editing) {
      const fenceRows = sample.rows.filter((row) => !row.body && row.rawFence);
      check(
        fenceRows.some(
          (row) => row.line === fixture.closing && row.fenceGlyphs.length > 0,
        ),
        label,
        "visible closing fence text was not measured",
      );
      for (const row of fenceRows)
        check(
          row.fenceGlyphs.length > 0 &&
            row.fenceGlyphs.every(
              (rect) => rect.right <= row.background.right + 1,
            ),
          label,
          `visible fence on line ${row.line} exceeds its background`,
        );
      glyphs.push(...fenceRows.flatMap((row) => row.fenceGlyphs));
    }
  }
  check(
    background && Number.isFinite(background.width) && background.width > 0,
    label,
    "invalid background bounds",
  );
  check(
    background && background.right <= sample.content.right + 1,
    label,
    "background exceeds editor content width",
  );
  if (background)
    check(
      glyphs.every((rect) => rect.right <= background.right + 1),
      label,
      "rendered code extends beyond its background",
    );
  if (fixture.name === "wrapped")
    check(
      background && background.right >= sample.content.right - 24,
      label,
      "long code does not use the available pane width",
    );
  if (compact && glyphs.length && background) {
    const end = Math.max(...glyphs.map((r) => r.right));
    const gap = background.right - end;
    const flair = sample.opening?.flair;
    const adjacentText = flair
      ? glyphs.filter(
          (rect) => rect.top < flair.bottom && rect.bottom > flair.top,
        )
      : [];
    const adjacentEnd = adjacentText.length
      ? Math.max(...adjacentText.map((rect) => rect.right))
      : end;
    // Native copy controls exist even without a language label. Allow their
    // independently measured width beside the rows its actual height covers:
    // a wider later row already supplies some or all of that room. An absent editing flair
    // provides no allowance, and measuring its width cannot excuse an
    // arbitrary gap between the text and a control at the full editor edge.
    const flairWidth = flair?.width ?? 0;
    const maximum = sample.embed
      ? 70
      : 24 + Math.max(0, adjacentEnd + flairWidth - end);
    check(
      gap >= -1 && gap <= maximum,
      label,
      `background trailing gap ${gap.toFixed(2)}px is outside 0–${maximum}px`,
    );
    sample.trailingGap = gap;
    sample.allowedTrailingGap = maximum;
  }
  if (!sample.embed && !editing && sample.opening?.flair && background) {
    const flair = sample.opening.flair;
    check(
      flair.left >= background.left - 1 && flair.right <= background.right + 1,
      label,
      "native flair exceeds fitted background",
    );
    if (compact)
      check(
        !glyphs.some(
          (r) =>
            r.left < flair.right &&
            r.right > flair.left &&
            r.top < flair.bottom &&
            r.bottom > flair.top,
        ),
        label,
        "native flair overlaps code text",
      );
  }
  if (fixture.empty)
    check(
      background && background.width <= (sample.embed ? 180 : 120),
      label,
      `empty block is unnecessarily wide (${background?.width}px)`,
    );
  sample.background = background;
  sample.failures = failures.slice(startFailures);
  results.push({ label, mode, editing, ...sample });
  screenshot(label);
  return sample;
}

const cases = [
  { name: "short", body: ["const a = 1;", "a;"] },
  { name: "language", language: "js", body: ["const a = 1;", "a;"] },
  { name: "unicode", body: ["// 日本語 👩‍💻", "const emoji = '😀';"] },
  { name: "indent", body: ["  if (ready) {", "\twork();", "  }"] },
  {
    name: "partial-tab",
    prefix: "",
    raw: ["\tconsole.log('tabs');", "\t  nested();"],
  },
  { name: "empty", body: [] },
  { name: "deep-empty-language", prefix: "\t\t\t", language: "js", body: [] },
  { name: "longer-closing", closingFence: "``````", body: ["hello"] },
  {
    name: "wrapped",
    width: 440,
    compact: false,
    body: ["// " + "long code 日本語 ".repeat(35), "  next();"],
  },
];
assert.ok(
  !selectedCase ||
    [...cases.map((spec) => spec.name), "editing", "offscreen"].includes(
      selectedCase,
    ),
  "Unknown case",
);

try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  run(async (name) => {
    app.workspace.leftSplit.collapse();
    app.workspace.rightSplit.collapse();
    await app.vault.create(name, "");
  }, notePath);
  created = true;
  run(async (name) => {
    const file = app.vault.getAbstractFileByPath(name);
    await app.workspace.getLeaf(false).openFile(file);
    await app.workspace.activeLeaf.view.setState(
      {
        ...app.workspace.activeLeaf.view.getState(),
        mode: "source",
        source: false,
      },
      { history: false },
    );
  }, notePath);
  for (const mode of modes) {
    configure(mode);
    for (const spec of cases.filter(
      (spec) => !selectedCase || spec.name === selectedCase,
    )) {
      const fixture = makeFixture(spec, mode);
      load(fixture);
      sample(`${mode}-${spec.name}`, fixture, mode);
    }
    if (!selectedCase || selectedCase === "editing") {
      const fixture = makeFixture(
        { name: "editing", closingFence: "`".repeat(20), body: ["hello"] },
        mode,
      );
      load(fixture);
      sample(`${mode}-editing-preview`, fixture, mode);
      run(async (fixture) => {
        const editor = app.workspace.activeLeaf.view.editor;
        editor.focus();
        editor.setCursor({
          line: fixture.firstBody - 1,
          ch: editor.getLine(fixture.firstBody - 1).length,
        });
        await new Promise((resolve) => setTimeout(resolve, 350));
      }, fixture);
      const before = sample(`${mode}-editing-before`, fixture, mode, {
        editing: true,
      });
      const suffix = "_with_a_much_longer_value";
      run(
        (suffix) =>
          app.workspace.activeLeaf.view.editor.replaceSelection(suffix),
        suffix,
      );
      const lines = fixture.text.split("\n");
      lines[fixture.firstBody - 1] += suffix;
      fixture.text = lines.join("\n");
      const grown = sample(`${mode}-editing-grown`, fixture, mode, {
        editing: true,
      });
      check(
        grown.background?.width > before.background?.width + 30,
        `${mode}-editing-grown`,
        "typing did not grow background",
      );
      run((suffix) => {
        const editor = app.workspace.activeLeaf.view.editor;
        const end = editor.getCursor();
        editor.replaceRange(
          "",
          { line: end.line, ch: end.ch - suffix.length },
          end,
        );
      }, suffix);
      lines[fixture.firstBody - 1] = lines[fixture.firstBody - 1].slice(
        0,
        -suffix.length,
      );
      fixture.text = lines.join("\n");
      const shrunk = sample(`${mode}-editing-shrunk`, fixture, mode, {
        editing: true,
      });
      check(
        Math.abs(shrunk.background?.width - before.background?.width) < 1,
        `${mode}-editing-shrunk`,
        "deleting did not restore background width",
      );
      run(
        (fixture) =>
          app.workspace.activeLeaf.view.editor.setCursor({
            line: fixture.tail - 1,
            ch: 6,
          }),
        fixture,
      );
      sample(`${mode}-editing-returned`, fixture, mode);
    }
    if (mode === "native" && (!selectedCase || selectedCase === "offscreen")) {
      const body = Array.from({ length: 190 }, (_, n) =>
        n > 50 && n < 150 ? "" : "x",
      );
      body[0] = "the_longest_line_stays_above_the_viewport";
      const fixture = makeFixture({ name: "offscreen", body });
      load(fixture);
      const first = sample("native-offscreen-top", fixture, mode);
      for (const [name, offset] of [
        ["blank-viewport", 95],
        ["lower-rows", 170],
      ]) {
        run(
          async ({ fixture, offset }) => {
            const editor = app.workspace.activeLeaf.view.editor;
            const target = { line: fixture.firstBody - 1 + offset, ch: 0 };
            editor.scrollIntoView({ from: target, to: target }, true);
            await new Promise((resolve) => setTimeout(resolve, 500));
          },
          { fixture, offset },
        );
        const next = sample(`native-offscreen-${name}`, fixture, mode, {
          compact: false,
          visibleOnly: true,
        });
        check(
          !next.opening || next.opening.bounds.bottom <= next.viewport.top,
          name,
          "opening fence remains onscreen",
        );
        check(
          Math.abs(next.background?.width - first.background?.width) < 1,
          name,
          "width lost the offscreen longest row",
        );
        if (name === "blank-viewport")
          check(
            next.rows
              .filter((row) => row.body)
              .every((row) => row.text.trim() === ""),
            name,
            "viewport is not exclusively blank code rows",
          );
      }
    }
  }
} finally {
  try {
    run(
      async ({ original, settings, notePath, created }) => {
        const id = "shiki-highlighter";
        if (original.shiki && !app.plugins.plugins[id]) {
          await app.plugins.loadManifest(".obsidian/plugins/shiki-highlighter");
          await app.plugins.enablePlugin(id);
        }
        const shiki = app.plugins.plugins[id];
        if (shiki && settings) {
          shiki.settings = settings;
          await shiki.reloadHighlighter();
        }
        if (!original.shiki && shiki) await app.plugins.disablePlugin(id);
        await app.workspace.activeLeaf.setViewState(original.viewState);
        const editor = app.workspace.activeLeaf.view.editor;
        if (editor && original.cursor) editor.setCursor(original.cursor);
        if (editor && original.scroll)
          editor.scrollTo(original.scroll.left, original.scroll.top);
        if (!original.left) app.workspace.leftSplit.expand();
        if (!original.right) app.workspace.rightSplit.expand();
        const file = app.vault.getAbstractFileByPath(notePath);
        if (created && file) await app.vault.delete(file);
      },
      { original, settings: savedShikiSettings, notePath, created },
    );
  } finally {
    cdp("Emulation.clearDeviceMetricsOverride");
    cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
    fs.writeFileSync(
      path.join(output, "results.json"),
      JSON.stringify({ results, failures }, null, 2),
    );
    console.log(
      JSON.stringify({ output, samples: results.length, failures }, null, 2),
    );
  }
}
assert.deepEqual(failures, [], "Nested code width regressions");
