const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");

assert.ok(process.argv[2], "Supply a fresh output directory");
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output);
const note = `movement-cursors-${randomUUID()}.md`;
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  vim: app.vault.config.vimMode ?? false,
}));
const results = [];
let leafId;

function guard() {
  evaluate((note) => {
    window.focus();
    if (
      !document.title.includes("vault") ||
      document.title.includes("base") ||
      document.visibilityState !== "visible" ||
      app.workspace.activeLeaf.view.file?.path !== note
    )
      throw Error("Wrong verification window or note");
  }, note);
}

function snapshot() {
  return evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const view = app.workspace.activeLeaf.view;
    await view.save();
    return {
      doc: view.editor.getValue(),
      cursor: view.editor.getCursor(),
      saved: await app.vault.read(view.file),
    };
  });
}

function history(modifiers) {
  for (const type of ["keyDown", "keyUp"]) {
    guard();
    cdp("Input.dispatchKeyEvent", {
      type,
      key: "z",
      code: "KeyZ",
      windowsVirtualKeyCode: 90,
      nativeVirtualKeyCode: 90,
      modifiers,
    });
  }
}

try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  leafId = evaluate(async (note) => {
    app.vault.setConfig("vimMode", false);
    app.workspace.updateOptions();
    const leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(await app.vault.create(note, "audit"));
    return leaf.id;
  }, note);
  for (const lower of [9, 99]) {
    for (const direction of ["up", "down"]) {
      const lines = Array.from(
        { length: lower + 2 },
        (_, i) => `${i + 1}. item${i + 1}`,
      );
      const from = direction === "up" ? lower : lower - 1;
      const to = direction === "up" ? from - 1 : from + 1;
      const ch = String(from + 1).length + 2;
      evaluate(
        async (text, line, ch) => {
          app.commands.executeCommandById("bullet:zoom-reset");
          const editor = app.workspace.activeLeaf.view.editor;
          editor.setValue(text);
          editor.setCursor({ line, ch });
          editor.focus();
          await new Promise((resolve) => setTimeout(resolve, 600));
        },
        lines.join("\n"),
        from,
        ch,
      );
      const before = snapshot();
      guard();
      assert.equal(
        evaluate(
          (command) => app.commands.executeCommandById(command),
          `bullet:move-list-item-${direction}`,
        ),
        true,
      );
      const moved = snapshot();
      const labels = lines.map((line) => line.replace(/^\d+\. /, ""));
      [labels[from], labels[to]] = [labels[to], labels[from]];
      const expected = labels.map((label, i) => `${i + 1}. ${label}`);
      const expectedCursor = { line: to, ch: String(to + 1).length + 2 };
      assert.equal(moved.doc, expected.join("\n"));
      assert.deepEqual(moved.cursor, expectedCursor);
      assert.equal(moved.saved, moved.doc);
      evaluate(async () => new Promise((resolve) => setTimeout(resolve, 600)));
      guard();
      cdp("Input.insertText", { text: "X" });
      const typed = snapshot();
      expected[to] =
        expected[to].slice(0, expectedCursor.ch) + "X" + labels[to];
      assert.equal(typed.doc, expected.join("\n"));
      assert.equal(typed.saved, typed.doc);
      assert.deepEqual(typed.cursor, {
        ...expectedCursor,
        ch: expectedCursor.ch + 1,
      });
      history(4);
      assert.equal(snapshot().doc, moved.doc);
      history(4);
      assert.equal(snapshot().doc, before.doc);
      history(12);
      const redone = snapshot();
      assert.equal(redone.doc, moved.doc);
      assert.deepEqual(redone.cursor, moved.cursor);
      history(12);
      assert.equal(snapshot().doc, typed.doc);
      results.push({ lower, direction, before, moved, typed, redone });
    }
  }
  for (const fixture of [
    {
      direction: "down",
      anchor: { line: 2, ch: 7 },
      head: { line: 0, ch: 2 },
      expectedAnchor: { line: 2, ch: 7 },
      expectedHead: { line: 1, ch: 2 },
      moved: "- second\n- first\n- third",
      typed: "- second\n- X",
    },
    {
      direction: "up",
      anchor: { line: 0, ch: 2 },
      head: { line: 2, ch: 2 },
      expectedAnchor: { line: 0, ch: 2 },
      expectedHead: { line: 1, ch: 2 },
      moved: "- first\n- third\n- second",
      typed: "- Xthird\n- second",
    },
  ]) {
    evaluate(async (fixture) => {
      const editor = app.workspace.activeLeaf.view.editor;
      editor.setValue("- first\n- second\n- third");
      editor.setSelection(fixture.anchor, fixture.head);
      editor.focus();
      await new Promise((resolve) => setTimeout(resolve, 600));
    }, fixture);
    guard();
    evaluate(
      (direction) =>
        app.commands.executeCommandById(`bullet:move-list-item-${direction}`),
      fixture.direction,
    );
    const moved = snapshot();
    assert.equal(moved.doc, fixture.moved);
    assert.deepEqual(
      evaluate(() => app.workspace.activeLeaf.view.editor.listSelections()),
      [{ anchor: fixture.expectedAnchor, head: fixture.expectedHead }],
    );
    evaluate(async () => new Promise((resolve) => setTimeout(resolve, 600)));
    guard();
    cdp("Input.insertText", { text: "X" });
    const typed = snapshot();
    assert.equal(typed.doc, fixture.typed);
    assert.equal(typed.saved, typed.doc);
    history(4);
    assert.equal(snapshot().doc, moved.doc);
    history(12);
    assert.equal(snapshot().doc, typed.doc);
    results.push({ selectionAcrossSiblings: fixture.direction, moved, typed });
  }
  fs.writeFileSync(
    path.join(output, "after.png"),
    Buffer.from(cdp("Page.captureScreenshot").data, "base64"),
  );
} finally {
  evaluate(
    async (leafId, original, note) => {
      const leaf = app.workspace.getLeafById(leafId);
      if (leaf?.view.save) await leaf.view.save();
      leaf?.detach();
      app.vault.setConfig("vimMode", original.vim);
      app.workspace.updateOptions();
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
assert.equal(results.length, 6);
console.log(JSON.stringify({ output, cases: results.length }));
