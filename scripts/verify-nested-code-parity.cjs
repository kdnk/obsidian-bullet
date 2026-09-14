// Run serially against the deployed desktop test vault with Shiki installed.
// Screenshots describe the current theme; the verifier does not change it.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

assert.ok(
  process.argv.length <= 3,
  "Usage: npm run test:code-parity -- [fresh-output-directory]",
);
const output = process.argv[2]
  ? path.resolve(process.argv[2])
  : fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-bullet-code-parity-"));
if (process.argv[2]) {
  assert.ok(
    !fs.existsSync(output),
    `Output directory must be fresh: ${output}`,
  );
  fs.mkdirSync(output, { recursive: false });
}
console.log(`Code parity artifacts: ${output}`);

const note = `code-parity-${randomUUID()}.md`;
const fixture =
  "- hello\n\t- aaa\n\t\t- ```js\n\t\t  hello\n\t\t  ```\n\t\t- ```js\n\t\t  hello\n\t\t  ```\n\t- ";
const results = [],
  failures = [];
let original,
  focusRequested = false;

function screenshot(name) {
  fs.writeFileSync(
    path.join(output, `${name}.png`),
    Buffer.from(
      cdp("Page.captureScreenshot", { format: "png" }).data,
      "base64",
    ),
  );
}

