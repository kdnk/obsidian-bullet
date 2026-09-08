// Deploy the current test build to the repository vault, then run separately
// from full tests. --zoom tests zoom restoration; the default tests reflow.
// --pane resizes only the editor pane, without a window resize event.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

const zoom = process.argv.includes("--zoom");
const navigation = process.argv.includes("--navigation");
const pane = process.argv.includes("--pane") || navigation;
const note = `scroll-${randomUUID().slice(0, 8)}.md`;
const initial = evaluate(() => {
  if (!app.plugins.plugins.bullet)
    throw Error("Enable Bullet before verification");
  return { file: app.workspace.getActiveFile()?.path, dpr: devicePixelRatio };
});
const results = [];

function sample(targetText = "Last parent") {
  return evaluate((targetText) => {
    const view = app.workspace.activeLeaf.view.editor.cm;
    const bounds = view.scrollDOM.getBoundingClientRect();
    const lines = [...view.contentDOM.querySelectorAll(".cm-line")];
    const first = lines.find((line) => {
      const rect = line.getBoundingClientRect();
      return rect.bottom > bounds.top + 3 && rect.top < bounds.bottom;
    });
    const parent = lines.find((line) =>
      line.textContent.includes("Last parent"),
    );
    const target = lines.find(
      (line) =>
        view.state.doc.lineAt(view.posAtDOM(line)).text.trim() ===
        `- ${targetText}`,
    );
    const cursor = view.coordsAtPos(view.state.selection.main.head);
    return {
      cursorY: cursor ? cursor.top - bounds.top : null,
      cursorBottom: cursor ? cursor.bottom - bounds.top : null,
      viewportHeight: bounds.height,
      width: view.scrollDOM.clientWidth,
      line: first ? view.state.doc.lineAt(view.posAtDOM(first)).number : null,
      y: first ? first.getBoundingClientRect().top - bounds.top : null,
      parentY: parent ? parent.getBoundingClientRect().top - bounds.top : null,
      parentFolded: !!parent?.querySelector(".cm-fold-indicator.is-collapsed"),
      scrollTop: view.scrollDOM.scrollTop,
      scrollHeight: view.scrollDOM.scrollHeight,
      padding: getComputedStyle(view.contentDOM).paddingBottom,
      zoom: !!view.dom.closest(".bullet-zoom-active"),
      zoomTarget:
        view.dom.querySelector(
          '.bullet-zoom-breadcrumbs [aria-current="location"]',
        )?.textContent ?? null,
      target: target
        ? {
            line: view.state.doc.lineAt(view.posAtDOM(target)).number,
            text: view.state.doc.lineAt(view.posAtDOM(target)).text.trim(),
            folded: !!target.querySelector(".cm-fold-indicator.is-collapsed"),
          }
        : null,
    };
  }, targetText);
}

function settle(targetText) {
  evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  return sample(targetText);
}

function resize(width) {
  evaluate(() => window.focus());
  if (pane) {
    evaluate((width) => {
      const container = app.workspace.activeLeaf.view.containerEl;
      container.style.width = `${width}px`;
      container.style.flex = "none";
    }, width);
  } else {
    cdp("Emulation.setDeviceMetricsOverride", {
      width,
      height: 700,
      deviceScaleFactor: initial.dpr,
      mobile: false,
    });
  }
  return settle();
}

function locate(text, y) {
  evaluate(
    async (text, y) => {
      const editor = app.workspace.activeLeaf.view.editor;
      const view = editor.cm;
      const n =
        view.state.doc
          .toString()
          .split("\n")
          .findIndex((line) => line.trim() === `- ${text}`) + 1;
      if (!n) throw Error(`Missing fixture line: ${text}`);
      editor.scrollIntoView(
        { from: { line: n - 1, ch: 0 }, to: { line: n - 1, ch: 4 } },
        true,
      );
      await new Promise((resolve) => setTimeout(resolve, 350));
      const line = [...view.contentDOM.querySelectorAll(".cm-line")].find(
        (line) =>
          line.textContent.trim() === text ||
          line.textContent.trim() === `- ${text}`,
      );
      if (!line) throw Error(`Fixture line is not rendered: ${text}`);
      view.scrollDOM.scrollTop +=
        line.getBoundingClientRect().top -
        view.scrollDOM.getBoundingClientRect().top -
        y;
    },
    text,
    y,
  );
  return settle();
}

