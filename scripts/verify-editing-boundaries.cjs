const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

if (!process.argv[2])
  throw Error(
    "Usage: node scripts/verify-editing-boundaries.cjs <fresh-output-dir> [--empty-markers]",
  );
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const note = `pages/editing-boundaries-${randomUUID()}.md`;
const original = evaluate(() => {
  const settings = app.plugins.plugins.bullet.settings;
  return {
    leaf: app.workspace.activeLeaf.id,
    vim: app.vault.config.vimMode ?? false,
    settings: {
      overrideEnterBehaviour: settings.overrideEnterBehaviour,
      overrideTabBehaviour: settings.overrideTabBehaviour,
      keepBodyTextInBullets: settings.keepBodyTextInBullets,
      keepCursorWithinContent: settings.keepCursorWithinContent,
    },
  };
});
const emptyMarkersOnly = process.argv.includes("--empty-markers");
const results = [];
const failures = [];
const inputs = [];

function focus() {
  evaluate(() => {
    window.focus();
    if (
      !document.title.includes(" - vault - ") ||
      document.visibilityState !== "visible"
    )
      throw Error("Wrong visible test vault");
    const leaf = window.__editingBoundariesLeaf;
    if (app.workspace.activeLeaf !== leaf)
      throw Error("Scratch leaf is not active");
    const cm = leaf.view.editor.cm;
    if (!cm) throw Error("Expected editor is missing");
    cm.focus();
    if (!cm.hasFocus || document.activeElement !== cm.contentDOM)
      throw Error("Expected editor does not own keyboard focus");
  });
}

function keypress(key, modifiers = 0) {
  const codes = {
    Enter: 13,
    Backspace: 8,
    Delete: 46,
    End: 35,
    ArrowLeft: 37,
    a: 65,
    z: 90,
  };
  for (const type of ["keyDown", "keyUp"]) {
    focus();
    evaluate((eventType) => {
      window.__editingBoundariesInput = null;
      const receive = (event) => {
        window.__editingBoundariesInput = event;
      };
      window.__editingBoundariesReceive = { eventType, receive };
      window.addEventListener(eventType, receive, {
        capture: true,
        once: true,
      });
    }, type.toLowerCase());
    cdp("Input.dispatchKeyEvent", {
      type,
      key,
      code: /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : key,
      windowsVirtualKeyCode: codes[key],
      modifiers,
    });
    const received = evaluate(() => {
      const event = window.__editingBoundariesInput;
      const listener = window.__editingBoundariesReceive;
      window.removeEventListener(listener.eventType, listener.receive, true);
      delete window.__editingBoundariesReceive;
      delete window.__editingBoundariesInput;
      return (
        event && {
          key: event.key,
          target: event.target?.className,
          editorTarget: event.target?.classList.contains("cm-content"),
          prevented: event.defaultPrevented,
        }
      );
    });
    inputs.push({ type, key, modifiers, received });
    assert.equal(received?.key, key, "Renderer must receive the native key");
    assert.equal(
      received.editorTarget,
      true,
      "Key must reach a CodeMirror editor",
    );
  }
}

function type(text) {
  focus();
  cdp("Input.insertText", { text });
}

function setup(text, cursor) {
  evaluate(
    async (text, cursor) => {
      app.commands.executeCommandById("bullet:zoom-reset");
      app.commands.executeCommandById("editor:unfold-all");
      const editor = window.__editingBoundariesLeaf.view.editor;
      editor.setValue(text);
      editor.setCursor(cursor);
      editor.focus();
      await new Promise((resolve) => setTimeout(resolve, 200));
    },
    text,
    cursor,
  );
}

function sample() {
  return evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const view = window.__editingBoundariesLeaf.view;
    await view.save();
    return {
      doc: view.editor.getValue(),
      cursor: view.editor.getCursor(),
      selections: view.editor.listSelections(),
      saved: await app.vault.read(view.file),
      folds: view.currentMode.getFoldInfo()?.folds ?? [],
      zoomed: !!view.containerEl.querySelector(
        '.bullet-zoom-breadcrumbs [aria-current="location"]',
      ),
    };
  });
}

