const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

if (!process.argv[2])
  throw Error(
    "Usage: verify-fold-parent-position.cjs <fresh-output-directory> [--full]",
  );
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: true });
const full = process.argv.includes("--full");
const note = `pages/Fold parent verification ${randomUUID()}.md`;
const initial = evaluate(() => ({
  file: app.workspace.getActiveFile()?.path,
  viewState: app.workspace.activeLeaf.getViewState(),
  font: app.getBaseFontSize(),
  zoom: require("electron").webFrame.getZoomLevel(),
}));
const results = [];

function sample() {
  return evaluate(() => {
    const p = window.__bulletParentVerification;
    const v = app.workspace.activeLeaf.view.editor.cm;
    const row = [...v.contentDOM.querySelectorAll(".cm-line")].find(
      (e) => v.state.doc.lineAt(v.posAtDOM(e)).text === "- Target parent",
    );
    const bullet = row?.querySelector(".list-bullet")?.getBoundingClientRect();
    const external = v.scrollDOM.querySelector(
      ".bullet-plugin-fold-scroll-reserve",
    );
    return {
      y: bullet ? (bullet.top + bullet.bottom) / 2 : null,
      folded: !!row?.querySelector(".cm-fold-indicator.is-collapsed"),
      padding: getComputedStyle(v.contentDOM).paddingBottom,
      contentHeight: v.contentDOM.getBoundingClientRect().height,
      reserve: external?.getBoundingClientRect().height ?? null,
      external: !!external && !v.contentDOM.contains(external),
      editable: external?.getAttribute("contenteditable"),
      unchanged: v.state.doc.toString() === p.text,
      frames: p.frames,
      scrollTop: v.scrollDOM.scrollTop,
      font: app.getBaseFontSize(),
      zoom: require("electron").webFrame.getZoomFactor(),
    };
  });
}

function settle() {
  evaluate(async () => {
    await new Promise((r) => setTimeout(r, 500));
  });
}

function settings(steps, font) {
  evaluate(
    async (steps, font) => {
      window.focus();
      const frame = require("electron").webFrame;
      const waitZoom = async (expected) => {
        const start = performance.now();
        while (Math.abs(frame.getZoomLevel() - expected) > 1e-8) {
          if (performance.now() - start > 5000)
            throw Error("Zoom command timeout");
          await new Promise((r) => setTimeout(r, 20));
        }
      };
      app.commands.executeCommandById("window:reset-zoom");
      await waitZoom(0);
      for (let n = 0; n < steps; n++) {
        app.commands.executeCommandById("window:zoom-out");
        await waitZoom(-(n + 1) / 2);
      }
      app.setBaseFontSize(font);
      await new Promise((r) => setTimeout(r, 700));
    },
    steps,
    font,
  );
}

function locate(y) {
  evaluate(async (y) => {
    const e = app.workspace.activeLeaf.view.editor;
    const v = e.cm;
    const n = v.state.doc.toString().split("\n").indexOf("- Target parent");
    e.setCursor(0, 0);
    e.scrollIntoView(
      { from: { line: n, ch: 0 }, to: { line: n, ch: 3 } },
      true,
    );
    await new Promise((r) => setTimeout(r, 350));
    const row = [...v.contentDOM.querySelectorAll(".cm-line")].find(
      (e) => v.state.doc.lineAt(v.posAtDOM(e)).text === "- Target parent",
    );
    v.scrollDOM.scrollTop +=
      row.getBoundingClientRect().top -
      v.scrollDOM.getBoundingClientRect().top -
      y;
    await new Promise((r) => setTimeout(r, 350));
  }, y);
}

function focusTestWindow() {
  evaluate(() => {
    window.focus();
    if (!document.title.includes("vault") || document.title.includes("base"))
      throw Error("Title guard");
  });
}

function click() {
  const target = evaluate(() => {
    window.focus();
    if (!document.title.includes("vault") || document.title.includes("base"))
      throw Error("Title guard");
    const p = window.__bulletParentVerification;
    const v = app.workspace.activeLeaf.view.editor.cm;
    const row = [...v.contentDOM.querySelectorAll(".cm-line")].find(
      (e) => v.state.doc.lineAt(v.posAtDOM(e)).text === "- Target parent",
    );
    const control = row.querySelector(".collapse-indicator");
    const rect = control.getBoundingClientRect();
    const x = rect.x + rect.width / 2,
      y = rect.y + rect.height / 2;
    if (!control.contains(document.elementFromPoint(x, y)))
      throw Error("Covered fold control");
    p.frames = [];
    const start = performance.now();
    const record = () => {
      const row = [...v.contentDOM.querySelectorAll(".cm-line")].find(
        (e) => v.state.doc.lineAt(v.posAtDOM(e)).text === "- Target parent",
      );
      const b = row?.querySelector(".list-bullet")?.getBoundingClientRect();
      p.frames.push({
        y: b ? (b.top + b.bottom) / 2 : null,
        t: performance.now() - start,
      });
      if (performance.now() - start < 450) requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
    return { x, y };
  });
  cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...target });
  focusTestWindow();
  cdp("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    buttons: 1,
    clickCount: 1,
    ...target,
  });
  focusTestWindow();
  cdp("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    buttons: 0,
    clickCount: 1,
    ...target,
  });
  settle();
  return sample();
}

