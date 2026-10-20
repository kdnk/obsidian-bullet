const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

if (!process.argv[2] || !process.argv[3])
  throw Error(
    "Usage: node scripts/verify-formatting-linker.cjs <fresh-output-directory> <built-automatic-linker-directory>",
  );
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const source = path.resolve(process.argv[3]);
const target = path.resolve(
  __dirname,
  "../vault/.obsidian/plugins/automatic-linker",
);
assert.ok(
  !fs.existsSync(target),
  "A preexisting Automatic Linker installation must not be replaced",
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(source, "manifest.json")),
);
assert.equal(manifest.id, "automatic-linker");
const note = `pages/linker-formatting-${randomUUID()}.md`;
const input = "- 日本語ABC https://github.com/a/b/issues/1";
const expected =
  "- 日本語 ABC [[github/a/b/issues/1]] [🔗](https://github.com/a/b/issues/1)";
const results = [];
let initialized = false;

function key(key, code, windowsVirtualKeyCode) {
  const focus = () =>
    evaluate(() => {
      window.focus();
      if (
        !document.title.includes("vault") ||
        document.title.includes("base") ||
        document.visibilityState !== "visible"
      )
        throw Error("Wrong renderer");
      window.__linkerFormattingProof.leaf.view.editor.focus();
    });
  focus();
  cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    windowsVirtualKeyCode,
    modifiers: 4,
  });
  focus();
  cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode,
    modifiers: 4,
  });
}

function sample() {
  return evaluate(async () => {
    const state = window.__linkerFormattingProof;
    return {
      text: state.leaf.view.editor.getValue(),
      saved: await app.vault.read(state.file),
      runs: state.runs,
    };
  });
}

function configure(
  input,
  { onSave = true, automaticLinker = true, linkerOnSave = true } = {},
) {
  evaluate(
    async (input, onSave, automaticLinker, linkerOnSave) => {
      const state = window.__linkerFormattingProof;
      const bullet = app.plugins.plugins.bullet;
      bullet.settings.formatting = {
        ...bullet.settings.formatting,
        onSave,
        automaticLinker,
        markdown: false,
        footnotes: false,
        listCleanup: false,
        spacing: false,
        cjkSpacing: true,
        joinHyphenatedWords: false,
        compactFrontmatter: false,
        correctClosingFences: false,
        timestamps: { kind: "disabled" },
        script: { kind: "disabled" },
        profile: { ...bullet.settings.formatting.profile, disabledRules: [] },
      };
      app.plugins.plugins["automatic-linker"].settings.formatOnSave =
        linkerOnSave;
      state.leaf.view.editor.setValue("- setup source");
      await state.leaf.view.save();
      state.leaf.view.editor.setValue(input);
      state.leaf.view.editor.setCursor({ line: 0, ch: input.length });
      state.runs = 0;
    },
    input,
    onSave,
    automaticLinker,
    linkerOnSave,
  );
}

function run(name, options = {}, expectedOutput = expected) {
  const {
    onSave = true,
    automaticLinker = true,
    linkerOnSave = true,
  } = options;
  configure(input, options);
  assert.equal(sample().saved, "- setup source");
  key("s", "KeyS", 83);
  for (
    let attempt = 0;
    attempt < 60 && sample().saved !== expectedOutput;
    attempt++
  )
    evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  const result = sample();
  assert.equal(result.saved, expectedOutput);
  assert.equal(result.text, expectedOutput);
  const expectedRuns = onSave ? Number(automaticLinker) : Number(linkerOnSave);
  assert.equal(
    result.runs,
    expectedRuns,
    "Only the selected save owner runs linking",
  );
  if (onSave) {
    key("z", "KeyZ", 90);
    assert.equal(
      sample().text,
      input,
      "One Undo restores linking and cleanup together",
    );
  }
  results.push({ name, onSave, automaticLinker, linkerOnSave, ...result });
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(`PASS ${name}`);
}