function screenshot(name) {
  const filename = `${name.replace(/[^a-zA-Z0-9-]/g, "_")}.png`;
  fs.writeFileSync(
    path.join(output, filename),
    Buffer.from(
      cdp("Page.captureScreenshot", { format: "png" }).data,
      "base64",
    ),
  );
  return filename;
}

function check(name, run) {
  if (emptyMarkersOnly && !name.startsWith("empty-marker-enter-")) return;
  const result = { name };
  results.push(result);
  try {
    run(result);
    console.log(`PASS ${name}`);
  } catch (error) {
    result.error = error.stack;
    failures.push({ name, error: error.message });
    console.log(`FAIL ${name}: ${error.message}`);
  }
  result.screenshot = screenshot(name);
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify({ note, results, failures }, null, 2),
  );
}

try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (note) => {
    if (window.__editingBoundariesLeaf)
      throw Error("Boundary verifier already running");
    Object.assign(app.plugins.plugins.bullet.settings, {
      overrideEnterBehaviour: true,
      overrideTabBehaviour: true,
      keepBodyTextInBullets: true,
      keepCursorWithinContent: "bullet-and-checkbox",
    });
    app.vault.setConfig("vimMode", false);
    app.workspace.updateOptions();
    const leaf = app.workspace.getLeaf("tab");
    window.__editingBoundariesLeaf = leaf;
    await leaf.openFile(await app.vault.create(note, ""));
  }, note);

  function expectState(actual, doc, cursor) {
    assert.equal(actual.doc, doc);
    assert.equal(actual.saved, doc);
    if (cursor) assert.deepEqual(actual.cursor, cursor);
  }

  function history(result, before, after) {
    keypress("z", 4);
    result.undo = sample();
    expectState(result.undo, before);
    keypress("z", 12);
    result.redo = sample();
    expectState(result.redo, after);
  }

  let emptyMarkerCase = 0;
  for (const { before, after, cursor } of [
    { before: "-", after: "- \n- ", cursor: { line: 1, ch: 2 } },
    { before: "*", after: "* \n* ", cursor: { line: 1, ch: 2 } },
    { before: "+", after: "+ \n+ ", cursor: { line: 1, ch: 2 } },
    { before: "1.", after: "1. \n2. ", cursor: { line: 1, ch: 3 } },
    ...[
      { number: 9, precedingSeparator: " ", separator: "" },
      { number: 99, precedingSeparator: " ", separator: "" },
      { number: 9, precedingSeparator: " ", separator: "\t" },
      { number: 9, precedingSeparator: "\t", separator: "" },
    ].map(({ number, precedingSeparator, separator }) => {
      const prefix = Array.from(
        { length: number - 1 },
        (_, index) => `${index + 1}.${precedingSeparator}previous\n`,
      ).join("");
      return {
        before: `${prefix}${number}.${separator}`,
        after: `${prefix}${number}.${separator || " "}\n${number + 1}.${separator || " "}`,
        cursor: { line: number, ch: String(number + 1).length + 2 },
      };
    }),
    { before: "-\t", after: "-\t\n-\t", cursor: { line: 1, ch: 2 } },
  ]) {
    check(
      `empty-marker-enter-${++emptyMarkerCase}-${JSON.stringify(before.split("\n").at(-1))}`,
      (result) => {
        const lines = before.split("\n");
        const initialCursor = {
          line: lines.length - 1,
          ch: lines.at(-1).length,
        };
        setup(before, initialCursor);
        result.before = sample();
        expectState(result.before, before, initialCursor);
        keypress("Enter");
        result.after = sample();
        expectState(result.after, after, cursor);
        history(result, before, after);
        assert.deepEqual(result.undo.cursor, initialCursor);
        assert.deepEqual(result.redo.cursor, cursor);
        type("X");
        result.typed = sample();
        expectState(result.typed, after + "X", {
          ...cursor,
          ch: cursor.ch + 1,
        });
        result.typingHistory = {};
        history(result.typingHistory, after, after + "X");
        assert.deepEqual(result.typingHistory.redo.cursor, {
          ...cursor,
          ch: cursor.ch + 1,
        });
      },
    );
  }

  for (const marker of ["[ ]", "[x]"]) {
    for (const ch of [6, 9]) {
      check(`task-${marker}-delete-${ch}`, (result) => {
        const before = `- ${marker} abcDEF`;
        const after = ch === 6 ? before : `- ${marker} DEF`;
        setup(before, { line: 0, ch });
        keypress("Backspace", 4);
        result.after = sample();
        expectState(result.after, after, { line: 0, ch: 6 });
        if (ch !== 6) history(result, before, after);
        type("X");
        result.typed = sample();
        expectState(result.typed, after.slice(0, 6) + "X" + after.slice(6), {
          line: 0,
          ch: 7,
        });
      });
    }
  }

  for (const mode of ["bullet-and-checkbox", "bullet-only"]) {
    evaluate((mode) => {
      app.plugins.plugins.bullet.settings.keepCursorWithinContent = mode;
    }, mode);
    for (const ch of [2, 6]) {
      check(`task-continuation-left-${mode}-${ch}`, (result) => {
        const before = "- [ ] task\n  notes";
        setup(before, { line: 1, ch });
        keypress("ArrowLeft");
        result.after = sample();
        const cursor = ch === 2 ? { line: 0, ch: 10 } : { line: 1, ch: 5 };
        expectState(result.after, before, cursor);
        type("X");
        result.typed = sample();
        expectState(
          result.typed,
          ch === 2 ? "- [ ] taskX\n  notes" : "- [ ] task\n  notXes",
        );
      });
    }
  }
  evaluate(() => {
    app.plugins.plugins.bullet.settings.keepCursorWithinContent =
      "bullet-and-checkbox";
  });

  for (const fixture of [
    { name: "child", doc: "- parent\n\t- hidden child\n- sibling", last: 2 },
    { name: "notes", doc: "- parent\n  hidden note\n- sibling", last: 2 },
    {
      name: "nested",
      doc: "- parent\n\t- child\n\t\t- hidden grandchild\n- sibling",
      last: 3,
    },
  ]) {
    for (const direction of ["Delete", "Backspace"]) {
      check(`fold-${fixture.name}-${direction}`, (result) => {
        const cursor =
          direction === "Delete"
            ? { line: 0, ch: 8 }
            : { line: fixture.last, ch: 2 };
        setup(fixture.doc, cursor);
        evaluate(async (cursor) => {
          const e = window.__editingBoundariesLeaf.view.editor;
          e.setCursor({ line: 0, ch: 2 });
          if (!app.commands.executeCommandById("editor:fold-more"))
            throw Error("Fold command unavailable");
          e.setCursor(cursor);
          await new Promise((resolve) => setTimeout(resolve, 150));
        }, cursor);
        result.before = sample();
        assert.ok(
          result.before.folds.length > 0,
          "Fixture must be folded before input",
        );
        keypress(direction);
        result.after = sample();
        expectState(result.after, fixture.doc, cursor);
        assert.equal(
          result.after.folds.length,
          0,
          "First boundary deletion reveals hidden content",
        );
        type("X");
        result.typed = sample();
        const lines = fixture.doc.split("\n");
        lines[cursor.line] =
          lines[cursor.line].slice(0, cursor.ch) +
          "X" +
          lines[cursor.line].slice(cursor.ch);
        expectState(result.typed, lines.join("\n"));
        history(result, fixture.doc, lines.join("\n"));
      });
    }
  }

  for (const direction of ["Delete", "Backspace"]) {
    check(`fold-repeat-${direction}`, (result) => {
      const before = "- parent\n\t- hidden child\n- sibling";
      const cursor =
        direction === "Delete" ? { line: 0, ch: 8 } : { line: 2, ch: 2 };
      setup(before, cursor);
      evaluate((cursor) => {
        const e = window.__editingBoundariesLeaf.view.editor;
        e.setCursor({ line: 0, ch: 2 });
        app.commands.executeCommandById("editor:fold-more");
        e.setCursor(cursor);
      }, cursor);
      keypress(direction);
      result.revealed = sample();
      expectState(result.revealed, before, cursor);
      keypress(direction);
      result.joined = sample();
      const after =
        direction === "Delete"
          ? "- parenthidden child\n- sibling"
          : "- parent\n\t- hidden childsibling";
      expectState(result.joined, after);
      history(result, before, after);
    });

    check(`fold-no-undo-step-${direction}`, (result) => {
      const before =
        direction === "Delete"
          ? "- paren\n\t- hidden child\n- sibling"
          : "- parent\n\t- hidden child\n- siblin";
      const cursor =
        direction === "Delete" ? { line: 0, ch: 7 } : { line: 2, ch: 8 };
      setup(before, cursor);
      type(direction === "Delete" ? "t" : "g");
      const typed = "- parent\n\t- hidden child\n- sibling";
      result.typed = sample();
      expectState(result.typed, typed);
      evaluate((direction) => {
        const e = window.__editingBoundariesLeaf.view.editor;
        e.setCursor({ line: 0, ch: 2 });
        app.commands.executeCommandById("editor:fold-more");
        e.setCursor(
          direction === "Delete" ? { line: 0, ch: 8 } : { line: 2, ch: 2 },
        );
      }, direction);
      keypress(direction);
      result.revealed = sample();
      expectState(result.revealed, typed);
      assert.equal(result.revealed.folds.length, 0);
      history(result, before, typed);
    });
  }

  check("nested-folds-reveal-independently", (result) => {
    const before = "- parent\n\t- child\n\t\t- grandchild\n- sibling";
    const cursor = { line: 3, ch: 2 };
    setup(before, cursor);
    evaluate(() => {
      const e = window.__editingBoundariesLeaf.view.editor;
      e.setCursor({ line: 1, ch: 3 });
      app.commands.executeCommandById("editor:fold-more");
      e.setCursor({ line: 0, ch: 2 });
      app.commands.executeCommandById("editor:fold-more");
      e.setCursor({ line: 3, ch: 2 });
    });
    result.before = sample();
    assert.equal(result.before.folds.length, 2);
    keypress("Backspace");
    result.outer = sample();
    expectState(result.outer, before, cursor);
    assert.equal(result.outer.folds.length, 1);
    keypress("Backspace");
    result.inner = sample();
    expectState(result.inner, before, cursor);
    assert.equal(result.inner.folds.length, 0);
  });

  for (const entry of [
    {
      name: "spaces",
      doc: "\n",
      cursors: [
        { line: 0, ch: 0 },
        { line: 1, ch: 0 },
      ],
      input: " ",
      after: "- \n- ",
      typedAfter: "- X\n- X",
    },
    {
      name: "heading",
      doc: "- \n- ",
      cursors: [
        { line: 0, ch: 2 },
        { line: 1, ch: 2 },
      ],
      input: "# ",
      after: "# \n# ",
      beforeFinal: "#\n#",
      typedAfter: "# X\n# X",
    },
    {
      name: "quote",
      doc: "- \n- ",
      cursors: [
        { line: 0, ch: 2 },
        { line: 1, ch: 2 },
      ],
      input: "> ",
      after: "> \n> ",
      beforeFinal: ">\n>",
      typedAfter: "> X\n> X",
    },
    {
      name: "asterisk-rule",
      doc: "- \n\n- ",
      cursors: [
        { line: 0, ch: 2 },
        { line: 2, ch: 2 },
      ],
      input: "***",
      after: "***\n\n***",
      beforeFinal: "- **\n\n- **",
      typedAfter: "- ***X\n\n- ***X",
    },
    {
      name: "underscore-rule",
      doc: "- \n\n- ",
      cursors: [
        { line: 0, ch: 2 },
        { line: 2, ch: 2 },
      ],
      input: "___",
      after: "___\n\n___",
      beforeFinal: "- __\n\n- __",
      typedAfter: "- ___X\n\n- ___X",
    },
    {
      name: "mixed-space",
      doc: "\n- title",
      cursors: [
        { line: 0, ch: 0 },
        { line: 1, ch: 7 },
      ],
      input: " ",
      after: "- \n- title ",
      typedAfter: "- X\n- title X",
    },
    {
      name: "mixed-code-heading",
      doc: "- ```\n\n  ```\n- ",
      cursors: [
        { line: 1, ch: 0 },
        { line: 3, ch: 2 },
      ],
      input: "#",
      after: "- ```\n  #\n  ```\n#",
      typedAfter: "- ```\n  #X\n  ```\n- #X",
    },
  ]) {
    check(`multi-${entry.name}`, (result) => {
      setup(entry.doc, entry.cursors[0]);
      evaluate((cursors) => {
        window.__editingBoundariesLeaf.view.editor.setSelections(
          cursors.map((p) => ({ anchor: p, head: p })),
        );
      }, entry.cursors);
      for (const char of entry.input.slice(0, -1)) type(char);
      if (entry.input.length > 1) {
        result.beforeFinal = sample();
        expectState(result.beforeFinal, entry.beforeFinal);
        evaluate(async () => {
          await new Promise((resolve) => setTimeout(resolve, 650));
        });
      }
      type(entry.input.at(-1));
      result.after = sample();
      expectState(result.after, entry.after);
      history(result, entry.beforeFinal ?? entry.doc, entry.after);
      type("X");
      result.typed = sample();
      expectState(result.typed, entry.typedAfter);
    });
  }

  const rangeCases = [
    {
      name: "root",
      doc: "- alpha\n- beta",
      start: { line: 0, ch: 4 },
      end: { line: 1, ch: 4 },
      after: "- alta",
    },
    {
      name: "nested",
      doc: "- parent\n\t- alpha\n\t- beta",
      start: { line: 1, ch: 5 },
      end: { line: 2, ch: 5 },
      after: "- parent\n\t- alta",
    },
    {
      name: "ordered",
      doc: "9. alpha\n10. beta",
      start: { line: 0, ch: 5 },
      end: { line: 1, ch: 6 },
      after: "9. alta",
    },
    {
      name: "task",
      doc: "- [x] alpha\n- [ ] beta",
      start: { line: 0, ch: 8 },
      end: { line: 1, ch: 8 },
      after: "- [x] alta",
    },
    {
      name: "descendants",
      doc: "- alpha\n\t- child\n- middle\n- beta",
      start: { line: 0, ch: 4 },
      end: { line: 3, ch: 4 },
      after: "- alta",
    },
    {
      name: "empty-first-item",
      doc: "- \n- beta",
      start: { line: 0, ch: 1 },
      end: { line: 1, ch: 4 },
      after: "- ta",
      cursor: { line: 0, ch: 2 },
    },
    {
      name: "partial-first-marker",
      doc: "10. alpha\n* beta",
      start: { line: 0, ch: 1 },
      end: { line: 1, ch: 4 },
      after: "10. ta",
      cursor: { line: 0, ch: 4 },
    },
    {
      name: "whole-first-item",
      doc: "10. alpha\n* beta",
      start: { line: 0, ch: 0 },
      end: { line: 1, ch: 4 },
      after: "* ta",
      cursor: { line: 0, ch: 2 },
    },
  ];
  for (const entry of rangeCases) {
    for (const reverse of [false, true]) {
      for (const key of ["Backspace", "Delete"]) {
        check(`range-${entry.name}-${key}-${reverse}`, (result) => {
          setup(entry.doc, entry.start);
          evaluate(
            (start, end, reverse) => {
              window.__editingBoundariesLeaf.view.editor.setSelection(
                reverse ? end : start,
                reverse ? start : end,
              );
            },
            entry.start,
            entry.end,
            reverse,
          );
          keypress(key);
          result.after = sample();
          const cursor = entry.cursor ?? entry.start;
          expectState(result.after, entry.after, cursor);
          history(result, entry.doc, entry.after);
          assert.deepEqual(result.undo.selections, [
            {
              anchor: reverse ? entry.end : entry.start,
              head: reverse ? entry.start : entry.end,
            },
          ]);
          assert.deepEqual(result.redo.cursor, cursor);
          type("X");
          result.typed = sample();
          const lines = entry.after.split("\n");
          const line = lines[cursor.line];
          lines[cursor.line] =
            line.slice(0, cursor.ch) + "X" + line.slice(cursor.ch);
          expectState(result.typed, lines.join("\n"), {
            ...cursor,
            ch: cursor.ch + 1,
          });
        });
      }
    }
  }
  for (const cursorMode of ["never", "bullet-and-checkbox"]) {
    for (const reverse of [false, true]) {
      check(`range-enter-${cursorMode}-${reverse}`, (result) => {
        evaluate((mode) => {
          app.plugins.plugins.bullet.settings.keepCursorWithinContent = mode;
        }, cursorMode);
        try {
          const before = "- alpha\n- beta";
          const after = "- al\n- ta";
          setup(before, { line: 0, ch: 4 });
          const selection = {
            anchor: reverse ? { line: 1, ch: 4 } : { line: 0, ch: 4 },
            head: reverse ? { line: 0, ch: 4 } : { line: 1, ch: 4 },
          };
          evaluate((selection) => {
            window.__editingBoundariesLeaf.view.editor.setSelection(
              selection.anchor,
              selection.head,
            );
          }, selection);
          keypress("Enter");
          result.after = sample();
          expectState(result.after, after, { line: 1, ch: 2 });
          history(result, before, after);
          assert.deepEqual(result.undo.selections, [selection]);
          assert.deepEqual(result.redo.cursor, { line: 1, ch: 2 });
          type("X");
          result.typed = sample();
          expectState(result.typed, "- al\n- Xta", { line: 1, ch: 3 });
          result.typingHistory = {};
          history(result.typingHistory, after, "- al\n- Xta");
          assert.deepEqual(result.typingHistory.redo.cursor, {
            line: 1,
            ch: 3,
          });
        } finally {
          evaluate(() => {
            app.plugins.plugins.bullet.settings.keepCursorWithinContent =
              "bullet-and-checkbox";
          });
        }
      });
    }
  }
  check("multiple-selected-joins", (result) => {
    const before = "- alpha\n- beta\n- gamma\n- delta";
    const after = "- alta\n- galta";
    setup(before, { line: 0, ch: 4 });
    evaluate(() => {
      window.__editingBoundariesLeaf.view.editor.setSelections([
        { anchor: { line: 0, ch: 4 }, head: { line: 1, ch: 4 } },
        { anchor: { line: 3, ch: 4 }, head: { line: 2, ch: 4 } },
      ]);
    });
    keypress("Backspace");
    result.after = sample();
    expectState(result.after, after);
    history(result, before, after);
    type("X");
    result.typed = sample();
    expectState(result.typed, "- alXta\n- gaXlta");
  });
  check("range-enter-guard-disabled", (result) => {
    evaluate(() => {
      app.plugins.plugins.bullet.settings.keepBodyTextInBullets = false;
    });
    try {
      setup("- alpha\n- beta", { line: 0, ch: 4 });
      evaluate(() => {
        window.__editingBoundariesLeaf.view.editor.setSelection(
          { line: 0, ch: 4 },
          { line: 1, ch: 4 },
        );
      });
      keypress("Enter");
      result.after = sample();
      expectState(result.after, "- al\nta", { line: 1, ch: 0 });
      type("X");
      result.typed = sample();
      expectState(result.typed, "- al\nXta", { line: 1, ch: 1 });
    } finally {
      evaluate(() => {
        app.plugins.plugins.bullet.settings.keepBodyTextInBullets = true;
      });
    }
  });
} finally {
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify({ note, results, failures }, null, 2),
  );
  fs.writeFileSync(
    path.join(output, "input-events.json"),
    JSON.stringify(inputs, null, 2),
  );
  try {
    evaluate(
      async (original, note) => {
        const listener = window.__editingBoundariesReceive;
        if (listener)
          window.removeEventListener(
            listener.eventType,
            listener.receive,
            true,
          );
        delete window.__editingBoundariesReceive;
        delete window.__editingBoundariesInput;
        const leaf = window.__editingBoundariesLeaf;
        if (leaf) {
          app.workspace.setActiveLeaf(leaf, { focus: true });
          app.commands.executeCommandById("bullet:zoom-reset");
          leaf.detach();
        }
        delete window.__editingBoundariesLeaf;
        Object.assign(app.plugins.plugins.bullet.settings, original.settings);
        app.vault.setConfig("vimMode", original.vim);
        app.workspace.updateOptions();
        const priorLeaf = app.workspace.getLeafById(original.leaf);
        if (priorLeaf) app.workspace.setActiveLeaf(priorLeaf, { focus: true });
        const file = app.vault.getAbstractFileByPath(note);
        if (file) await app.vault.trash(file, true);
      },
      original,
      note,
    );
  } finally {
    cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
  }
}
assert.equal(
  failures.length,
  0,
  `${failures.length} editing boundary checks failed`,
);
