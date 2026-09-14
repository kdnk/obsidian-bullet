// Real editor movement across tab indentation and a numbered-marker width change.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const note = `fenced-movement-${randomUUID()}.md`;
const original = evaluate(() => app.workspace.activeLeaf.id);
const results = [],
  failures = [];
const cases = [
  ...["  ", "   "].map((indent) => ({
    name: `tab body inherits ${indent.length}-space indentation`,
    text: `- previous\n${indent}- existing\n- \`\`\`js\n\tcode\n\t\`\`\`\n- next`,
    line: 2,
    command: "bullet:indent-list",
    inverse: "bullet:outdent-list",
    expected: `- previous\n${indent}- existing\n${indent}- \`\`\`js\n${indent}\t${indent}code\n${indent}\t${indent}\`\`\`\n- next`,
  })),
  {
    name: "tab continuation",
    text: "- previous\n- ```js\n\tcode\n\t```\n- next",
    line: 1,
    command: "bullet:move-list-item-up",
    expected: "- ```js\n\tcode\n\t```\n- previous\n- next",
  },
  {
    name: "tab marker separator",
    text: "- previous\n-\t```js\n\tcode\n\t```\n- next",
    line: 1,
    command: "bullet:move-list-item-up",
    expected: "-\t```js\n\tcode\n\t```\n- previous\n- next",
  },
  {
    name: "ordered width crossing",
    text: [
      ...Array.from({ length: 8 }, (_, i) => `${i + 1}. before`),
      "9. ```js",
      "   code",
      "   ```",
      "10. next",
    ].join("\n"),
    line: 8,
    command: "bullet:move-list-item-down",
    expected: [
      ...Array.from({ length: 8 }, (_, i) => `${i + 1}. before`),
      "9. next",
      "10. ```js",
      "    code",
      "    ```",
    ].join("\n"),
  },
];
function sample() {
  return evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    const editor = app.workspace.activeLeaf.view.editor;
    const cm = editor.cm;
    return {
      doc: editor.getValue(),
      cursor: editor.getCursor(),
      lines: [...cm.contentDOM.querySelectorAll(".cm-line")].map((el) => ({
        text: el.textContent,
        classes: el.className,
        line: cm.state.doc.lineAt(cm.posAtDOM(el)).number,
      })),
    };
  });
}
try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (note) => {
    window.__fenceMovementLeaf = app.workspace.getLeaf("tab");
    await window.__fenceMovementLeaf.openFile(
      await app.vault.create(note, "audit"),
    );
  }, note);
  for (const fixture of cases) {
    evaluate((fixture) => {
      app.commands.executeCommandById("bullet:zoom-reset");
      const e = app.workspace.activeLeaf.view.editor;
      e.setValue(fixture.text);
      e.setCursor({ line: fixture.line, ch: 3 });
      e.focus();
    }, fixture);
    const before = sample();
    evaluate(
      (command) => app.commands.executeCommandById(command),
      fixture.command,
    );
    const after = sample();
    if (after.doc !== fixture.expected)
      failures.push(`${fixture.name}: moved Markdown mismatch`);
    evaluate(
      (command) => app.commands.executeCommandById(command),
      fixture.inverse ??
        (fixture.command === "bullet:move-list-item-up"
          ? "bullet:move-list-item-down"
          : "bullet:move-list-item-up"),
    );
    const restored = sample();
    if (restored.doc !== fixture.text)
      failures.push(
        `${fixture.name}: reverse movement did not restore Markdown`,
      );
    results.push({
      name: fixture.name,
      before,
      after,
      restored,
      expected: fixture.expected,
    });
    fs.writeFileSync(
      path.join(output, `case-${results.length}.png`),
      Buffer.from(cdp("Page.captureScreenshot").data, "base64"),
    );
  }
} finally {
  evaluate(
    async (original, note) => {
      if (window.__fenceMovementLeaf?.view.save)
        await window.__fenceMovementLeaf.view.save();
      window.__fenceMovementLeaf?.detach();
      delete window.__fenceMovementLeaf;
      const leaf = app.workspace.getLeafById(original);
      if (leaf) app.workspace.setActiveLeaf(leaf);
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.trash(file, false);
    },
    original,
    note,
  );
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify({ results, failures }, null, 2),
  );
  console.log(
    JSON.stringify({ output, cases: results.length, failures }, null, 2),
  );
}
if (failures.length) process.exitCode = 1;
