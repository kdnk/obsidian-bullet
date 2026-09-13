// Run serially against the deployed test build in the repository vault.
// Repeat with Shiki Highlighter disabled/enabled. Uses real CDP mouse/key input;
// the mousedown -> mousemove -> mouseup flow matches DragAndDrop.spec.md.
// Add --zoomed-drag to move between two nested, zoomed parents.
// --source-zoom-only / --target-zoom-only exercise mixed pane states;
// --last-child moves the final code child before a hidden source sibling.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

if (!process.argv[2])
  throw Error(
    "Usage: node scripts/verify-nested-code-interactions.cjs <fresh-output-directory> [--zoomed-drag]",
  );
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const id = randomUUID();
const key = `__bulletNestedCodeInteractions_${id.replaceAll("-", "")}`;
const sourcePath = `nested-code-source-${id}.md`;
const targetPath = `nested-code-target-${id}.md`;
const zoomedDrag =
  process.argv.includes("--zoomed-drag") ||
  process.argv.includes("--target-zoom-only");
const sourceZoom =
  process.argv.includes("--zoomed-drag") ||
  process.argv.includes("--source-zoom-only");
const lastChild = process.argv.includes("--last-child");
const sourceLines = [
  "- source envelope",
  "\t- code group",
  "\t\t- ```js",
  "\t\t  const first = 1;",
  "\t\t  - literal list marker",
  "\t\t  ```",
  "\t\t- code sibling",
  "\t- source sibling",
  "- keep",
];
if (lastChild) sourceLines.splice(2, 0, ...sourceLines.splice(6, 1));
const sourceText = sourceLines.join("\n");
const codeBodyLine = lastChild ? 4 : 3;
const codeSiblingLine = lastChild ? 2 : 6;
const targetText = zoomedDrag
  ? "- destination envelope\n\t- destination group\n\t\t- destination sibling\n\t- destination outside sibling\n- target keep"
  : "- destination\n\t- destination sibling\n- target keep";
const editedText = sourceText.replace(
  "const first = 1;",
  "const first = 1; // zoom edit",
);
const sourceAfter =
  "- source envelope\n\t- code group\n\t\t- code sibling\n\t- source sibling\n- keep";
const targetIndent = zoomedDrag ? "\t\t" : "\t";
const targetCodeOpening = `${targetIndent}- \`\`\`js`;
const targetCodeSibling = `${targetIndent}- destination sibling`;
const movedCode = [
  "- ```js",
  "  const first = 1; // zoom edit",
  "  - literal list marker",
  "  ```",
]
  .map((line) => targetIndent + line)
  .join("\n");
const targetAfter = targetText.replace(
  targetCodeSibling,
  `${movedCode}\n${targetCodeSibling}`,
);
const results = [];
const failures = [];
let initial;
let focusEmulated = false;
let viewportOverridden = false;

function check(condition, message) {
  if (!condition) failures.push(message);
}

function settle() {
  evaluate(async () => new Promise((resolve) => setTimeout(resolve, 250)));
}

function guardWindow() {
  evaluate(() => {
    window.focus();
    if (!document.title.includes("vault") || document.title.includes("base"))
      throw Error("Test vault window title guard");
  });
}

function focus(side) {
  evaluate(
    (key, side) => {
      const leaf = window[key]?.[side];
      if (!leaf?.view?.editor) throw Error(`Missing fixture editor: ${side}`);
      app.workspace.setActiveLeaf(leaf, { focus: true });
      window.focus();
      leaf.view.editor.focus();
      if (!document.title.includes("vault") || document.title.includes("base"))
        throw Error("Test vault window title guard");
      if (
        !leaf.view.editor.cm.dom.closest(
          ".markdown-source-view.is-live-preview",
        )
      )
        throw Error("Fixture editor must use Live Preview");
    },
    key,
    side,
  );
}

function cursor(side, line, ch) {
  focus(side);
  evaluate(
    (key, side, line, ch) => {
      const editor = window[key][side].view.editor;
      const end = ch ?? editor.getLine(line).length;
      editor.setCursor({ line, ch: end });
      editor.scrollIntoView(
        { from: { line, ch: end }, to: { line, ch: end } },
        true,
      );
    },
    key,
    side,
    line,
    ch ?? null,
  );
  settle();
}

