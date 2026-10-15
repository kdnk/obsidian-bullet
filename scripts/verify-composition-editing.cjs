const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");

if (!process.argv[2])
  throw Error(
    "Usage: node scripts/verify-composition-editing.cjs <fresh-output-directory> [--native-control] [--case=name] [--boundary]",
  );
const output = path.resolve(process.argv[2]);
const nativeControl = process.argv.includes("--native-control");
const boundary = process.argv.includes("--boundary");
assert.ok(!(boundary && nativeControl), "Boundary checks require the guard");
const caseName = process.argv
  .find((argument) => argument.startsWith("--case="))
  ?.slice(7);
fs.mkdirSync(output);
const notes = [];
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  vim: app.vault.config.vimMode,
  hasVim: Object.hasOwn(app.vault.config, "vimMode"),
  shiki: !!app.plugins.plugins["shiki-highlighter"],
  body: app.plugins.plugins.bullet.settings.keepBodyTextInBullets,
}));
const results = [];
const failures = [];
const fixtures = [
  {
    name: "existing-list",
    doc: "- abc",
    anchor: { line: 0, ch: 2 },
    expected: "- 日本語abc",
    cursor: { line: 0, ch: 5 },
  },
  {
    name: "empty-document",
    doc: "",
    anchor: { line: 0, ch: 0 },
    expected: "- 日本語",
    cursor: { line: 0, ch: 5 },
  },
  {
    name: "blank-code-row",
    doc: "- ```js\n\n  ```",
    anchor: { line: 1, ch: 0 },
    expected: "- ```js\n  日本語\n  ```",
    cursor: { line: 1, ch: 5 },
  },
  {
    name: "nested-blank-code-row",
    doc: "- parent\n\t- ```js\n\n\t  ```",
    anchor: { line: 2, ch: 0 },
    expected: "- parent\n\t- ```js\n\t  日本語\n\t  ```",
    cursor: { line: 2, ch: 6 },
  },
  {
    name: "selected-list-prefix",
    doc: "- alpha",
    anchor: { line: 0, ch: 0 },
    head: { line: 0, ch: 2 },
    expected: "- 日本語alpha",
    cursor: { line: 0, ch: 5 },
  },
  {
    name: "selected-list-range",
    doc: "- alpha\n- beta",
    anchor: { line: 0, ch: 4 },
    head: { line: 1, ch: 4 },
    expected: "- al日本語ta",
    cursor: { line: 0, ch: 7 },
  },
];

function provisional(fixture, text) {
  const offset = ({ line, ch }) =>
    fixture.doc
      .split("\n")
      .slice(0, line)
      .reduce((sum, row) => sum + row.length + 1, 0) + ch;
  const start = offset(fixture.anchor);
  const end = offset(fixture.head ?? fixture.anchor);
  return (
    fixture.doc.slice(0, Math.min(start, end)) +
    text +
    fixture.doc.slice(Math.max(start, end))
  );
}

