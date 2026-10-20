// Run against the deployed build in the repository test vault.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const note = `pages/vim-code-newlines-${randomUUID()}.md`;
const rootOpening = process.argv.includes("--root-opening");
const fullNote = process.argv.includes("--full-note");
const editorShortcuts = process.argv.includes("--editor-shortcuts");
const light = process.argv.includes("--light");
const fontArgument = process.argv.find((argument) =>
  argument.startsWith("--font="),
);
const fontSize = fontArgument ? Number(fontArgument.slice(7)) : null;
assert.ok(
  fontSize === null ||
    (Number.isFinite(fontSize) && fontSize >= 10 && fontSize <= 40),
  "--font must be 10 to 40",
);
const original = evaluate(() => ({
  leaf: app.workspace.activeLeaf.id,
  fontSize: app.getBaseFontSize(),
  dark: document.body.classList.contains("theme-dark"),
  light: document.body.classList.contains("theme-light"),
  vimMode: app.vault.config.vimMode ?? false,
  betterVimO: app.plugins.plugins.bullet.settings.overrideVimOBehaviour,
  shiki: !!app.plugins.plugins["shiki-highlighter"],
  shikiSettings: app.plugins.plugins["shiki-highlighter"]?.settings,
}));
const fixtures = [
  {
    name: "nested body o",
    text: "- parent\n\t- ```js\n\t  code\n\t  ```\n\t- after",
    line: 2,
    key: "o",
    indent: "\t  ",
  },
  {
    name: "nested body O",
    text: "- parent\n\t- ```js\n\t  code\n\t  ```\n\t- after",
    line: 2,
    key: "O",
    indent: "\t  ",
  },
  {
    name: "root literal marker o",
    text: "```yaml\n- literal\n```",
    line: 1,
    key: "o",
    indent: "",
  },
  {
    name: "root literal marker O",
    text: "```yaml\n- literal\n```",
    line: 1,
    key: "O",
    indent: "",
  },
  {
    name: "nested opening o",
    text: "- parent\n\t- ```js\n\t  code\n\t  ```",
    line: 1,
    key: "o",
    indent: "\t  ",
  },
  {
    name: "nested closing O",
    text: "- parent\n\t- ```js\n\t  code\n\t  ```",
    line: 3,
    key: "O",
    indent: "\t  ",
  },
  {
    name: "tab separator opening o",
    text: "-\t```js\n\tcode\n\t```",
    line: 0,
    key: "o",
    indent: " \t",
  },
  {
    name: "spaced separator opening o",
    text: "-   ```js\n    code\n    ```",
    line: 0,
    key: "o",
    indent: "    ",
  },
  {
    name: "tab separator blank o",
    text: "-\t```js\n\n\t```",
    line: 1,
    key: "o",
    indent: " \t",
  },
  {
    name: "spaced separator blank O",
    text: "-   ```js\n\n    ```",
    line: 1,
    key: "O",
    indent: "    ",
  },
  {
    name: "ordered tab separator opening o",
    text: "12.\t```js\n\tcode\n\t```",
    line: 0,
    key: "o",
    indent: "   \t",
  },
  {
    name: "physical blank body o",
    text: "- parent\n\t- ```js\n\t  code\n\n\t  ```",
    line: 3,
    key: "o",
    indent: "\t  ",
  },
  {
    name: "physical blank body O",
    text: "- parent\n\t- ```js\n\t  code\n\n\t  ```",
    line: 3,
    key: "O",
    indent: "\t  ",
  },
  {
    name: "literal marker nested o",
    text: "- parent\n\t- ```yaml\n\t  - literal\n\t  ```",
    line: 2,
    key: "o",
    indent: "\t  ",
  },
  {
    name: "underindented blank body o",
    text: "- parent\n\t- ```js\n\t\n\t  ```",
    line: 2,
    key: "o",
    indent: "\t  ",
  },
  {
    name: "continuation blank body O",
    text: "- parent\n\t```js\n\n\t```",
    line: 2,
    key: "O",
    indent: "\t",
  },
  {
    name: "code indentation o",
    text: "- parent\n\t- ```js\n\t    code\n\t  ```",
    line: 2,
    key: "o",
    indent: "\t\t",
  },
  {
    name: "continued tilde body o",
    text: "- parent\n\t~~~~yaml\n\t- literal\n\t~~~~",
    line: 2,
    key: "o",
    indent: "\t",
  },
  ...(!process.argv.includes("--native")
    ? [
        {
          name: "ordinary list o",
          text: "- parent\n\t- item\n\t- after",
          line: 1,
          key: "o",
          indent: "\t- ",
        },
        {
          name: "ordinary list O",
          text: "- parent\n\t- item\n\t- after",
          line: 1,
          key: "O",
          indent: "\t- ",
        },
        {
          name: "empty nested list o",
          text: "- parent\n\t- ",
          line: 1,
          key: "o",
          indent: "\t- ",
        },
        {
          name: "empty nested list O",
          text: "- parent\n\t- ",
          line: 1,
          key: "O",
          indent: "\t- ",
        },
        {
          name: "empty ordered list o",
          text: "- parent\n\t1. ",
          line: 1,
          key: "o",
          indent: "\t2. ",
        },
        {
          name: "empty ordered list O",
          text: "- parent\n\t1. ",
          line: 1,
          key: "O",
          indent: "\t1. ",
          expectedOpened: {
            doc: "- parent\n\t1. \n\t2. ",
            cursor: { line: 1, ch: 4 },
          },
          expectedTyped: {
            doc: "- parent\n\t1. x\n\t2. ",
            cursor: { line: 1, ch: 5 },
          },
        },
        {
          name: "empty task list o",
          text: "- parent\n\t- [ ] ",
          line: 1,
          key: "o",
          indent: "\t- [ ] ",
        },
        {
          name: "empty task list O",
          text: "- parent\n\t- [ ] ",
          line: 1,
          key: "O",
          indent: "\t- [ ] ",
        },
        {
          name: "bare empty nested list o",
          text: "- parent\n\t-",
          line: 1,
          key: "o",
          indent: "\t- ",
        },
        {
          name: "bare empty nested list O",
          text: "- parent\n\t-",
          line: 1,
          key: "O",
          indent: "\t- ",
        },
        {
          name: "empty nested list with child o",
          text: "- parent\n\t- \n\t\t- child",
          line: 1,
          key: "o",
          indent: "\t- ",
          expectedOpened: {
            doc: "- parent\n\t- \n\t\t- child\n\t- ",
            cursor: { line: 3, ch: 3 },
          },
          expectedTyped: {
            doc: "- parent\n\t- \n\t\t- child\n\t- x",
            cursor: { line: 3, ch: 4 },
          },
        },
        {
          name: "ordinary list after separated code o",
          text: "- ```js\n  code\n  ```\n\n- item",
          line: 4,
          key: "o",
          indent: "- ",
        },
        {
          name: "ordinary list after separated code O",
          text: "- ```js\n  code\n  ```\n\n- item",
          line: 4,
          key: "O",
          indent: "- ",
        },
        {
          name: "nested closing o creates sibling",
          text: "- parent\n\t- ```js\n\t  code\n\t  ```\n\t- after",
          line: 3,
          key: "o",
          indent: "\t- ",
        },
      ]
    : []),
];
const rootFixtures = [
  {
    name: "root single-space sh opening o",
    text: "- ```sh\n  git remote add upstream origin\n  ```",
    line: 0,
    key: "o",
    indent: "  ",
  },
  {
    name: "heading root single-space sh opening o",
    text: "## 設定\n\n- ```sh\n  git remote add upstream origin\n  ```\n- hello\n\t- hello",
    line: 2,
    key: "o",
    indent: "  ",
  },
];
if (fullNote) {
  const text = [
    "---",
    "title: Verification scratch",
    "tags:",
    "  - bullet",
    "---",
    "",
    "# Verification scratch",
    "",
    "- hello",
    "\t- hello",
    "\t\t- ```js",
    "\t\t  hello",
    "\t\t  hell",
    "\t\t  ```",
    "\t\t\t- hello",
    "\t\t\t\t- ```",
    "\t\t\t\t  hello",
    "\t\t\t\t      hello",
    "\t\t\t\t  ```",
    "",
    "## 設定",
    "",
    "- ```sh",
    "  git remote add upstream <upstream-repository-url>",
    "  git remote set-url upstream --push NO-PUSH",
    "  but pull --check",
    "  but config target upstream/main --push-remote origin # but config target upstream/master --push-remote origin",
    "  ```",
    "- hello",
    "\t- hello",
  ].join("\n");
  rootFixtures.push({
    name: "reconstructed full note root sh opening o",
    text,
    line: text.split("\n").indexOf("- ```sh"),
    key: "o",
    indent: "  ",
  });
}
const modes = rootOpening ? ["native", "shiki", "numbers"] : ["original"];
const results = [],
  failures = [];