function runIntegrationMatrix(loadOrder) {
  for (const automaticLinker of [true, false]) {
    for (const linkerOnSave of [true, false]) {
      run(
        `${loadOrder}; Bullet integration ${automaticLinker}; Automatic Linker save ${linkerOnSave}`,
        { automaticLinker, linkerOnSave },
        automaticLinker
          ? expected
          : "- 日本語 ABC https://github.com/a/b/issues/1",
      );
    }
  }
}

try {
  fs.mkdirSync(target);
  for (const file of ["main.js", "manifest.json", "styles.css"])
    if (fs.existsSync(path.join(source, file)))
      fs.copyFileSync(path.join(source, file), path.join(target, file));
  fs.writeFileSync(
    path.join(target, "data.json"),
    JSON.stringify({
      formatOnSave: true,
      replaceUrlWithTitle: false,
      formatGitHubURLs: true,
    }),
  );
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(async (note) => {
    if (app.plugins.plugins["automatic-linker"])
      throw Error("Automatic Linker must be initially unloaded");
    const previous = {
      leaf: app.workspace.activeLeaf.id,
      settings: JSON.stringify(app.plugins.plugins.bullet.settings.formatting),
      vim: app.vault.config.vimMode,
    };
    app.vault.setConfig("vimMode", false);
    const file = await app.vault.create(note, "- start");
    const leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    window.__linkerFormattingProof = { previous, leaf, file, runs: 0 };
    await app.plugins.loadManifest(".obsidian/plugins/automatic-linker");
    await app.plugins.enablePlugin("automatic-linker");
    const linker = app.plugins.plugins["automatic-linker"];
    if (typeof linker.formatText !== "function")
      throw Error("Updated text API is missing");
    const original = linker.formatText;
    linker.formatText = async function (...args) {
      window.__linkerFormattingProof.runs++;
      return original.apply(this, args);
    };
  }, note);
  initialized = true;
  runIntegrationMatrix("Bullet loaded before Automatic Linker");
  evaluate(async () => {
    await app.plugins.disablePlugin("bullet");
    await app.plugins.loadManifest(".obsidian/plugins/bullet");
    await app.plugins.enablePlugin("bullet");
  });
  runIntegrationMatrix("Automatic Linker loaded before Bullet");
  for (const automaticLinker of [true, false]) {
    for (const linkerOnSave of [true, false]) {
      run(
        `Bullet save disabled; integration ${automaticLinker}; Automatic Linker save ${linkerOnSave}`,
        { onSave: false, automaticLinker, linkerOnSave },
        linkerOnSave
          ? "- 日本語ABC [[github/a/b/issues/1]] [🔗](https://github.com/a/b/issues/1)"
          : input,
      );
    }
  }
  configure(input, {
    onSave: false,
    automaticLinker: false,
    linkerOnSave: false,
  });
  assert.equal(
    evaluate(() =>
      app.commands.executeCommandById("automatic-linker:format-file"),
    ),
    true,
  );
  const standalone =
    "- 日本語ABC [[github/a/b/issues/1]] [🔗](https://github.com/a/b/issues/1)";
  for (let attempt = 0; attempt < 60 && sample().text !== standalone; attempt++)
    evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  assert.equal(sample().text, standalone);
  assert.equal(sample().runs, 1);
  results.push({
    name: "existing Format file command",
    entry: "programmatic Obsidian command",
    ...sample(),
  });
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log("PASS existing Format file command");
} finally {
  if (initialized)
    evaluate(async () => {
      const state = window.__linkerFormattingProof;
      await app.plugins.disablePlugin("automatic-linker");
      delete app.plugins.manifests["automatic-linker"];
      app.plugins.plugins.bullet.settings.formatting = JSON.parse(
        state.previous.settings,
      );
      app.vault.setConfig("vimMode", state.previous.vim);
      state.leaf.detach();
      await app.vault.trash(state.file, true);
      const previous = app.workspace.getLeafById(state.previous.leaf);
      if (previous) app.workspace.setActiveLeaf(previous, { focus: true });
      delete window.__linkerFormattingProof;
    });
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
  if (fs.existsSync(target)) execFileSync("/usr/bin/trash", [target]);
}
