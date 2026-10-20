const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

if (!process.argv[2])
  throw Error(
    "Usage: node scripts/verify-integrated-formatting.cjs <fresh-output-directory>",
  );
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const token = randomUUID();
const note = `pages/formatting-${token}.md`;
const script = `.obsidian/formatting-${token}.mjs`;
const helperScript = `.obsidian/formatting-${token}-helper.mjs`;
const jsScript = `.obsidian/formatting-${token}.js`;
const stateKey = "__bulletFormattingProof";
const results = [];

function waitFor(predicate, label, attempts = 60) {
  for (let index = 0; index < attempts; index++) {
    if (predicate()) return;
    evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  }
  throw Error(`Timed out: ${label}`);
}

function snapshot() {
  return evaluate(async (key) => {
    const state = window[key];
    const editor = state.leaf.view.editor;
    return {
      text: editor.getValue(),
      saved: await app.vault.adapter.read(state.file.path),
      selection: editor.listSelections(),
      breadcrumb:
        editor.cm.dom.querySelector(
          '.bullet-zoom-breadcrumbs [aria-current="location"]',
        )?.textContent ?? null,
      scrollTop: editor.cm.scrollDOM.scrollTop,
    };
  }, stateKey);
}

function waitForFormatting() {
  waitFor(
    () => evaluate(() => app.plugins.plugins.bullet.formatting.runs.size === 0),
    "formatting completion",
  );
}

function focus() {
  evaluate((key) => {
    window.focus();
    if (
      !document.title.includes("vault") ||
      document.title.includes("base") ||
      document.visibilityState !== "visible"
    )
      throw Error("Wrong renderer");
    window[key].leaf.view.editor.focus();
  }, stateKey);
}

function key(key, code, windowsVirtualKeyCode, modifiers = 0) {
  focus();
  cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    windowsVirtualKeyCode,
    modifiers,
  });
  focus();
  cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode,
    modifiers,
  });
}

function configure(scriptSource, source = "- TOKEN") {
  evaluate(
    async (stateKey, scriptSource, source) => {
      const state = window[stateKey];
      const plugin = app.plugins.plugins.bullet;
      app.workspace.setActiveLeaf(state.leaf, { focus: true });
      if (
        state.leaf.view.editor.cm.dom.querySelector(".bullet-zoom-breadcrumbs")
      )
        app.commands.executeCommandById("bullet:zoom-out");
      const settings = plugin.settings.formatting;
      plugin.settings.formatting = {
        ...settings,
        onSave: true,
        markdown: false,
        footnotes: false,
        listCleanup: false,
        spacing: false,
        cjkSpacing: false,
        joinHyphenatedWords: false,
        compactFrontmatter: false,
        correctClosingFences: false,
        timestamps: { kind: "disabled" },
        script:
          scriptSource === null
            ? { kind: "disabled" }
            : { kind: "module", path: state.script },
      };
      if (scriptSource !== null)
        await app.vault.adapter.write(state.script, scriptSource);
      state.leaf.view.editor.setValue(source);
      state.leaf.view.editor.setCursor({
        line: 0,
        ch: source.split("\n")[0].length,
      });
      await state.leaf.view.save();
      state.received = [];
    },
    stateKey,
    scriptSource,
    source,
  );
}

function proof(name, value) {
  results.push({ name, ...value });
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(`PASS ${name}`);
}

cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
const initial = evaluate(
  async (key, note, script) => {
    const plugin = app.plugins.plugins.bullet;
    if (typeof plugin.formatActiveEditor !== "function")
      throw Error("Deploy integrated formatting build first");
    const previous = {
      leaf: app.workspace.activeLeaf.id,
      formatting: JSON.stringify(plugin.settings.formatting),
      vim: app.vault.config.vimMode,
    };
    app.vault.setConfig("vimMode", false);
    const file = await app.vault.create(note, "- TOKEN");
    const leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    window[key] = { leaf, file, script, received: [] };
    const command = app.commands.commands["editor:save-file"];
    const originalSave = command.checkCallback;
    const wrappedSave = function (checking) {
      if (!checking) window[key].received.push({ save: true });
      return originalSave.call(this, checking);
    };
    window[key].saveCommand = command;
    window[key].originalSave = originalSave;
    window[key].wrappedSave = wrappedSave;
    command.checkCallback = wrappedSave;
    leaf.view.editor.cm.dom.addEventListener("keydown", (event) =>
      window[key].received.push({ key: event.key, meta: event.metaKey }),
    );
    return previous;
  },
  stateKey,
  note,
  script,
);