try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (note) => {
    window.focus();
    if (document.visibilityState !== "visible")
      throw Error("Visible renderer required");
    const before = Array.from({ length: 140 }, (_, i) => `- Before ${i}`).join(
      "\n",
    );
    const children = Array.from(
      { length: 110 },
      (_, i) => `\t- Child ${i}`,
    ).join("\n");
    const text = `---\nstatus: verification\nowner: Bullet\npriority: 3\nenabled: true\ncategory: editor\nplatform: desktop\ncreated: 2026-10-05\ntags: [fold]\n---\n# Fold parent verification\n${before}\n- Target parent\n${children}`;
    const file = await app.vault.create(note, text);
    await app.workspace.getLeaf(false).openFile(file);
    await new Promise((r) => setTimeout(r, 500));
    const metadata = app.workspace.activeLeaf.view.containerEl.querySelector(
      ".metadata-container",
    );
    if (metadata?.classList.contains("is-collapsed"))
      metadata.querySelector(".metadata-properties-heading").click();
    window.__bulletParentVerification = { text, frames: [] };
    await new Promise((r) => setTimeout(r, 500));
  }, note);
  const cases = full
    ? [
        [0, 16],
        [1, 16],
        [2, 16],
        [3, 16],
        [4, 16],
        [0, 14],
        [1, 14],
        [0, 12],
        [1, 12],
        [2, 12],
        [3, 12],
      ]
    : [[0, 16]];
  for (const [steps, font] of cases) {
    settings(steps, font);
    for (const y of full ? [100, 160, 400] : [160]) {
      locate(y);
      const before = sample();
      assert.equal(
        before.external,
        true,
        "Reserve must exist outside editable content",
      );
      assert.equal(before.editable, "false", "Reserve must be noneditable");
      assert.equal(
        before.reserve,
        0,
        "Expanded note must not retain added tail space",
      );
      const turns = Array.from({ length: full ? 6 : 4 }, click);
      const positions = [
        before.y,
        ...turns.flatMap((t) => [t.y, ...t.frames.map((f) => f.y)]),
      ];
      assert.ok(
        positions.every((p) => p !== null),
        "Parent must remain rendered throughout folding",
      );
      const delta = Math.max(...positions) - Math.min(...positions);
      const result = { steps, font, y, before, turns, delta };
      results.push(result);
      fs.writeFileSync(
        path.join(output, "results.json"),
        JSON.stringify(results, null, 2),
      );
      console.log(
        JSON.stringify({
          steps,
          font,
          y,
          delta,
          reserve: turns.map((t) => t.reserve),
        }),
      );
      assert.equal(
        delta,
        0,
        "Clicked parent screen Y must remain exactly unchanged",
      );
      turns.forEach((t, i) => {
        assert.equal(t.unchanged, true, "Folding must preserve Markdown");
        assert.equal(
          t.padding,
          before.padding,
          "Folding must not extend editable padding",
        );
        assert.equal(
          t.folded,
          i % 2 === 0,
          "Native input must toggle the parent",
        );
        if (i % 2)
          assert.equal(t.reserve, 0, "Unfolding must remove added space");
        else
          assert.ok(
            t.contentHeight < before.contentHeight,
            "Editable content must shrink when folded",
          );
      });
    }
  }
} finally {
  evaluate(
    async (initial, note) => {
      app.commands.executeCommandById("window:reset-zoom");
      app.setBaseFontSize(initial.font);
      const frame = require("electron").webFrame;
      await new Promise((r) => setTimeout(r, 300));
      while (Math.abs(frame.getZoomLevel() - initial.zoom) > 1e-8) {
        app.commands.executeCommandById(
          frame.getZoomLevel() < initial.zoom
            ? "window:zoom-in"
            : "window:zoom-out",
        );
        await new Promise((r) => setTimeout(r, 50));
      }
      if (initial.file)
        await app.workspace.activeLeaf.setViewState(initial.viewState);
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.trash(file, false);
      delete window.__bulletParentVerification;
    },
    initial,
    note,
  );
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
}
