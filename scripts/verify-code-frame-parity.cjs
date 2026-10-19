const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const observe = process.argv.includes("--observe");
const light = process.argv.includes("--light");
const note = `pages/Code frame parity ${randomUUID()}.md`;
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  font: app.getBaseFontSize(),
  shiki: !!app.plugins.plugins["shiki-highlighter"],
  settings: app.plugins.plugins["shiki-highlighter"]?.settings,
  dark: document.body.classList.contains("theme-dark"),
  light: document.body.classList.contains("theme-light"),
}));
const cases = [];
for (const frame of ["auto", "none", "code", "terminal"]) {
  for (const language of [
    "sh",
    "bash",
    "zsh",
    "powershell",
    "js",
    "ts",
    "python",
    "json",
    "",
  ]) {
    cases.push({ frame, info: language, font: 16, numbers: false });
  }
}
for (const font of [16, 24, 30]) {
  for (const info of ["sh", 'js title="example.js"', 'sh title="setup.sh"']) {
    cases.push({ frame: "auto", info, font, numbers: true });
  }
}
const results = [],
  failures = [];
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(
    async (note, light) => {
      if (!document.body.classList.contains("bullet-plugin-better-lists"))
        throw Error("List styling required");
      const leaf = app.workspace.getLeaf("tab");
      await leaf.openFile(await app.vault.create(note, ""));
      await leaf.setViewState({
        type: "markdown",
        state: { file: note, mode: "source", source: false },
      });
      if (!app.plugins.plugins["shiki-highlighter"])
        await app.plugins.enablePlugin("shiki-highlighter");
      if (light) {
        document.body.classList.remove("theme-dark");
        document.body.classList.add("theme-light");
        await app.plugins.plugins["shiki-highlighter"].reloadHighlighter();
      }
    },
    note,
    light,
  );
  for (const spec of cases) {
    const sample = evaluate(async (spec) => {
      window.focus();
      if (document.visibilityState !== "visible")
        throw Error("Renderer hidden");
      const plugin = app.plugins.plugins["shiki-highlighter"];
      const reconfigure =
        plugin.settings.ecDefaultFrame !== spec.frame ||
        plugin.settings.ecDefaultShowLineNumbers !== spec.numbers;
      plugin.settings.ecDefaultFrame = spec.frame;
      plugin.settings.ecDefaultShowLineNumbers = spec.numbers;
      if (reconfigure) await plugin.reloadHighlighter();
      app.setBaseFontSize(spec.font);
      const editor = app.workspace.activeLeaf.view.editor,
        cm = editor.cm;
      const text = [
        "## Settings",
        "",
        "- ```" + spec.info,
        "  git remote add upstream example",
        "  but pull --check",
        "  ```",
        "",
        "- after",
      ].join("\n");
      editor.setValue(text);
      editor.focus();
      const phases = [];
      const line = (n) =>
        [...cm.contentDOM.querySelectorAll(".cm-line")].find(
          (el) => cm.state.doc.lineAt(cm.posAtDOM(el)).number === n,
        );
      const bounds = (el) => {
        if (!el) throw Error("Required element missing");
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      };
      const glyph = (el) => {
        if (!el) throw Error("Code glyph missing");
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (!node.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const b = range.getClientRects()[0];
          if (b) return { x: b.x, y: b.y, h: b.height };
        }
        throw Error("No painted glyph");
      };
      for (const phase of ["preview", "editing", "preview-again"]) {
        editor.setCursor({
          line: phase === "editing" ? 3 : 7,
          ch: phase === "editing" ? 8 : 3,
        });
        editor.scrollIntoView(
          { from: { line: 0, ch: 0 }, to: { line: 7, ch: 0 } },
          true,
        );
        const expectedEmbed = phase !== "editing" && spec.info !== "";
        const expectedHeader =
          expectedEmbed &&
          spec.frame !== "none" &&
          (spec.frame === "terminal" ||
            spec.info.includes("title=") ||
            (spec.frame === "auto" &&
              ["sh", "bash", "zsh", "powershell"].includes(spec.info)));
        let stable = 0,
          previous = "";
        for (let attempt = 0; attempt < 40 && stable < 3; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const candidate = line(3)?.nextElementSibling;
          const rendered = candidate?.matches(".cm-preview-code-block")
            ? candidate
            : null;
          const headerHeight =
            rendered?.querySelector(".header")?.getBoundingClientRect()
              .height ?? 0;
          if (
            !!rendered !== expectedEmbed ||
            headerHeight > 0 !== expectedHeader ||
            (rendered &&
              !rendered.querySelector(".ec-line .code")?.getBoundingClientRect()
                .height)
          )
            continue;
          const geometry = JSON.stringify([
            line(3)?.getBoundingClientRect().y,
            candidate?.getBoundingClientRect().height,
            headerHeight,
          ]);
          stable = geometry === previous ? stable + 1 : 0;
          previous = geometry;
        }
        if (stable < 3)
          throw Error(`Frame did not settle: ${JSON.stringify(spec)} ${phase}`);
        const opening = line(3),
          embed = opening.nextElementSibling?.matches(".cm-preview-code-block")
            ? opening.nextElementSibling
            : null;
        const header = embed?.querySelector(".header");
        const first =
          embed?.querySelector(".ec-line .code") ??
          line(4)?.querySelector(".bullet-plugin-nested-code-block-content");
        const start = bounds(opening),
          firstGlyph = glyph(first),
          headerBounds = header ? bounds(header) : null;
        const button = embed?.querySelector(".copy button");
        const buttonBounds = button ? bounds(button) : null;
        const hit =
          buttonBounds &&
          document.elementFromPoint(
            buttonBounds.x + buttonBounds.w / 2,
            buttonBounds.y + buttonBounds.h / 2,
          );
        const titleElement = header?.querySelector(".title");
        const gutter = embed?.querySelector(".ec-line .gutter");
        phases.push({
          phase,
          opening: start,
          openingPaint: getComputedStyle(opening, "::before").backgroundColor,
          glyph: firstGlyph,
          gutterWidth: gutter?.getBoundingClientRect().width ?? 0,
          offset: firstGlyph.y - start.y,
          embedded: !!embed,
          frame: embed?.querySelector(".frame")?.className,
          header: headerBounds,
          headerClipMargin: embed
            ? getComputedStyle(embed).overflowClipMargin
            : null,
          title: header?.querySelector(".title")?.textContent,
          titleBounds: titleElement ? bounds(titleElement) : null,
          button: buttonBounds,
          buttonHit: !!button && (button === hit || button.contains(hit)),
          paint: embed ? bounds(embed.querySelector("pre")) : null,
          code: embed?.querySelector(".copy button")?.getAttribute("data-code"),
          markdown: editor.getValue(),
          theme: document.body.classList.contains("theme-light")
            ? "light"
            : "dark",
          background: embed
            ? getComputedStyle(embed.querySelector("pre")).backgroundColor
            : getComputedStyle(opening, "::before").backgroundColor,
        });
      }
      await app.workspace.activeLeaf.view.save();
      return {
        text,
        phases,
        saved: await app.vault.read(app.workspace.activeLeaf.view.file),
      };
    }, spec);
    const preview = sample.phases[0],
      editing = sample.phases[1],
      again = sample.phases[2];
    const label = `${spec.frame}/${spec.info || "unlabeled"}/${spec.font}/${spec.numbers}`;
    try {
      assert.equal(sample.saved, sample.text, `${label}: saved Markdown`);
      for (const phase of sample.phases) {
        if (light)
          assert.equal(phase.theme, "light", `${label}: light theme active`);
        assert.equal(
          phase.markdown,
          sample.text,
          `${label}: unchanged Markdown`,
        );
        assert.ok(phase.opening.h > 0, `${label}: positive native fence row`);
      }
      const header = preview.header && preview.header.h > 0;
      if (header) {
        assert.ok(
          Number.parseFloat(preview.headerClipMargin) >= preview.header.h - 1,
          `${label}: header is inside the processor paint clip`,
        );
        assert.equal(
          preview.openingPaint,
          "rgba(0, 0, 0, 0)",
          `${label}: native row does not paint over the header`,
        );
        assert.ok(
          Math.abs(preview.header.h - editing.opening.h) <= 1,
          `${label}: header shares native fence height (${preview.header.h} vs ${editing.opening.h})`,
        );
      }
      assert.ok(
        Math.abs(preview.offset - editing.offset) <= 2,
        `${label}: first code glyph stable (${preview.offset} vs ${editing.offset})`,
      );
      assert.ok(
        Math.abs(preview.glyph.x - preview.gutterWidth - editing.glyph.x) <= 2,
        `${label}: code left edge after line-number gutter (${preview.glyph.x} - ${preview.gutterWidth} vs ${editing.glyph.x})`,
      );
      if (spec.frame === "none")
        assert.ok(!header, `${label}: respects frame off`);
      if (spec.info.includes("title="))
        assert.ok(preview.title?.length > 0, `${label}: keeps explicit title`);
      if (header && preview.titleBounds?.h > 0) {
        assert.ok(
          preview.titleBounds.h <= preview.header.h + 1,
          `${label}: title fits header`,
        );
      }
      assert.ok(
        Math.abs(preview.offset - again.offset) <= 1,
        `${label}: preview return stable`,
      );
      if (preview.embedded)
        assert.ok(preview.buttonHit, `${label}: native copy button hit target`);
      if (preview.embedded)
        assert.equal(
          preview.code,
          "git remote add upstream example\x7fbut pull --check",
          `${label}: code-only copy payload`,
        );
    } catch (error) {
      failures.push({ label, message: error.message });
    }
    results.push({ ...spec, ...sample });
    console.log(
      `${label}: ${failures.at(-1)?.label === label ? "FAIL" : "PASS"}`,
    );
    if (spec.info === "sh" || spec.info.includes("title=")) {
      const image = cdp("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(
        path.join(output, `${results.length}.png`),
        Buffer.from(image.data, "base64"),
      );
    }
  }
} finally {
  evaluate(
    async (original, note) => {
      document.body.classList.toggle("theme-dark", original.dark);
      document.body.classList.toggle("theme-light", original.light);
      const plugin = app.plugins.plugins["shiki-highlighter"];
      if (plugin && original.settings) {
        plugin.settings = original.settings;
        await plugin.reloadHighlighter();
      }
      if (!original.shiki && plugin)
        await app.plugins.disablePlugin("shiki-highlighter");
      app.setBaseFontSize(original.font);
      const testLeaf = app.workspace
        .getLeavesOfType("markdown")
        .find((leaf) => leaf.view.file?.path === note);
      const previous = app.workspace.getLeafById(original.leaf);
      if (previous) app.workspace.setActiveLeaf(previous, { focus: true });
      testLeaf?.detach();
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.trash(file, true);
    },
    original,
    note,
  );
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(
      {
        entry: "editor.setCursor API transitions",
        lightThemeOverride: light,
        results,
        failures,
      },
      null,
      2,
    ),
  );
}
console.log(
  JSON.stringify(
    {
      cases: results.length,
      failures: failures.length,
      examples: failures.slice(0, 5),
    },
    null,
    2,
  ),
);
if (!observe)
  assert.equal(
    failures.length,
    0,
    `${failures.length} code frame parity failures`,
  );