function command(side, command) {
  focus(side);
  assert.equal(
    evaluate((command) => app.commands.executeCommandById(command), command),
    true,
    `Command unavailable: ${command}`,
  );
  settle();
}

function snapshot(side) {
  return evaluate(
    (key, side) => {
      const leaf = window[key][side];
      const editor = leaf.view.editor;
      const cm = editor.cm;
      const feature = app.plugins.plugins.bullet.features.find(
        (f) => f.constructor.name === "ListZoom",
      );
      if (!feature) throw Error("Missing ListZoom feature");
      const range = feature.zoom.range(cm.state);
      return {
        text: editor.getValue(),
        file: leaf.view.file.path,
        zoom: range
          ? {
              from: range.from,
              to: range.to,
              labels: range.ancestors.map((a) => a.label),
            }
          : null,
        visible: cm.contentDOM.textContent,
        cursor: editor.getCursor(),
        shiki: !!app.plugins.plugins["shiki-highlighter"],
      };
    },
    key,
    side,
  );
}

function layout(name, side, openingText, siblingText) {
  const sample = evaluate(
    (key, side, openingText, siblingText) => {
      const cm = window[key][side].view.editor.cm;
      const find = (text) =>
        [...cm.contentDOM.querySelectorAll(".cm-line")].find(
          (element) => cm.state.doc.lineAt(cm.posAtDOM(element)).text === text,
        );
      const opening = find(openingText);
      const sibling = find(siblingText);
      if (!opening || !sibling)
        throw Error(
          "Required code/sibling rows are outside the rendered viewport",
        );
      const bounds = (element) => element.getBoundingClientRect();
      const marker = opening.querySelector(".cm-formatting-list");
      const otherMarker = sibling.querySelector(".cm-formatting-list");
      if (!marker || !otherMarker)
        throw Error("Native list markers are missing");
      const next = opening.nextElementSibling;
      const embed = next?.matches(".cm-preview-code-block") ? next : null;
      const margin = parseFloat(getComputedStyle(marker).marginInlineEnd) || 0;
      const backgroundLeft = embed
        ? bounds(embed.querySelector("pre")).left
        : bounds(opening).left +
          parseFloat(getComputedStyle(opening, "::before").insetInlineStart);
      const guides = (line) =>
        [...line.querySelectorAll(".cm-hmd-list-indent > .cm-indent")].map(
          (guide) => {
            const r = bounds(guide);
            return {
              left: r.left,
              width: r.width,
              margin:
                parseFloat(
                  getComputedStyle(guide, "::before").marginInlineStart,
                ) || 0,
            };
          },
        );
      let textRect = null;
      const code = embed
        ? (embed.querySelector(".ec-line .code") ?? embed.querySelector("code"))
        : next?.querySelector(".bullet-plugin-nested-code-block-content");
      if (code) {
        const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const r = range.getClientRects()[0];
          if (r?.height) {
            textRect = r;
            break;
          }
        }
      }
      const bullet = opening.querySelector(".list-bullet") ?? marker;
      const bulletBounds = bounds(bullet);
      return {
        markerLeft: bounds(marker).left,
        siblingMarkerLeft: bounds(otherMarker).left,
        backgroundLeft,
        contentLeft: bounds(marker).right + margin,
        guides: guides(opening),
        siblingGuides: guides(sibling),
        embedded: !!embed,
        embedGuideCount:
          embed?.querySelectorAll(".cm-indent,.bullet-plugin-outer-list-guide")
            .length ?? 0,
        bulletCenter: bulletBounds.top + bulletBounds.height / 2,
        textCenter: textRect ? textRect.top + textRect.height / 2 : null,
        guideHeight:
          embed && opening.querySelector(".cm-indent")
            ? parseFloat(
                getComputedStyle(
                  opening.querySelector(".cm-indent"),
                  "::before",
                ).height,
              )
            : null,
        embedHeight: embed ? bounds(embed).height : null,
      };
    },
    key,
    side,
    openingText,
    siblingText,
  );
  results.push({ name, ...sample });
  check(
    Math.abs(sample.markerLeft - sample.siblingMarkerLeft) < 1,
    `${name}: marker aligns with sibling`,
  );
  check(
    Math.abs(sample.backgroundLeft - sample.contentLeft) < 1,
    `${name}: code background starts at list content`,
  );
  check(sample.embedGuideCount === 0, `${name}: no guides inside code embed`);
  check(
    sample.guides.length === sample.siblingGuides.length,
    `${name}: same native ancestor guide count`,
  );
  for (let i = 0; i < sample.siblingGuides.length; i++) {
    const a = sample.guides[i],
      b = sample.siblingGuides[i];
    check(
      a &&
        Math.abs(a.left + a.margin - b.left - b.margin) < 1 &&
        Math.abs(a.width - b.width) < 1,
      `${name}: ancestor guide ${i} aligns`,
    );
  }
  check(
    sample.textCenter !== null &&
      Math.abs(sample.bulletCenter - sample.textCenter) < 1,
    `${name}: marker shares first code line`,
  );
  if (sample.embedded && sample.guideHeight !== null)
    check(
      Math.abs(sample.guideHeight - sample.embedHeight) < 1,
      `${name}: native guide spans preview`,
    );
  fs.writeFileSync(
    path.join(output, `${name}.png`),
    Buffer.from(
      cdp("Page.captureScreenshot", { format: "png" }).data,
      "base64",
    ),
  );
}