function keypress(key) {
  evaluate(() => {
    window.focus();
    if (!document.title.includes("vault") || document.title.includes("base"))
      throw Error("Wrong vault window");
    app.workspace.activeLeaf.view.editor.focus();
  });
  const code = key === "Escape" ? "Escape" : "KeyO";
  const windowsVirtualKeyCode = key === "Escape" ? 27 : 79;
  const modifiers = key === "O" ? 8 : 0;
  cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    windowsVirtualKeyCode,
    modifiers,
  });
  cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode,
    modifiers,
  });
}
function screenshot(name) {
  const file = path.join(output, `${name}.png`);
  fs.writeFileSync(
    file,
    Buffer.from(
      cdp("Page.captureScreenshot", { format: "png" }).data,
      "base64",
    ),
  );
  return file;
}
function sample(painted = false, typed = false) {
  return evaluate(
    async (painted, typed) => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      const view = app.workspace.activeLeaf.view;
      await view.save();
      const result = {
        doc: view.editor.getValue(),
        cursor: view.editor.getCursor(),
        saved: await app.vault.read(view.file),
      };
      if (!painted) return result;
      result.trace = JSON.parse(
        JSON.stringify(
          window.__vimCodeTrace ?? { events: [], transactions: [] },
        ),
      );
      const cm = view.editor.cm;
      const rect = (bounds) =>
        bounds && {
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
          width: bounds.width,
          height: bounds.height,
        };
      const glyphAt = (from, to) => {
        const start = cm.domAtPos(from);
        const end = cm.domAtPos(to);
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        return rect(range.getBoundingClientRect());
      };
      const cursors = (selector) =>
        [...cm.dom.querySelectorAll(selector)].map((element) => ({
          bounds: rect(element.getBoundingClientRect()),
          display: getComputedStyle(element).display,
          visibility: getComputedStyle(element).visibility,
          opacity: getComputedStyle(element).opacity,
          className: element.className,
        }));
      const selection = document.getSelection();
      const head = cm.state.selection.main.head;
      const nextLine = cm.state.doc.line(result.cursor.line + 2);
      const firstCode = nextLine.text.search(/\S/);
      const reference =
        firstCode < 0
          ? null
          : glyphAt(nextLine.from + firstCode, nextLine.from + firstCode + 1);
      const vim = cm.cm?.state?.vim;
      const atCursor = cm.domAtPos(head).node;
      const activeLine = (
        atCursor.nodeType === Node.ELEMENT_NODE
          ? atCursor
          : atCursor.parentElement
      )?.closest(".cm-line");
      const lineStyle = activeLine && getComputedStyle(activeLine);
      result.paint = {
        fontSize: app.getBaseFontSize(),
        theme: document.body.classList.contains("theme-light")
          ? "light"
          : "dark",
        activeLine: activeLine && {
          classes: activeLine.className,
          style: activeLine.getAttribute("style"),
          bounds: rect(activeLine.getBoundingClientRect()),
          blockInset: lineStyle.getPropertyValue(
            "--bullet-nested-code-block-inset",
          ),
          cursorOffset: lineStyle.getPropertyValue(
            "--bullet-code-cursor-offset",
          ),
          afterInlineSize: getComputedStyle(activeLine, "::after").inlineSize,
          caretColor: lineStyle.caretColor,
        },
        contentDOM: {
          classes: cm.contentDOM.className,
          style: cm.contentDOM.getAttribute("style"),
          bounds: rect(cm.contentDOM.getBoundingClientRect()),
          caretColor: getComputedStyle(cm.contentDOM).caretColor,
        },
        customCursors: cursors(".cm-cursorLayer .cm-cursor-primary"),
        vimCursors: cursors(".cm-vimCursorLayer .cm-cursor-primary"),
        allCursors: cursors(".cm-cursor-primary"),
        nativeSelection: selection?.rangeCount
          ? rect(selection.getRangeAt(0).getBoundingClientRect())
          : null,
        referenceGlyph: reference,
        typedGlyph: typed ? glyphAt(head - 1, head) : null,
        expectedCaretX: typed
          ? glyphAt(head - 1, head)?.right
          : reference?.left,
        vim: {
          configured: app.vault.config.vimMode,
          enabled: app.isVimEnabled(),
          insertMode: vim?.insertMode,
          visualMode: vim?.visualMode,
          status: cm.dom.querySelector(".cm-vim-panel")?.textContent,
        },
        bulletSettings: {
          overrideVimOBehaviour:
            app.plugins.plugins.bullet.settings.overrideVimOBehaviour,
          betterListsStyles:
            app.plugins.plugins.bullet.settings.betterListsStyles,
          keepCursorWithinContent:
            app.plugins.plugins.bullet.settings.keepCursorWithinContent,
        },
        shikiSettings: {
          enabled: !!app.plugins.plugins["shiki-highlighter"],
          ecDefaultShowLineNumbers:
            app.plugins.plugins["shiki-highlighter"]?.settings
              ?.ecDefaultShowLineNumbers,
          ecDefaultFrame:
            app.plugins.plugins["shiki-highlighter"]?.settings?.ecDefaultFrame,
        },
        frameMode:
          app.plugins.plugins["shiki-highlighter"]?.loadedSettings
            ?.ecDefaultFrame ??
          app.plugins.plugins["shiki-highlighter"]?.settings?.ecDefaultFrame ??
          "native",
        frames: [...cm.dom.querySelectorAll("figure.frame")].map(
          (element) => element.className,
        ),
      };
      return result;
    },
    painted,
    typed,
  );
}
function assertPaint(sample, phase) {
  const { paint } = sample;
  const candidates = paint.customCursors.length
    ? paint.customCursors
    : paint.allCursors;
  const cursor = candidates.find(
    ({ bounds, display, visibility }) =>
      bounds.height > 0 && display !== "none" && visibility !== "hidden",
  );
  const bounds = cursor?.bounds ?? paint.nativeSelection;
  paint.assertedCaretSource = cursor ? "cm-cursor-primary" : "native selection";
  assert.ok(
    bounds?.height > 0,
    `${phase}: painted or native caret bounds must exist`,
  );
  assert.ok(
    Number.isFinite(paint.expectedCaretX),
    `${phase}: reference glyph must exist`,
  );
  assert.ok(
    Math.abs(bounds.left - paint.expectedCaretX) <= 2,
    `${phase}: painted caret X ${bounds.left} must align with code glyph X ${paint.expectedCaretX}`,
  );
}

