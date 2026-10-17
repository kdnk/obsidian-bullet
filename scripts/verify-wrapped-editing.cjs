const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");

assert.ok(process.argv[2], "Supply a fresh output directory");
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output);
const note = `wrapped-editing-${randomUUID()}.md`;
const results = [];
let leafId;

const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  vim: app.vault.config.vimMode ?? false,
  left: app.workspace.leftSplit.collapsed,
  right: app.workspace.rightSplit.collapsed,
}));

function guard() {
  evaluate((note) => {
    window.focus();
    const view = app.workspace.activeLeaf?.view;
    if (
      !document.title.includes("vault") ||
      document.title.includes("base") ||
      document.visibilityState !== "visible" ||
      view?.file?.path !== note ||
      view?.editor?.cm?.contentDOM.isContentEditable !== true
    ) {
      throw Error("Wrong verification window or note");
    }
  }, note);
}

function key(key, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ["keyDown", "keyUp"]) {
    guard();
    cdp("Input.dispatchKeyEvent", {
      type,
      key,
      code,
      windowsVirtualKeyCode,
      nativeVirtualKeyCode: windowsVirtualKeyCode,
      modifiers,
    });
  }
}

function history(modifiers) {
  key("z", "KeyZ", 90, modifiers);
}

function snapshot(label) {
  return evaluate(async (label) => {
    await new Promise((resolve) => setTimeout(resolve, 180));
    const view = app.workspace.activeLeaf.view;
    await view.save();
    const cursor = view.editor.getCursor();
    const offset = view.editor.posToOffset(cursor);
    const coords = view.editor.cm.coordsAtPos(offset);
    const line = view.editor.cm
      .domAtPos(offset)
      .node.parentElement?.closest(".cm-line");
    return {
      label,
      doc: view.editor.getValue(),
      saved: await app.vault.read(view.file),
      cursor,
      coords: coords && {
        left: coords.left,
        right: coords.right,
        top: coords.top,
        bottom: coords.bottom,
      },
      lineHeight: line?.getBoundingClientRect().height ?? null,
      editorWidth: view.editor.cm.contentDOM.getBoundingClientRect().width,
      scrollTop: view.editor.cm.scrollDOM.scrollTop,
      viewport: (() => {
        const rect = view.editor.cm.scrollDOM.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      })(),
    };
  }, label);
}

function setFixture(text, cursor) {
  evaluate(
    async (text, cursor) => {
      app.commands.executeCommandById("bullet:zoom-reset");
      const view = app.workspace.activeLeaf.view;
      view.editor.setValue(text);
      view.editor.setCursor(cursor);
      view.editor.scrollIntoView({ from: cursor, to: cursor }, true);
      view.editor.focus();
      await new Promise((resolve) => setTimeout(resolve, 650));
    },
    text,
    cursor,
  );
}

