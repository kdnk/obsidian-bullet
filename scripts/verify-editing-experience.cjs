const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

if (!process.argv[2])
  throw Error(
    "Usage: node scripts/verify-editing-experience.cjs <fresh-output-dir>",
  );
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const note = `pages/editing-experience-${randomUUID()}.md`;
const original = evaluate(() => {
  const settings = app.plugins.plugins.bullet.settings;
  return {
    leaf: app.workspace.activeLeaf.id,
    vim: app.vault.config.vimMode ?? false,
    shiki: !!app.plugins.plugins["shiki-highlighter"],
    settings: {
      overrideEnterBehaviour: settings.overrideEnterBehaviour,
      overrideTabBehaviour: settings.overrideTabBehaviour,
      keepBodyTextInBullets: settings.keepBodyTextInBullets,
      keepCursorWithinContent: settings.keepCursorWithinContent,
    },
  };
});
const results = [];
const failures = [];
const inputs = [];

function focus(cell = false) {
  evaluate((cell) => {
    window.focus();
    if (
      !document.title.includes(" - vault - ") ||
      document.visibilityState !== "visible"
    )
      throw Error("Wrong visible test vault");
    const leaf = window.__editingExperienceLeaf;
    if (app.workspace.activeLeaf !== leaf)
      throw Error("Scratch leaf is not active");
    const main = leaf.view.editor.cm;
    const cm = cell
      ? main.constructor.findFromDOM(
          leaf.view.containerEl.querySelector(".table-cell-wrapper .cm-editor"),
        )
      : main;
    if (!cm) throw Error("Expected editor is missing");
    cm.focus();
    if (!cm.hasFocus || document.activeElement !== cm.contentDOM)
      throw Error("Expected editor does not own keyboard focus");
  }, cell);
}

function keypress(key, modifiers = 0, cell = false) {
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
    focus(cell);
    evaluate((eventType) => {
      window.__editingExperienceInput = null;
      const receive = (event) => {
        window.__editingExperienceInput = event;
      };
      window.__editingExperienceReceive = { eventType, receive };
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
      const event = window.__editingExperienceInput;
      const listener = window.__editingExperienceReceive;
      window.removeEventListener(listener.eventType, listener.receive, true);
      delete window.__editingExperienceReceive;
      delete window.__editingExperienceInput;
      return (
        event && {
          key: event.key,
          target: event.target?.className,
          editorTarget: event.target?.classList.contains("cm-content"),
          prevented: event.defaultPrevented,
        }
      );
    });
    inputs.push({ type, key, modifiers, cell, received });
    assert.equal(received?.key, key, "Renderer must receive the native key");
    assert.equal(
      received.editorTarget,
      true,
      "Key must reach a CodeMirror editor",
    );
  }
}

function type(text, cell = false) {
  focus(cell);
  cdp("Input.insertText", { text });
}