try {
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  evaluate(
    async (note, native, light, fontSize) => {
      if (fontSize !== null) app.setBaseFontSize(fontSize);
      if (light) {
        document.body.classList.remove("theme-dark");
        document.body.classList.add("theme-light");
      }
      app.plugins.plugins.bullet.settings.overrideVimOBehaviour = !native;
      app.vault.setConfig("vimMode", true);
      app.workspace.updateOptions();
      window.__vimCodeLeaf = app.workspace.getLeaf("tab");
      await window.__vimCodeLeaf.openFile(await app.vault.create(note, ""));
    },
    note,
    process.argv.includes("--native"),
    light,
    fontSize,
  );
  if (editorShortcuts)
    evaluate(() => {
      const vim = window.CodeMirrorAdapter?.Vim;
      if (!vim?.defineEx || !vim.map || !vim.unmap)
        throw Error("Vim mapping API missing");
      const commands = {
        blankBelow: "obsidian-editor-shortcuts:insertLineBelow",
        blankAbove: "obsidian-editor-shortcuts:insertLineAbove",
      };
      for (const [name, command] of Object.entries(commands)) {
        if (!app.commands.commands[command])
          throw Error(`Missing command ${command}`);
        vim.defineEx(name, name, () => {
          window.__vimCodeTrace?.events.push({
            type: "ex",
            command,
            time: performance.now(),
          });
          app.commands.executeCommandById(command);
        });
      }
      window.__vimCodeMappingCleanup = () => {
        for (const key of ["o", "O", "&a&", "&b&"]) vim.unmap(key, "normal");
        const settings = app.plugins.plugins.bullet.settings;
        settings.overrideVimOBehaviour = false;
        settings.overrideVimOBehaviour = true;
        delete window.__vimCodeMappingCleanup;
      };
      vim.map("&a&", ":blankAbove<CR>", "normal");
      vim.map("&b&", ":blankBelow<CR>", "normal");
      vim.map("o", "&b&i", "normal");
      vim.map("O", "&a&i", "normal");
    });
  if (rootOpening && !original.shikiSettings) {
    original.shikiSettings = evaluate(async () => {
      const id = "shiki-highlighter";
      await app.plugins.loadManifest(".obsidian/plugins/shiki-highlighter");
      if (!app.plugins.manifests[id])
        throw Error("Install Shiki in test vault");
      if (!app.plugins.plugins[id]) await app.plugins.enablePlugin(id);
      return { ...app.plugins.plugins[id].settings };
    });
  }
  for (const mode of modes) {
    if (mode !== "original")
      evaluate(async (mode) => {
        const id = "shiki-highlighter";
        if (mode === "native") await app.plugins.disablePlugin(id);
        else {
          await app.plugins.loadManifest(".obsidian/plugins/shiki-highlighter");
          if (!app.plugins.manifests[id])
            throw Error("Install Shiki in test vault");
          if (!app.plugins.plugins[id]) await app.plugins.enablePlugin(id);
          app.plugins.plugins[id].settings.ecDefaultShowLineNumbers =
            mode === "numbers";
          await app.plugins.plugins[id].reloadHighlighter();
        }
      }, mode);
    for (const fixture of rootOpening ? rootFixtures : fixtures) {
      keypress("Escape");
      evaluate(async (fixture) => {
        window.__vimCodeTraceCleanup?.();
        const editor = app.workspace.activeLeaf.view.editor;
        editor.setValue(fixture.text);
        editor.setCursor({
          line: fixture.line,
          ch: Math.max(0, editor.getLine(fixture.line).length - 1),
        });
        editor.focus();
        await new Promise((resolve) => setTimeout(resolve, 120));
      }, fixture);
      if (rootOpening)
        evaluate(() => {
          const cm = app.workspace.activeLeaf.view.editor.cm;
          const trace = { events: [], transactions: [] };
          window.__vimCodeTrace = trace;
          const onEvent = (event) =>
            trace.events.push({
              type: event.type,
              key: event.key,
              data: event.data,
              inputType: event.inputType,
              time: performance.now(),
              target: event.target?.className,
            });
          const names = ["keydown", "keyup", "beforeinput", "input"];
          for (const name of names)
            cm.dom.addEventListener(name, onEvent, true);
          const dispatch = cm.dispatchTransactions;
          if (typeof dispatch !== "function")
            throw Error("CodeMirror dispatchTransactions missing");
          cm.dispatchTransactions = function (transactions, view) {
            for (const transaction of transactions) {
              if (transaction.docChanged)
                trace.transactions.push({
                  time: performance.now(),
                  before: transaction.startState.doc.toString(),
                  after: transaction.newDoc.toString(),
                  changes: transaction.changes.toJSON(),
                  selection: transaction.newSelection.toJSON(),
                  userEvents: [
                    "input",
                    "input.type",
                    "input.type.compose",
                    "delete",
                    "select",
                    "undo",
                    "redo",
                    "set",
                  ].filter((event) => transaction.isUserEvent(event)),
                });
            }
            return dispatch.call(this, transactions, view);
          };
          window.__vimCodeTraceCleanup = () => {
            cm.dispatchTransactions = dispatch;
            for (const name of names)
              cm.dom.removeEventListener(name, onEvent, true);
            delete window.__vimCodeTrace;
            delete window.__vimCodeTraceCleanup;
          };
        });
      const capture = `${mode}-${fixture.name.replaceAll(" ", "-")}`;
      const before = rootOpening ? sample(true) : null;
      if (before) {
        assert.equal(
          before.doc,
          fixture.text,
          `${fixture.name}: setup document`,
        );
        assert.deepEqual(
          before.cursor,
          {
            line: fixture.line,
            ch: Math.max(0, fixture.text.split("\n")[fixture.line].length - 1),
          },
          `${fixture.name}: setup cursor`,
        );
      }
      const screenshots = rootOpening
        ? { before: screenshot(`${capture}-before`) }
        : null;
      keypress(fixture.key);
      const opened = sample(rootOpening);
      if (rootOpening) screenshots.opened = screenshot(`${capture}-opened`);
      evaluate(() => {
        window.focus();
        if (
          !document.title.includes("vault") ||
          document.title.includes("base")
        )
          throw Error("Wrong vault window");
      });
      cdp("Input.insertText", { text: "x" });
      const typed = sample(rootOpening, true);
      if (rootOpening) screenshots.typed = screenshot(`${capture}-typed`);
      const line = fixture.line + (fixture.key === "o" ? 1 : 0);
      const lines = fixture.text.split("\n");
      lines.splice(line, 0, fixture.indent);
      const defaultOpened = {
        doc: lines.join("\n"),
        cursor: { line, ch: fixture.indent.length },
      };
      lines[line] += "x";
      const defaultTyped = {
        doc: lines.join("\n"),
        cursor: { line, ch: fixture.indent.length + 1 },
      };
      const expectedOpened = fixture.expectedOpened ?? defaultOpened;
      const expectedTyped = fixture.expectedTyped ?? defaultTyped;
      results.push({
        name: fixture.name,
        mode,
        before,
        screenshots,
        opened,
        typed,
        expectedOpened,
        expectedTyped,
      });
      try {
        const openedState = {
          doc: opened.doc,
          cursor: opened.cursor,
          saved: opened.saved,
        };
        const typedState = {
          doc: typed.doc,
          cursor: typed.cursor,
          saved: typed.saved,
        };
        assert.deepEqual(openedState, {
          ...expectedOpened,
          saved: expectedOpened.doc,
        });
        assert.deepEqual(typedState, {
          ...expectedTyped,
          saved: expectedTyped.doc,
        });
        if (rootOpening) {
          assertPaint(opened, "after o");
          assertPaint(typed, "after x");
        }
      } catch (error) {
        failures.push(`${mode}, ${fixture.name}: ${error.message}`);
      }
    }
  }
} finally {
  keypress("Escape");
  evaluate(
    async (original, note, rootOpening) => {
      window.__vimCodeTraceCleanup?.();
      window.__vimCodeMappingCleanup?.();
      window.__vimCodeLeaf?.detach();
      delete window.__vimCodeLeaf;
      app.setBaseFontSize(original.fontSize);
      document.body.classList.toggle("theme-dark", original.dark);
      document.body.classList.toggle("theme-light", original.light);
      app.vault.setConfig("vimMode", original.vimMode);
      app.plugins.plugins.bullet.settings.overrideVimOBehaviour =
        original.betterVimO;
      app.workspace.updateOptions();
      if (rootOpening) {
        const id = "shiki-highlighter";
        if (original.shikiSettings) {
          if (!app.plugins.plugins[id]) await app.plugins.enablePlugin(id);
          app.plugins.plugins[id].settings = original.shikiSettings;
          await app.plugins.plugins[id].reloadHighlighter();
        }
        if (!original.shiki) await app.plugins.disablePlugin(id);
      }
      const leaf = app.workspace.getLeafById(original.leaf);
      if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
      const file = app.vault.getAbstractFileByPath(note);
      if (file) await app.vault.trash(file, true);
    },
    original,
    note,
    rootOpening,
  );
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(
      {
        options: { rootOpening, fullNote, editorShortcuts, light, fontSize },
        results,
        failures,
      },
      null,
      2,
    ),
  );
}
console.log(
  JSON.stringify({ output, cases: results.length, failures }, null, 2),
);
assert.equal(
  failures.length,
  0,
  "Vim code newlines must preserve code indentation and literal input",
);
