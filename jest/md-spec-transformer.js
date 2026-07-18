function isHeader(line) {
  return line.startsWith("# ");
}

function isAction(line) {
  return line.startsWith("- ");
}

function getCodeFenceLength(line) {
  const match = /^(`{3,})(?:[^`]*)$/.exec(line);
  return match ? match[1].length : null;
}

function isCodeBlock(line) {
  return getCodeFenceLength(line) !== null;
}

function isClosingCodeBlock(line, openingFenceLength) {
  const match = /^(`{3,})\s*$/.exec(line);
  return Boolean(match && match[1].length >= openingFenceLength);
}

function parseState(l) {
  const openingFenceLength = getCodeFenceLength(l.line);
  if (openingFenceLength === null) {
    throw new Error(
      `parseState: Unexpected line "${l.line}", expected "\`\`\`"`
    );
  }

  const lines = [];

  while (true) {
    l.next();

    if (l.isEnded()) {
      throw new Error(`parseState: Unexpected EOF, expected "\`\`\`"`);
    } else if (isClosingCodeBlock(l.line, openingFenceLength)) {
      l.nextNotEmpty();
      return {
        lines,
      };
    } else {
      lines.push(l.line);
    }
  }
}

function parseApplyState(l) {
  l.nextNotEmpty();

  return {
    type: "applyState",
    state: parseState(l),
  };
}

function parseAssertState(l) {
  l.nextNotEmpty();

  return {
    type: "assertState",
    state: parseState(l),
  };
}

function parseAssertStateOneOf(l) {
  const states = [];

  l.nextNotEmpty();

  while (!l.isEnded() && isCodeBlock(l.line)) {
    states.push(parseState(l));
  }

  if (states.length === 0) {
    throw new Error("parseAssertStateOneOf: Expected at least one state");
  }

  return {
    type: "assertStateOneOf",
    states,
  };
}

function parseSimulateKeydown(l) {
  const key = l.line.replace(/- keydown: `([^`]+)`/, "$1");

  l.nextNotEmpty();

  return {
    type: "simulateKeydown",
    key,
  };
}

function parsePlatform(l) {
  const platform = l.line.replace(/- platform: `([^`]+)`/, "$1");

  l.nextNotEmpty();

  return {
    type: "platform",
    platform,
  };
}

function parseDrag(l) {
  const { from } = JSON.parse(l.line.replace(/- drag: `([^`]+)`/, "$1"));

  l.nextNotEmpty();

  return {
    type: "drag",
    from,
  };
}

function parseClickGuide(l) {
  const options = JSON.parse(l.line.replace(/^- clickGuide:\s*/, ""));

  l.nextNotEmpty();

  return {
    type: "clickGuide",
    options,
  };
}

function parseAssertNativeListBullet(l) {
  const options = JSON.parse(
    l.line.replace(/^- assertNativeListBullet:\s*/, "")
  );

  l.nextNotEmpty();

  return {
    type: "assertNativeListBullet",
    options,
  };
}

function parseMove(l) {
  const { to, offsetX, offsetY } = JSON.parse(
    l.line.replace(/- move: `([^`]+)`/, "$1")
  );

  l.nextNotEmpty();

  return {
    type: "move",
    to,
    offsetX: offsetX || 0,
    offsetY: offsetY || 0,
  };
}

function parseDrop(l) {
  l.nextNotEmpty();

  return {
    type: "drop",
  };
}

function parseAdjustSelection(l) {
  l.nextNotEmpty();

  return {
    type: "adjustSelection",
  };
}

function parseInsertText(l) {
  const text = l.line.replace(/- insertText: `([^`]+)`/, "$1");

  l.nextNotEmpty();

  return {
    type: "insertText",
    text,
  };
}

function parseTextAction(l, type) {
  const source = l.line.replace(new RegExp(`^- ${type}:\\s*`), "");
  const backtickMatch = /^`([^`]*)`$/.exec(source);
  let text;

  if (backtickMatch) {
    text = backtickMatch[1];
  } else {
    text = JSON.parse(source);
    if (typeof text !== "string") {
      throw new Error(`${type}: Expected a string`);
    }
  }

  l.nextNotEmpty();

  return { type, text };
}

function parseExecuteCommandById(l) {
  const command = l.line.replace(/- execute: `([^`]+)`/, "$1");

  l.nextNotEmpty();

  return {
    type: "executeCommandById",
    command,
  };
}

function parseSetSetting(l) {
  const [k, v] = l.line.replace(/- setting: `([^`]+)`/, "$1").split("=", 2);

  l.nextNotEmpty();

  return {
    type: "setSetting",
    k,
    v: JSON.parse(v),
  };
}

function parseAction(l) {
  if (!isAction(l.line)) {
    throw new Error(
      `parseAction: Unexpected line "${l.line}", expected ACTION`
    );
  }

  if (l.line.startsWith("- applyState:")) {
    return parseApplyState(l);
  } else if (l.line.startsWith("- keydown:")) {
    return parseSimulateKeydown(l);
  } else if (l.line.startsWith("- insertText:")) {
    return parseInsertText(l);
  } else if (l.line.startsWith("- typeText:")) {
    return parseTextAction(l, "typeText");
  } else if (l.line.startsWith("- pasteText:")) {
    return parseTextAction(l, "pasteText");
  } else if (l.line.startsWith("- execute:")) {
    return parseExecuteCommandById(l);
  } else if (l.line.startsWith("- setting:")) {
    return parseSetSetting(l);
  } else if (l.line.startsWith("- assertStateOneOf:")) {
    return parseAssertStateOneOf(l);
  } else if (l.line.startsWith("- assertState:")) {
    return parseAssertState(l);
  } else if (l.line.startsWith("- platform:")) {
    return parsePlatform(l);
  } else if (l.line.startsWith("- drag:")) {
    return parseDrag(l);
  } else if (l.line.startsWith("- clickGuide:")) {
    return parseClickGuide(l);
  } else if (l.line.startsWith("- assertNativeListBullet:")) {
    return parseAssertNativeListBullet(l);
  } else if (l.line.startsWith("- move:")) {
    return parseMove(l);
  } else if (l.line.startsWith("- drop")) {
    return parseDrop(l);
  } else if (l.line.startsWith("- adjustSelection")) {
    return parseAdjustSelection(l);
  }

  throw new Error(`parseAction: Unknown action "${l.line}"`);
}

function parseTest(l) {
  if (!isHeader(l.line)) {
    throw new Error(`parseTest: Unexpected line "${l.line}", expected HEADER`);
  }

  const title = l.line.replace(/^# /, "").trim();
  const actions = [];

  l.nextNotEmpty();

  while (!l.isEnded() && !isHeader(l.line)) {
    actions.push(parseAction(l));
  }

  return {
    title,
    actions,
  };
}

function parseTests(l) {
  l.nextNotEmpty();

  const tests = [];

  while (!l.isEnded()) {
    tests.push(parseTest(l));
  }

  return tests;
}

class LinesIterator {
  constructor(lines) {
    this.i = -1;
    this.lines = lines;
    this.len = this.lines.length;
  }

  get line() {
    return this.lines[this.i];
  }

  isEnded() {
    return this.i >= this.len;
  }

  nextNotEmpty() {
    do {
      this.i++;
    } while (!this.isEnded() && this.line.trim() === "");
  }

  next() {
    this.i++;
  }
}

const currentPlatform = process.platform;

module.exports.process = function process(sourceText, sourcePath, options) {
  const l = new LinesIterator(sourceText.split("\n"));
  const s = (v) => JSON.stringify(v);

  const name = sourcePath.replace(options.config.cwd + "/", "");

  let code = "";
  code += `jest.setTimeout(15000);\n`;
  code += `describe(${s(name)}, () => {\n`;

  for (const test of parseTests(l)) {
    const platform = test.actions.find((a) => a.type === "platform");
    const testFn =
      platform && currentPlatform !== platform.platform ? "test.skip" : "test";

    code += `  ${testFn}(${s(test.title)}, async () => {\n`;
    code += `    await resetSettings();\n`;

    for (const action of test.actions) {
      switch (action.type) {
        case "applyState":
          code += `    await applyState(${s(action.state.lines)});\n`;
          break;
        case "simulateKeydown":
          code += `    await simulateKeydown(${s(action.key)});\n`;
          break;
        case "insertText":
          code += `    await insertText(${s(action.text)});\n`;
          break;
        case "typeText":
          code += `    await typeText(${s(action.text)});\n`;
          break;
        case "pasteText":
          code += `    await pasteText(${s(action.text)});\n`;
          break;
        case "executeCommandById":
          code += `    await executeCommandById(${s(action.command)});\n`;
          break;
        case "setSetting":
          code += `    await setSetting(${s({ k: action.k, v: action.v })});\n`;
          break;
        case "drag":
          code += `    await drag(${s({ from: action.from })});\n`;
          break;
        case "clickGuide":
          code += `    await clickGuide(${s(action.options)});\n`;
          break;
        case "assertNativeListBullet":
          code += `    await assertNativeListBullet(${s(action.options)});\n`;
          break;
        case "move":
          code += `    await move(${s({
            to: action.to,
            offsetX: action.offsetX,
            offsetY: action.offsetY,
          })});`;
          break;
        case "drop":
          code += "    await drop();\n";
          break;
        case "adjustSelection":
          code += "    await adjustSelection();\n";
          break;
        case "assertState":
          code += `    await waitForIdle();\n`;
          code += `    await expect(await getCurrentState()).toEqualEditorState(${s(
            action.state.lines
          )});\n`;
          break;
        case "assertStateOneOf":
          code += `    await waitForIdle();\n`;
          code += `    const currentState = await getCurrentState();\n`;
          code += `    const expectedStates = ${s(
            action.states.map((state) => state.lines)
          )};\n`;
          code += `    let lastStateError = null;\n`;
          code += `    let stateMatched = false;\n`;
          code += `    for (const expectedState of expectedStates) {\n`;
          code += `      try {\n`;
          code += `        await expect(currentState).toEqualEditorState(expectedState);\n`;
          code += `        stateMatched = true;\n`;
          code += `        break;\n`;
          code += `      } catch (error) {\n`;
          code += `        lastStateError = error;\n`;
          code += `      }\n`;
          code += `    }\n`;
          code += `    if (!stateMatched) throw lastStateError;\n`;
          break;
      }
    }

    code += `  });\n`;
  }

  code += `});\n`;

  return {
    code,
  };
};
