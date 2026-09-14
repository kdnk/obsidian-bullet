// Deploy build-with-tests to the repository vault before running this check.
// Exercise zoom commands and actual input at subtree boundaries in Live Preview.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

if (!process.argv[2])
  throw Error(
    "Usage: node scripts/verify-zoom-subtree-editing.cjs <fresh-output-dir>",
  );
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const note = `zoom-subtree-editing-${randomUUID()}.md`;
const original = evaluate(() => {
  const settings = app.plugins.plugins.bullet.settings;
  return {
    leaf: app.workspace.activeLeaf.id,
    betterEnter: settings.overrideEnterBehaviour,
    betterTab: settings.overrideTabBehaviour,
    keepBody: settings.keepBodyTextInBullets,
    stickCursor: settings.keepCursorWithinContent,
  };
});
const results = [];
let failure = null;

function focus() {
  evaluate(() => {
    window.focus();
    const leaf = window.__zoomSubtreeEditingLeaf;
    app.workspace.setActiveLeaf(leaf, { focus: true });
    leaf.view.editor.focus();
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
function type(text) {
  focus();
  cdp("Input.insertText", { text });
}
function paste(text) {
  focus();
  evaluate((text) => {
    const editor = window.__zoomSubtreeEditingLeaf.view.editor.cm;
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    editor.contentDOM.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  }, text);
}
function sample() {
  return evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    const editor = window.__zoomSubtreeEditingLeaf.view.editor;
    const cm = editor.cm;
    const position = cm.coordsAtPos(cm.state.selection.main.head);
    const bounds = cm.scrollDOM.getBoundingClientRect();
    return {
      doc: editor.getValue(),
      cursor: editor.getCursor(),
      target:
        cm.dom.querySelector(
          '.bullet-zoom-breadcrumbs [aria-current="location"]',
        )?.textContent ?? null,
      visible: cm.contentDOM.textContent,
      visibleCursor:
        !!position &&
        position.top >= bounds.top &&
        position.bottom <= bounds.bottom,
    };
  });
}
function capture(name) {
  const state = sample();
  results.push({ name, ...state });
  fs.writeFileSync(
    path.join(output, `${name}.png`),
    Buffer.from(cdp("Page.captureScreenshot").data, "base64"),
  );
  return state;
}
function setup(text, zoom = true) {
  evaluate(
    async (text, zoom) => {
      app.commands.executeCommandById("bullet:zoom-reset");
      const editor = window.__zoomSubtreeEditingLeaf.view.editor;
      editor.setValue(text);
      app.commands.executeCommandById("editor:unfold-all");
      await new Promise((resolve) => setTimeout(resolve, 350));
      // A task checkbox is an atomic native widget in Live Preview. Put the
      // cursor in the visible body before invoking the command, so its queued
      // checkbox-selection repair cannot overwrite the new child selection.
      editor.setCursor({ line: 1, ch: editor.getLine(1).length });
      if (zoom) app.commands.executeCommandById("bullet:zoom-in");
      editor.focus();
    },
    text,
    zoom,
  );
}
function cursor(line, ch) {
  evaluate(
    (line, ch) => {
      window.__zoomSubtreeEditingLeaf.view.editor.setCursor({ line, ch });
    },
    line,
    ch,
  );
}
function expectState(state, doc, cursor, target) {
  assert.equal(state.doc, doc);
  assert.deepEqual(state.cursor, cursor);
  assert.equal(state.target, target);
  assert.ok(state.visibleCursor, "The next input position must be visible");
}
function resetAndCheck(doc, name) {
  evaluate(() => app.commands.executeCommandById("bullet:zoom-reset"));
  const reset = capture(name);
  assert.equal(reset.doc, doc);
  assert.equal(reset.target, null);
  assert.ok(reset.visible.includes("before"));
  assert.ok(reset.visible.includes("hidden"));
  assert.ok(reset.visible.includes("after"));
}

try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (note) => {
    if (window.__zoomSubtreeEditingLeaf) throw Error("Check already running");
    const settings = app.plugins.plugins.bullet.settings;
    settings.overrideEnterBehaviour = true;
    settings.overrideTabBehaviour = true;
    settings.keepBodyTextInBullets = true;
    settings.keepCursorWithinContent = "never";
    const leaf = app.workspace.getLeaf("tab");
    window.__zoomSubtreeEditingLeaf = leaf;
    await leaf.openFile(await app.vault.create(note, "audit"));
  }, note);

  for (const fixture of [
    { name: "leaf", root: "- leaf", child: "- ", label: "leaf" },
    { name: "ordered-leaf", root: "7. leaf", child: "1. ", label: "leaf" },
    {
      name: "checked-leaf",
      root: "- [x] leaf",
      child: "- [ ] ",
      label: "[x] leaf",
    },
    { name: "bare-leaf", root: "-", child: "- ", label: "Empty item" },
  ]) {
    const before = `- before\n\t${fixture.root}\n\t- hidden\n- after`;
    const expected = `- before\n\t${fixture.root}\n\t\t${fixture.child}\n\t- hidden\n- after`;
    setup(before);
    expectState(
      capture(`${fixture.name}-zoom`),
      expected,
      { line: 2, ch: 2 + fixture.child.length },
      fixture.label,
    );
    // Zoom the same root again (the child cursor would intentionally zoom deeper).
    cursor(1, 1);
    evaluate(() => app.commands.executeCommandById("bullet:zoom-in"));
    const repeated = capture(`${fixture.name}-repeat`);
    assert.equal(
      repeated.doc,
      expected,
      "Repeated zoom must not duplicate the empty child",
    );
    assert.equal(repeated.target, fixture.label);
    resetAndCheck(expected, `${fixture.name}-reset`);
  }

  setup("- before\n\t- leaf");
  expectState(
    capture("leaf-at-eof"),
    "- before\n\t- leaf\n\t\t- ",
    { line: 2, ch: 4 },
    "leaf",
  );
  type("NEXT");
  expectState(
    capture("leaf-at-eof-typing"),
    "- before\n\t- leaf\n\t\t- NEXT",
    { line: 2, ch: 8 },
    "leaf",
  );

  const leaf = "- before\n\t- leaf\n\t- hidden\n- after";
  const prepared = "- before\n\t- leaf\n\t\t- \n\t- hidden\n- after";
  for (const action of ["enter", "shift-tab"]) {
    setup(leaf);
    if (action === "enter") key("Enter", "Enter", 13, 0, "\r");
    else key("Tab", "Tab", 9, 8);
    expectState(
      capture(`empty-child-${action}`),
      prepared,
      { line: 2, ch: 4 },
      "leaf",
    );
    type("NEXT");
    const expected = "- before\n\t- leaf\n\t\t- NEXT\n\t- hidden\n- after";
    expectState(
      capture(`empty-child-${action}-typing`),
      expected,
      { line: 2, ch: 8 },
      "leaf",
    );
    resetAndCheck(expected, `empty-child-${action}-reset`);
  }

  const subtree = "- before\n\t- project\n\t\t- task\n\t- hidden\n- after";
  setup(subtree);
  cursor(1, 3);
  type("edited ");
  const bodyEdited =
    "- before\n\t- edited project\n\t\t- task\n\t- hidden\n- after";
  expectState(
    capture("root-body-edit"),
    bodyEdited,
    { line: 1, ch: 10 },
    "edited project",
  );
  resetAndCheck(bodyEdited, "root-body-edit-reset");

  for (const action of [
    "paste-sibling",
    "root-shift-tab",
    "child-shift-tab",
    "remove-root",
  ]) {
    setup(subtree);
    const atChild = action === "paste-sibling" || action === "child-shift-tab";
    const position = atChild ? { line: 2, ch: 8 } : { line: 1, ch: 3 };
    cursor(position.line, position.ch);
    if (action === "paste-sibling") paste("\n\t- escaped");
    else if (action === "remove-root")
      evaluate(() => {
        const cm = window.__zoomSubtreeEditingLeaf.view.editor.cm;
        cm.dispatch({
          changes: {
            from: cm.state.doc.line(2).from,
            to: cm.state.doc.line(3).from,
          },
          userEvent: "input.delete",
        });
      });
    else key("Tab", "Tab", 9, 8);
    expectState(capture(action), subtree, position, "project");
    type("NEXT");
    const expected = atChild
      ? "- before\n\t- project\n\t\t- taskNEXT\n\t- hidden\n- after"
      : "- before\n\t- NEXTproject\n\t\t- task\n\t- hidden\n- after";
    expectState(
      capture(`${action}-typing`),
      expected,
      { line: position.line, ch: position.ch + 4 },
      atChild ? "project" : "NEXTproject",
    );
    resetAndCheck(expected, `${action}-reset`);
  }

  setup(subtree);
  cursor(2, 8);
  paste("\n\t\t- pasted");
  const pasted =
    "- before\n\t- project\n\t\t- task\n\t\t- pasted\n\t- hidden\n- after";
  expectState(
    capture("paste-descendant"),
    pasted,
    { line: 3, ch: 10 },
    "project",
  );
  resetAndCheck(pasted, "paste-descendant-reset");

  for (const fixture of [
    {
      name: "number-width-expands",
      before:
        "- before\n\t- project\n" +
        Array.from({ length: 9 }, (_, i) => `\t\t${i + 1}. item`).join("\n") +
        "\n\t- hidden\n- after",
      line: 10,
      expectedLine: 11,
      ch: 6,
    },
    {
      name: "number-width-shrinks",
      before:
        "- before\n\t- project\n\t\t10. item\n\t\t11. second\n\t- hidden\n- after",
      line: 2,
      expectedLine: 3,
      ch: 5,
    },
  ]) {
    setup(fixture.before);
    evaluate((line) => {
      const editor = window.__zoomSubtreeEditingLeaf.view.editor;
      editor.setCursor({ line, ch: editor.getLine(line).length });
    }, fixture.line);
    key("Enter", "Enter", 13, 0, "\r");
    const inserted = capture(fixture.name);
    assert.deepEqual(inserted.cursor, {
      line: fixture.expectedLine,
      ch: fixture.ch,
    });
    type("NEXT");
    const typed = capture(`${fixture.name}-typing`);
    assert.ok(typed.doc.split("\n")[fixture.expectedLine].endsWith(". NEXT"));
    assert.equal(typed.target, "project");
    assert.ok(typed.doc.endsWith("\n\t- hidden\n- after"));
  }

  setup(
    "- before\n\t- project\n\t\t- folded\n\t\t\t- grandchild\n\t\t- sibling\n\t- hidden\n- after",
  );
  cursor(2, 10);
  evaluate(() => app.commands.executeCommandById("editor:fold-more"));
  key("Enter", "Enter", 13, 0, "\r");
  expectState(
    capture("folded-descendant-enter"),
    "- before\n\t- project\n\t\t- folded\n\t\t\t- grandchild\n\t\t- \n\t\t- sibling\n\t- hidden\n- after",
    { line: 4, ch: 4 },
    "project",
  );

  const closedFence =
    "- before\n\t- ```js\n\t  code\n\t  ```\n\t- hidden\n- after";
  setup(closedFence);
  const withChild =
    "- before\n\t- ```js\n\t  code\n\t  ```\n\t\t- \n\t- hidden\n- after";
  expectState(
    capture("closed-fence-leaf"),
    withChild,
    { line: 4, ch: 4 },
    "```js",
  );
  resetAndCheck(withChild, "closed-fence-leaf-reset");

  // An unclosed fence has no safe position to append a child marker.
  const unclosedFence = "- before\n\t- ```js\n\t  code";
  setup(unclosedFence);
  const skipped = capture("unclosed-fence-leaf");
  assert.equal(skipped.doc, unclosedFence);
  assert.equal(skipped.target, "```js");

  for (const fixture of [
    {
      name: "root-code-enter",
      before:
        "- before\n\t- ```js\n\t  code\n\t  ```\n\t\t- existing\n\t- hidden\n- after",
      line: 2,
      ch: 7,
      expected:
        "- before\n\t- ```js\n\t  code\n\t  \n\t  ```\n\t\t- existing\n\t- hidden\n- after",
      cursor: { line: 3, ch: 3 },
      target: "```js",
    },
    {
      name: "child-code-enter",
      before:
        "- before\n\t- project\n\t\t- ```js\n\t\t  code\n\t\t  ```\n\t- hidden\n- after",
      line: 3,
      ch: 8,
      expected:
        "- before\n\t- project\n\t\t- ```js\n\t\t  code\n\t\t  \n\t\t  ```\n\t- hidden\n- after",
      cursor: { line: 4, ch: 4 },
      target: "project",
    },
  ]) {
    for (const zoom of [false, true]) {
      setup(fixture.before, zoom);
      cursor(fixture.line, fixture.ch);
      key("Enter", "Enter", 13, 0, "\r");
      expectState(
        capture(`${fixture.name}-${zoom}`),
        fixture.expected,
        fixture.cursor,
        zoom ? fixture.target : null,
      );
      type("NEXT");
      const lines = fixture.expected.split("\n");
      lines[fixture.cursor.line] += "NEXT";
      expectState(
        capture(`${fixture.name}-${zoom}-typing`),
        lines.join("\n"),
        { line: fixture.cursor.line, ch: fixture.cursor.ch + 4 },
        zoom ? fixture.target : null,
      );
    }
  }
} catch (error) {
  failure = error.stack ?? String(error);
  throw error;
} finally {
  try {
    evaluate(
      async (original, note) => {
        const settings = app.plugins.plugins.bullet.settings;
        settings.overrideEnterBehaviour = original.betterEnter;
        settings.overrideTabBehaviour = original.betterTab;
        settings.keepBodyTextInBullets = original.keepBody;
        settings.keepCursorWithinContent = original.stickCursor;
        const leaf = window.__zoomSubtreeEditingLeaf;
        if (leaf) {
          await leaf.view.save();
          leaf.detach();
          delete window.__zoomSubtreeEditingLeaf;
        }
        const previous = app.workspace.getLeafById(original.leaf);
        if (previous) app.workspace.setActiveLeaf(previous, { focus: true });
        const file = app.vault.getAbstractFileByPath(note);
        if (file) await app.vault.trash(file, false);
      },
      original,
      note,
    );
  } finally {
    cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
    fs.writeFileSync(
      path.join(output, "results.json"),
      JSON.stringify({ results, failure }, null, 2),
    );
    console.log(
      JSON.stringify({ output, cases: results.length, failure }, null, 2),
    );
  }
}
