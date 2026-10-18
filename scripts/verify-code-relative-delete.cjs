const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");

const output = process.argv[2];
fs.mkdirSync(output);
const note = `pages/code-relative-delete-${randomUUID()}.md`;
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  shiki: !!app.plugins.plugins["shiki-highlighter"],
  numbers:
    app.plugins.plugins["shiki-highlighter"]?.settings.ecDefaultShowLineNumbers,
  vim: app.vault.config.vimMode ?? false,
  hasVim: Object.hasOwn(app.vault.config, "vimMode"),
}));
const results = [];
const failures = [];
const cases = [
  ...["", " ", "  "].map((blank) => ({
    name: `incomplete-container-${blank.length}`,
    text: `- root\n\t- second\n\t\t- third\n\t\t\t- \`\`\`js\n\t\t\t  before\n${blank}\n\t\t\t  \`\`\``,
    expected:
      "- root\n\t- second\n\t\t- third\n\t\t\t- ```js\n\t\t\t  before\n\t\t\t  ```",
    cursor: { line: 5, ch: blank.length },
    after: { line: 4, ch: 11 },
  })),
  ...["", "hello"].map((content) => ({
    name: content ? "deep-populated-eight" : "deep-blank-eight",
    text: `- root\n\t- second\n\t\t- third\n\t\t\t- \`\`\`js\n\t\t\t  before\n\t\t\t          ${content}\n\t\t\t  \`\`\``,
    expected: `- root\n\t- second\n\t\t- third\n\t\t\t- \`\`\`js\n\t\t\t  before\n\t\t\t      ${content}\n\t\t\t  \`\`\``,
    cursor: { line: 5, ch: 13 },
    after: { line: 5, ch: 9 },
  })),
  {
    name: "root-four",
    text: "- ```js\n  before\n      hello\n  ```",
    expected: "- ```js\n  before\n  hello\n  ```",
    cursor: { line: 2, ch: 6 },
    after: { line: 2, ch: 2 },
  },
  {
    name: "crossing-tab",
    text: "- ```js\n  before\n\t\t  hello\n  ```",
    expected: "- ```js\n  before\n\t  hello\n  ```",
    cursor: { line: 2, ch: 4 },
    after: { line: 2, ch: 3 },
  },
  {
    name: "root-two-hundred",
    text: `- \`\`\`js\n  before\n${" ".repeat(202)}hello\n  \`\`\``,
    expected: `- \`\`\`js\n  before\n${" ".repeat(198)}hello\n  \`\`\``,
    cursor: { line: 2, ch: 202 },
    after: { line: 2, ch: 198 },
  },
];
function key(key, code, modifiers = 0) {
  for (const type of ["keyDown", "keyUp"]) {
    evaluate(() => {
      window.focus();
      if (
        !document.title.includes(" - vault - ") ||
        document.visibilityState !== "visible"
      )
        throw Error("Wrong visible test vault");
      const editor = app.workspace.activeLeaf.view.editor;
      editor.focus();
      if (app.isVimEnabled() || !editor.cm.hasFocus)
        throw Error("Expected focused normal editor");
    });
    cdp("Input.dispatchKeyEvent", {
      type,
      key,
      code: code === 8 ? "Backspace" : `Key${key.toUpperCase()}`,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
      modifiers,
    });
  }
}
function snapshot() {
  return evaluate(async () => {
    const view = app.workspace.activeLeaf.view;
    await new Promise((resolve) => setTimeout(resolve, 350));
    await view.save();
    const cm = view.editor.cm;
    const cursor = cm.dom.querySelector(".cm-cursor-primary");
    const selection = document.getSelection();
    const nativeRange =
      selection?.isCollapsed &&
      selection.rangeCount &&
      cm.contentDOM.contains(selection.focusNode)
        ? selection.getRangeAt(0)
        : null;
    let bounds = cursor?.getBoundingClientRect();
    if (!bounds && nativeRange) {
      bounds = nativeRange.getBoundingClientRect();
      if (!bounds.height && selection.focusNode?.nodeType === Node.TEXT_NODE) {
        const node = selection.focusNode;
        const offset = selection.focusOffset;
        if (node.textContent.length) {
          const adjacent = document.createRange();
          adjacent.setStart(node, Math.max(0, offset - 1));
          adjacent.setEnd(node, offset || 1);
          const box = adjacent.getBoundingClientRect();
          bounds = {
            x: offset ? box.right : box.left,
            y: box.y,
            height: box.height,
          };
        }
      }
    }
    const walker = document.createTreeWalker(
      view.editor.cm.contentDOM,
      NodeFilter.SHOW_TEXT,
    );
    let node,
      typedGlyph = null;
    while ((node = walker.nextNode())) {
      const index = node.textContent.indexOf("X");
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const box = range.getBoundingClientRect();
      if (box.width > 0) {
        typedGlyph = { x: box.left, right: box.right };
        break;
      }
    }
    return {
      text: view.editor.getValue(),
      saved: await app.vault.read(view.file),
      cursor: view.editor.getCursor(),
      selections: view.editor.listSelections(),
      typedGlyph,
      caret: bounds?.height
        ? {
            x: bounds.x,
            y: bounds.y,
            height: bounds.height,
            source: cursor ? "custom layer" : "native selection",
            color: cursor
              ? getComputedStyle(cursor).borderLeftColor
              : getComputedStyle(cm.contentDOM).caretColor,
          }
        : null,
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
}
function check(record, text, cursor) {
  assert.equal(record.text, text);
  assert.equal(record.saved, text);
  assert.deepEqual(record.cursor, cursor);
}
function captureCaret(record) {
  assert(record.caret, "The deletion caret must have observable bounds");
  for (let attempt = 0; attempt < 8; attempt++) {
    const shot = cdp("Page.captureScreenshot", { format: "png" });
    const paint = evaluate(
      async (data, { caret, viewport }) => {
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
        const scale = canvas.width / viewport.width;
        const target = caret.color
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number);
        if (!target || target.length !== 3)
          throw Error(`Expected resolved RGB caret color, got ${caret.color}`);
        const top = Math.ceil((caret.y + 1) * scale);
        const bottom = Math.floor((caret.y + caret.height - 1) * scale);
        const left = Math.floor((caret.x - 1.5) * scale);
        const right = Math.ceil((caret.x + 1.5) * scale);
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        const columns = [];
        for (let x = left; x <= right; x++) {
          let matching = 0;
          for (let y = top; y < bottom; y++) {
            const offset = (y * canvas.width + x) * 4;
            if (
              target.every(
                (value, channel) =>
                  Math.abs(pixels[offset + channel] - value) <= 40,
              )
            )
              matching++;
          }
          columns.push({
            x: (x + 0.5) / scale,
            fraction: matching / (bottom - top),
          });
        }
        const stroke = columns.filter((column) => column.fraction >= 0.8);
        return {
          columns,
          visible: stroke.length > 0,
          x: stroke.length
            ? stroke.reduce((sum, column) => sum + column.x, 0) / stroke.length
            : null,
        };
      },
      shot.data,
      record,
    );
    record.caretPaint = paint;
    if (paint.visible) return shot;
    evaluate(async () => new Promise((resolve) => setTimeout(resolve, 100)));
  }
  assert.fail(
    "The deletion caret must paint a vertical stroke at its observed bounds",
  );
}
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (note) => {
    app.vault.setConfig("vimMode", false);
    await app.vault.saveConfig();
    app.workspace.updateOptions();
    window.__relativeDeleteLeaf = app.workspace.getLeaf("tab");
    await window.__relativeDeleteLeaf.openFile(
      await app.vault.create(note, ""),
    );
  }, note);
  for (const mode of ["native", "shiki", "numbers"]) {
    evaluate(async (mode) => {
      if (mode === "native")
        await app.plugins.disablePlugin("shiki-highlighter");
      else {
        await app.plugins.enablePlugin("shiki-highlighter");
        const plugin = app.plugins.plugins["shiki-highlighter"];
        plugin.settings.ecDefaultShowLineNumbers = mode === "numbers";
        await plugin.reloadHighlighter();
      }
    }, mode);
    for (const input of ["Backspace", "Ctrl-H"]) {
      for (const test of cases) {
        const record = { name: `${mode}-${input}-${test.name}` };
        try {
          evaluate(async ({ text, cursor }) => {
            const editor = app.workspace.activeLeaf.view.editor;
            editor.setValue(text);
            editor.setCursor(cursor);
            editor.focus();
            editor.scrollIntoView({ from: cursor, to: cursor }, true);
            await new Promise((resolve) => setTimeout(resolve, 350));
          }, test);
          record.before = snapshot();
          check(record.before, test.text, test.cursor);
          key(
            input === "Backspace" ? "Backspace" : "h",
            input === "Backspace" ? 8 : 72,
            input === "Backspace" ? 0 : 2,
          );
          record.after = snapshot();
          check(record.after, test.expected, test.after);
          const shot = cdp("Page.captureScreenshot", { format: "png" });
          fs.writeFileSync(
            `${output}/${record.name}.png`,
            Buffer.from(shot.data, "base64"),
          );
          key("z", 90, 4);
          record.undo = snapshot();
          check(record.undo, test.text, test.cursor);
          key("z", 90, 12);
          record.redo = snapshot();
          check(record.redo, test.expected, test.after);
          const caretShot = captureCaret(record.redo);
          fs.writeFileSync(
            `${output}/${record.name}-redo-caret.png`,
            Buffer.from(caretShot.data, "base64"),
          );
          evaluate(() => {
            window.focus();
            if (
              !document.title.includes(" - vault - ") ||
              document.visibilityState !== "visible"
            )
              throw Error("Wrong visible test vault");
            app.workspace.activeLeaf.view.editor.focus();
          });
          cdp("Input.insertText", { text: "X" });
          record.typed = snapshot();
          const lines = test.expected.split("\n");
          const row = lines[test.after.line];
          lines[test.after.line] =
            row.slice(0, test.after.ch) + "X" + row.slice(test.after.ch);
          check(record.typed, lines.join("\n"), {
            line: test.after.line,
            ch: test.after.ch + 1,
          });
          assert(
            record.redo.caret && record.typed.typedGlyph,
            "A painted caret and the following typed glyph are required",
          );
          assert(
            Math.abs(record.redo.caret.x - record.typed.typedGlyph.x) <= 1,
            "Following input must start at the painted deletion caret",
          );
          assert(
            Math.abs(record.redo.caretPaint.x - record.typed.typedGlyph.x) <= 1,
            "Following input must start at the captured caret stroke",
          );
        } catch (error) {
          record.error = error.stack;
          failures.push({ name: record.name, error: error.message });
        }
        results.push(record);
      }
    }
  }
} finally {
  fs.writeFileSync(
    `${output}/results.json`,
    JSON.stringify({ results, failures }, null, 2),
  );
  evaluate(
    async ({ note, original }) => {
      window.__relativeDeleteLeaf?.detach();
      delete window.__relativeDeleteLeaf;
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.delete(file);
      if (original.shiki) {
        await app.plugins.enablePlugin("shiki-highlighter");
        const plugin = app.plugins.plugins["shiki-highlighter"];
        plugin.settings.ecDefaultShowLineNumbers = original.numbers;
        await plugin.reloadHighlighter();
      } else await app.plugins.disablePlugin("shiki-highlighter");
      if (original.hasVim) app.vault.setConfig("vimMode", original.vim);
      else delete app.vault.config.vimMode;
      await app.vault.saveConfig();
      app.workspace.updateOptions();
      const leaf = app.workspace.getLeafById(original.leaf);
      if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
    },
    { note, original },
  );
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
}
console.log(JSON.stringify({ cases: results.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