function nativeFold(text) {
  evaluate((text) => {
    const view = app.workspace.activeLeaf.view.editor.cm;
    const line = [...view.contentDOM.querySelectorAll(".cm-line")].find(
      (line) =>
        view.state.doc.lineAt(view.posAtDOM(line)).text.trim() === `- ${text}`,
    );
    const control = line?.querySelector(".collapse-indicator");
    if (!control) throw Error(`Missing native control: ${text}`);
    const bounds = control.getBoundingClientRect();
    const viewport = view.scrollDOM.getBoundingClientRect();
    if (bounds.top < viewport.top || bounds.bottom > viewport.bottom)
      throw Error("Control must be visible before the pointer sequence");
    for (const type of ["pointerdown", "pointerup", "click"]) {
      control.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerType: "mouse",
          button: 0,
          buttons: type === "pointerdown" ? 1 : 0,
          clientX: bounds.x + bounds.width / 2,
          clientY: bounds.y + bounds.height / 2,
        }),
      );
    }
  }, text);
  return settle(text);
}

function command(id) {
  evaluate((id) => {
    if (!app.commands.executeCommandById(`bullet:${id}`))
      throw Error(`Command failed: ${id}`);
  }, id);
  return settle();
}

function expectAnchor(actual, before, message) {
  assert.notEqual(before.line, null, "The reference line must be visible");
  assert.equal(actual.line, before.line, `${message}: visible document line`);
  assert.ok(
    Math.abs(actual.y - before.y) <= 1 / initial.dpr,
    `${message}: screen Y (${before.y} → ${actual.y})`,
  );
}