try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  leafId = evaluate(async (note) => {
    app.vault.setConfig("vimMode", false);
    app.workspace.updateOptions();
    app.workspace.leftSplit.expand();
    app.workspace.rightSplit.expand();
    const leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(await app.vault.create(note, "audit"));
    app.workspace.setActiveLeaf(leaf);
    return leaf.id;
  }, note);

  const longInline =
    "- alpha " +
    "wrapped prose ".repeat(18) +
    "`inline code with spaces and symbols()` " +
    "tail words ".repeat(18);
  const inlineStart = longInline.indexOf("inline code");
  setFixture(longInline, { line: 0, ch: inlineStart + 8 });
  const beforeDown = snapshot("wrapped-arrow-before");
  assert.ok(
    beforeDown.lineHeight >
      (beforeDown.coords.bottom - beforeDown.coords.top) * 2,
  );
  key("ArrowDown", "ArrowDown", 40);
  const afterDown = snapshot("wrapped-arrow-down");
  assert.equal(afterDown.doc, beforeDown.doc);
  assert.equal(afterDown.saved, beforeDown.doc);
  assert.equal(afterDown.cursor.line, 0);
  assert.ok(afterDown.coords.top > beforeDown.coords.top);
  key("ArrowUp", "ArrowUp", 38);
  const afterUp = snapshot("wrapped-arrow-up");
  assert.equal(afterUp.doc, beforeDown.doc);
  assert.equal(afterUp.cursor.line, 0);
  assert.ok(afterUp.coords.top < afterDown.coords.top);
  results.push({
    name: "wrapped-inline-arrow-navigation",
    beforeDown,
    afterDown,
    afterUp,
  });

  const deleteCh = Math.max(afterDown.cursor.ch, inlineStart + 2);
  setFixture(longInline, { line: 0, ch: deleteCh });
  const beforeBackspace = snapshot("wrapped-backspace-before");
  key("Backspace", "Backspace", 8);
  const afterBackspace = snapshot("wrapped-backspace-after");
  assert.equal(
    afterBackspace.doc,
    longInline.slice(0, deleteCh - 1) + longInline.slice(deleteCh),
  );
  assert.deepEqual(afterBackspace.cursor, { line: 0, ch: deleteCh - 1 });
  guard();
  cdp("Input.insertText", { text: "X" });
  const afterBackspaceTyping = snapshot("wrapped-backspace-typing");
  assert.equal(
    afterBackspaceTyping.doc,
    longInline.slice(0, deleteCh - 1) + "X" + longInline.slice(deleteCh),
  );
  results.push({
    name: "wrapped-inline-backspace",
    beforeBackspace,
    afterBackspace,
    afterBackspaceTyping,
  });

  const splitCh = longInline.indexOf("symbols") + 3;
  setFixture(longInline, { line: 0, ch: splitCh });
  const beforeEnter = snapshot("wrapped-enter-before");
  key("Enter", "Enter", 13);
  const afterEnter = snapshot("wrapped-enter-after");
  assert.equal(
    afterEnter.doc,
    `${longInline.slice(0, splitCh)}\n- ${longInline.slice(splitCh)}`,
  );
  assert.deepEqual(afterEnter.cursor, { line: 1, ch: 2 });
  guard();
  cdp("Input.insertText", { text: "X" });
  const afterEnterTyping = snapshot("wrapped-enter-typing");
  assert.equal(
    afterEnterTyping.doc,
    `${longInline.slice(0, splitCh)}\n- X${longInline.slice(splitCh)}`,
  );
  results.push({
    name: "wrapped-inline-enter",
    beforeEnter,
    afterEnter,
    afterEnterTyping,
  });

  const deep = [
    "- level 0",
    "\t- level 1",
    "\t\t- level 2",
    "\t\t\t- level 3",
    "\t\t\t\t- level 4",
    "\t\t\t\t\t- level 5",
    "\t\t\t\t\t\t- previous " + "wide text ".repeat(12),
    "\t\t\t\t\t\t- target `inline code` " + "long tail ".repeat(20),
    "\t\t\t\t\t\t\t- child " + "child text ".repeat(10),
  ].join("\n");
  const targetLine = 7;
  const targetCh = deep.split("\n")[targetLine].indexOf("inline") + 4;
  setFixture(deep, { line: targetLine, ch: targetCh });
  const beforeTab = snapshot("deep-tab-before");
  assert.ok(
    beforeTab.lineHeight > (beforeTab.coords.bottom - beforeTab.coords.top) * 2,
  );
  key("Tab", "Tab", 9);
  const afterTab = snapshot("deep-tab-after");
  assert.equal(
    afterTab.doc
      .split("\n")
      [targetLine].startsWith("\t".repeat(7) + "- target"),
    true,
  );
  assert.equal(
    afterTab.doc
      .split("\n")
      [targetLine + 1].startsWith("\t".repeat(8) + "- child"),
    true,
  );
  assert.deepEqual(afterTab.cursor, { line: targetLine, ch: targetCh + 1 });
  key("Tab", "Tab", 9, 8);
  const afterShiftTab = snapshot("deep-shift-tab-after");
  assert.equal(afterShiftTab.doc, deep);
  assert.deepEqual(afterShiftTab.cursor, { line: targetLine, ch: targetCh });
  guard();
  cdp("Input.insertText", { text: "X" });
  const afterDeepTyping = snapshot("deep-typing");
  assert.equal(
    afterDeepTyping.doc,
    deep
      .split("\n")
      .map((line, index) =>
        index === targetLine
          ? line.slice(0, targetCh) + "X" + line.slice(targetCh)
          : line,
      )
      .join("\n"),
  );
  results.push({
    name: "deep-wrapped-inline-indent",
    beforeTab,
    afterTab,
    afterShiftTab,
    afterDeepTyping,
  });

  const longDocumentLines = Array.from(
    { length: 800 },
    (_, index) =>
      `- item ${index} ` +
      (index % 7 === 0 ? "wrapped document text ".repeat(15) : "body"),
  );
  const longTarget = 640;
  longDocumentLines.splice(
    longTarget - 6,
    7,
    "- long ancestor",
    "\t- nested 1",
    "\t\t- nested 2",
    "\t\t\t- nested 3",
    "\t\t\t\t- nested 4",
    "\t\t\t\t\t- nested 5",
    "\t\t\t\t\t\t- long target `inline code` " + "viewport text ".repeat(24),
  );
  const longDocument = longDocumentLines.join("\n");
  const longTargetText = longDocumentLines[longTarget];
  const longTargetCh = longTargetText.indexOf("inline code") + 6;
  setFixture(longDocument, { line: longTarget, ch: longTargetCh });
  const longBefore = snapshot("long-document-before");
  assert.ok(longBefore.scrollTop > 0);
  assert.ok(longBefore.coords.top >= longBefore.viewport.top);
  assert.ok(longBefore.coords.bottom <= longBefore.viewport.bottom);
  key("Enter", "Enter", 13);
  const longEntered = snapshot("long-document-entered");
  assert.deepEqual(longEntered.cursor, { line: longTarget + 1, ch: 8 });
  assert.ok(longEntered.coords.top >= longEntered.viewport.top);
  assert.ok(longEntered.coords.bottom <= longEntered.viewport.bottom);
  guard();
  cdp("Input.insertText", { text: "X" });
  const longTyped = snapshot("long-document-typed");
  assert.equal(
    longTyped.doc
      .split("\n")
      [longTarget + 1].startsWith("\t".repeat(6) + "- X"),
    true,
  );
  assert.equal(longTyped.saved, longTyped.doc);
  history(4);
  const longTypingUndone = snapshot("long-document-typing-undone");
  assert.equal(longTypingUndone.doc, longEntered.doc);
  history(4);
  const longEnterUndone = snapshot("long-document-enter-undone");
  assert.equal(longEnterUndone.doc, longDocument);
  history(12);
  history(12);
  const longRedone = snapshot("long-document-redone");
  assert.equal(longRedone.doc, longTyped.doc);
  assert.equal(longRedone.saved, longTyped.doc);
  assert.ok(longRedone.coords.top >= longRedone.viewport.top);
  assert.ok(longRedone.coords.bottom <= longRedone.viewport.bottom);
  results.push({
    name: "long-document-deep-wrapped-inline-enter",
    longBefore,
    longEntered,
    longTyped,
    longTypingUndone,
    longEnterUndone,
    longRedone,
  });

  fs.writeFileSync(
    path.join(output, "after.png"),
    Buffer.from(cdp("Page.captureScreenshot").data, "base64"),
  );
} finally {
  evaluate(
    async (leafId, original, note) => {
      const leaf = app.workspace.getLeafById(leafId);
      if (leaf?.view?.save) await leaf.view.save();
      leaf?.detach();
      app.vault.setConfig("vimMode", original.vim);
      app.workspace.updateOptions();
      if (original.left) app.workspace.leftSplit.collapse();
      else app.workspace.leftSplit.expand();
      if (original.right) app.workspace.rightSplit.collapse();
      else app.workspace.rightSplit.expand();
      const previous = app.workspace.getLeafById(original.leaf);
      if (previous) app.workspace.setActiveLeaf(previous);
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.trash(file, false);
    },
    leafId,
    original,
    note,
  );
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(results, null, 2),
  );
}

assert.equal(results.length, 5);
console.log(JSON.stringify({ output, cases: results.length }));