function setup(text, cursor) {
  evaluate(
    async (text, cursor) => {
      app.commands.executeCommandById("bullet:zoom-reset");
      const editor = window.__editingExperienceLeaf.view.editor;
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
    const view = window.__editingExperienceLeaf.view;
    await view.save();
    return {
      doc: view.editor.getValue(),
      cursor: view.editor.getCursor(),
      selections: view.editor.listSelections(),
      saved: await app.vault.read(view.file),
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
    if (window.__editingExperienceLeaf)
      throw Error("Editing verifier already running");
    Object.assign(app.plugins.plugins.bullet.settings, {
      overrideEnterBehaviour: true,
      overrideTabBehaviour: true,
      keepBodyTextInBullets: true,
      keepCursorWithinContent: "bullet-and-checkbox",
    });
    app.vault.setConfig("vimMode", false);
    app.workspace.updateOptions();
    const leaf = app.workspace.getLeaf("tab");
    window.__editingExperienceLeaf = leaf;
    await leaf.openFile(await app.vault.create(note, ""));
  }, note);

  for (const shiki of [false, true]) {
    evaluate(async (enabled) => {
      if (enabled) await app.plugins.enablePlugin("shiki-highlighter");
      else await app.plugins.disablePlugin("shiki-highlighter");
      if (!!app.plugins.plugins["shiki-highlighter"] !== enabled)
        throw Error("Shiki did not reach the requested state");
    }, shiki);
    const suffix = shiki ? "shiki" : "native";
    for (const fixture of [
      {
        name: "split-parent-with-partial-tab-code",
        key: "Enter",
        text: "- title\n  ```js\n\tfoo\n\n  ```",
        cursor: { line: 0, ch: 4 },
        expected: "- ti\n- tle\n  ```js\n\tfoo\n\n  ```",
        afterCursor: { line: 1, ch: 2 },
        typed: "- ti\n- Xtle\n  ```js\n\tfoo\n\n  ```",
      },
      {
        name: "backspace-parent-with-partial-tab-code",
        key: "Backspace",
        text: "- prev\n- title\n  ```js\n\tfoo\n\n  ```",
        cursor: { line: 1, ch: 2 },
        expected: "- prevtitle\n  ```js\n\tfoo\n\n  ```",
        afterCursor: { line: 0, ch: 6 },
        typed: "- prevXtitle\n  ```js\n\tfoo\n\n  ```",
      },
      {
        name: "delete-parent-with-partial-tab-code",
        key: "Delete",
        text: "- prev\n- title\n  ```js\n\tfoo\n\n  ```",
        cursor: { line: 0, ch: 6 },
        expected: "- prevtitle\n  ```js\n\tfoo\n\n  ```",
        afterCursor: { line: 0, ch: 6 },
        typed: "- prevXtitle\n  ```js\n\tfoo\n\n  ```",
      },
    ]) {
      check(`${fixture.name}-${suffix}`, (result) => {
        setup(fixture.text, fixture.cursor);
        result.before = sample();
        keypress(fixture.key);
        result.after = sample();
        assert.equal(result.after.doc, fixture.expected);
        assert.equal(result.after.saved, fixture.expected);
        assert.deepEqual(result.after.cursor, fixture.afterCursor);
        keypress("z", 4);
        result.undone = sample();
        assert.equal(result.undone.doc, fixture.text);
        assert.deepEqual(result.undone.cursor, fixture.cursor);
        keypress("z", 12);
        result.redone = sample();
        assert.equal(result.redone.doc, fixture.expected);
        assert.deepEqual(result.redone.cursor, fixture.afterCursor);
        type("X");
        result.typed = sample();
        assert.equal(result.typed.doc, fixture.typed);
        assert.equal(result.typed.saved, fixture.typed);
        assert.deepEqual(result.typed.cursor, {
          ...fixture.afterCursor,
          ch: fixture.afterCursor.ch + 1,
        });
      });
    }

    for (const glyph of [
      { name: "emoji", text: "😀", backspace: "" },
      { name: "joined-emoji", text: "👩‍💻", backspace: "" },
      { name: "flag", text: "🇯🇵", backspace: "" },
      { name: "combining-kana", text: "か\u3099", backspace: "か" },
    ]) {
      for (const key of ["Backspace", "Delete"]) {
        check(
          `unicode-${glyph.name}-${key.toLowerCase()}-${suffix}`,
          (result) => {
            const text = `- a${glyph.text}b`;
            const remaining = key === "Backspace" ? glyph.backspace : "";
            const afterCursor = { line: 0, ch: 3 + remaining.length };
            setup(text, {
              line: 0,
              ch: key === "Backspace" ? 3 + glyph.text.length : 3,
            });
            result.before = sample();
            keypress(key);
            result.after = sample();
            assert.equal(result.after.doc, `- a${remaining}b`);
            assert.equal(result.after.saved, `- a${remaining}b`);
            assert.deepEqual(result.after.cursor, afterCursor);
            assert.deepEqual(result.after.selections, [
              { anchor: afterCursor, head: afterCursor },
            ]);
            type("追");
            result.typed = sample();
            assert.equal(result.typed.doc, `- a${remaining}追b`);
            assert.equal(result.typed.saved, `- a${remaining}追b`);
            assert.deepEqual(result.typed.cursor, {
              line: 0,
              ch: afterCursor.ch + 1,
            });
          },
        );
      }
    }

    for (const backwards of [false, true]) {
      for (const action of ["Backspace", "insert-text"]) {
        check(
          `descendant-range-${action}-${backwards ? "backwards" : "forwards"}-${suffix}`,
          (result) => {
            const text =
              "- parent\n\t- alpha\n\t\t- grandchild\n\t- beta\n\t\t- retained";
            const start = { line: 1, ch: 5 };
            const end = { line: 3, ch: 5 };
            const selection = backwards
              ? { anchor: end, head: start }
              : { anchor: start, head: end };
            const expected =
              action === "Backspace"
                ? "- parent\n\t- alta\n\t\t- retained"
                : "- parent\n\t- alXta\n\t\t- retained";
            const afterCursor = { line: 1, ch: action === "Backspace" ? 5 : 6 };
            const collapsed = { anchor: afterCursor, head: afterCursor };
            for (const history of [false, true]) {
              setup(text, selection.head);
              evaluate((selection) => {
                window.__editingExperienceLeaf.view.editor.setSelection(
                  selection.anchor,
                  selection.head,
                );
              }, selection);
              const run = {};
              result[history ? "history" : "immediate"] = run;
              run.before = sample();
              assert.deepEqual(run.before.selections, [selection]);
              if (action === "Backspace") keypress("Backspace");
              else type("X");
              run.after = sample();
              assert.equal(run.after.doc, expected);
              assert.equal(run.after.saved, expected);
              assert.deepEqual(run.after.cursor, afterCursor);
              assert.deepEqual(run.after.selections, [collapsed]);
              if (history) {
                keypress("z", 4);
                run.undone = sample();
                assert.equal(run.undone.doc, text);
                assert.equal(run.undone.saved, text);
                assert.deepEqual(run.undone.selections, [selection]);
                keypress("z", 12);
                run.redone = sample();
                assert.equal(run.redone.doc, expected);
                assert.equal(run.redone.saved, expected);
                const redoneSelection =
                  action === "Backspace"
                    ? collapsed
                    : backwards
                      ? { anchor: afterCursor, head: start }
                      : { anchor: start, head: afterCursor };
                assert.deepEqual(run.redone.cursor, redoneSelection.head);
                assert.deepEqual(run.redone.selections, [redoneSelection]);
              }
              type("追");
              run.typed = sample();
              const typed =
                !history && action === "insert-text"
                  ? "- parent\n\t- alX追ta\n\t\t- retained"
                  : "- parent\n\t- al追ta\n\t\t- retained";
              const typedCursor = {
                line: 1,
                ch: !history && action === "insert-text" ? 7 : 6,
              };
              assert.equal(run.typed.doc, typed);
              assert.equal(run.typed.saved, typed);
              assert.deepEqual(run.typed.cursor, typedCursor);
              assert.deepEqual(run.typed.selections, [
                { anchor: typedCursor, head: typedCursor },
              ]);
            }
          },
        );
      }
    }

    for (const initial of ["", "- "]) {
      for (const content of ["~~~js", "***", "___", "*word*", "~~word~~"]) {
        check(
          `type-${content.replace(/\*/g, "star").replace(/~/g, "tilde")}-${initial ? "empty-item" : "empty-note"}-${suffix}`,
          (result) => {
            setup(initial, { line: 0, ch: initial.length });
            result.steps = [];
            for (const character of content) {
              type(character);
              result.steps.push({ character, ...sample() });
            }
            const expected = content.includes("word")
              ? `- ${content}`
              : content;
            const after = result.steps.at(-1);
            assert.equal(after.doc, expected);
            assert.equal(after.saved, expected);
            assert.deepEqual(after.cursor, { line: 0, ch: expected.length });
          },
        );
      }
    }
  }

  evaluate(() => {
    app.plugins.plugins.bullet.settings.keepCursorWithinContent = "never";
  });
  for (const marker of ["1. ", "12. ", "123. ", "1.\t", "12.\t", "123.\t"]) {
    check(
      `ordered-zoom-${marker.trim()}-${marker.endsWith("\t") ? "tab" : "space"}`,
      (result) => {
        const text = `${marker}task\n\t- child`;
        setup(text, { line: 0, ch: marker.length });
        result.before = sample();
        result.entryPoint = "bullet:zoom-in command via API";
        evaluate(() => {
          if (!app.commands.executeCommandById("bullet:zoom-in"))
            throw Error("Zoom command unavailable");
        });
        result.zoomed = sample();
        assert.equal(result.zoomed.zoomed, true);
        assert.deepEqual(result.zoomed.cursor, { line: 0, ch: marker.length });
        type("X");
        result.typed = sample();
        assert.equal(result.typed.doc, `${marker}Xtask\n\t- child`);
        assert.equal(result.typed.saved, result.typed.doc);
        assert.deepEqual(result.typed.cursor, {
          line: 0,
          ch: marker.length + 1,
        });
        evaluate(() => app.commands.executeCommandById("bullet:zoom-reset"));
      },
    );
  }

  evaluate(() => {
    app.plugins.plugins.bullet.settings.keepCursorWithinContent =
      "bullet-and-checkbox";
  });
  check("delete-to-line-start-from-marker", (result) => {
    setup("- abc😀", { line: 0, ch: 2 });
    keypress("ArrowLeft", 1);
    result.before = sample();
    assert.deepEqual(result.before.cursor, { line: 0, ch: 0 });
    keypress("Backspace", 4);
    result.after = sample();
    assert.equal(result.after.doc, "- abc😀");
    assert.equal(result.after.saved, "- abc😀");
  });

  check("native-table-cell-typing", (result) => {
    setup("| Name | Value |\n| --- | --- |\n| Sample | abc |\n\n", {
      line: 4,
      ch: 0,
    });
    for (const eventType of ["mousePressed", "mouseReleased"]) {
      const target = evaluate(async () => {
        window.focus();
        if (
          !document.title.includes(" - vault - ") ||
          document.visibilityState !== "visible"
        )
          throw Error("Wrong visible test vault");
        const leaf = window.__editingExperienceLeaf;
        if (app.workspace.activeLeaf !== leaf)
          throw Error("Scratch leaf is not active");
        for (let attempt = 0; attempt < 30; attempt++) {
          const cell = [
            ...leaf.view.containerEl.querySelectorAll(".table-cell-wrapper"),
          ].find((element) => element.textContent.trim() === "abc");
          if (cell) {
            const bounds = cell.getBoundingClientRect();
            const x = bounds.left + bounds.width / 2;
            const y = bounds.top + bounds.height / 2;
            const hit = document.elementFromPoint(x, y);
            if (hit && cell.contains(hit)) return { x, y };
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw Error("Native abc cell was not visible and hit-testable");
      });
      cdp("Input.dispatchMouseEvent", {
        type: eventType,
        ...target,
        button: "left",
        clickCount: 1,
      });
    }
    keypress("End", 0, true);
    type("X", true);
    result.cell = evaluate(() => {
      const view = window.__editingExperienceLeaf.view;
      const cell = view.containerEl.querySelector(
        ".table-cell-wrapper .cm-editor",
      );
      const cm = view.editor.cm.constructor.findFromDOM(cell);
      return {
        doc: cm.state.doc.toString(),
        cursor: cm.state.selection.main.head,
      };
    });
    result.editingScreenshot = screenshot("native-table-cell-active");
    assert.equal(result.cell.doc, "abcX");
    assert.equal(result.cell.cursor, 4);
    keypress("a", 4, true);
    type("Y", true);
    result.replacedCell = evaluate(() => {
      const view = window.__editingExperienceLeaf.view;
      const cell = view.containerEl.querySelector(
        ".table-cell-wrapper .cm-editor",
      );
      const cm = view.editor.cm.constructor.findFromDOM(cell);
      return cm.state.doc.toString();
    });
    assert.equal(result.replacedCell, "Y");
    focus();
    result.after = sample();
    const rows = result.after.doc
      .trim()
      .split("\n")
      .map((line) =>
        line
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim()),
      );
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0], ["Name", "Value"]);
    assert.equal(rows[1].length, 2);
    assert.ok(rows[1].every((cell) => /^:?-{3,}:?$/.test(cell)));
    assert.deepEqual(rows[2], ["Sample", "Y"]);
    assert.ok(
      result.after.doc
        .trim()
        .split("\n")
        .every((line) => line.startsWith("|")),
    );
    assert.equal(result.after.saved, result.after.doc);
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
        const listener = window.__editingExperienceReceive;
        if (listener)
          window.removeEventListener(
            listener.eventType,
            listener.receive,
            true,
          );
        delete window.__editingExperienceReceive;
        delete window.__editingExperienceInput;
        const leaf = window.__editingExperienceLeaf;
        if (leaf) {
          app.workspace.setActiveLeaf(leaf, { focus: true });
          app.commands.executeCommandById("bullet:zoom-reset");
          leaf.detach();
        }
        delete window.__editingExperienceLeaf;
        Object.assign(app.plugins.plugins.bullet.settings, original.settings);
        app.vault.setConfig("vimMode", original.vim);
        app.workspace.updateOptions();
        if (original.shiki) await app.plugins.enablePlugin("shiki-highlighter");
        else await app.plugins.disablePlugin("shiki-highlighter");
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
  `${failures.length} editing experience checks failed`,
);
