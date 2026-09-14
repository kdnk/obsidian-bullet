// Verify ordinary Enter and the intentional zoom subtree contract, including
// the next input and native Undo/Redo. Deploy build-with-tests first.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");
if (!process.argv[2])
  throw Error(
    "Usage: node scripts/verify-zoom-enter-splits.cjs <fresh-output-dir>",
  );
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const note = `zoom-enter-split-${randomUUID()}.md`;
const original = evaluate(() => app.workspace.activeLeaf.id);
const originalEnterSettings = evaluate(() => ({
  betterEnter: app.plugins.plugins.bullet.settings.overrideEnterBehaviour,
  keepBody: app.plugins.plugins.bullet.settings.keepBodyTextInBullets,
  stickCursor: app.plugins.plugins.bullet.settings.keepCursorWithinContent,
}));
const results = [];
const failures = [];
function sample() {
  return evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const editor = app.workspace.activeLeaf.view.editor;
    const p = editor.cm.coordsAtPos(editor.cm.state.selection.main.head);
    const bounds = editor.cm.scrollDOM.getBoundingClientRect();
    return {
      doc: editor.getValue(),
      cursor: editor.getCursor(),
      visibleCursor: !!p && p.top >= bounds.top && p.bottom <= bounds.bottom,
      folded: editor.getFoldOffsets().size > 0,
      target:
        editor.cm.dom.querySelector(
          '.bullet-zoom-breadcrumbs [aria-current="location"]',
        )?.textContent ?? null,
    };
  });
}
function focus() {
  evaluate(() => {
    window.focus();
    app.workspace.activeLeaf.view.editor.focus();
  });
}
function key(key, code, number, modifiers = 0, text) {
  for (const type of ["keyDown", "keyUp"]) {
    focus();
    cdp("Input.dispatchKeyEvent", {
      type,
      key,
      code,
      modifiers,
      windowsVirtualKeyCode: number,
      nativeVirtualKeyCode: number,
      ...(type === "keyDown" && text ? { text } : {}),
    });
  }
}
const cases = [
  {
    name: "native ordered root middle",
    text: "- work\n\t1. project\n\t\t- task\n\t2. other\n- personal",
    line: 1,
    ch: 7,
    native: true,
    expected:
      "- work\n\t1. pro\n\t\t- ject\n\t\t- task\n\t2. other\n- personal",
    cursor: { line: 2, ch: 4 },
  },
  {
    name: "checked task start without cursor guard",
    text: "- work\n\t1. [x] project\n\t\t- task\n- personal",
    line: 1,
    ch: 8,
    noCursorGuard: true,
    expected: "- work\n\t1. [x] project\n\t\t- [ ] \n\t\t- task\n- personal",
    cursor: { line: 2, ch: 8 },
  },
  {
    name: "ordered root middle with hidden sibling",
    text: "- work\n\t1. project\n\t\t- task\n\t2. other\n- personal",
    line: 1,
    ch: 7,
    expected:
      "- work\n\t1. pro\n\t\t- ject\n\t\t- task\n\t2. other\n- personal",
    cursor: { line: 2, ch: 4 },
  },
  {
    name: "ordered root end with hidden sibling",
    text: "- work\n\t1. project\n\t\t- task\n\t2. other\n- personal",
    line: 1,
    ch: 11,
    expected:
      "- work\n\t1. project\n\t\t- \n\t\t- task\n\t2. other\n- personal",
    cursor: { line: 2, ch: 4 },
  },
  {
    name: "unordered root middle",
    text: "- work\n\t- project\n\t\t- task\n\t- other\n- personal",
    line: 1,
    ch: 6,
    expected: "- work\n\t- pro\n\t\t- ject\n\t\t- task\n\t- other\n- personal",
    cursor: { line: 2, ch: 4 },
  },
  {
    name: "child Enter preserves hidden ancestor numbering",
    text: "9. work\n\t- project\n\t\t- task\n- personal",
    line: 2,
    ch: 8,
    zoomLine: 1,
    expected: "9. work\n\t- project\n\t\t- task\n\t\t- \n- personal",
    cursor: { line: 3, ch: 4 },
  },
  {
    name: "folded root end",
    text: "- work\n\t- project\n\t\t- task\n- personal",
    line: 1,
    ch: 10,
    fold: true,
    expected: "- work\n\t- project\n\t\t- \n\t\t- task\n- personal",
    cursor: { line: 2, ch: 4 },
  },
];
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (note) => {
    window.__zoomEnterSplitsLeaf = app.workspace.getLeaf("tab");
    await window.__zoomEnterSplitsLeaf.openFile(
      await app.vault.create(note, "audit"),
    );
  }, note);
  for (const fixture of cases) {
    const modes = [];
    for (const zoom of [false, true]) {
      evaluate(
        async (fixture, zoom, originalEnterSettings) => {
          app.commands.executeCommandById("bullet:zoom-reset");
          const settings = app.plugins.plugins.bullet.settings;
          settings.overrideEnterBehaviour = fixture.native ? false : true;
          settings.keepBodyTextInBullets = fixture.native ? false : true;
          settings.keepCursorWithinContent = fixture.noCursorGuard
            ? "never"
            : "bullet-and-checkbox";
          const editor = app.workspace.activeLeaf.view.editor;
          editor.setValue(fixture.text);
          app.commands.executeCommandById("editor:unfold-all");
          await new Promise((resolve) => setTimeout(resolve, 350));
          const zoomLine = fixture.zoomLine ?? fixture.line;
          editor.setCursor({
            line: zoomLine,
            ch: editor.getLine(zoomLine).length,
          });
          if (zoom) app.commands.executeCommandById("bullet:zoom-in");
          editor.setCursor({ line: fixture.line, ch: fixture.ch });
          if (fixture.fold) app.commands.executeCommandById("editor:fold-more");
          editor.focus();
        },
        fixture,
        zoom,
        originalEnterSettings,
      );
      const initial = sample();
      if (fixture.fold && !initial.folded)
        throw Error("Folded root fixture must be folded");
      key("Enter", "Enter", 13, 0, "\r");
      const entered = sample();
      focus();
      cdp("Input.insertText", { text: "NEXT" });
      const typed = sample();
      const expectedEntered = zoom ? fixture.expected : entered.doc;
      const expectedCursor = zoom ? fixture.cursor : entered.cursor;
      const lines = expectedEntered.split("\n");
      lines[expectedCursor.line] =
        lines[expectedCursor.line].slice(0, expectedCursor.ch) +
        "NEXT" +
        lines[expectedCursor.line].slice(expectedCursor.ch);
      const expectedTyped =
        fixture.native && !zoom
          ? "- work\n\t1. pro\n\t2. NEXTject\n\t\t- task\n\t3. other\n- personal"
          : lines.join("\n");
      if (
        entered.doc !== expectedEntered ||
        entered.cursor.line !== expectedCursor.line ||
        entered.cursor.ch !== expectedCursor.ch ||
        typed.doc !== expectedTyped ||
        typed.cursor.line !== expectedCursor.line ||
        typed.cursor.ch !== expectedCursor.ch + 4
      )
        failures.push(
          `${fixture.name} / zoom ${zoom}: document or input cursor mismatch`,
        );
      if (
        fixture.noCursorGuard &&
        !zoom &&
        entered.doc !==
          "- work\n\t1. [ ] \n\t2. [x] project\n\t\t- task\n- personal"
      )
        failures.push(`${fixture.name}: ordinary task Enter changed`);
      key("z", "KeyZ", 90, 4);
      const undoTyping = sample();
      key("z", "KeyZ", 90, 4);
      const undoEnter = sample();
      key("z", "KeyZ", 90, 12);
      const redoEnter = sample();
      key("z", "KeyZ", 90, 12);
      const redoTyping = sample();
      if (entered.doc === fixture.text)
        failures.push(`${fixture.name} / zoom ${zoom}: Enter was rejected`);
      if (undoTyping.doc !== entered.doc)
        failures.push(
          `${fixture.name} / zoom ${zoom}: Undo typing did not restore Enter`,
        );
      if (undoEnter.doc !== fixture.text)
        failures.push(
          `${fixture.name} / zoom ${zoom}: Undo did not restore input`,
        );
      if (
        redoEnter.doc !== entered.doc ||
        redoEnter.cursor.line !== entered.cursor.line ||
        redoEnter.cursor.ch !== entered.cursor.ch
      )
        failures.push(
          `${fixture.name} / zoom ${zoom}: Redo Enter did not restore document and cursor`,
        );
      if (redoTyping.doc !== typed.doc)
        failures.push(
          `${fixture.name} / zoom ${zoom}: Redo typing did not restore document`,
        );
      modes.push({
        zoom,
        entered,
        typed,
        undoTyping,
        undoEnter,
        redoEnter,
        redoTyping,
      });
    }
    // Root Enter intentionally creates a child in zoom; ordinary Enter may
    // create a sibling. Each mode has its own document and history assertions.
    const zoomed = modes[1];
    if (!zoomed.entered.visibleCursor || !zoomed.typed.visibleCursor)
      failures.push(`${fixture.name}: cursor is hidden`);
    results.push({ name: fixture.name, modes });
    fs.writeFileSync(
      path.join(output, `case-${results.length}.png`),
      Buffer.from(cdp("Page.captureScreenshot").data, "base64"),
    );
  }
} finally {
  try {
    evaluate(
      async (original, note, originalEnterSettings) => {
        const settings = app.plugins.plugins.bullet.settings;
        settings.overrideEnterBehaviour = originalEnterSettings.betterEnter;
        settings.keepBodyTextInBullets = originalEnterSettings.keepBody;
        settings.keepCursorWithinContent = originalEnterSettings.stickCursor;
        app.commands.executeCommandById("bullet:zoom-reset");
        if (window.__zoomEnterSplitsLeaf?.view.save)
          await window.__zoomEnterSplitsLeaf.view.save();
        window.__zoomEnterSplitsLeaf?.detach();
        delete window.__zoomEnterSplitsLeaf;
        const leaf = app.workspace.getLeafById(original);
        if (leaf) app.workspace.setActiveLeaf(leaf);
        const file = app.vault.getAbstractFileByPath(note);
        if (file) await app.vault.trash(file, false);
      },
      original,
      note,
      originalEnterSettings,
    );
  } finally {
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
if (failures.length) process.exitCode = 1;