try {
  const engineSource =
    "# Heading\n\n- 日本語ABC\n\ntext[^x].\n\n[^x]: footnote";
  const engineExpected =
    "# Heading\n\n- 日本語 ABC\n\ntext.[^1]\n\n[^1]: footnote\n";
  configure(null, engineSource);
  evaluate(() => {
    const settings = app.plugins.plugins.bullet.settings;
    settings.formatting = {
      ...settings.formatting,
      markdown: true,
      footnotes: true,
      listCleanup: true,
      spacing: true,
      cjkSpacing: true,
      profile: { ...settings.formatting.profile, disabledRules: [] },
    };
  });
  key("s", "KeyS", 83, 4);
  waitFor(
    () => snapshot().saved === engineExpected,
    "Prettier and Linter save result",
  );
  waitForFormatting();
  assert.equal(snapshot().text, engineExpected);
  proof("native Save with embedded Prettier and Linter", snapshot());

  const codeSource =
    "- - ```txt\n    日本語ABC  \n    - literal marker\n    ```\n- tail";
  const codeExpected =
    "- \n\t- ```txt\n\t  日本語ABC  \n\t  - literal marker\n\t  ```\n- tail\n";
  configure(null, codeSource);
  evaluate(() => {
    const settings = app.plugins.plugins.bullet.settings;
    settings.formatting = {
      ...settings.formatting,
      markdown: true,
      footnotes: true,
      listCleanup: true,
      spacing: true,
      cjkSpacing: true,
      correctClosingFences: true,
      profile: { ...settings.formatting.profile, disabledRules: [] },
    };
  });
  key("s", "KeyS", 83, 4);
  waitFor(
    () => snapshot().saved === codeExpected,
    "compact code ancestor saved",
  );
  key("s", "KeyS", 83, 4);
  evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
  waitForFormatting();
  assert.equal(snapshot().text, codeExpected);
  assert.equal(snapshot().saved, codeExpected);
  proof(
    "repeated Save preserves empty code ancestors and literal code",
    snapshot(),
  );
  fs.writeFileSync(
    path.join(output, "code-save.png"),
    Buffer.from(
      cdp("Page.captureScreenshot", { format: "png" }).data,
      "base64",
    ),
  );
  key("z", "KeyZ", 90, 4);
  assert.equal(snapshot().text, codeSource);
  proof("one Undo restores the compact code source", snapshot());

  configure(
    'export default async (text, {file, app, signal}) => { if (!file.path || !app || signal.aborted) throw Error("context"); return text.replace("TOKEN", "DONE"); };',
  );
  key("s", "KeyS", 83, 4);
  waitFor(
    () => snapshot().saved === "- DONE",
    "native Save applies module result",
  );
  assert.equal(snapshot().text, "- DONE");
  assert.ok(
    evaluate(
      (key) => window[key].received.some((event) => event.save === true),
      stateKey,
    ),
  );
  proof("native Save and default ES module", snapshot());
  key("z", "KeyZ", 90, 4);
  assert.equal(snapshot().text, "- TOKEN");
  proof("one native Undo restores source", snapshot());

  configure('export default text => text.replace("TOKEN", "RELOADED");');
  key("s", "KeyS", 83, 4);
  waitFor(() => snapshot().saved === "- RELOADED", "changed module reload");
  key("s", "KeyS", 83, 4);
  evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
  assert.equal(snapshot().text, "- RELOADED");
  proof("module edits and repeated Save", snapshot());

  configure(null);
  evaluate(
    async (key, helper, script) => {
      const state = window[key];
      state.helperScript = helper;
      state.jsScript = script;
      await app.vault.adapter.write(helper, 'export const word = "RELATIVE";');
      await app.vault.adapter.write(
        script,
        `import {word} from "./${helper.split("/").pop()}"; export default text => text.replace("TOKEN", word);`,
      );
      const settings = app.plugins.plugins.bullet.settings;
      settings.formatting = {
        ...settings.formatting,
        script: { kind: "module", path: script },
      };
    },
    stateKey,
    helperScript,
    jsScript,
  );
  key("s", "KeyS", 83, 4);
  waitFor(
    () => snapshot().saved === "- RELATIVE",
    ".js and relative module import",
  );
  proof("JavaScript extension and relative imports", snapshot());

  configure('export default () => { throw Error("expected proof failure"); };');
  evaluate((key) => {
    const editor = window[key].leaf.view.editor;
    editor.setValue("- UNSAVED");
    editor.setCursor({ line: 0, ch: 9 });
  }, stateKey);
  assert.equal(snapshot().saved, "- TOKEN");
  assert.equal(snapshot().text, "- UNSAVED");
  key("s", "KeyS", 83, 4);
  waitForFormatting();
  waitFor(() => snapshot().saved === "- UNSAVED", "failed script saves source");
  assert.equal(snapshot().text, "- UNSAVED");
  proof("script failure preserves and saves source", snapshot());

  configure(
    'export default async text => { await new Promise(resolve => window.__bulletFormatRelease = resolve); return text.replace("TOKEN", "STALE"); };',
  );
  key("s", "KeyS", 83, 4);
  waitFor(
    () => evaluate(() => typeof window.__bulletFormatRelease === "function"),
    "async module started",
  );
  focus();
  cdp("Input.insertText", { text: "!" });
  assert.equal(snapshot().text, "- TOKEN!");
  evaluate(() => {
    window.__bulletFormatRelease();
    delete window.__bulletFormatRelease;
  });
  evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
  assert.equal(snapshot().text, "- TOKEN!");
  proof("typing during async formatting discards stale output", snapshot());

  configure(
    'export default async text => { await new Promise(resolve => window.__bulletFormatRelease = resolve); return text.replace("TOKEN", "DONE"); };',
  );
  evaluate((key) => {
    const state = window[key];
    state.sourceSaves = 0;
    state.sourceSave = state.leaf.view.save;
    state.leaf.view.save = function (...args) {
      state.sourceSaves++;
      return state.sourceSave.apply(this, args);
    };
  }, stateKey);
  key("s", "KeyS", 83, 4);
  waitFor(
    () => evaluate(() => typeof window.__bulletFormatRelease === "function"),
    "pane-switch module started",
  );
  evaluate(
    async (key, token) => {
      const state = window[key];
      state.secondFile = await app.vault.create(
        `pages/formatting-destination-${token}.md`,
        "- destination",
      );
      state.second = app.workspace.getLeaf("split", "vertical");
      await state.second.openFile(state.secondFile);
      app.workspace.setActiveLeaf(state.second, { focus: true });
      state.destinationSaves = 0;
      state.destinationSave = state.second.view.save;
      state.second.view.save = function (...args) {
        state.destinationSaves++;
        return state.destinationSave.apply(this, args);
      };
      state.sourceSavesBeforeRelease = state.sourceSaves;
      window.__bulletFormatRelease();
      delete window.__bulletFormatRelease;
    },
    stateKey,
    token,
  );
  waitFor(() => snapshot().saved === "- DONE", "captured source pane saved");
  const switched = evaluate(async (key) => {
    const state = window[key];
    return {
      sourceSaves: state.sourceSaves - state.sourceSavesBeforeRelease,
      destinationSaves: state.destinationSaves,
      destination: await app.vault.read(state.secondFile),
    };
  }, stateKey);
  assert.equal(switched.sourceSaves, 1);
  assert.equal(switched.destinationSaves, 0);
  assert.equal(switched.destination, "- destination");
  proof("async save persists the captured pane", {
    ...snapshot(),
    ...switched,
  });
  evaluate((key) => {
    const state = window[key];
    state.leaf.view.save = state.sourceSave;
    state.second.view.save = state.destinationSave;
    state.second.detach();
    state.second = null;
    app.workspace.setActiveLeaf(state.leaf, { focus: true });
  }, stateKey);

  configure(
    'export default text => text.replace("TOKEN", "DONE");',
    "- parent\n\t- TOKEN\n\t- sibling\n- outside",
  );
  evaluate((key) => {
    const editor = window[key].leaf.view.editor;
    editor.setCursor({ line: 1, ch: 8 });
    app.commands.executeCommandById("bullet:zoom-in");
  }, stateKey);
  waitFor(() => snapshot().breadcrumb === "TOKEN", "zoom focus");
  evaluate((key) => {
    window[key].leaf.view.editor.setCursor({ line: 1, ch: 8 });
  }, stateKey);
  assert.deepEqual(snapshot().selection, [
    { anchor: { line: 1, ch: 8 }, head: { line: 1, ch: 8 } },
  ]);
  key("s", "KeyS", 83, 4);
  waitFor(() => snapshot().text.includes("DONE"), "zoomed Save");
  assert.equal(snapshot().breadcrumb, "DONE");
  focus();
  cdp("Input.insertText", { text: "!" });
  assert.ok(snapshot().text.includes("\t- DONE!"), JSON.stringify(snapshot()));
  proof("zoomed Save and following native input", snapshot());

  const png = cdp("Page.captureScreenshot", { format: "png" }).data;
  fs.writeFileSync(
    path.join(output, "zoomed-save.png"),
    Buffer.from(png, "base64"),
  );
} finally {
  evaluate(
    async (key, initial) => {
      const state = window[key];
      window.__bulletFormatRelease?.();
      delete window.__bulletFormatRelease;
      if (state.saveCommand.checkCallback === state.wrappedSave)
        state.saveCommand.checkCallback = state.originalSave;
      if (state.sourceSave) state.leaf.view.save = state.sourceSave;
      if (state.second) {
        if (state.destinationSave)
          state.second.view.save = state.destinationSave;
        state.second.detach();
      }
      app.plugins.plugins.bullet.settings.formatting = JSON.parse(
        initial.formatting,
      );
      app.vault.setConfig("vimMode", initial.vim);
      state.leaf.detach();
      await app.vault.trash(state.file, true);
      if (await app.vault.adapter.exists(state.script))
        await app.vault.adapter.remove(state.script);
      for (const script of [state.helperScript, state.jsScript])
        if (script && (await app.vault.adapter.exists(script)))
          await app.vault.adapter.remove(script);
      if (state.secondFile) await app.vault.trash(state.secondFile, true);
      const previous = app.workspace.getLeafById(initial.leaf);
      if (previous) app.workspace.setActiveLeaf(previous, { focus: true });
      delete window[key];
    },
    stateKey,
    initial,
  );
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
}
