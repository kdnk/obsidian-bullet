const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const {
  cdp,
  evaluate: evaluateDesktop,
} = require("./obsidian-scroll-driver.cjs");
const mobile = process.argv.includes("--mobile");
function evaluate(fn, ...args) {
  if (!mobile) return evaluateDesktop(fn, ...args);
  const vault = path.resolve(__dirname, "../vault");
  const response = cdp("Runtime.evaluate", {
    expression: `(async () => {
      if (app.vault.adapter.getBasePath() !== ${JSON.stringify(vault)} ||
          app.vault.config.useTab !== true || app.vault.config.tabSize !== 4)
        throw Error("Test vault guard");
      return (${fn.toString()})(...${JSON.stringify(args)});
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails)
    throw Error(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text,
    );
  return response.result.value;
}

if (!process.argv[2])
  throw Error(
    "Usage: verify-fold-parent-position.cjs <fresh-output-directory> [--full] [--mobile] [--new-pane] [--collapsed-properties] [--kind=unordered|ordered|task|nested|empty|heading|wrapped] [--selection=range|multiple|vim]",
  );
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: true });
const full = process.argv.includes("--full");
const collapsedProperties = process.argv.includes("--collapsed-properties");
const newPane = process.argv.includes("--new-pane");
assert.ok(!newPane || !mobile, "New pane verification requires desktop mode");
const selection = process.argv
  .find((arg) => arg.startsWith("--selection="))
  ?.slice(12);
assert.ok(!selection || ["range", "multiple", "vim"].includes(selection));
const kind =
  process.argv.find((arg) => arg.startsWith("--kind="))?.slice(7) ??
  "unordered";
const parentLines = {
  unordered: "- Target parent",
  ordered: "1. Target parent",
  task: "- [ ] Target parent",
  nested: "\t- Target parent",
  empty: "- ",
  heading: "## Target heading",
  wrapped: "- Target parent " + "wrapped words ".repeat(25),
};
assert.ok(kind in parentLines, "Unknown parent kind");
const targetLine = parentLines[kind];
const note = `pages/Fold parent verification ${randomUUID()}.md`;
const initial = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  file: app.workspace.getActiveFile()?.path,
  viewState: app.workspace.activeLeaf.getViewState(),
  font: app.getBaseFontSize(),
  vim: app.vault.config.vimMode ?? false,
  zoom: require("electron").webFrame.getZoomLevel(),
  mobileRightFoldControls:
    app.plugins.plugins.bullet.settings.mobileRightFoldControls,
}));
const results = [];

function mobileMode(enabled) {
  evaluate(
    (enabled) => window.setTimeout(() => app.emulateMobile(enabled), 0),
    enabled,
  );
  execFileSync("sleep", ["1"]);
  execFileSync(
    "obsidian-cli",
    ["vault=vault", "open", `path=${initial.file ?? "test.md"}`],
    { timeout: 20000 },
  );
  execFileSync("obsidian-cli", ["vault=vault", "plugin:reload", "id=bullet"], {
    timeout: 20000,
  });
  evaluate((enabled) => {
    if (
      document.body.classList.contains("is-mobile") !== enabled ||
      !app.workspace.activeLeaf.view.editor?.cm
    )
      throw Error("Mode transition must reconnect the test editor");
  }, enabled);
}

function sample() {
  return evaluate(() => {
    const p = window.__bulletParentVerification;
    const v = app.workspace.activeLeaf.view.editor.cm;
    const row = [...v.contentDOM.querySelectorAll(".cm-line")].find(
      (e) =>
        v.state.doc.lineAt(v.posAtDOM(e)).text ===
        window.__bulletParentVerification.target,
    );
    const bullet =
      row?.querySelector(".list-bullet")?.getBoundingClientRect() ??
      (row && v.coordsAtPos(v.state.doc.lineAt(v.posAtDOM(row)).from + 3));
    const external = v.scrollDOM.querySelector(
      ".bullet-plugin-fold-scroll-reserve",
    );
    const metadata = app.workspace.activeLeaf.view.containerEl.querySelector(
      ".metadata-container",
    );
    if (!p.reserveNode) p.reserveNode = external;
    return {
      sameReserveNode: external === p.reserveNode,
      y: bullet ? (bullet.top + bullet.bottom) / 2 : null,
      rowY: row
        ? row.getBoundingClientRect().top -
          v.scrollDOM.getBoundingClientRect().top
        : null,
      dpr: devicePixelRatio,
      offset:
        Number.parseFloat(
          v.contentDOM
            .closest(".cm-contentContainer")
            ?.style.getPropertyValue("--bullet-plugin-fold-scroll-offset"),
        ) || 0,
      folded: !!row?.querySelector(".cm-fold-indicator.is-collapsed"),
      metadataHeight: metadata?.getBoundingClientRect().height,
      visibleProperties: metadata
        ? [...metadata.querySelectorAll(".metadata-property")].filter(
            (element) => element.getBoundingClientRect().height > 0,
          ).length
        : 0,
      padding: getComputedStyle(v.contentDOM).paddingBottom,
      contentHeight: v.contentDOM.getBoundingClientRect().height,
      reserve: external?.getBoundingClientRect().height ?? null,
      external: !!external && !v.contentDOM.contains(external),
      editable: external?.getAttribute("contenteditable"),
      unchanged: v.state.doc.toString() === p.text,
      frames: p.frames,
      overlays: p.measureOverlays(),
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
  evaluate(
    async (y, selection) => {
      const e = app.workspace.activeLeaf.view.editor;
      const v = e.cm;
      const n = v.state.doc
        .toString()
        .split("\n")
        .indexOf(window.__bulletParentVerification.target);
      if (selection === "range") {
        e.setSelection({ line: n - 1, ch: 2 }, { line: n - 1, ch: 8 });
        e.focus();
      } else if (selection === "multiple") {
        const type = v.state.selection.constructor;
        v.dispatch({
          selection: type.create(
            [
              type.cursor(v.state.doc.line(n).from + 2),
              type.range(
                v.state.doc.line(n - 1).from + 2,
                v.state.doc.line(n - 1).from + 8,
              ),
            ],
            0,
          ),
        });
        e.focus();
      } else if (selection === "vim") {
        e.setCursor(n - 1, 2);
        e.focus();
      } else e.setCursor(0, 0);
      e.scrollIntoView(
        { from: { line: n, ch: 0 }, to: { line: n, ch: 3 } },
        true,
      );
      await new Promise((r) => setTimeout(r, 350));
      for (let attempt = 0; attempt < 3; attempt++) {
        const row = [...v.contentDOM.querySelectorAll(".cm-line")].find(
          (e) =>
            v.state.doc.lineAt(v.posAtDOM(e)).text ===
            window.__bulletParentVerification.target,
        );
        const difference =
          row.getBoundingClientRect().top -
          v.scrollDOM.getBoundingClientRect().top -
          y;
        if (Math.abs(difference) <= 1 / devicePixelRatio) break;
        v.scrollDOM.scrollTop += difference;
        await new Promise((r) => setTimeout(r, 350));
      }
    },
    y,
    selection,
  );
}

function focusTestWindow() {
  evaluate(() => {
    window.focus();
    if (!document.title.includes("vault") || document.title.includes("base"))
      throw Error("Title guard");
  });
}

function click() {
  const hover = evaluate((mobile) => {
    window.focus();
    if (!document.title.includes("vault") || document.title.includes("base"))
      throw Error("Title guard");
    const v = app.workspace.activeLeaf.view.editor.cm;
    const row = [...v.contentDOM.querySelectorAll(".cm-line")].find(
      (e) =>
        v.state.doc.lineAt(v.posAtDOM(e)).text ===
        window.__bulletParentVerification.target,
    );
    const rect = row.getBoundingClientRect();
    const point = {
      x: rect.left + Math.min(60, rect.width / 2),
      y: rect.top + 12,
    };
    if (!mobile && !row.contains(document.elementFromPoint(point.x, point.y)))
      throw Error("Covered parent row");
    return point;
  }, mobile);
  if (!mobile)
    cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...hover });
  const target = evaluate(async () => {
    window.focus();
    if (!document.title.includes("vault") || document.title.includes("base"))
      throw Error("Title guard");
    const p = window.__bulletParentVerification;
    const v = app.workspace.activeLeaf.view.editor.cm;
    const row = [...v.contentDOM.querySelectorAll(".cm-line")].find(
      (e) =>
        v.state.doc.lineAt(v.posAtDOM(e)).text ===
        window.__bulletParentVerification.target,
    );
    const control = row.querySelector(".collapse-indicator");
    let bounds;
    let target;
    const deadline = performance.now() + 10000;
    do {
      bounds = [control.querySelector("svg"), control]
        .filter(Boolean)
        .map((element) => element.getBoundingClientRect());
      target = bounds
        .flatMap((rect) =>
          [0.5, 0.2, 0.8, 0.05, 0.95].map((fraction) => ({
            x: rect.x + rect.width * fraction,
            y: rect.y + Math.min(rect.height / 2, 12),
          })),
        )
        .find(({ x, y }) => control.contains(document.elementFromPoint(x, y)));
      if (target) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (performance.now() < deadline);
    if (!target)
      throw Error(
        JSON.stringify({
          message: "Covered fold control",
          bounds: bounds.map((rect) => rect.toJSON()),
          row: row.outerHTML,
        }),
      );
    const { x, y } = target;
    p.frames = [];
    let start;
    const record = () => {
      const row = [...v.contentDOM.querySelectorAll(".cm-line")].find(
        (e) =>
          v.state.doc.lineAt(v.posAtDOM(e)).text ===
          window.__bulletParentVerification.target,
      );
      const b =
        row?.querySelector(".list-bullet")?.getBoundingClientRect() ??
        (row && v.coordsAtPos(v.state.doc.lineAt(v.posAtDOM(row)).from + 3));
      p.frames.push({
        y: b ? (b.top + b.bottom) / 2 : null,
        overlays: p.measureOverlays(),
        t: performance.now() - start,
      });
      if (performance.now() - start < 450) requestAnimationFrame(record);
    };
    p.clickRecorder = () => {
      start = performance.now();
      requestAnimationFrame(record);
    };
    p.recorderDOM = v.contentDOM;
    v.contentDOM.addEventListener("click", p.clickRecorder, {
      capture: true,
      once: true,
    });
    return { x, y };
  });
  if (!mobile)
    cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...target });
  focusTestWindow();
  if (mobile)
    cdp("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...target, id: 0 }],
    });
  else
    cdp("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      buttons: 1,
      clickCount: 1,
      ...target,
    });
  focusTestWindow();
  if (mobile)
    cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  else
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
  if (mobile) {
    mobileMode(true);
    evaluate(
      () =>
        (app.plugins.plugins.bullet.settings.mobileRightFoldControls = true),
    );
    cdp("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    cdp("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
  }
  evaluate(
    async (note, target, kind, selection, collapsedProperties, newPane) => {
      window.focus();
      if (document.visibilityState !== "visible")
        throw Error("Visible renderer required");
      if (selection === "vim") {
        app.vault.setConfig("vimMode", true);
        app.workspace.updateOptions();
      }
      const before = Array.from(
        { length: 140 },
        (_, i) => `- Before ${i}`,
      ).join("\n");
      const children = Array.from(
        { length: 110 },
        (_, i) =>
          `${kind === "heading" ? "" : kind === "nested" ? "\t\t" : "\t"}- Child ${i}`,
      ).join("\n");
      const text = `---\nstatus: verification\nowner: Bullet\npriority: 3\nenabled: true\ncategory: editor\nplatform: desktop\ncreated: 2026-10-05\ntags: [fold]\n---\n# Fold parent verification\n${before}\n${kind === "nested" ? "- Section owner\n" : ""}${target}\n${children}`;
      const file = await app.vault.create(note, text);
      const previous = app.workspace.activeLeaf;
      const leaf = app.workspace.getLeaf(newPane);
      await leaf.openFile(file);
      await new Promise((r) => setTimeout(r, 500));
      if (newPane && leaf.view.editor.cm === previous.view.editor.cm)
        throw Error("New pane must create a separate editor");
      const metadata = app.workspace.activeLeaf.view.containerEl.querySelector(
        ".metadata-container",
      );
      if (
        metadata &&
        metadata.classList.contains("is-collapsed") !== collapsedProperties
      )
        metadata.querySelector(".metadata-properties-heading").click();
      window.__bulletParentVerification = {
        leaf: leaf.id,
        text,
        target,
        frames: [],
        measureOverlays() {
          if (!selection) return [];
          const v = app.workspace.activeLeaf.view.editor.cm;
          const range =
            selection === "multiple"
              ? v.state.selection.ranges.find(
                  (r) => r !== v.state.selection.main,
                )
              : v.state.selection.main;
          const cursor = v.dom.querySelector(
            selection === "vim"
              ? ".cm-vimCursorLayer .cm-fat-cursor.cm-cursor-primary"
              : selection === "multiple"
                ? ".cm-cursor-secondary"
                : ".cm-cursor-primary",
          );
          const background = v.dom.querySelector(".cm-selectionBackground");
          return [
            cursor
              ? cursor.getBoundingClientRect().top -
                v.coordsAtPos(range.head).top
              : null,
            ...(selection === "multiple"
              ? [
                  background
                    ? background.getBoundingClientRect().top -
                      v.coordsAtPos(range.from).top
                    : null,
                ]
              : []),
          ];
        },
      };
      await new Promise((r) => setTimeout(r, 500));
    },
    note,
    targetLine,
    kind,
    selection,
    collapsedProperties,
    newPane,
  );
  if (selection === "vim") {
    focusTestWindow();
    for (const type of ["keyDown", "keyUp"])
      cdp("Input.dispatchKeyEvent", {
        type,
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
  }
  const cases = mobile
    ? [
        [0, 16],
        [0, 12],
      ]
    : full
      ? selection
        ? [
            [0, 16],
            [1, 16],
            [3, 12],
          ]
        : [
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
    for (const y of full || mobile ? [100, 160, 400] : [160]) {
      locate(y);
      const before = sample();
      assert.equal(
        before.visibleProperties,
        collapsedProperties ? 0 : 8,
        "Frontmatter property display must match the requested state",
      );
      fs.writeFileSync(
        path.join(output, "before.json"),
        JSON.stringify(before, null, 2),
      );
      assert.ok(
        Math.abs(before.rowY - y) <= 2 / before.dpr,
        "Parent must reach requested viewport position",
      );
      assert.ok(
        before.overlays.every((value) => value !== null),
        "Selection overlays must be rendered",
      );
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
      const turns = [];
      for (let i = 0; i < (full || mobile ? 6 : 4); i++) {
        turns.push(click());
        fs.writeFileSync(
          path.join(output, "current.json"),
          JSON.stringify({ before, turns }, null, 2),
        );
      }
      const positions = [
        before.y,
        ...turns.flatMap((t) => [t.y, ...t.frames.map((f) => f.y)]),
      ];
      assert.ok(
        positions.every((p) => p !== null),
        "Parent must remain rendered throughout folding",
      );
      const delta = Math.max(...positions) - Math.min(...positions);
      const result = {
        kind,
        selection,
        mobile,
        newPane,
        steps,
        font,
        y,
        before,
        turns,
        delta,
      };
      results.push(result);
      fs.writeFileSync(
        path.join(output, "results.json"),
        JSON.stringify(results, null, 2),
      );
      console.log(
        JSON.stringify({
          kind,
          mobile,
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
        assert.ok(
          Math.abs(t.offset) <= 2 / t.dpr,
          "Content correction must remain bounded to rounding",
        );
        assert.ok(
          t.frames.length >= 5,
          "Native click must record painted frames",
        );
        for (const frame of [t, ...t.frames])
          assert.deepEqual(
            frame.overlays,
            before.overlays,
            "Cursor and selection overlays must remain aligned",
          );
        assert.equal(t.unchanged, true, "Folding must preserve Markdown");
        assert.equal(
          t.sameReserveNode,
          true,
          "Folding must reuse the same reserve DOM element",
        );
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
  if (mobile) {
    mobileMode(false);
    evaluate((initial) => {
      app.plugins.plugins.bullet.settings.mobileRightFoldControls =
        initial.mobileRightFoldControls;
    }, initial);
    cdp("Emulation.clearDeviceMetricsOverride", {});
    cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
  evaluate(
    async (initial, note, newPane) => {
      const verification = window.__bulletParentVerification;
      verification?.recorderDOM?.removeEventListener(
        "click",
        verification.clickRecorder,
        true,
      );
      if (newPane) {
        const leaves = app.workspace.getLeavesOfType("markdown");
        const previous = leaves.find((leaf) => leaf.id === initial.leaf);
        const created = leaves.find((leaf) => leaf.id === verification?.leaf);
        if (!previous) throw Error("Original pane must remain available");
        created?.detach();
        app.workspace.setActiveLeaf(previous, { focus: true });
      }
      app.vault.setConfig("vimMode", initial.vim);
      app.workspace.updateOptions();
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
    newPane,
  );
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
}