function focus() {
  evaluate(() => {
    window.focus();
    if (
      !document.title.includes(" - vault - ") ||
      document.visibilityState !== "visible" ||
      app.isVimEnabled()
    )
      throw Error("Native input preconditions");
    const cm = window.__compositionEditingLeaf.view.editor.cm;
    cm.focus();
    if (
      app.workspace.activeLeaf !== window.__compositionEditingLeaf ||
      !cm.hasFocus ||
      document.activeElement !== cm.contentDOM ||
      cm.cm
    )
      throw Error("Wrong editor");
  });
}
function sample(save = false) {
  return evaluate(async (save) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const view = window.__compositionEditingLeaf.view;
    if (save) await view.save();
    return {
      doc: view.editor.getValue(),
      cursor: view.editor.getCursor(),
      composing: view.editor.cm.composing,
      events: window.__compositionEditingEvents.slice(),
      ...(save ? { saved: await app.vault.read(view.file) } : {}),
    };
  }, save);
}
function key(key, modifiers = 0) {
  const code = key === "z" ? "KeyZ" : key;
  const keyCode = { z: 90, Enter: 13, Backspace: 8 }[key];
  assert.ok(keyCode, "Known native key");
  for (const type of ["keyDown", "keyUp"]) {
    focus();
    cdp("Input.dispatchKeyEvent", {
      type,
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      modifiers,
    });
  }
}
function compose(text) {
  focus();
  cdp("Input.imeSetComposition", {
    text,
    selectionStart: text.length,
    selectionEnd: text.length,
  });
}
function type(text) {
  focus();
  cdp("Input.insertText", { text });
}
function setup(fixture) {
  const note = `pages/composition-editing-${randomUUID()}.md`;
  notes.push(note);
  fs.writeFileSync(
    path.join(output, "notes.json"),
    JSON.stringify(notes, null, 2),
  );
  evaluate(
    async (fixture, note) => {
      window.__compositionEditingLeaf?.detach();
      window.__compositionEditingLeaf = app.workspace.getLeaf("tab");
      await window.__compositionEditingLeaf.openFile(
        await app.vault.create(note, fixture.doc),
      );
      const editor = window.__compositionEditingLeaf.view.editor;
      editor.setSelection(fixture.anchor, fixture.head ?? fixture.anchor);
      editor.focus();
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (editor.cm.compositionStarted)
        throw Error("Fixture has an active composition");
      window.__compositionEditingEvents = [];
    },
    fixture,
    note,
  );
}
function check(result, assertions) {
  results.push(result);
  try {
    assertions();
    console.log(`PASS ${result.name}`);
  } catch (error) {
    failures.push({ name: result.name, error: String(error) });
    console.error(`FAIL ${result.name}: ${error.message}`);
  }
}
function holdCompletion() {
  evaluate(() => {
    const cm = window.__compositionEditingLeaf.view.editor.cm;
    const requestMeasure = cm.requestMeasure;
    const held = [];
    cm.requestMeasure = (request) => held.push(request);
    window.__compositionEditingHeld = {
      cm,
      requestMeasure,
      held,
    };
  });
}
function releaseCompletion() {
  return evaluate(() => {
    const pending = window.__compositionEditingHeld;
    if (!pending) return 0;
    pending.cm.requestMeasure = pending.requestMeasure;
    for (const request of pending.held) pending.cm.requestMeasure(request);
    delete window.__compositionEditingHeld;
    return pending.held.length;
  });
}
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate((nativeControl) => {
    app.plugins.plugins.bullet.settings.keepBodyTextInBullets = !nativeControl;
    window.__compositionEditingEvents = [];
    window.__compositionEditingListener = (event) =>
      window.__compositionEditingEvents.push({
        type: event.type,
        time: Date.now(),
        data: event.data,
        inputType: event.inputType,
        isComposing: event.isComposing,
        editorTarget:
          event.target ===
          window.__compositionEditingLeaf.view.editor.cm.contentDOM,
      });
    for (const name of [
      "compositionstart",
      "compositionupdate",
      "compositionend",
      "beforeinput",
      "input",
    ])
      window.addEventListener(name, window.__compositionEditingListener, true);
  }, nativeControl);
  for (const shiki of [false, true]) {
    evaluate(async (shiki) => {
      if (shiki) await app.plugins.enablePlugin("shiki-highlighter");
      else await app.plugins.disablePlugin("shiki-highlighter");
      if (!!app.plugins.plugins["shiki-highlighter"] !== shiki)
        throw Error("Requested Shiki state is unavailable");
      app.vault.setConfig("vimMode", false);
      await app.vault.saveConfig();
      app.workspace.updateOptions();
    }, shiki);
    if (boundary) {
      for (const action of ["Enter", "Backspace", "text"]) {
        setup(fixtures[2]);
        compose("日本");
        const provisionalState = sample();
        holdCompletion();
        type("日本語");
        const pending = sample();
        evaluate(async () => {
          await new Promise((resolve) => setTimeout(resolve, 650));
        });
        if (action === "text") type("X");
        else key(action);
        const held = releaseCompletion();
        const following = sample(true);
        key("z", 4);
        const undone = sample(true);
        key("z", 4);
        const originalState = sample(true);
        key("z", 12);
        const compositionRedone = sample(true);
        key("z", 12);
        const redone = sample(true);
        check(
          {
            name: `deferred-${action}-${shiki ? "shiki" : "native"}`,
            provisionalState,
            pending,
            held,
            following,
            undone,
            originalState,
            compositionRedone,
            redone,
          },
          () => {
            assert.equal(provisionalState.doc, "- ```js\n日本\n  ```");
            assert.equal(pending.doc, fixtures[2].expected);
            assert.deepEqual(pending.cursor, fixtures[2].cursor);
            assert.equal(pending.composing, false);
            assert.ok(held > 0, "Layout measurement was withheld");
            const expected =
              action === "Enter"
                ? "- ```js\n  日本語\n  \n  ```"
                : action === "Backspace"
                  ? "- ```js\n  日本\n  ```"
                  : "- ```js\n  日本語X\n  ```";
            assert.equal(following.doc, expected);
            assert.equal(following.saved, expected);
            assert.deepEqual(
              following.cursor,
              action === "Enter"
                ? { line: 2, ch: 2 }
                : { line: 1, ch: action === "Backspace" ? 4 : 6 },
            );
            assert.equal(undone.doc, fixtures[2].expected);
            assert.equal(undone.saved, fixtures[2].expected);
            assert.equal(originalState.doc, fixtures[2].doc);
            assert.equal(originalState.saved, fixtures[2].doc);
            assert.equal(compositionRedone.doc, fixtures[2].expected);
            assert.equal(redone.doc, expected);
            assert.equal(redone.saved, expected);
            assert.deepEqual(redone.cursor, following.cursor);
          },
        );
      }
      setup(fixtures[2]);
      compose("日本");
      holdCompletion();
      type("日本語");
      type("X");
      const held = releaseCompletion();
      const following = sample(true);
      key("z", 4);
      const undone = sample(true);
      key("z", 12);
      const redone = sample(true);
      check(
        {
          name: `quick-text-${shiki ? "shiki" : "native"}`,
          held,
          following,
          undone,
          redone,
        },
        () => {
          const ended = following.events.find(
            (event) => event.type === "compositionend",
          );
          const input = following.events.find(
            (event) =>
              event.type === "input" && event.inputType === "insertText",
          );
          assert.ok(
            ended && input && input.time - ended.time < 500,
            "Native follow-up arrived within the history grouping interval",
          );
          assert.ok(held > 0);
          assert.equal(following.doc, "- ```js\n  日本語X\n  ```");
          assert.equal(following.saved, following.doc);
          assert.deepEqual(following.cursor, { line: 1, ch: 6 });
          assert.equal(undone.doc, fixtures[2].doc);
          assert.equal(undone.saved, fixtures[2].doc);
          assert.equal(redone.doc, following.doc);
          assert.equal(redone.saved, following.doc);
          assert.deepEqual(redone.cursor, following.cursor);
        },
      );
      continue;
    }
    for (const source of fixtures) {
      if (caseName && source.name !== caseName) continue;
      const expected = nativeControl
        ? provisional(source, "日本語")
        : source.expected;
      const fixture = nativeControl
        ? {
            ...source,
            expected,
            cursor: { line: source.anchor.line, ch: source.anchor.ch + 3 },
          }
        : source;
      setup(fixture);
      compose("に");
      const first = sample();
      compose("日本");
      const updated = sample();
      type("日本語");
      const committed = sample(true);
      key("z", 4);
      const undone = sample(true);
      key("z", 12);
      const redone = sample(true);
      type("X");
      const following = sample(true);
      const lines = fixture.expected.split("\n");
      const { line, ch } = fixture.cursor;
      lines[line] = lines[line].slice(0, ch) + "X" + lines[line].slice(ch);
      check(
        {
          name: `${fixture.name}-${shiki ? "shiki" : "native"}`,
          first,
          updated,
          committed,
          undone,
          redone,
          following,
        },
        () => {
          assert.equal(first.doc, provisional(fixture, "に"));
          assert.equal(updated.doc, provisional(fixture, "日本"));
          assert.equal(first.composing, true);
          assert.equal(updated.composing, true);
          assert.equal(committed.composing, false);
          assert.equal(committed.doc, fixture.expected);
          assert.equal(committed.saved, fixture.expected);
          assert.deepEqual(committed.cursor, fixture.cursor);
          assert.equal(
            committed.events.filter(
              (event) => event.type === "compositionstart",
            ).length,
            1,
            "One uninterrupted native composition",
          );
          assert.ok(committed.events.every((event) => event.editorTarget));
          assert.equal(undone.doc, fixture.doc);
          assert.equal(undone.saved, fixture.doc);
          assert.equal(redone.doc, fixture.expected);
          assert.equal(redone.saved, fixture.expected);
          assert.deepEqual(redone.cursor, fixture.cursor);
          assert.equal(following.doc, lines.join("\n"));
          assert.equal(following.saved, following.doc);
        },
      );
    }
    for (const fixture of [
      fixtures[1],
      fixtures[2],
      {
        name: "selected-marker",
        doc: "- item",
        anchor: { line: 0, ch: 0 },
        head: { line: 0, ch: 1 },
      },
      {
        name: "unsafe-list-boundary",
        doc: "plain\n- item",
        anchor: { line: 1, ch: 1 },
        head: { line: 0, ch: 5 },
      },
    ]) {
      if (caseName && fixture.name !== caseName) continue;
      setup(fixture);
      compose("に");
      const first = sample();
      compose("");
      const cancelled = sample(true);
      check(
        {
          name: `cancel-${fixture.name}-${shiki ? "shiki" : "native"}`,
          first,
          cancelled,
        },
        () => {
          assert.equal(first.doc, provisional(fixture, "に"));
          assert.equal(first.composing, true);
          assert.equal(
            cancelled.events.filter(
              (event) => event.type === "compositionstart",
            ).length,
            1,
          );
          assert.equal(
            cancelled.events.filter((event) => event.type === "compositionend")
              .length,
            1,
          );
          assert.ok(cancelled.events.every((event) => event.editorTarget));
          assert.equal(cancelled.composing, false);
          const expected = nativeControl
            ? provisional(fixture, "")
            : fixture.doc;
          assert.equal(cancelled.doc, expected);
          assert.equal(cancelled.saved, expected);
        },
      );
    }
  }
} finally {
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify({ results, failures }, null, 2),
  );
  try {
    releaseCompletion();
    evaluate(
      async (original, notes) => {
        for (const name of [
          "compositionstart",
          "compositionupdate",
          "compositionend",
          "beforeinput",
          "input",
        ])
          window.removeEventListener(
            name,
            window.__compositionEditingListener,
            true,
          );
        window.__compositionEditingLeaf?.detach();
        delete window.__compositionEditingLeaf;
        delete window.__compositionEditingEvents;
        delete window.__compositionEditingListener;
        app.plugins.plugins.bullet.settings.keepBodyTextInBullets =
          original.body;
        if (original.shiki) await app.plugins.enablePlugin("shiki-highlighter");
        else await app.plugins.disablePlugin("shiki-highlighter");
        if (!!app.plugins.plugins["shiki-highlighter"] !== original.shiki)
          throw Error("Original Shiki state was not restored");
        app.vault.setConfig(
          "vimMode",
          original.hasVim ? original.vim : undefined,
        );
        await app.vault.saveConfig();
        app.workspace.updateOptions();
        const leaf = app.workspace.getLeafById(original.leaf);
        if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
        for (const note of notes) {
          const file = app.vault.getAbstractFileByPath(note);
          if (file) await app.vault.trash(file, true);
        }
      },
      original,
      notes,
    );
  } finally {
    cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
  }
}
assert.ok(results.length > 0, "Requested composition case must exist");
assert.equal(failures.length, 0, `${failures.length} composition regressions`);
