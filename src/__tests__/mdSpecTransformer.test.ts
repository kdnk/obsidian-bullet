import { runInNewContext } from "node:vm";

const transformer = jest.requireActual<{
  process: (
    source: string,
    path: string,
    options: { config: { cwd: string } },
  ) => { code: string };
}>("../../jest/md-spec-transformer");

function executeSpec(source: string, currentStates: string[][] = []) {
  const callbacks: (() => Promise<void>)[] = [];
  const applyState = jest.fn();
  const simulateKeydown = jest.fn();
  const typeText = jest.fn();
  const setSetting = jest.fn();
  const assertions = jest.fn((actual: string[], expected: string[]) => {
    expect(actual).toEqual(expected);
  });
  let stateIndex = 0;
  const { code } = transformer.process(source, "/repo/specs/example.spec.md", {
    config: { cwd: "/repo" },
  });

  runInNewContext(code, {
    jest: { setTimeout: jest.fn() },
    describe: (_title: string, callback: () => void) => callback(),
    test: (_title: string, callback: () => Promise<void>) => {
      callbacks.push(callback);
    },
    resetSettings: jest.fn(),
    waitForIdle: jest.fn(),
    applyState,
    simulateKeydown,
    typeText,
    setSetting,
    getCurrentState: () => currentStates[stateIndex++],
    expect: (actual: string[]) => ({
      toEqualEditorState: (expected: string[]) => assertions(actual, expected),
    }),
  });

  return {
    applyState,
    simulateKeydown,
    typeText,
    setSetting,
    assertions,
    run: async () => {
      for (const callback of callbacks) await callback();
    },
  };
}

describe("Markdown spec execution", () => {
  test("runs repeated alternative-state assertions independently", async () => {
    const spec = executeSpec(
      [
        "# repeated assertions",
        "- assertStateOneOf:",
        "```",
        "- first|",
        "```",
        "```",
        "- second|",
        "```",
        "- assertStateOneOf:",
        "```",
        "- third|",
        "```",
      ].join("\n"),
      [["- second|"], ["- third|"]],
    );

    await spec.run();

    expect(spec.assertions.mock.calls).toEqual([
      [["- second|"], ["- first|"]],
      [["- second|"], ["- second|"]],
      [["- third|"], ["- third|"]],
    ]);
  });

  test("fails when none of the alternative states match", async () => {
    const spec = executeSpec(
      [
        "# no matching state",
        "- assertStateOneOf:",
        "```",
        "- first|",
        "```",
        "```",
        "- second|",
        "```",
      ].join("\n"),
      [["- unexpected|"]],
    );

    await expect(spec.run()).rejects.toThrow();
    expect(spec.assertions.mock.calls).toEqual([
      [["- unexpected|"], ["- first|"]],
      [["- unexpected|"], ["- second|"]],
    ]);
  });

  test.each(["\n", "\r\n"])(
    "preserves fixture lines and action arguments with %j line endings",
    async (lineEnding) => {
      const spec = executeSpec(
        [
          "# line endings",
          "- applyState:",
          "````md",
          "- parent",
          "\t- child|  ",
          "",
          "```",
          "````",
          "- keydown: `Enter`",
          "- typeText: `child`",
          "- assertState:",
          "```",
          "- result|",
          "```",
        ].join(lineEnding),
        [["- result|"]],
      );

      await spec.run();

      expect(spec.applyState.mock.calls).toEqual([
        [["- parent", "\t- child|  ", "", "```"]],
      ]);
      expect(spec.simulateKeydown.mock.calls).toEqual([["Enter"]]);
      expect(spec.typeText.mock.calls).toEqual([["child"]]);
      expect(spec.assertions.mock.calls).toEqual([
        [["- result|"], ["- result|"]],
      ]);
    },
  );

  test("removes CRLF terminators from fixture content", async () => {
    const spec = executeSpec(
      ["# fixture", "- applyState:", "```", "- item|  ", "", "```"].join(
        "\r\n",
      ),
    );

    await spec.run();

    expect(spec.applyState.mock.calls).toEqual([[["- item|  ", ""]]]);
  });

  test.each([true, 4, "a=b=c", { expression: "x=y" }])(
    "preserves the complete JSON setting value %j",
    async (value) => {
      const spec = executeSpec(
        ["# setting", `- setting: \`example=${JSON.stringify(value)}\``].join(
          "\n",
        ),
      );

      await spec.run();

      expect(spec.setSetting.mock.calls).toEqual([
        [{ k: "example", v: value }],
      ]);
    },
  );

  test("rejects setting values without an assignment", () => {
    expect(() => executeSpec("# setting\n- setting: `true`")).toThrow();
  });
});
