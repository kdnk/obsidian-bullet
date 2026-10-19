const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const observe = process.argv.includes("--observe");
const light = process.argv.includes("--light");
const note = `pages/Code frame hover ${randomUUID()}.md`;
const cases = [
  { name: "auto-terminal", frame: "auto", info: "sh", header: true },
  {
    name: "auto-title",
    frame: "auto",
    info: 'js title="example.js"',
    header: true,
  },
  { name: "none", frame: "none", info: "js", header: false },
  { name: "code", frame: "code", info: "js", header: false },
  { name: "terminal", frame: "terminal", info: "js", header: true },
  {
    name: "numbered-terminal",
    frame: "auto",
    info: "sh",
    header: true,
    numbers: true,
  },
  {
    name: "root-terminal",
    frame: "auto",
    info: "sh",
    header: true,
    root: true,
  },
  {
    name: "middle-terminal",
    frame: "auto",
    info: "sh",
    header: true,
    middle: true,
  },
  {
    name: "middle-title",
    frame: "auto",
    info: 'js title="example.js"',
    header: true,
    middle: true,
  },
  {
    name: "middle-root-terminal",
    frame: "auto",
    info: "sh",
    header: true,
    root: true,
    middle: true,
  },
].flatMap((spec) => [16, 24, 30].map((font) => ({ ...spec, font })));
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  font: app.getBaseFontSize(),
  shiki: !!app.plugins.plugins["shiki-highlighter"],
  settings: app.plugins.plugins["shiki-highlighter"]?.settings,
  dark: document.body.classList.contains("theme-dark"),
  light: document.body.classList.contains("theme-light"),
}));
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
    const label = `${spec.name}-${spec.font}`;
    const result = { ...spec, label, states: [] };
    results.push(result);
    try {
      result.text = evaluate(async (spec) => {
        const plugin = app.plugins.plugins["shiki-highlighter"];
        plugin.settings.ecDefaultFrame = spec.frame;
        plugin.settings.ecDefaultShowLineNumbers = !!spec.numbers;
        await plugin.reloadHighlighter();
        app.setBaseFontSize(spec.font);
        const editor = app.workspace.activeLeaf.view.editor;
        const prefix = spec.root ? "" : "  ";
        const paragraphs = spec.middle
          ? Array.from({ length: 40 }, (_, i) => [
              `Paragraph ${i + 1}. This article explains repository setup before showing its configuration commands and the steps that follow.`,
              "",
            ]).flat()
          : [];
        const offset = paragraphs.length;
        const text = [
          ...paragraphs,
          "## Settings",
          "",
          (spec.root ? "" : "- ") + "```" + spec.info,
          prefix + "git remote add upstream <upstream-repository-url>",
          prefix + "git remote set-url upstream --push NO-PUSH",
          prefix + "but pull --check",
          prefix +
            "but config target upstream/main --push-remote origin # but config target upstream/master --push-remote origin",
          prefix + "```",
          "",
          "- after",
          ...(spec.middle ? ["", ...paragraphs] : []),
        ].join("\n");
        editor.setValue(text);
        editor.setCursor({ line: offset + 9, ch: 3 });
        editor.focus();
        editor.scrollIntoView(
          { from: { line: offset, ch: 0 }, to: { line: offset + 9, ch: 0 } },
          true,
        );
        let previous = "",
          stable = 0;
        for (let attempt = 0; attempt < 50 && stable < 3; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const code = editor.cm.contentDOM.querySelector(".expressive-code");
          const first = code?.querySelector(".ec-line .code");
          const header = code?.querySelector(".header");
          const pre = code?.querySelector("pre");
          if (
            !first?.getBoundingClientRect().height ||
            first.textContent !==
              "git remote add upstream <upstream-repository-url>" ||
            !pre?.getBoundingClientRect().height ||
            header?.getBoundingClientRect().height > 0 !== spec.header
          )
            continue;
          const walker = document.createTreeWalker(first, NodeFilter.SHOW_TEXT);
          let node, glyph;
          while ((node = walker.nextNode())) {
            if (!node.textContent.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            glyph = range.getBoundingClientRect().toJSON();
            break;
          }
          const geometry = JSON.stringify([
            first.getBoundingClientRect().toJSON(),
            header?.getBoundingClientRect().toJSON(),
            pre.getBoundingClientRect().toJSON(),
            glyph,
          ]);
          stable = geometry === previous ? stable + 1 : 0;
          previous = geometry;
        }
        if (stable < 3) throw Error("Code frame did not settle");
        return text;
      }, spec);
      for (const state of ["outside-before", "inside", "outside-after"]) {
        let sample;
        for (let pointerAttempt = 0; pointerAttempt < 5; pointerAttempt++) {
          const target = evaluate(
            (state, note, text) => {
              window.focus();
              if (
                document.visibilityState !== "visible" ||
                !document.title.includes("vault") ||
                document.title.includes("base") ||
                app.workspace.activeLeaf.view.file?.path !== note
              )
                throw Error("Visible test-vault title and note guard");
              const editor = app.workspace.activeLeaf.view.editor;
              if (editor.getValue() !== text)
                throw Error("Fixture Markdown changed");
              const code =
                editor.cm.contentDOM.querySelector(".expressive-code");
              const embed = code?.closest(
                ".cm-preview-code-block, .cm-embed-block",
              );
              const element =
                state === "inside"
                  ? code?.querySelector(".ec-line .code")
                  : editor.cm.contentDOM.querySelector(".HyperMD-header");
              if (!embed || !element) throw Error("Missing hover target");
              const rect = element.getBoundingClientRect();
              const x = rect.left + Math.min(40, rect.width / 2),
                y = rect.top + rect.height / 2;
              const hit = document.elementFromPoint(x, y);
              if (
                !hit ||
                !element.contains(hit) ||
                (state !== "inside" && embed.contains(hit))
              )
                throw Error("Fresh hover target is obscured");
              const input = { x, y, event: null, frames: 0 };
              window.__bulletFrameHoverInput = input;
              const listener = (event) => {
                if (
                  Math.abs(event.clientX - x) > 1 ||
                  Math.abs(event.clientY - y) > 1
                )
                  return;
                document.removeEventListener("mousemove", listener, true);
                input.event = {
                  x: event.clientX,
                  y: event.clientY,
                  type: event.type,
                };
                requestAnimationFrame(() => {
                  input.frames++;
                  requestAnimationFrame(() => {
                    input.frames++;
                    const style = getComputedStyle(embed);
                    input.paint = {
                      hover: embed.matches(":hover"),
                      overflow: style.overflow,
                      overflowX: style.overflowX,
                      overflowY: style.overflowY,
                      overflowClipMargin: style.overflowClipMargin,
                    };
                  });
                });
              };
              if (window.__bulletFrameHoverListener)
                document.removeEventListener(
                  "mousemove",
                  window.__bulletFrameHoverListener,
                  true,
                );
              window.__bulletFrameHoverListener = listener;
              document.addEventListener("mousemove", listener, {
                capture: true,
              });
              return { x, y };
            },
            state,
            note,
            result.text,
          );
          cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...target });
          sample = evaluate(async () => {
            for (
              let attempt = 0;
              attempt < 20 && window.__bulletFrameHoverInput.frames < 2;
              attempt++
            )
              await new Promise((resolve) => setTimeout(resolve, 50));
            const editor = app.workspace.activeLeaf.view.editor;
            for (let attempt = 0; attempt < 40; attempt++) {
              const first = editor.cm.contentDOM.querySelector(
                ".expressive-code .ec-line .code",
              );
              if (
                first?.textContent ===
                "git remote add upstream <upstream-repository-url>"
              )
                break;
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            const code = editor.cm.contentDOM.querySelector(".expressive-code");
            const embed = code.closest(
              ".cm-preview-code-block, .cm-embed-block",
            );
            const header = code.querySelector(".header");
            const bounds = (element) => {
              if (!element) return null;
              const r = element.getBoundingClientRect();
              return { x: r.x, y: r.y, w: r.width, h: r.height };
            };
            const embedBounds = bounds(embed),
              headerBounds = bounds(header);
            const style = window.__bulletFrameHoverInput.paint;
            if (!style)
              throw Error("No paint after the requested pointer event");
            const clipMargin = Number.parseFloat(style.overflowClipMargin) || 0;
            const allowsPaint = (axis, start, size) => {
              const overflow = style[axis],
                margin = overflow === "clip" ? clipMargin : 0;
              return (
                overflow === "visible" ||
                (headerBounds[start] >= embedBounds[start] - margin - 1 &&
                  headerBounds[start] + headerBounds[size] <=
                    embedBounds[start] + embedBounds[size] + margin + 1)
              );
            };
            const walker = document.createTreeWalker(
              code.querySelector(".ec-line .code"),
              NodeFilter.SHOW_TEXT,
            );
            let glyph, node;
            while ((node = walker.nextNode())) {
              if (!node.textContent.trim()) continue;
              const range = document.createRange();
              range.selectNodeContents(node);
              const r = range.getClientRects()[0];
              if (r) {
                glyph = { x: r.x, y: r.y, h: r.height };
                break;
              }
            }
            if (!glyph) throw Error("Missing painted first code glyph");
            return {
              hover: style.hover,
              screenshotHover: embed.matches(":hover"),
              input: window.__bulletFrameHoverInput,
              embed: embedBounds,
              overflow: style.overflow,
              clipMargin,
              header: headerBounds,
              headerPaintUnclipped:
                !!headerBounds?.h &&
                allowsPaint("overflowX", "x", "w") &&
                allowsPaint("overflowY", "y", "h"),
              glyph,
              pre: bounds(code.querySelector("pre")),
              firstCode: code.querySelector(".ec-line .code").textContent,
              controls:
                !!embed.querySelector(".copy button") &&
                !!embed.querySelector(".edit-block-button"),
              markdown: editor.getValue(),
              scrollTop: editor.cm.scrollDOM.scrollTop,
              theme: document.body.classList.contains("theme-light")
                ? "light"
                : "dark",
            };
          });
          if (sample.hover === (state === "inside")) break;
        }
        sample.state = state;
        sample.screenshot = `${label}-${state}.png`;
        result.states.push(sample);
        fs.writeFileSync(
          path.join(output, sample.screenshot),
          Buffer.from(
            cdp("Page.captureScreenshot", { format: "png" }).data,
            "base64",
          ),
        );
      }
      const saved = evaluate(async () => {
        const view = app.workspace.activeLeaf.view;
        await view.save();
        return app.vault.read(view.file);
      });
      assert.equal(saved, result.text, `${label} unchanged saved Markdown`);
      result.saved = saved;
      for (const sample of result.states) {
        assert.equal(
          sample.hover,
          sample.state === "inside",
          `${label} native hover`,
        );
        assert.equal(
          sample.input.event?.type,
          "mousemove",
          `${label} renderer received mousemove`,
        );
        assert.ok(sample.input.frames >= 2, `${label} post-event paint frames`);
        assert.equal(
          sample.markdown,
          result.text,
          `${label} unchanged Markdown`,
        );
        assert.equal(
          sample.header?.h > 0,
          spec.header,
          `${label} expected header`,
        );
        assert.ok(sample.controls, `${label} native copy and edit controls`);
        assert.equal(
          sample.firstCode,
          "git remote add upstream <upstream-repository-url>",
          `${label} processor has removed the list container indentation`,
        );
        if (light) assert.equal(sample.theme, "light", `${label} light theme`);
        if (spec.middle)
          assert.ok(
            sample.scrollTop > 0,
            `${label} article scrolled to middle`,
          );
        if (spec.header)
          assert.ok(
            sample.headerPaintUnclipped,
            `${label} ${sample.state} header paint fits the overflow clip`,
          );
        for (const key of ["glyph", "pre", "header"]) {
          const baseline = result.states[0][key];
          if (!baseline && !sample[key]) continue;
          for (const dimension of Object.keys(baseline))
            assert.ok(
              Math.abs(baseline[dimension] - sample[key][dimension]) <= 1,
              `${label} stable ${key}.${dimension}`,
            );
        }
      }
    } catch (error) {
      failures.push({ label, message: error.message });
    }
    console.log(
      `${label} ${failures.at(-1)?.label === label ? "FAIL" : "PASS"}`,
    );
  }
} finally {
  try {
    evaluate(
      async (original, note) => {
        if (window.__bulletFrameHoverListener)
          document.removeEventListener(
            "mousemove",
            window.__bulletFrameHoverListener,
            true,
          );
        delete window.__bulletFrameHoverListener;
        delete window.__bulletFrameHoverInput;
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
        const leaf = app.workspace
          .getLeavesOfType("markdown")
          .find((leaf) => leaf.view.file?.path === note);
        const previous = app.workspace.getLeafById(original.leaf);
        if (previous) app.workspace.setActiveLeaf(previous, { focus: true });
        leaf?.detach();
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
      JSON.stringify(
        {
          entry: "Native CDP mouseMoved outside, inside, outside",
          lightThemeOverride: light,
          results,
          failures,
        },
        null,
        2,
      ),
    );
  }
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
    `${failures.length} code frame hover failures`,
  );
