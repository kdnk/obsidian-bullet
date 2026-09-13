// Real Enter handling for ordered/task roots. The following typed text is part
// of the assertion: retaining a breadcrumb alone does not prove cursor safety.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const note = `zoom-marker-audit-${randomUUID()}.md`;
const original = evaluate(() => app.workspace.activeLeaf.id);
const results = [],
  failures = [];
function sample(delay = 250) {
  return evaluate(async (delay) => {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const editor = app.workspace.activeLeaf.view.editor;
    return {
      doc: editor.getValue(),
      cursor: editor.getCursor(),
      target: editor.cm.dom.querySelector(
        '.bullet-zoom-breadcrumbs [aria-current="location"]',
      )?.textContent,
      visible: editor.cm.contentDOM.textContent,
    };
  }, delay);
}
function focus() {
  evaluate(() => {
    window.focus();
    app.workspace.activeLeaf.view.editor.focus();
  });
}
function setup(text, line) {
  evaluate(
    (text, line) => {
      app.commands.executeCommandById("bullet:zoom-reset");
      const editor = app.workspace.activeLeaf.view.editor;
      editor.setValue(text);
      editor.setCursor({ line, ch: editor.getLine(line).indexOf("project") });
      app.commands.executeCommandById("bullet:zoom-in");
      editor.focus();
    },
    text,
    line,
  );
}
function key(name, code, number, modifiers = 0, text) {
  for (const type of ["keyDown", "keyUp"]) {
    focus();
    cdp("Input.dispatchKeyEvent", {
      type,
      key: name,
      code,
      modifiers,
      windowsVirtualKeyCode: number,
      nativeVirtualKeyCode: number,
      ...(type === "keyDown" && text ? { text } : {}),
    });
  }
}
const cases = ["- ", "1. ", "- [ ] ", "- [x] ", "1. [ ] ", "1. [x] "].map(
  (marker) => {
    const focused = marker.replace(/^1\. /, "2. ");
    const empty = marker.replace("[x]", "[ ]");
    return {
      name: `mixed siblings / ${marker}`,
      line: 1,
      before: `- work\n\t${marker}project\n\t\t- task\n\t- other\n- personal`,
      expected: `- work\n\t${empty}\n\t${focused}project\n\t\t- task\n\t- other\n- personal`,
    };
  },
);
for (const checkbox of ["", "[ ] ", "[x] "]) {
  for (const hasBefore of [false, true]) {
    const previous = hasBefore ? `\t1. ${checkbox}before\n` : "";
    const number = hasBefore ? 2 : 1;
    cases.push({
      name: `ordered siblings / ${checkbox || "plain"} / preceding ${hasBefore}`,
      line: hasBefore ? 2 : 1,
      before: `- work\n${previous}\t${number}. ${checkbox}project\n\t\t- task\n\t${number + 1}. ${checkbox}other\n- personal`,
      expected: `- work\n${previous}\t${number}. ${checkbox ? "[ ] " : ""}\n\t${number + 1}. ${checkbox}project\n\t\t- task\n\t${number + 2}. ${checkbox}other\n- personal`,
    });
  }
}
cases.push(
  {
    name: "recursive hidden descendant normalization",
    line: 1,
    before:
      "- work\n\t1. project\n\t\t- task\n\t2. other\n\t\t9. nested\n- personal",
    expected:
      "- work\n\t1. \n\t2. project\n\t\t- task\n\t3. other\n\t\t1. nested\n- personal",
  },
  {
    name: "recursive hidden ancestor normalization",
    line: 1,
    before: "9. work\n\t1. project\n\t\t- task\n\t2. other\n- personal",
    expected:
      "1. work\n\t1. \n\t2. project\n\t\t- task\n\t3. other\n- personal",
  },
  {
    name: "hidden bare ordered item normalization",
    line: 1,
    before: "- work\n\t1. project\n\t\t- task\n\t2.\n- personal",
    expected: "- work\n\t1. \n\t2. project\n\t\t- task\n\t3.\n- personal",
  },
);
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (name) => {
    window.__zoomMarkerAudit = app.workspace.getLeaf("tab");
    await window.__zoomMarkerAudit.openFile(
      await app.vault.create(name, "audit"),
    );
  }, note);
  for (const { name, line, before, expected } of cases) {
    setup(before, line);
    // Separate setup, Enter, and typing into distinct native history events.
    const start = sample(700);
    key("Enter", "Enter", 13, 0, "\r");
    const after = sample(700);
    focus();
    cdp("Input.insertText", { text: "visible " });
    const typed = sample();
    const expectedCursor = {
      line: line + 1,
      ch: expected.split("\n")[line + 1].indexOf("project"),
    };
    const expectedTyped = expected.replace("project", "visible project");
    const found = [];
    if (after.doc !== expected)
      found.push("Enter changed the wrong document content");
    if (after.target !== start.target) found.push("Enter changed zoom target");
    if (
      after.cursor.line !== expectedCursor.line ||
      after.cursor.ch !== expectedCursor.ch
    )
      found.push(
        `Enter cursor ${JSON.stringify(after.cursor)}, expected ${JSON.stringify(expectedCursor)}`,
      );
    if (typed.doc !== expectedTyped)
      found.push("following input misses original body");
    if (
      typed.cursor.line !== expectedCursor.line ||
      typed.cursor.ch !== expectedCursor.ch + "visible ".length
    )
      found.push("following input cursor misses original body");
    if (typed.target !== start.target.replace("project", "visible project"))
      found.push("following input not visible in focused item");
    if (typed.visible.includes("personal") || typed.visible.includes("other"))
      found.push("hidden siblings exposed");
    fs.writeFileSync(
      path.join(output, `marker-${results.length + 1}.png`),
      Buffer.from(cdp("Page.captureScreenshot").data, "base64"),
    );
    key("z", "KeyZ", 90, 4);
    const undoTyping = sample();
    key("z", "KeyZ", 90, 4);
    const undoEnter = sample();
    key("z", "KeyZ", 90, 12);
    const redoEnter = sample();
    key("z", "KeyZ", 90, 12);
    const redoTyping = sample();
    if (undoTyping.doc !== expected)
      found.push("Undo typing document mismatch");
    if (undoEnter.doc !== before) found.push("Undo Enter document mismatch");
    if (redoEnter.doc !== expected) found.push("Redo Enter document mismatch");
    if (
      redoEnter.cursor.line !== expectedCursor.line ||
      redoEnter.cursor.ch !== expectedCursor.ch
    )
      found.push("Redo Enter cursor misses original body");
    if (redoTyping.doc !== expectedTyped)
      found.push("Redo typing document mismatch");
    results.push({
      name,
      start,
      after,
      typed,
      undoTyping,
      undoEnter,
      redoEnter,
      redoTyping,
      failures: found,
    });
    failures.push(...found.map((f) => `${name}: ${f}`));
  }

  const before = "- work\n\t1. project\n\t\t- task\n\t2. other\n- personal";
  const renumbered =
    "- work\n\t1. \n\t2. project\n\t\t- task\n\t3. other\n- personal";
  for (const external of [false, true]) {
    setup(before, 1);
    const start = sample();
    const proposed = external
      ? renumbered
      : renumbered.replace("other", "changed");
    evaluate(
      (text, external) => {
        const view = app.workspace.activeLeaf.view.editor.cm;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          userEvent: external ? "set" : "input",
        });
      },
      proposed,
      external,
    );
    const after = sample();
    const found = [];
    if (external) {
      if (after.doc !== proposed)
        found.push("external document update rejected");
      if (after.target) found.push("external hidden renumbering retained zoom");
    } else {
      if (after.doc !== before) found.push("hidden body edit was accepted");
      if (
        after.target !== start.target ||
        after.cursor.line !== start.cursor.line ||
        after.cursor.ch !== start.cursor.ch
      )
        found.push("rejected hidden edit changed focus or cursor");
      focus();
      cdp("Input.insertText", { text: "visible " });
      const typed = sample();
      if (typed.doc !== before.replace("project", "visible project"))
        found.push("input after rejected hidden edit misses original body");
    }
    const name = external
      ? "external renumbering clears zoom"
      : "hidden body mutation rejected";
    results.push({ name, start, after, failures: found });
    failures.push(...found.map((f) => `${name}: ${f}`));
  }
} finally {
  try {
    evaluate(
      async (name, original) => {
        const leaf = window.__zoomMarkerAudit;
        if (leaf) {
          await leaf.view.save();
          leaf.detach();
          delete window.__zoomMarkerAudit;
        }
        const file = app.vault.getAbstractFileByPath(name);
        if (file) await app.vault.trash(file, false);
        const previous = app.workspace.getLeafById(original);
        if (previous) app.workspace.setActiveLeaf(previous, { focus: true });
      },
      note,
      original,
    );
  } finally {
    cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
    fs.writeFileSync(
      path.join(output, "results.json"),
      JSON.stringify({ results, failures }, null, 2),
    );
    console.log(JSON.stringify({ output, failures }, null, 2));
  }
}
assert.equal(failures.length, 0, "Zoom marker insertion regressions");
