// Deploy build-with-tests to the repository vault before running this check.
// Exercises real Enter handling and Obsidian's coarse same-note pane sync.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

const output = process.argv[2];
if (!output)
  throw Error(
    "Usage: node scripts/verify-zoom-insertions.cjs <fresh-output-dir>",
  );
fs.mkdirSync(output);
const note = `zoom-insertions-${randomUUID()}.md`;
const before = "- work\n\t- project\n\t\t- task\n\t- other\n- personal";
const initial = evaluate(() => {
  const settings = app.plugins.plugins.bullet.settings;
  return {
    leaf: app.workspace.activeLeaf.id,
    betterEnter: settings.overrideEnterBehaviour,
    keepBody: settings.keepBodyTextInBullets,
    stickCursor: settings.keepCursorWithinContent,
  };
});
const results = [];

function sample() {
  return evaluate(() => {
    const { first } = window.__zoomInsertionsCheck;
    const editor = first.view.editor;
    return {
      doc: editor.getValue(),
      target:
        editor.cm.dom.querySelector(
          '.bullet-zoom-breadcrumbs [aria-current="location"]',
        )?.textContent ?? null,
      visible: editor.cm.contentDOM.textContent,
      cursor: editor.getCursor(),
      cursorLine: editor.getLine(editor.getCursor().line),
    };
  });
}

function capture(name) {
  const state = sample();
  results.push({ name, ...state });
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(results, null, 2),
  );
  fs.writeFileSync(
    path.join(output, `${name}.png`),
    Buffer.from(cdp("Page.captureScreenshot").data, "base64"),
  );
  return state;
}

function reset() {
  evaluate(async (before) => {
    const { first, second } = window.__zoomInsertionsCheck;
    app.workspace.setActiveLeaf(first, { focus: true });
    app.commands.executeCommandById("bullet:zoom-reset");
    await first.view.save();
    await new Promise((resolve) => setTimeout(resolve, 750));
    app.workspace.setActiveLeaf(second, { focus: true });
    second.view.editor.setValue(before);
    await second.view.save();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (first.view.editor.getValue() !== before)
      throw Error("Fixture did not synchronize before zoom");
    app.workspace.setActiveLeaf(first, { focus: true });
    first.view.editor.setCursor({ line: 1, ch: 3 });
    app.commands.executeCommandById("bullet:zoom-in");
    first.view.editor.focus();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }, before);
  assert.equal(sample().target, "project");
}

function assertProject(state, expected) {
  assert.equal(state.doc, expected);
  assert.equal(state.target, "project");
  assert.equal(state.cursorLine, "\t- project");
  assert.ok(!state.visible.includes("personal"));
  assert.ok(!state.visible.includes("other"));
  assert.ok(!state.visible.includes("inserted"));
}

function focus() {
  evaluate(() => {
    window.focus();
    const { first } = window.__zoomInsertionsCheck;
    app.workspace.setActiveLeaf(first, { focus: true });
    first.view.editor.focus();
  });
}

function enter() {
  focus();
  cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    text: "\r",
  });
  focus();
  cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
}

try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(
    async (note, before) => {
      if (window.__zoomInsertionsCheck) throw Error("Check already running");
      const settings = app.plugins.plugins.bullet.settings;
      settings.overrideEnterBehaviour = true;
      settings.keepBodyTextInBullets = true;
      settings.keepCursorWithinContent = "bullet-and-checkbox";
      const file = await app.vault.create(note, before);
      const first = app.workspace.getLeaf("tab");
      window.__zoomInsertionsCheck = { first, file, second: null };
      await first.openFile(file);
      const second = app.workspace.getLeaf("split", "vertical");
      window.__zoomInsertionsCheck.second = second;
      await second.openFile(file);
    },
    note,
    before,
  );

  reset();
  enter();
  const entered = capture("enter-at-start");
  assert.equal(
    entered.doc,
    "- work\n\t- \n\t\t- project\n\t\t- task\n\t- other\n- personal",
  );
  assert.equal(entered.target, "Empty item");
  assert.deepEqual(entered.cursor, { line: 2, ch: 4 });
  enter();
  const repeated = capture("repeated-enter-at-start");
  assert.equal(
    repeated.doc,
    "- work\n\t- \n\t\t- \n\t\t- project\n\t\t- task\n\t- other\n- personal",
  );
  assert.equal(repeated.target, "Empty item");
  assert.deepEqual(repeated.cursor, { line: 3, ch: 4 });
  focus();
  cdp("Input.insertText", { text: "visible " });
  const typed = capture("typing-after-enter");
  assert.equal(
    typed.doc,
    "- work\n\t- \n\t\t- \n\t\t- visible project\n\t\t- task\n\t- other\n- personal",
  );
  assert.equal(typed.cursorLine, "\t\t- visible project");
  assert.equal(typed.target, "Empty item");
  assert.ok(!typed.visible.includes("other"));
  assert.ok(!typed.visible.includes("personal"));

  for (const kind of ["precise-before", "whole-before", "farther-above"]) {
    reset();
    const expected = evaluate(
      async (kind, before) => {
        const { second } = window.__zoomInsertionsCheck;
        app.workspace.setActiveLeaf(second, { focus: true });
        const editor = second.view.editor;
        const expected =
          kind === "farther-above"
            ? "- prepended\n" + before
            : before.replace("\t- project", "\t- inserted\n\t- project");
        if (kind === "whole-before") editor.setValue(expected);
        else if (kind === "farther-above")
          editor.replaceRange("- prepended\n", { line: 0, ch: 0 });
        else editor.replaceRange("\t- inserted\n", { line: 1, ch: 0 });
        await second.view.save();
        await new Promise((resolve) => setTimeout(resolve, 750));
        return expected;
      },
      kind,
      before,
    );
    const synchronized = capture(kind);
    assert.equal(synchronized.doc, expected);
    if (kind === "farther-above") {
      assert.equal(synchronized.target, null);
    } else {
      assertProject(synchronized, expected);
      evaluate(() => {
        const { first } = window.__zoomInsertionsCheck;
        app.workspace.setActiveLeaf(first, { focus: true });
        first.view.editor.focus();
      });
      focus();
      cdp("Input.insertText", { text: "visible " });
      const typed = capture(`${kind}-typing`);
      assert.equal(
        typed.doc,
        expected.replace("\t- project", "\t- visible project"),
      );
      assert.equal(typed.target, "visible project");
      assert.equal(typed.cursorLine, "\t- visible project");
    }
  }
  console.log(JSON.stringify({ output, cases: results.length, failures: [] }));
} finally {
  try {
    evaluate(
      async (initial, note) => {
        const settings = app.plugins.plugins.bullet.settings;
        settings.overrideEnterBehaviour = initial.betterEnter;
        settings.keepBodyTextInBullets = initial.keepBody;
        settings.keepCursorWithinContent = initial.stickCursor;
        const check = window.__zoomInsertionsCheck;
        if (check) {
          if (check.second) {
            await check.second.view.save();
            check.second.detach();
          }
          await check.first.view.save();
          check.first.detach();
        }
        const file = app.vault.getAbstractFileByPath(note);
        if (file) await app.vault.trash(file, true);
        const leaf = app.workspace.getLeafById(initial.leaf);
        if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
        delete window.__zoomInsertionsCheck;
      },
      initial,
      note,
    );
  } finally {
    cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
  }
}
