const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");

const output = process.argv[2];
assert(output, "A fresh output directory is required");
fs.mkdirSync(output);
const note = `pages/code-guide-hover-${randomUUID()}.md`;
const text = [
  "- Verification scratch",
  "\t- hello",
  "\t\t- hello",
  "\t\t\t- ```",
  "\t\t\t  hello",
  "\t\t\t  hell",
  "\t\t\t  ```",
  "\t\t\t\t- hello",
  "\t\t\t\t\t- ```js",
  "\t\t\t\t\t  hello",
  "\t\t\t\t\t\t  hello",
  "\t\t\t\t\t  ```",
  "- tail",
].join("\n");
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  font: app.getBaseFontSize(),
  shiki: !!app.plugins.plugins["shiki-highlighter"],
  settings: app.plugins.plugins["shiki-highlighter"]?.settings,
}));
const results = [];
const failures = [];

function point(kind) {
  return evaluate((kind) => {
    const cm = app.workspace.activeLeaf.view.editor.cm;
    const rows = [...cm.contentDOM.querySelectorAll(".cm-line")];
    const row = (number) =>
      rows.find((el) => cm.state.doc.lineAt(cm.posAtDOM(el)).number === number);
    const number = (value) => parseFloat(value) || 0;
    const nativeCenter = (guide) => {
      const css = getComputedStyle(guide, "::before");
      let container = guide;
      while (container && getComputedStyle(container).position === "static")
        container = container.parentElement;
      if (!container) throw Error("Positioned native guide required");
      const border = number(css.borderRightWidth);
      const width =
        number(css.width) +
        (css.boxSizing === "border-box"
          ? 0
          : border +
            number(css.borderLeftWidth) +
            number(css.paddingLeft) +
            number(css.paddingRight));
      return (
        container.getBoundingClientRect().left +
        container.clientLeft +
        number(css.left) +
        number(css.marginLeft) +
        width -
        (border > 0 ? border / 2 : width / 2)
      );
    };
    const ownerTarget = (css, x, y) => ({
      x,
      y,
      paintX: x,
      hitLeft:
        x + number(css.getPropertyValue("--bullet-code-guide-hit-offset")),
      hitWidth: number(css.getPropertyValue("--bullet-code-guide-hit-width")),
    });
    const ownerPaint = (opening, closing) => {
      for (const el of rows) {
        const line = cm.state.doc.lineAt(cm.posAtDOM(el)).number;
        if (line < opening || line > closing) continue;
        const box = el.getBoundingClientRect();
        if (el.classList.contains("bullet-plugin-code-preview-owner-guide")) {
          const css = getComputedStyle(el, "::after");
          const height = number(css.height);
          if (height > 5)
            return ownerTarget(
              css,
              box.left + number(css.left) + number(css.width) / 2,
              box.top + number(css.top) + height * 0.75,
            );
        }
        if (el.classList.contains("bullet-plugin-code-owner-guide")) {
          const css = getComputedStyle(el);
          const height = number(css.backgroundSize.split(/\s+/)[1]);
          if (height > 5)
            return ownerTarget(
              css,
              box.left +
                number(css.backgroundPositionX) +
                number(css.backgroundSize) / 2,
              box.bottom - Math.min(height / 2, 8),
            );
        }
      }
      throw Error(`Visible owner paint required for ${opening}`);
    };
    let target;
    if (kind.startsWith("owner") || kind === "code-text") {
      target = ownerPaint(4, 7);
      if (kind === "owner-left") target.x = target.hitLeft + 2;
      if (kind === "owner-right")
        target.x = target.hitLeft + target.hitWidth - 2;
      if (kind === "code-text")
        target.x = target.hitLeft + target.hitWidth + 24;
    } else if (kind === "leaf") target = ownerPaint(9, 12);
    else if (kind === "child") {
      const guide = row(8)?.querySelectorAll(
        ".cm-hmd-list-indent .cm-indent",
      )[3];
      if (!guide) throw Error("Child native guide required");
      const box = guide.getBoundingClientRect();
      target = { x: nativeCenter(guide), y: box.top + box.height / 2 };
    } else if (kind === "ancestor") {
      const guide = row(4)?.querySelectorAll(
        ".cm-hmd-list-indent .cm-indent",
      )[2];
      if (!guide) throw Error("Opening ancestor guide required");
      target = { x: nativeCenter(guide), y: ownerPaint(4, 7).y };
    } else {
      const box = row(1).getBoundingClientRect();
      target = { x: box.right - 10, y: box.top + box.height / 2 };
    }
    window.focus();
    if (
      !document.title.includes("vault") ||
      document.title.includes("base") ||
      document.visibilityState !== "visible"
    )
      throw Error("Visible test vault required");
    const hit = document.elementFromPoint(target.x, target.y);
    if (!hit || !cm.contentDOM.contains(hit))
      throw Error("Guide hit outside editor");
    window.__guideHoverInput = null;
    cm.contentDOM.addEventListener(
      "pointermove",
      (event) => {
        window.__guideHoverInput = { x: event.clientX, y: event.clientY };
      },
      { once: true, capture: true },
    );
    return { ...target, hit: hit.outerHTML };
  }, kind);
}

