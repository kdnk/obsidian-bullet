const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");

const output = process.argv[2];
fs.mkdirSync(output);
const note = `pages/code-delete-boundaries-${randomUUID()}.md`;
const prefix = "\t".repeat(5) + "  ";
const opening =
  "- Verification scratch\n\t- hello\n\t\t- hello\n\t\t\t- ```\n\t\t\t  hello\n\t\t\t  hell\n\t\t\t  ```\n\t\t\t\t- hello\n\t\t\t\t\t- ```\n";
const bodyLine = 9;
const closing = `\n${prefix}\`\`\``;
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  vim: app.vault.config.vimMode ?? false,
  shiki: !!app.plugins.plugins["shiki-highlighter"],
}));
const results = [];
const failures = [];
function focus() {
  evaluate(() => {
    window.focus();
    const editor = app.workspace.activeLeaf.view.editor;
    editor.focus();
    if (
      !document.title.includes(" - vault - ") ||
      !editor.cm.hasFocus ||
      document.visibilityState !== "visible"
    )
      throw Error("Input focus guard");
  });
}
function key(key, modifiers = 0) {
  focus();
  evaluate(() => {
    window.__codeDeleteKeys = [];
    const cm = app.workspace.activeLeaf.view.editor.cm;
    const receive = (event) =>
      window.__codeDeleteKeys.push([event.type, event.key]);
    cm.contentDOM.addEventListener("keydown", receive, true);
    cm.contentDOM.addEventListener("keyup", receive, true);
    window.__codeDeleteDispose = () => {
      cm.contentDOM.removeEventListener("keydown", receive, true);
      cm.contentDOM.removeEventListener("keyup", receive, true);
    };
  });
  for (const type of ["keyDown", "keyUp"])
    cdp("Input.dispatchKeyEvent", {
      type,
      key,
      code: key === "h" ? "KeyH" : key,
      windowsVirtualKeyCode: key === "h" ? 72 : 8,
      modifiers,
    });
  const received = evaluate(() => {
    window.__codeDeleteDispose();
    delete window.__codeDeleteDispose;
    return window.__codeDeleteKeys;
  });
  assert.deepEqual(received, [
    ["keydown", key],
    ["keyup", key],
  ]);
}
function state() {
  return evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    const view = app.workspace.activeLeaf.view;
    await view.save();
    return {
      doc: view.editor.getValue(),
      cursor: view.editor.getCursor(),
      saved: await app.vault.read(view.file),
    };
  });
}
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (note) => {
    app.vault.setConfig("vimMode", false);
    app.workspace.updateOptions();
    window.__codeDeleteLeaf = app.workspace.getLeaf("tab");
    await window.__codeDeleteLeaf.openFile(await app.vault.create(note, ""));
  }, note);
  for (const shiki of [false, true]) {
    evaluate(async (enabled) => {
      if (enabled) await app.plugins.enablePlugin("shiki-highlighter");
      else await app.plugins.disablePlugin("shiki-highlighter");
    }, shiki);
    for (const ctrlH of [false, true]) {
      for (const codeIndent of ["", " ", "  ", "\t", "\t  "]) {
        const name = `${shiki ? "shiki" : "native"}-${ctrlH ? "ctrl-h" : "backspace"}-${JSON.stringify(codeIndent)}`;
        const record = { name };
        try {
          const text =
            opening +
            prefix +
            "before\n" +
            prefix +
            codeIndent +
            "after" +
            closing;
          evaluate(
            ({ text, ch, bodyLine }) => {
              const editor = app.workspace.activeLeaf.view.editor;
              editor.setValue(text);
              editor.setCursor({ line: bodyLine + 1, ch });
            },
            { text, ch: prefix.length + codeIndent.length, bodyLine },
          );
          record.before = state();
          const deletion = () => key(ctrlH ? "h" : "Backspace", ctrlH ? 2 : 0);
          let current = record.before;
          let steps = 0;
          while (current.cursor.line === bodyLine + 1 && steps++ < 12) {
            deletion();
            current = state();
            if (current.cursor.line === bodyLine + 1)
              assert(
                current.doc.split("\n")[bodyLine + 1].startsWith(prefix),
                "Code deletion consumed container indentation",
              );
          }
          record.joined = current;
          assert.equal(current.doc, opening + prefix + "beforeafter" + closing);
          assert.equal(current.saved, current.doc);
          assert.deepEqual(current.cursor, {
            line: bodyLine,
            ch: prefix.length + 6,
          });
          focus();
          cdp("Input.insertText", { text: "X" });
          record.typed = state();
          assert.equal(
            record.typed.doc,
            opening + prefix + "beforeXafter" + closing,
          );
          assert.equal(record.typed.saved, record.typed.doc);
          const blank =
            opening + prefix + "before\n" + prefix + codeIndent + closing;
          evaluate(
            ({ blank, ch, bodyLine }) => {
              const editor = app.workspace.activeLeaf.view.editor;
              editor.setValue(blank);
              editor.setCursor({ line: bodyLine + 1, ch });
              editor.focus();
            },
            { blank, ch: prefix.length + codeIndent.length, bodyLine },
          );
          focus();
          cdp("Input.insertText", { text: "X" });
          const glyph = evaluate(() => {
            const editor = app.workspace.activeLeaf.view.editor;
            const cm = editor.cm;
            const pos = cm.state.selection.main.head - 1;
            const at = cm.domAtPos(pos);
            const row = (
              at.node.nodeType === 1 ? at.node : at.node.parentElement
            ).closest(".cm-line");
            if (!row.classList.contains("HyperMD-codeblock"))
              throw Error("Native code row required");
            const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const node = walker.currentNode;
              const index = node.textContent.indexOf("X");
              if (index < 0) continue;
              const range = document.createRange();
              range.setStart(node, index);
              range.setEnd(node, index + 1);
              const rect = range.getBoundingClientRect();
              return { left: rect.left, top: rect.top, height: rect.height };
            }
            throw Error("Typed glyph missing");
          });
          deletion();
          record.blank = state();
          assert.equal(record.blank.doc, blank);
          assert.equal(record.blank.saved, blank);
          assert.deepEqual(record.blank.cursor, {
            line: bodyLine + 1,
            ch: prefix.length + codeIndent.length,
          });
          const clip = {
            x: Math.floor(glyph.left - 8),
            y: Math.ceil(glyph.top + 2),
            width: 17,
            height: Math.max(3, Math.floor(glyph.height - 4)),
            scale: 1,
          };
          const shot = cdp("Page.captureScreenshot", { format: "png", clip });
          const imageName = `${shiki ? "shiki" : "native"}-${ctrlH ? "ctrl-h" : "backspace"}-${codeIndent.replace(/ /g, "s").replace(/\t/g, "t") || "none"}`;
          fs.writeFileSync(
            `${output}/${imageName}.png`,
            Buffer.from(shot.data, "base64"),
          );
          record.blankPaint = evaluate(
            async ({ data, glyph, clip }) => {
              const image = await createImageBitmap(
                new Blob(
                  [Uint8Array.from(atob(data), (c) => c.charCodeAt(0))],
                  { type: "image/png" },
                ),
              );
              const canvas = new OffscreenCanvas(image.width, image.height);
              const context = canvas.getContext("2d");
              context.drawImage(image, 0, 0);
              image.close();
              const pixels = context.getImageData(
                0,
                0,
                canvas.width,
                canvas.height,
              ).data;
              const columns = [];
              for (let x = 0; x < canvas.width; x++) {
                let count = 0;
                for (let y = 0; y < canvas.height; y++)
                  if (pixels[(y * canvas.width + x) * 4] > 140) count++;
                if (count > canvas.height * 0.7) columns.push(x);
              }
              const expected = (glyph.left - clip.x) * devicePixelRatio;
              return {
                columns,
                expected,
                aligned: columns.some(
                  (x) => Math.abs(x - expected) <= devicePixelRatio * 1.5,
                ),
              };
            },
            { data: shot.data, glyph, clip },
          );
          assert(
            record.blankPaint.aligned,
            "Painted blank caret differs from the deleted glyph position",
          );
        } catch (error) {
          record.error = error.stack;
          failures.push({ name, error: error.message });
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
    async ({ original, note }) => {
      window.__codeDeleteLeaf?.detach();
      delete window.__codeDeleteLeaf;
      const leaf = app.workspace.getLeafById(original.leaf);
      if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
      app.vault.setConfig("vimMode", original.vim);
      app.workspace.updateOptions();
      if (original.shiki) await app.plugins.enablePlugin("shiki-highlighter");
      else await app.plugins.disablePlugin("shiki-highlighter");
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.fileManager.trashFile(file);
    },
    { original, note },
  );
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
}
console.log(JSON.stringify({ results: results.length, failures }));
assert.equal(failures.length, 0);