try {
  evaluate(
    async (note, zoom) => {
      const frontmatter = zoom
        ? "---\nstatus: verification\npriority: 3\nowner: Bullet\nenabled: true\ntags:\n  - scroll\ncreated: 2026-09-01\ncategory: editor\nplatform: desktop\n---\n"
        : "";
      const before = Array.from(
        { length: 65 },
        (_, i) =>
          `- Before ${i}` +
          (zoom
            ? ""
            : " Text above the viewport must reflow when the pane becomes narrow.".repeat(
                6,
              )),
      ).join("\n");
      const anchors = zoom
        ? ""
        : "\n" +
          Array.from({ length: 12 }, (_, i) => `- Anchor ${i}`).join("\n");
      const children = Array.from(
        { length: 6 },
        (_, i) =>
          `\t- Branch ${i}\n` +
          Array.from({ length: 4 }, (_, j) => `\t\t- Leaf ${i}.${j}`).join(
            "\n",
          ),
      ).join("\n");
      const file = await app.vault.create(
        note,
        frontmatter + before + anchors + "\n- Last parent\n" + children,
      );
      await app.workspace.getLeaf(false).openFile(file);
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (zoom) {
        const metadata =
          app.workspace.activeLeaf.view.containerEl.querySelector(
            ".metadata-container",
          );
        if (metadata?.classList.contains("is-collapsed"))
          metadata.querySelector(".metadata-properties-heading").click();
        if (!metadata || metadata.getBoundingClientRect().height < 200)
          throw Error(
            "Expanded Properties are required for the zoom regression",
          );
      }
    },
    note,
    zoom,
  );
  cdp("Emulation.setDeviceMetricsOverride", {
    width: 1000,
    height: 700,
    deviceScaleFactor: initial.dpr,
    mobile: false,
  });
  resize(900);
  locate("Last parent", 160);
  if (zoom) {
    evaluate(() => {
      const view = app.workspace.activeLeaf.view.editor.cm;
      const n =
        view.state.doc
          .toString()
          .split("\n")
          .findIndex((line) => line === "- Last parent") + 1;
      view.dispatch({ selection: { anchor: view.state.doc.line(n).from + 2 } });
    });
    const before = settle();
    results.push({ step: "before zoom", ...before });
    assert.equal(
      before.zoom,
      false,
      "The scenario must start in the whole note",
    );
    assert.equal(before.target?.text, "- Last parent");
    const zoomed = command("zoom-in");
    results.push({ step: "zoom in", ...zoomed });
    assert.equal(zoomed.zoom, true, "Zoom must activate before folding");
    assert.equal(
      zoomed.zoomTarget,
      "Last parent",
      "Zoom must focus the fixture parent",
    );
    assert.equal(zoomed.target?.line, before.target.line);
    const child = sample("Branch 0");
    results.push({ step: "before child fold", ...child });
    assert.equal(child.target?.text, "- Branch 0");
    assert.equal(child.target.folded, false, "The child must start expanded");
    const folded = nativeFold("Branch 0");
    results.push({ step: "fold child", ...folded });
    assert.equal(folded.zoom, true, "Folding must retain zoom");
    assert.equal(folded.zoomTarget, "Last parent");
    assert.equal(
      folded.target?.line,
      child.target.line,
      "Fold the intended child",
    );
    assert.equal(
      folded.target.folded,
      true,
      "The child must fold before zoom reset",
    );
    const restored = command("zoom-reset");
    results.push({ step: "whole note", ...restored });
    assert.equal(restored.zoom, false);
    expectAnchor(restored, before, "Whole-note zoom restoration");
  } else if (navigation) {
    for (const kind of ["selection", "effect"]) {
      for (const flush of [false, true]) {
        resize(900);
        locate("Last parent", 160);
        evaluate(
          (kind, flush) => {
            const view = app.workspace.activeLeaf.view.editor.cm;
            const position = view.state.doc.line(67).from + 2;
            view.dispatch({
              selection: { anchor: position },
              ...(kind === "selection"
                ? { scrollIntoView: true }
                : {
                    effects: view.constructor.scrollIntoView(position, {
                      y: "start",
                      yMargin: 2,
                    }),
                  }),
            });
            if (flush) view.lineBlockAtHeight(0);
            app.workspace.activeLeaf.view.containerEl.style.width = "500px";
            window.dispatchEvent(new Event("resize"));
          },
          kind,
          flush,
        );
        const result = settle();
        results.push({
          step: `navigation ${kind}, measured=${flush}`,
          ...result,
        });
        assert.notEqual(
          result.cursorY,
          null,
          "Navigation target must be rendered",
        );
        assert.ok(
          result.cursorY >= 0 && result.cursorBottom <= result.viewportHeight,
          "A resize must retain the newer navigation destination",
        );
      }
    }
  } else {
    const before = sample();
    results.push({ step: "before fold", ...before });
    const folded = nativeFold("Last parent");
    results.push({ step: "folded", ...folded });
    assert.equal(folded.parentFolded, true);
    expectAnchor(folded, before, "Native fold");
    for (const width of [500, 900, 500, 900]) {
      const resized = resize(width);
      results.push({ step: `resize ${width}`, ...resized });
      assert.equal(resized.parentFolded, true);
      expectAnchor(resized, before, "Width reflow");
    }
    evaluate(() => {
      app.workspace.activeLeaf.view.editor.cm.scrollDOM.scrollTop -= 100;
    });
    const scrolled = settle();
    // Keep the reference inside the short anchor rows. A clipped wrapped line
    // above them can change its offscreen top while its visible ending stays put.
    assert.ok(
      scrolled.line >= 66,
      "Scrolling must retain an unwrapped anchor row",
    );
    results.push({ step: "scroll up", ...scrolled });
    assert.notEqual(
      scrolled.line,
      before.line,
      "Ordinary scrolling must change the visible line",
    );
    for (const width of [500, 900]) {
      const resized = resize(width);
      results.push({ step: `resize after scroll ${width}`, ...resized });
      expectAnchor(resized, scrolled, "Reflow after a newer scroll");
    }
  }
} finally {
  console.log(
    JSON.stringify(
      {
        zoom,
        pane,
        input: "Obsidian CLI/CDP, synthetic native pointer sequence",
        results,
      },
      null,
      2,
    ),
  );
  evaluate(() => {
    const container = app.workspace.activeLeaf.view.containerEl;
    container.style.removeProperty("width");
    container.style.removeProperty("flex");
  });
  cdp("Emulation.clearDeviceMetricsOverride", {});
  evaluate(
    async (note, previousPath) => {
      const previous =
        previousPath && app.vault.getAbstractFileByPath(previousPath);
      if (previous) await app.workspace.getLeaf(false).openFile(previous);
      else app.workspace.activeLeaf.detach();
      const fixture = app.vault.getAbstractFileByPath(note);
      if (fixture) await app.vault.delete(fixture);
    },
    note,
    initial.file ?? null,
  );
}