function snapshot() {
  return evaluate(async () => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const cm = app.workspace.activeLeaf.view.editor.cm;
    return {
      received: window.__guideHoverInput,
      markdown: cm.state.doc.toString(),
      segments: [
        ...cm.contentDOM.querySelectorAll(
          ".bullet-plugin-hovered-indent-guide",
        ),
      ].map((el) => ({
        line: cm.state.doc.lineAt(cm.posAtDOM(el.closest(".cm-line"))).number,
        owner:
          el.classList.contains("bullet-plugin-code-owner-guide") ||
          el.classList.contains("bullet-plugin-code-preview-owner-guide"),
        width: el.matches(".cm-line")
          ? el.classList.contains("bullet-plugin-code-preview-owner-guide")
            ? parseFloat(getComputedStyle(el, "::after").width)
            : parseFloat(getComputedStyle(el).backgroundSize)
          : Math.max(
              parseFloat(getComputedStyle(el, "::before").width) || 0,
              parseFloat(getComputedStyle(el, "::before").borderRightWidth) ||
                0,
            ),
      })),
    };
  });
}

try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (note) => {
    app.setBaseFontSize(16);
    window.__guideHoverLeaf = app.workspace.getLeaf("tab");
    await window.__guideHoverLeaf.openFile(await app.vault.create(note, ""));
  }, note);
  for (const mode of ["native", "shiki", "numbers"]) {
    evaluate(async (mode) => {
      if (mode === "native")
        await app.plugins.disablePlugin("shiki-highlighter");
      else {
        await app.plugins.enablePlugin("shiki-highlighter");
        const plugin = app.plugins.plugins["shiki-highlighter"];
        if (!plugin) throw Error("Shiki must be installed");
        plugin.settings.ecDefaultShowLineNumbers = mode === "numbers";
        await plugin.reloadHighlighter();
      }
    }, mode);
    for (const editing of [false, true]) {
      evaluate(
        async ({ text, editing }) => {
          const view = app.workspace.activeLeaf.view;
          view.editor.setValue(text);
          view.editor.setCursor(
            editing ? { line: 5, ch: 7 } : { line: 12, ch: 6 },
          );
          view.editor.focus();
          view.editor.scrollIntoView(
            { from: { line: 0, ch: 0 }, to: { line: 12, ch: 6 } },
            true,
          );
          await new Promise((resolve) => setTimeout(resolve, 400));
          await view.save();
          if ((await app.vault.read(view.file)) !== text)
            throw Error("Saved Markdown changed");
        },
        { text, editing },
      );
      for (const kind of [
        "child",
        "owner",
        "owner-left",
        "owner-right",
        "ancestor",
        "leaf",
        "code-text",
        "text",
      ]) {
        const record = {
          name: `${mode}-${editing ? "source" : "preview"}-${kind}`,
        };
        try {
          record.point = point(kind);
          cdp("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: record.point.x,
            y: record.point.y,
          });
          record.state = snapshot();
          const shot = cdp("Page.captureScreenshot", { format: "png" });
          fs.writeFileSync(
            `${output}/${record.name}.png`,
            Buffer.from(shot.data, "base64"),
          );
          if (kind !== "text" && kind !== "code-text") {
            record.paint = evaluate(
              async (data, point) => {
                const bitmap = await createImageBitmap(
                  new Blob(
                    [
                      Uint8Array.from(atob(data), (character) =>
                        character.charCodeAt(0),
                      ),
                    ],
                    { type: "image/png" },
                  ),
                );
                const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
                const context = canvas.getContext("2d");
                context.drawImage(bitmap, 0, 0);
                bitmap.close();
                const scale = canvas.width / innerWidth;
                const paintX = point.paintX ?? point.x;
                const low = Math.floor((paintX - 7) * scale);
                const high = Math.ceil((paintX + 7) * scale);
                const pixels = context.getImageData(
                  low,
                  Math.floor(point.y * scale),
                  high - low + 1,
                  1,
                ).data;
                const value = (index) =>
                  (pixels[index * 4] +
                    pixels[index * 4 + 1] +
                    pixels[index * 4 + 2]) /
                  3;
                const background = (value(0) + value(high - low)) / 2;
                const contrast = Array.from(
                  { length: high - low + 1 },
                  (_, index) => Math.max(0, value(index) - background),
                );
                const peak = Math.max(...contrast);
                const mass = contrast.reduce((sum, value) => sum + value, 0);
                const center =
                  contrast.reduce(
                    (sum, value, index) => sum + value * (low + index + 0.5),
                    0,
                  ) /
                  mass /
                  scale;
                return {
                  width: mass / peak / scale,
                  center,
                  expectedCenter: paintX,
                  peak,
                };
              },
              shot.data,
              record.point,
            );
          }
          assert(
            record.state.received,
            "Renderer received native pointer movement",
          );
          assert(Math.abs(record.state.received.x - record.point.x) < 1);
          assert(Math.abs(record.state.received.y - record.point.y) < 1);
          assert.equal(record.state.markdown, text);
          if (kind === "text" || kind === "code-text")
            assert.equal(
              record.state.segments.length,
              0,
              "Leaving the guide clears all hover paint",
            );
          else {
            assert(
              record.paint.peak > 10,
              "Guide is painted in the screenshot",
            );
            assert(
              record.paint.width >= 2.4 && record.paint.width <= 3.6,
              "Screenshot shows a 3px guide",
            );
            assert(
              Math.abs(record.paint.center - record.paint.expectedCenter) < 0.8,
              "Hover paint remains centered",
            );
            assert(
              record.state.segments.length > 0,
              "Painted guide responds to native hover",
            );
            assert(
              record.state.segments.every(
                (segment) => Math.abs(segment.width - 3) < 0.02,
              ),
              "Every highlighted segment is 3px wide",
            );
            if (kind.startsWith("owner") || kind === "child") {
              assert(
                record.state.segments.some(
                  (segment) =>
                    segment.owner && segment.line >= 4 && segment.line <= 7,
                ),
                "Code owner paint belongs to the native child guide group",
              );
              assert(
                record.state.segments.some((segment) => segment.line === 8),
                "Hover beside code reaches the child guide",
              );
            }
            if (kind === "ancestor")
              assert(
                record.state.segments.some((segment) => segment.line === 4),
                "Code ancestor hover reaches the opening guide",
              );
            if (kind === "leaf")
              assert(
                record.state.segments.some(
                  (segment) =>
                    segment.owner && segment.line >= 9 && segment.line <= 12,
                ),
                "Childless code guide responds to hover",
              );
          }
        } catch (error) {
          record.error = error.stack;
          failures.push({ name: record.name, error: error.message });
        }
        results.push(record);
      }
      if (!editing) {
        const record = { name: `${mode}-owner-fold-unfold` };
        try {
          record.states = [];
          for (const folded of [true, false]) {
            const target = point(folded ? "owner-left" : "owner-right");
            cdp("Input.dispatchMouseEvent", {
              type: "mouseMoved",
              x: target.x,
              y: target.y,
            });
            for (const type of ["mousePressed", "mouseReleased"]) {
              evaluate((target) => {
                window.focus();
                if (
                  !document.title.includes("vault") ||
                  document.title.includes("base")
                )
                  throw Error("Test title required");
                if (
                  !app.workspace.activeLeaf.view.editor.cm.contentDOM.contains(
                    document.elementFromPoint(target.x, target.y),
                  )
                )
                  throw Error("Fresh guide target required");
              }, target);
              cdp("Input.dispatchMouseEvent", {
                type,
                x: target.x,
                y: target.y,
                button: "left",
                clickCount: 1,
              });
            }
            const state = evaluate(async () => {
              await new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              );
              const view = app.workspace.activeLeaf.view,
                cm = view.editor.cm;
              await view.save();
              return {
                codeChildVisible: [
                  ...cm.contentDOM.querySelectorAll(".cm-line"),
                ].some(
                  (el) => cm.state.doc.lineAt(cm.posAtDOM(el)).number === 9,
                ),
                selectedOwner: !!cm.contentDOM.querySelector(
                  ".cm-line.bullet-plugin-selected-indent-guide",
                ),
                markdown: await app.vault.read(view.file),
              };
            });
            record.states.push(state);
            assert.equal(
              state.codeChildVisible,
              !folded,
              "Owner guide toggles its child branch",
            );
            assert(
              state.selectedOwner,
              "Code owner retains the selected guide paint",
            );
            assert.equal(state.markdown, text);
          }
        } catch (error) {
          record.error = error.stack;
          failures.push({ name: record.name, error: error.message });
        }
        results.push(record);
      }
    }
  }
  const resize = { name: "stationary-pointer-font-resize" };
  try {
    const fixture =
      "- root\n\t- ```\n\t  code\n\t  more\n\t  ```\n\t\t- child\n\t\t\t- grandchild\n- tail";
    resize.point = evaluate(async (fixture) => {
      app.setBaseFontSize(16);
      const editor = app.workspace.activeLeaf.view.editor;
      editor.setValue(fixture);
      editor.setCursor({ line: 7, ch: 6 });
      editor.focus();
      window.focus();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const row = [...editor.cm.contentDOM.querySelectorAll(".cm-line")].find(
        (el) => editor.cm.state.doc.lineAt(editor.cm.posAtDOM(el)).number === 4,
      );
      const css = getComputedStyle(row),
        bounds = row.getBoundingClientRect();
      window.__guideResizeRow = row;
      return {
        x:
          bounds.left +
          parseFloat(css.backgroundPositionX) +
          parseFloat(css.backgroundSize) / 2,
        y: bounds.bottom - 1,
      };
    }, fixture);
    evaluate((target) => {
      window.focus();
      if (!document.title.includes("vault") || document.title.includes("base"))
        throw Error("Test title required");
      if (
        !app.workspace.activeLeaf.view.editor.cm.contentDOM.contains(
          document.elementFromPoint(target.x, target.y),
        )
      )
        throw Error("Fresh guide target required");
    }, resize.point);
    cdp("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: resize.point.x,
      y: resize.point.y,
    });
    const before = snapshot();
    assert(before.segments.length > 0, "Owner highlighted before resize");
    resize.after = evaluate(async (point) => {
      app.setBaseFontSize(17);
      await new Promise((resolve) => setTimeout(resolve, 350));
      const row = window.__guideResizeRow;
      const css = getComputedStyle(row),
        bounds = row.getBoundingClientRect();
      const left = bounds.left + parseFloat(css.backgroundPositionX);
      const center = left + parseFloat(css.backgroundSize) / 2;
      const hitLeft =
        center +
        parseFloat(css.getPropertyValue("--bullet-code-guide-hit-offset"));
      const hitWidth = parseFloat(
        css.getPropertyValue("--bullet-code-guide-hit-width"),
      );
      const view = app.workspace.activeLeaf.view;
      await view.save();
      return {
        connected: row.isConnected,
        hoveredRow: row.matches(":hover"),
        insidePaint:
          left <= point.x && point.x < left + parseFloat(css.backgroundSize),
        insideHit: hitLeft <= point.x && point.x < hitLeft + hitWidth,
        hoveredSegments: view.editor.cm.contentDOM.querySelectorAll(
          ".bullet-plugin-hovered-indent-guide",
        ).length,
        markdown: await app.vault.read(view.file),
      };
    }, resize.point);
    assert(
      resize.after.connected && resize.after.hoveredRow,
      "Resize retains the same hovered row",
    );
    assert.equal(
      resize.after.insidePaint,
      false,
      "Paint moved away from the stationary pointer",
    );
    assert(
      resize.after.insideHit && resize.after.hoveredSegments > 0,
      "Stationary pointer follows the current native-sized hit area",
    );
    assert.equal(resize.after.markdown, fixture);
  } catch (error) {
    resize.error = error.stack;
    failures.push({ name: resize.name, error: error.message });
  }
  results.push(resize);
} finally {
  fs.writeFileSync(
    `${output}/results.json`,
    JSON.stringify({ results, failures }, null, 2),
  );
  try {
    evaluate(
      async ({ original, note }) => {
        window.__guideHoverLeaf?.detach();
        delete window.__guideHoverLeaf;
        delete window.__guideHoverInput;
        delete window.__guideResizeRow;
        app.setBaseFontSize(original.font);
        if (original.shiki) {
          await app.plugins.enablePlugin("shiki-highlighter");
          const plugin = app.plugins.plugins["shiki-highlighter"];
          plugin.settings = original.settings;
          await plugin.reloadHighlighter();
        } else await app.plugins.disablePlugin("shiki-highlighter");
        const leaf = app.workspace.getLeafById(original.leaf);
        if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
        const file = app.vault.getAbstractFileByPath(note);
        if (file) await app.fileManager.trashFile(file);
      },
      { original, note },
    );
  } finally {
    cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
  }
}
console.log(JSON.stringify({ results: results.length, failures }));
assert.equal(failures.length, 0);