function mouse(type, point, buttons) {
  guardWindow();
  cdp("Input.dispatchMouseEvent", {
    type,
    ...point,
    button: "left",
    buttons,
    clickCount: 1,
  });
}

function historyKey(redo) {
  focus("target");
  for (const type of ["keyDown", "keyUp"]) {
    guardWindow();
    cdp("Input.dispatchKeyEvent", {
      type,
      key: "z",
      code: "KeyZ",
      modifiers: redo ? 12 : 4,
      windowsVirtualKeyCode: 90,
      nativeVirtualKeyCode: 90,
    });
  }
  settle();
}

function assertDocuments(name, source, target) {
  const a = snapshot("source"),
    b = snapshot("target");
  results.push({ name, source: a, target: b });
  assert.equal(a.text, source, `${name}: source document`);
  assert.equal(b.text, target, `${name}: destination document`);
}

function assertZoomRoots(name) {
  const source = snapshot("source"),
    target = snapshot("target");
  if (sourceZoom) {
    check(
      source.zoom?.labels.at(-1) === "code group",
      `${name}: source zoom root survives`,
    );
    check(
      !source.visible.includes("source sibling") &&
        !source.visible.includes("keep"),
      `${name}: source hidden siblings remain hidden`,
    );
  } else {
    check(
      source.zoom === null,
      `${name}: drag does not accidentally zoom source`,
    );
  }
  if (zoomedDrag) {
    check(
      target.zoom?.labels.at(-1) === "destination group",
      `${name}: destination zoom root survives`,
    );
    check(
      !target.visible.includes("destination outside sibling") &&
        !target.visible.includes("target keep"),
      `${name}: destination hidden siblings remain hidden`,
    );
  } else
    check(
      target.zoom === null,
      `${name}: drag does not accidentally zoom destination`,
    );
}

