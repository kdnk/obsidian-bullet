const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { evaluate, cdp } = require("./obsidian-scroll-driver.cjs");
const output = process.argv[2];
fs.mkdirSync(output);
const note = `pages/code-editing-regressions-${randomUUID()}.md`;
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  vim: app.vault.config.vimMode ?? false,
  hasVim: Object.hasOwn(app.vault.config, "vimMode"),
  shiki: !!app.plugins.plugins["shiki-highlighter"],
}));
const results = [];
const failures = [];
const inputEvents = [];
let pendingInput = null;
let expectedVimMode = false;
const cases = [
  {
    name: "partial-tab split",
    text: "- ```js\n\tfooBAR\n  ```",
    cursor: { line: 1, ch: 4 },
    key: "Enter",
    modifiers: 8,
    expected: "- ```js\n\tfoo\n  BAR\n  ```",
    typed: "- ```js\n\tfoo\n  XBAR\n  ```",
  },
  {
    name: "partial-tab join",
    text: "- ```js\n\tfoo\n  BAR\n  ```",
    cursor: { line: 2, ch: 2 },
    key: "Backspace",
    expected: "- ```js\n\tfooBAR\n  ```",
    typed: "- ```js\n\tfooXBAR\n  ```",
  },
  ...[
    {
      name: "unordered",
      opener: "- ```js",
      indent: "  ",
      partial: "\t",
      spaces: "    ",
      literal: "  ",
    },
    {
      name: "ordered",
      opener: "1. ```js",
      indent: "   ",
      partial: "\t",
      spaces: "    ",
      literal: " ",
    },
    {
      name: "nested",
      opener: "- parent\n\t- ```js",
      indent: "\t  ",
      partial: "\t\t",
      spaces: "\t    ",
      literal: "  ",
    },
  ].flatMap(({ name, opener, indent, partial, spaces, literal }) =>
    [
      { kind: "partial tab", prefix: partial },
      { kind: "equivalent spaces", prefix: spaces },
    ].flatMap(({ kind, prefix }) =>
      ["Backspace", "Delete"].map((key) => {
        const codeLine = opener.split("\n").length;
        return {
          name: `${name} ${kind} ${key} join`,
          text: `${opener}\n${indent}foo\n${prefix}BAR\n${indent}\`\`\``,
          cursor:
            key === "Backspace"
              ? {
                  line: codeLine + 1,
                  ch: Math.min(prefix.length, indent.length),
                }
              : { line: codeLine, ch: indent.length + 3 },
          key,
          expected: `${opener}\n${indent}foo${literal}BAR\n${indent}\`\`\``,
          typed: `${opener}\n${indent}fooX${literal}BAR\n${indent}\`\`\``,
          joinCursor: { line: codeLine, ch: indent.length + 3 },
        };
      }),
    ),
  ),
];
function focus() {
  evaluate((expectedVimMode) => {
    window.focus();
    if (
      !document.title.includes(" - vault - ") ||
      document.visibilityState !== "visible"
    )
      throw Error("Wrong visible test vault");
    app.workspace.activeLeaf.view.editor.focus();
    const cm = app.workspace.activeLeaf.view.editor.cm;
    if (app.isVimEnabled() !== expectedVimMode || !!cm.cm !== expectedVimMode)
      throw Error(
        `Unexpected Vim mode before input: expected ${expectedVimMode}`,
      );
  }, expectedVimMode);
}
function setVimMode(enabled) {
  evaluate(async (enabled) => {
    app.vault.setConfig("vimMode", enabled);
    await app.vault.saveConfig();
    app.workspace.updateOptions();
    const persisted = await app.vault.readConfigJson("app");
    if (persisted.vimMode !== enabled || app.isVimEnabled() !== enabled)
      throw Error(`Vim mode did not persist: expected ${enabled}`);
  }, enabled);
  expectedVimMode = enabled;
}
function key(key, modifiers = 0) {
  const codes = {
    Enter: 13,
    Backspace: 8,
    Delete: 46,
    Escape: 27,
    i: 73,
    z: 90,
  };
  for (const type of ["keyDown", "keyUp"]) {
    focus();
    pendingInput = { key, modifiers, type };
    evaluate(
      (type, key) => {
        const leaf = app.workspace.activeLeaf;
        const editor = leaf.view.editor;
        const cm = editor.cm;
        if (!cm.hasFocus) throw Error("Editor does not have keyboard focus");
        const snapshot = () => ({
          doc: editor.getValue(),
          cursor: editor.getCursor(),
          selection: cm.state.selection.toJSON(),
          focused: cm.hasFocus,
          activeLeafUnchanged: app.workspace.activeLeaf === leaf,
          vimEnabled: app.isVimEnabled(),
          vimAdapterPresent: !!cm.cm,
          vimInsertMode: cm.cm?.state?.vim?.insertMode ?? null,
          composing: cm.inputState.composing,
          imeOpen: app.plugins.plugins.bullet.imeDetector.isOpened(),
        });
        const restores = [];
        const trace = {
          before: snapshot(),
          steps: [],
          event: null,
          snapshot,
          dispose: () =>
            restores
              .splice(0)
              .reverse()
              .forEach((restore) => restore()),
          contentDOM: cm.contentDOM,
        };
        window.__codeEditingInputTrace = trace;
        const receive = (event) => {
          trace.event = event;
          trace.receivedState = snapshot();
        };
        window.addEventListener(type.toLowerCase(), receive, {
          capture: true,
          once: true,
        });
        restores.push(() =>
          window.removeEventListener(type.toLowerCase(), receive, true),
        );
        if (type !== "keyDown" || key !== "Backspace") return;

        const preventDefault = Event.prototype.preventDefault;
        Event.prototype.preventDefault = function () {
          if (this.type === "keydown" && this.key === "Backspace") {
            trace.steps.push({
              kind: "preventDefault",
              stack: new Error().stack,
              state: snapshot(),
            });
          }
          return preventDefault.call(this);
        };
        restores.push(() => {
          Event.prototype.preventDefault = preventDefault;
        });
        const consoleError = console.error;
        console.error = function (...args) {
          trace.steps.push({
            kind: "console-error",
            errors: args.map((value) => value?.stack ?? String(value)),
          });
          return consoleError.apply(this, args);
        };
        restores.push(() => {
          console.error = consoleError;
        });
        const performer = app.plugins.plugins.bullet.operationPerformer;
        const perform = performer.perform;
        performer.perform = function (...args) {
          trace.steps.push({ kind: "operation-start", state: snapshot() });
          try {
            const result = perform.apply(this, args);
            trace.steps.push({
              kind: "operation-result",
              result,
              state: snapshot(),
            });
            return result;
          } catch (error) {
            trace.steps.push({
              kind: "operation-error",
              error: String(error),
              stack: error.stack,
            });
            throw error;
          }
        };
        restores.push(() => {
          performer.perform = perform;
        });
      },
      type,
      key,
    );
    cdp("Input.dispatchKeyEvent", {
      type,
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      windowsVirtualKeyCode: codes[key],
      modifiers,
    });
    const trace = collectInputTrace();
    pendingInput = null;
    inputEvents.push({ key, modifiers, type, ...trace });
    assert.equal(
      trace.received?.key,
      key,
      `${type} was not received by the renderer`,
    );
    assert.equal(
      trace.received.editorTarget,
      true,
      `${type} did not target the editor`,
    );
  }
}
function collectInputTrace() {
  return evaluate(() => {
    const trace = window.__codeEditingInputTrace;
    if (!trace) return null;
    const event = trace.event;
    const result = {
      before: trace.before,
      receivedState: trace.receivedState,
      steps: trace.steps,
      received: event && {
        key: event.key,
        code: event.code,
        keyCode: event.keyCode,
        defaultPrevented: event.defaultPrevented,
        isComposing: event.isComposing,
        target: event.target?.className,
        editorTarget: event.target === trace.contentDOM,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      },
      after: trace.snapshot(),
    };
    trace.dispose();
    delete window.__codeEditingInputTrace;
    return result;
  });
}
function type(text) {
  focus();
  cdp("Input.insertText", { text });
}
function state() {
  return evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const v = app.workspace.activeLeaf.view;
    await v.save();
    return {
      doc: v.editor.getValue(),
      cursor: v.editor.getCursor(),
      saved: await app.vault.read(v.file),
    };
  });
}
function check(name, run) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error: error.message });
    console.log(`FAIL ${name}: ${error.message}`);
  }
}
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (note) => {
    window.__codeEditingRegressionLeaf = app.workspace.getLeaf("tab");
    await window.__codeEditingRegressionLeaf.openFile(
      await app.vault.create(note, ""),
    );
  }, note);
  for (const shiki of [false, true]) {
    evaluate(async (enabled) => {
      if (enabled) await app.plugins.enablePlugin("shiki-highlighter");
      else await app.plugins.disablePlugin("shiki-highlighter");
    }, shiki);
    setVimMode(false);
    for (const fixture of [
      {
        name: "continuation after fenced code",
        text: "- parent\n  ```js\n  code\n  ```\n  note",
        cursor: { line: 4, ch: 6 },
        input: "!",
        expected: "- parent\n  ```js\n  code\n  ```\n  note!",
      },
      ...["\n", "\n  paragraph\n\n"].map((gap) => ({
        name: `continuation after separated fence ${gap.length}`,
        text: `- parent\n${gap}  \`\`\`js\n  code\n  \`\`\`\n  note`,
        cursor: { line: 4 + gap.split("\n").length - 1, ch: 6 },
        input: "!",
        expected: `- parent\n${gap}  \`\`\`js\n  code\n  \`\`\`\n  note!`,
      })),
      {
        name: "child after fenced code",
        text: "- parent\n  ```js\n  code\n  ```\n  - ",
        cursor: { line: 4, ch: 4 },
        input: "#",
        expected: "- parent\n  ```js\n  code\n  ```\n  - #",
      },
      ...["", "\n"].map((gap) => ({
        name: `empty parent with ${gap ? "separated" : "immediate"} fence`,
        text: `- \n${gap}  \`\`\`js\n  code\n  \`\`\``,
        cursor: { line: 0, ch: 2 },
        input: "#",
        expected: `- #\n${gap}  \`\`\`js\n  code\n  \`\`\``,
      })),
      ...["***", "___", "* * *"].map((text) => ({
        name: `thematic break ${text}`,
        text,
        cursor: { line: 0, ch: text.length },
        input: " ",
        expected: `${text} `,
      })),
    ]) {
      evaluate(async (fixture) => {
        const editor = app.workspace.activeLeaf.view.editor;
        editor.setValue(fixture.text);
        editor.setCursor(fixture.cursor);
        editor.focus();
        await new Promise((resolve) => setTimeout(resolve, 150));
      }, fixture);
      type(fixture.input);
      const after = state();
      key("z", 4);
      const undone = state();
      key("z", 12);
      const redone = state();
      type(" ");
      const following = state();
      const name = `${fixture.name}-${shiki ? "shiki" : "native"}`;
      results.push({ name, after, undone, redone, following });
      check(name, () => {
        assert.equal(after.doc, fixture.expected);
        assert.equal(after.saved, fixture.expected);
        assert.deepEqual(after.cursor, {
          line: fixture.cursor.line,
          ch: fixture.cursor.ch + fixture.input.length,
        });
        assert.equal(undone.doc, fixture.text);
        assert.equal(redone.doc, fixture.expected);
        assert.equal(
          following.doc,
          fixture.expected.replace(
            fixture.expected.split("\n")[fixture.cursor.line],
            fixture.expected.split("\n")[fixture.cursor.line] + " ",
          ),
        );
        assert.equal(following.saved, following.doc);
      });
    }
    for (const fixture of cases) {
      evaluate(async (fixture) => {
        const e = app.workspace.activeLeaf.view.editor;
        e.setValue(fixture.text);
        e.setCursor(fixture.cursor);
        e.focus();
        await new Promise((resolve) => setTimeout(resolve, 150));
      }, fixture);
      const before = state();
      key(fixture.key, fixture.modifiers);
      const after = state();
      key("z", 4);
      const undone = state();
      key("z", 12);
      const redone = state();
      type("X");
      const typed = state();
      const name = `${fixture.name}-${shiki ? "shiki" : "native"}`;
      results.push({ name, before, after, undone, redone, typed });
      check(name, () => {
        assert.equal(before.doc, fixture.text);
        assert.equal(after.doc, fixture.expected);
        if (fixture.joinCursor) {
          assert.deepEqual(after.cursor, fixture.joinCursor);
          assert.deepEqual(redone.cursor, fixture.joinCursor);
        }
        assert.equal(undone.doc, fixture.text);
        assert.equal(redone.doc, fixture.expected);
        assert.equal(typed.doc, fixture.typed);
        assert.equal(typed.saved, fixture.typed);
      });
    }
    for (const fixture of [
      {
        name: "blank and populated code rows",
        text: "- ```js\n\n  hello\n  ```",
        cursors: [
          { line: 1, ch: 0 },
          { line: 2, ch: 7 },
        ],
        expected: "- ```js\n  x\n  hellox\n  ```",
      },
      {
        name: "two blank code rows and outside text",
        text: "- ```js\n\n\n  ```\n",
        cursors: [
          { line: 1, ch: 0 },
          { line: 2, ch: 0 },
          { line: 4, ch: 0 },
        ],
        expected: "- ```js\n  x\n  x\n  ```\n- x",
      },
    ]) {
      evaluate(async (fixture) => {
        const editor = app.workspace.activeLeaf.view.editor;
        editor.setValue(fixture.text);
        editor.setSelections(
          fixture.cursors.map((cursor) => ({ anchor: cursor, head: cursor })),
        );
        editor.focus();
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (editor.listSelections().length !== fixture.cursors.length)
          throw Error("Multiple selections were not installed");
      }, fixture);
      type("x");
      const after = state();
      key("z", 4);
      const undone = state();
      key("z", 12);
      const redone = state();
      const name = `${fixture.name}-${shiki ? "shiki" : "native"}`;
      results.push({ name, after, undone, redone });
      check(name, () => {
        assert.equal(after.doc, fixture.expected);
        assert.equal(after.saved, fixture.expected);
        assert.equal(undone.doc, fixture.text);
        assert.equal(redone.doc, fixture.expected);
      });
    }
    setVimMode(true);
    for (const prefix of ["", "  "]) {
      const text = `- \`\`\`js\n${prefix}\n  \`\`\``;
      evaluate(async (text) => {
        const e = app.workspace.activeLeaf.view.editor;
        e.setValue(text);
        e.setCursor(1, 0);
        e.focus();
        await new Promise((resolve) => setTimeout(resolve, 150));
      }, text);
      key("Escape");
      key("i");
      type("x");
      const first = state();
      type("y");
      const second = state();
      const name = `${prefix ? "indented" : "physical"}-blank-${shiki ? "shiki" : "native"}`;
      results.push({ name, first, second });
      check(name, () => {
        assert.equal(first.doc, "- ```js\n  x\n  ```");
        assert.equal(second.doc, "- ```js\n  xy\n  ```");
        assert.equal(second.saved, second.doc);
      });
      key("Escape");
    }
  }
} finally {
  if (pendingInput) {
    try {
      const trace = collectInputTrace();
      if (trace) inputEvents.push({ ...pendingInput, ...trace });
    } catch (error) {
      fs.writeFileSync(`${output}/input-trace-error.txt`, String(error));
    }
  }
  fs.writeFileSync(
    `${output}/input-events.json`,
    JSON.stringify(inputEvents, null, 2),
  );
  fs.writeFileSync(
    `${output}/results.json`,
    JSON.stringify({ results, failures }, null, 2),
  );
  evaluate(
    async (original, note) => {
      window.__codeEditingInputTrace?.dispose();
      delete window.__codeEditingInputTrace;
      window.__codeEditingRegressionLeaf?.detach();
      delete window.__codeEditingRegressionLeaf;
      if (original.shiki) await app.plugins.enablePlugin("shiki-highlighter");
      else await app.plugins.disablePlugin("shiki-highlighter");
      app.vault.setConfig(
        "vimMode",
        original.hasVim ? original.vim : undefined,
      );
      await app.vault.saveConfig();
      app.workspace.updateOptions();
      const leaf = app.workspace.getLeafById(original.leaf);
      if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.trash(file, true);
    },
    original,
    note,
  );
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
}
assert.equal(failures.length, 0, `${failures.length} editing regressions`);