try {
  try {
    original = evaluate(async () => {
      const bullet = app.plugins.plugins.bullet;
      if (
        !bullet ||
        !document.body.classList.contains("bullet-plugin-better-lists")
      )
        throw Error("Enable Bullet and its list styling in the test vault");
      if (!app.workspace.activeLeaf)
        throw Error("Open a note in the desktop test vault first");
      if (window.__codeParityLeaf || window.__codeParitySettings)
        throw Error("Another code parity run still owns the test renderer");
      for (const method of ["enablePlugin", "disablePlugin", "loadManifest"])
        if (typeof app.plugins[method] !== "function")
          throw Error(`Required Obsidian plugin API is missing: ${method}`);
      const directory = ".obsidian/plugins/shiki-highlighter";
      for (const file of ["manifest.json", "main.js", "styles.css"])
        if (!(await app.vault.adapter.exists(`${directory}/${file}`)))
          throw Error(
            `Install Shiki Highlighter in the test vault: missing ${directory}/${file}`,
          );
      const manifest = JSON.parse(
        await app.vault.adapter.read(`${directory}/manifest.json`),
      );
      if (manifest.id !== "shiki-highlighter")
        throw Error("Installed Shiki manifest has an unexpected plugin ID");
      const shiki = app.plugins.plugins[manifest.id];
      if (
        shiki &&
        (!shiki.settings || typeof shiki.reloadHighlighter !== "function")
      )
        throw Error(
          "Installed Shiki runtime does not expose settings and reloadHighlighter()",
        );
      const settingsPath = `${directory}/data.json`;
      return {
        leaf: app.workspace.activeLeaf.id,
        shiki: !!shiki,
        settings: shiki ? structuredClone(shiki.settings) : null,
        settingsData: (await app.vault.adapter.exists(settingsPath))
          ? await app.vault.adapter.read(settingsPath)
          : null,
        versions: {
          electron: process.versions.electron,
          bullet: bullet.manifest.version,
          shikiInstalled: manifest.version,
          shikiRuntime: shiki?.manifest.version ?? null,
        },
        appearance: {
          theme: document.body.classList.contains("theme-dark")
            ? "dark"
            : "light",
          cssTheme: app.vault.config.cssTheme ?? null,
          devicePixelRatio,
          viewport: { width: innerWidth, height: innerHeight },
        },
      };
    });
  } catch (error) {
    throw Error(
      `Code parity prerequisites failed. Open the repository's desktop vault with the current Bullet build and Shiki installed; obsidian-cli vault=vault dev:cdp must work. ${error.message}`,
    );
  }
  original.versions.obsidian = execFileSync(
    "obsidian-cli",
    ["vault=vault", "version"],
    { encoding: "utf8", timeout: 20000 },
  ).trim();
  console.log(
    JSON.stringify(
      { versions: original.versions, appearance: original.appearance },
      null,
      2,
    ),
  );
  focusRequested = true;
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(
    async (note, text) => {
      window.__codeParityLeaf = app.workspace.getLeaf("tab");
      await window.__codeParityLeaf.openFile(
        await app.vault.create(note, text),
      );
      await window.__codeParityLeaf.setViewState({
        type: "markdown",
        state: { file: note, mode: "source", source: false },
      });
      app.workspace.setActiveLeaf(window.__codeParityLeaf, { focus: true });
    },
    note,
    fixture,
  );
  for (const mode of ["native", "shiki", "numbers"]) {
    evaluate(async (mode) => {
      const id = "shiki-highlighter";
      if (mode === "native") {
        if (app.plugins.plugins[id]) await app.plugins.disablePlugin(id);
      } else {
        if (!app.plugins.plugins[id]) {
          await app.plugins.loadManifest(".obsidian/plugins/shiki-highlighter");
          await app.plugins.enablePlugin(id);
        }
        const p = app.plugins.plugins[id];
        if (!p?.settings || typeof p.reloadHighlighter !== "function")
          throw Error(
            "Shiki could not be enabled with the required settings/reloadHighlighter API",
          );
        // Capture merged defaults/settings even if Shiki started disabled.
        window.__codeParitySettings ??= structuredClone(p.settings);
        p.settings.ecDefaultShowLineNumbers = mode === "numbers";
        await p.reloadHighlighter();
      }
    }, mode);
    for (const [phase, cursorLine] of [
      ["preview", 8],
      ["edit-first", 3],
      ["edit-second", 6],
      ["preview-again", 8],
    ]) {
      try {
        const sample = evaluate(
          async (mode, cursorLine) => {
            window.focus();
            if (document.visibilityState !== "visible")
              throw Error("Hidden renderer");
            if (app.workspace.activeLeaf !== window.__codeParityLeaf)
              throw Error(
                "The active leaf changed during code parity verification",
              );
            const e = window.__codeParityLeaf.view.editor,
              cm = e.cm;
            e.focus();
            e.setCursor({ line: cursorLine, ch: e.getLine(cursorLine).length });
            const line = (n) =>
              [...cm.contentDOM.querySelectorAll(".cm-line")].find(
                (el) => cm.state.doc.lineAt(cm.posAtDOM(el)).number === n,
              );
            const rect = (el) => {
              if (!el) throw Error("Required code element has not rendered");
              return el.getBoundingClientRect();
            };
            const glyph = (el) => {
              if (!el) throw Error("Code content has not rendered");
              const walker = document.createTreeWalker(
                el,
                NodeFilter.SHOW_TEXT,
              );
              let node;
              while ((node = walker.nextNode())) {
                if (!node.textContent.trim()) continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                const bounds = range.getClientRects()[0];
                if (bounds) return bounds;
              }
              throw Error("Missing code glyph");
            };
            const measure = () => {
              const blocks = [3, 6].map((n) => {
                const opening = line(n),
                  start = rect(opening),
                  paint = getComputedStyle(opening, "::before");
                const embed = opening.nextElementSibling?.matches(
                  ".cm-preview-code-block",
                )
                  ? opening.nextElementSibling
                  : null;
                const expectedEmbedded = mode !== "native" && cursorLine !== n;
                if (!!embed !== expectedEmbedded)
                  throw Error(
                    `Block ${n}: expected ${expectedEmbedded ? "Shiki preview" : "native rows"}, found ${embed ? "preview" : "native rows"}`,
                  );
                const lineNumbers = [
                  ...(embed?.querySelectorAll(".ln") ?? []),
                ].filter((el) => {
                  const bounds = rect(el),
                    style = getComputedStyle(el);
                  return (
                    bounds.width > 0 &&
                    bounds.height > 0 &&
                    style.display !== "none" &&
                    style.visibility !== "hidden"
                  );
                }).length;
                if (
                  lineNumbers > 0 !==
                  (expectedEmbedded && mode === "numbers")
                )
                  throw Error(
                    `Block ${n}: unexpected visible line numbers (${lineNumbers}) for ${mode}`,
                  );
                const code = embed
                  ? embed.querySelector(".ec-line .code")
                  : line(n + 1)?.querySelector(
                      ".bullet-plugin-nested-code-block-content",
                    );
                const text = glyph(code);
                const openingPainted =
                  paint.backgroundColor !== "transparent" &&
                  paint.backgroundColor !== "rgba(0, 0, 0, 0)";
                const closing = embed ? null : line(n + 2);
                const backgroundLeft = embed
                  ? rect(embed).left
                  : start.left + parseFloat(paint.insetInlineStart);
                return {
                  embedded: !!embed,
                  lineNumbers,
                  openingHeight: start.height,
                  top: openingPainted
                    ? start.top + parseFloat(paint.insetBlockStart)
                    : rect(embed).top,
                  bottom: embed
                    ? rect(embed.querySelector("pre")).bottom
                    : rect(closing).bottom -
                      parseFloat(
                        getComputedStyle(closing, "::before").insetBlockEnd,
                      ),
                  padding:
                    text.left - (embed ? rect(code).left : backgroundLeft),
                  textCenter: text.top + text.height / 2 - rect(line(3)).top,
                  openingBackground: paint.backgroundColor,
                  previewBackground: embed
                    ? getComputedStyle(embed.querySelector("pre"))
                        .backgroundColor
                    : null,
                };
              });
              const styles = getComputedStyle(cm.dom);
              return {
                text: e.getValue(),
                blocks,
                gap: blocks[1].top - blocks[0].bottom,
                expectedPadding: parseFloat(
                  styles.getPropertyValue("--size-4-4"),
                ),
                expectedGap: parseFloat(styles.getPropertyValue("--size-4-2")),
              };
            };
            // Wait for renderer roles and stable geometry, never passing geometry.
            // Stable incorrect layouts must reach the assertions below.
            const started = performance.now();
            let previous, stableSince, lastError;
            while (performance.now() - started < 8000) {
              try {
                const sample = measure();
                const signature = JSON.stringify(sample, (_key, value) =>
                  typeof value === "number" && Number.isFinite(value)
                    ? Math.round(value * 100) / 100
                    : value,
                );
                if (signature !== previous) {
                  previous = signature;
                  stableSince = performance.now();
                } else if (performance.now() - stableSince >= 400) {
                  return {
                    ...sample,
                    settledAfterMs: performance.now() - started,
                  };
                }
                lastError = "Code geometry did not settle";
              } catch (error) {
                previous = undefined;
                stableSince = undefined;
                lastError = error.message;
              }
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            throw Error(`Renderer did not settle within 8000 ms: ${lastError}`);
          },
          mode,
          cursorLine,
        );
        results.push({ mode, phase, ...sample });
        assert.equal(sample.text, fixture);
        for (const key of ["gap", "expectedGap", "expectedPadding"])
          assert.ok(Number.isFinite(sample[key]), `Missing numeric ${key}`);
        assert.ok(
          Math.abs(sample.gap - sample.expectedGap) < 1,
          `Painted card gap ${sample.gap}px should be ${sample.expectedGap}px`,
        );
        for (const [i, block] of sample.blocks.entries()) {
          for (const key of [
            "openingHeight",
            "top",
            "bottom",
            "padding",
            "textCenter",
          ])
            assert.ok(
              Number.isFinite(block[key]),
              `Block ${i}: missing numeric ${key}`,
            );
          const expectedEmbedded =
            mode !== "native" && cursorLine !== [3, 6][i];
          assert.equal(
            block.embedded,
            expectedEmbedded,
            `Block ${i}: incorrect renderer`,
          );
          assert.equal(
            block.lineNumbers > 0,
            expectedEmbedded && mode === "numbers",
            `Block ${i}: incorrect line-number visibility`,
          );
          assert.ok(
            Math.abs(block.padding - sample.expectedPadding) < 1,
            `Block ${i}: left padding ${block.padding}px should be ${sample.expectedPadding}px`,
          );
          assert.ok(block.openingHeight > 0, "Fence must remain navigable");
          if (block.embedded)
            assert.equal(
              block.openingBackground,
              block.previewBackground,
              "Opening and Shiki card backgrounds must match",
            );
          if (results[0].mode === "native" && results[0].phase === "preview")
            assert.ok(
              Math.abs(block.textCenter - results[0].blocks[i].textCenter) < 1,
              `Block ${i}: code text moved vertically when toggling renderer/editing`,
            );
        }
      } catch (error) {
        failures.push(`${mode} ${phase}: ${error.message}`);
      }
      screenshot(`${mode}-${phase}`);
    }
  }
} catch (error) {
  failures.push(error.message);
} finally {
  if (original) {
    try {
      evaluate(
        async (original, note) => {
          const errors = [];
          const attempt = async (fn) => {
            try {
              await fn();
            } catch (error) {
              errors.push(error.message);
            }
          };
          await attempt(() => window.__codeParityLeaf?.detach());
          delete window.__codeParityLeaf;
          await attempt(async () => {
            const id = "shiki-highlighter";
            if (original.shiki && !app.plugins.plugins[id])
              await app.plugins.enablePlugin(id);
            const p = app.plugins.plugins[id];
            if (p && (original.settings || window.__codeParitySettings)) {
              p.settings = structuredClone(
                original.settings ?? window.__codeParitySettings,
              );
              if (original.shiki) await p.reloadHighlighter();
            }
          });
          if (!original.shiki)
            await attempt(async () => {
              if (app.plugins.plugins["shiki-highlighter"])
                await app.plugins.disablePlugin("shiki-highlighter");
            });
          delete window.__codeParitySettings;
          await attempt(async () => {
            const settingsPath =
              ".obsidian/plugins/shiki-highlighter/data.json";
            const exists = await app.vault.adapter.exists(settingsPath);
            if (original.settingsData === null) {
              if (exists) await app.vault.adapter.remove(settingsPath);
            } else if (
              !exists ||
              (await app.vault.adapter.read(settingsPath)) !==
                original.settingsData
            ) {
              await app.vault.adapter.write(
                settingsPath,
                original.settingsData,
              );
            }
          });
          await attempt(() => {
            const leaf = app.workspace.getLeafById(original.leaf);
            if (!leaf)
              throw Error("Original active leaf is no longer available");
            app.workspace.setActiveLeaf(leaf, { focus: true });
          });
          await attempt(async () => {
            const file = app.vault.getAbstractFileByPath(note);
            if (file) await app.vault.trash(file, true);
          });
          if (errors.length) throw Error(errors.join("; "));
        },
        original,
        note,
      );
    } catch (error) {
      failures.push(`Cleanup failed: ${error.message}`);
    }
  }
  if (focusRequested) {
    try {
      cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
    } catch (error) {
      failures.push(`Focus cleanup failed: ${error.message}`);
    }
  }
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(
      {
        versions: original?.versions ?? null,
        appearance: original?.appearance ?? null,
        results,
        failures,
      },
      null,
      2,
    ),
  );
}
console.log(
  JSON.stringify({ output, cases: results.length, failures }, null, 2),
);
assert.equal(
  failures.length,
  0,
  "Native and Shiki code card geometry must agree",
);
assert.equal(
  results.length,
  12,
  "All native/Shiki renderer and editing cases must run",
);