try {
  initial = evaluate(() => {
    for (const cls of ["bullet-plugin-better-lists", "bullet-plugin-dnd"])
      if (!document.body.classList.contains(cls))
        throw Error(`Required Bullet setting is off: ${cls}`);
    return {
      leaf: app.workspace.activeLeaf?.id,
      left: app.workspace.leftSplit.collapsed,
      right: app.workspace.rightSplit.collapsed,
      dpr: devicePixelRatio,
    };
  });
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  focusEmulated = true;
  // Match the existing zoom exploratory driver's desktop viewport so two
  // genuine editor panes fit even when the current Codex panel is narrow.
  cdp("Emulation.setDeviceMetricsOverride", {
    width: 1100,
    height: 850,
    deviceScaleFactor: initial.dpr,
    mobile: false,
  });
  viewportOverridden = true;
  evaluate(
    async (key, sourcePath, targetPath, sourceText, targetText) => {
      const state = (window[key] = {
        source: null,
        target: null,
        files: [],
        errors: [],
      });
      state.onError = (event) =>
        state.errors.push(String(event.message ?? event.reason));
      window.addEventListener("error", state.onError);
      window.addEventListener("unhandledrejection", state.onError);
      const source = await app.vault.create(sourcePath, sourceText);
      state.files.push(source);
      const target = await app.vault.create(targetPath, targetText);
      state.files.push(target);
      state.source = app.workspace.getLeaf("tab");
      await state.source.openFile(source);
      app.workspace.leftSplit.collapse();
      app.workspace.rightSplit.collapse();
    },
    key,
    sourcePath,
    targetPath,
    sourceText,
    targetText,
  );

  cursor("source", 8);
  layout("before-zoom", "source", "\t\t- ```js", "\t\t- code sibling");
  cursor("source", 1);
  command("source", "bullet:zoom-in");
  let state = snapshot("source");
  check(
    state.zoom?.labels.at(-1) === "code group",
    "zoom-in selects the code-containing group",
  );
  check(
    !state.visible.includes("source sibling") &&
      !state.visible.includes("keep"),
    "zoom hides unrelated source items",
  );
  assert.equal(state.text, sourceText, "zoom does not modify Markdown");
  layout("zoomed-preview", "source", "\t\t- ```js", "\t\t- code sibling");

  cursor("source", codeBodyLine);
  guardWindow();
  cdp("Input.insertText", { text: " // zoom edit" });
  settle();
  state = snapshot("source");
  assert.equal(
    state.text,
    editedText,
    "typing changes only the selected code content",
  );
  check(
    state.zoom?.labels.at(-1) === "code group",
    "code editing retains zoom",
  );
  cursor("source", codeSiblingLine);
  layout("zoomed-after-edit", "source", "\t\t- ```js", "\t\t- code sibling");
  command("source", "bullet:zoom-out");
  check(
    snapshot("source").zoom?.labels.at(-1) === "source envelope",
    "zoom-out selects parent",
  );
  command("source", "bullet:zoom-reset");
  assert.equal(snapshot("source").text, editedText);
  check(snapshot("source").zoom === null, "zoom-reset restores whole note");
  cursor("source", 8);
  layout("after-zoom-reset", "source", "\t\t- ```js", "\t\t- code sibling");

  // The source is the code item's own moved preview bullet, not a synthetic
  // cross-note move call. Target coordinates follow DragAndDropState's native
  // before-item drop position (line top minus 8px, one indent from the left).
  evaluate(
    async (key, targetPath) => {
      const state = window[key];
      app.workspace.setActiveLeaf(state.source, { focus: true });
      state.target = app.workspace.getLeaf("split", "vertical");
      await state.target.openFile(app.vault.getAbstractFileByPath(targetPath));
    },
    key,
    targetPath,
  );
  if (zoomedDrag) {
    cursor("target", 1);
    command("target", "bullet:zoom-in");
    cursor("target", 2);
  } else cursor("target", 2);
  if (sourceZoom) {
    cursor("source", 1);
    command("source", "bullet:zoom-in");
    cursor("source", codeSiblingLine);
    assertZoomRoots("before-zoomed-drag");
    layout("before-zoomed-drag", "source", "\t\t- ```js", "\t\t- code sibling");
  } else {
    cursor("source", 8);
  }
  const start = evaluate((key) => {
    const cm = window[key].source.view.editor.cm;
    const row = [...cm.contentDOM.querySelectorAll(".cm-line")].find(
      (element) =>
        cm.state.doc.lineAt(cm.posAtDOM(element)).text === "\t\t- ```js",
    );
    const marker =
      row?.querySelector(".list-bullet") ??
      row?.querySelector(".cm-formatting-list");
    if (!marker) throw Error("Source preview bullet is not rendered");
    const rect = marker.getBoundingClientRect();
    const point = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    if (!marker.contains(document.elementFromPoint(point.x, point.y)))
      throw Error("Source preview bullet is occluded");
    return point;
  }, key);
  mouse("mouseMoved", start, 0);
  mouse("mousePressed", start, 1);
  mouse("mouseMoved", { x: start.x + 12, y: start.y + 2 }, 1);
  settle();
  const drop = evaluate(
    (key, zoomedDrag) => {
      if (!document.body.classList.contains("bullet-plugin-dragging"))
        throw Error("Real pointer movement did not start dragging");
      const cm = window[key].target.view.editor.cm;
      const line = cm.state.doc.line(zoomedDrag ? 3 : 2);
      const coords = cm.coordsAtPos(line.from, -1);
      const firstLine = cm.contentDOM.querySelector(".cm-line");
      const indent = cm.contentDOM.querySelector(".cm-indent");
      if (!coords || !firstLine || !indent)
        throw Error("Destination drop geometry unavailable");
      const point = {
        x: firstLine.getBoundingClientRect().left + indent.offsetWidth,
        y: coords.top - 8,
      };
      if (!cm.dom.contains(document.elementFromPoint(point.x, point.y)))
        throw Error("Destination pointer is outside its editor");
      return point;
    },
    key,
    zoomedDrag,
  );
  mouse("mouseMoved", drop, 1);
  settle();
  const dropZone = evaluate(() => {
    const zone = document.querySelector(".bullet-plugin-drop-zone");
    const rect = zone.getBoundingClientRect();
    return {
      display: getComputedStyle(zone).display,
      left: rect.left,
      top: rect.top,
    };
  });
  results.push({ name: "drop-indicator", zoomedDrag, pointer: drop, dropZone });
  assert.notEqual(
    dropZone.display,
    "none",
    "Native cross-note drop indicator appears",
  );
  assert.ok(
    Math.abs(dropZone.left - drop.x) < 2,
    "Drop indicator uses the intended destination indent",
  );
  mouse("mouseReleased", drop, 0);
  settle();
  assertDocuments("cross-note-drop", sourceAfter, targetAfter);
  assertZoomRoots("cross-note-drop");
  cursor("target", 6);
  layout(
    "after-cross-note-drop",
    "target",
    targetCodeOpening,
    targetCodeSibling,
  );
  historyKey(false);
  assertDocuments("paired-undo", editedText, targetText);
  assertZoomRoots("paired-undo");
  cursor("source", codeSiblingLine);
  layout("after-paired-undo", "source", "\t\t- ```js", "\t\t- code sibling");
  historyKey(true);
  assertDocuments("paired-redo", sourceAfter, targetAfter);
  assertZoomRoots("paired-redo");
  cursor("target", 6);
  layout("after-paired-redo", "target", targetCodeOpening, targetCodeSibling);

  const saved = evaluate(async (key) => {
    const state = window[key];
    await state.source.view.save();
    await state.target.view.save();
    return {
      source: await app.vault.read(state.source.view.file),
      target: await app.vault.read(state.target.view.file),
      errors: state.errors,
    };
  }, key);
  assert.equal(
    saved.source,
    sourceAfter,
    "saved source retains exact Markdown",
  );
  assert.equal(
    saved.target,
    targetAfter,
    "saved destination retains exact tabs and code fences",
  );
  check(
    saved.errors.length === 0,
    `renderer errors: ${saved.errors.join("; ")}`,
  );
  results.push({ name: "saved-documents", ...saved });
  assert.equal(failures.length, 0, failures.join("\n"));
} catch (error) {
  failures.push(error.stack ?? String(error));
  throw error;
} finally {
  try {
    if (initial)
      evaluate(
        async (key, initial) => {
          const state = window[key];
          if (state) {
            window.removeEventListener("error", state.onError);
            window.removeEventListener("unhandledrejection", state.onError);
            // Cancel only an in-progress fixture drag if an assertion failed.
            if (document.body.classList.contains("bullet-plugin-dragging"))
              document.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "Escape",
                  code: "Escape",
                  bubbles: true,
                }),
              );
            for (const leaf of [state.target, state.source]) {
              if (!leaf) continue;
              if (leaf.view?.save) await leaf.view.save();
              leaf.detach();
            }
            for (const file of state.files)
              if (app.vault.getAbstractFileByPath(file.path))
                await app.vault.trash(file, false);
            delete window[key];
          }
          if (!initial.left) app.workspace.leftSplit.expand();
          if (!initial.right) app.workspace.rightSplit.expand();
          const leaf = initial.leaf && app.workspace.getLeafById(initial.leaf);
          if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
        },
        key,
        initial,
      );
  } finally {
    if (viewportOverridden) cdp("Emulation.clearDeviceMetricsOverride");
    if (focusEmulated)
      cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
    fs.writeFileSync(
      path.join(output, "results.json"),
      JSON.stringify({ results, failures }, null, 2) + "\n",
    );
    console.log(JSON.stringify({ output, failures }, null, 2));
  }
}
