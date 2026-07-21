import { COMMANDS, installObsidianDriver } from "../../jest/obsidian-driver";
import { semanticDriverCommandNames } from "../../jest/semantic-command-contract";
import {
  TEST_VAULT_APP_CONFIG,
  getTestPluginId,
  getVaultPluginDir,
} from "../../jest/test-config";

const mdSpecTransformer = jest.requireActual<{
  process: (
    sourceText: string,
    sourcePath: string,
    options: { config: { cwd: string } },
  ) => { code: string };
}>("../../jest/md-spec-transformer");

describe("test config helpers", () => {
  const rendererRequestCommands = [...semanticDriverCommandNames];

  test("uses the manifest plugin id for the vault plugin directory", () => {
    expect(getTestPluginId()).toBe("bullet");
    expect(getVaultPluginDir("/tmp/vault")).toBe(
      "/tmp/vault/.obsidian/plugins/bullet",
    );
  });

  test("uses tabs with a four-column width in the test vault", () => {
    expect(TEST_VAULT_APP_CONFIG).toMatchObject({
      useTab: true,
      tabSize: 4,
    });
  });

  test("keeps the exact renderer request-command registry", () => {
    expect(readRendererCommandNames()).toEqual(rendererRequestCommands);
  });

  test("reads quoted and statically computed renderer command names", () => {
    const source = `
      const testCommandDecoders = {
        "quotedCommand": decodeQuoted,
        ["computedCommand"]: decodeComputed,
      } satisfies TestCommandDecoders;
    `;

    expect(readRendererCommandNames(source)).toEqual([
      "computedCommand",
      "quotedCommand",
    ]);
  });

  test.each([
    [
      "spread",
      `const testCommandDecoders = { ...extraDecoders } satisfies TestCommandDecoders;`,
    ],
    [
      "dynamic computed property",
      `const testCommandDecoders = { [commandName]: decode } satisfies TestCommandDecoders;`,
    ],
  ])("rejects a renderer registry %s", (_description, source) => {
    expect(() => readRendererCommandNames(source)).toThrow(
      "Unsupported renderer test command registry member",
    );
  });

  test("keeps the exact semantic driver global declarations", () => {
    expect(readDeclaredGlobalCommandNames()).toEqual(rendererRequestCommands);
  });

  test("installs and forwards the exact semantic Obsidian driver registry", async () => {
    const target: Record<string, unknown> = {};
    const runCommand = jest.fn();

    installObsidianDriver(target, runCommand);

    expect([...COMMANDS].sort()).toEqual(rendererRequestCommands);
    expect(Object.keys(target).sort()).toEqual(rendererRequestCommands);

    for (const command of rendererRequestCommands) {
      const method = target[command];
      expect(method).toEqual(expect.any(Function));
      const data = { command };
      await (method as (value: unknown) => Promise<unknown>)(data);
    }
    expect(runCommand.mock.calls).toEqual(
      rendererRequestCommands.map((command) => [command, { command }]),
    );
  });

  test("transforms a clickGuide Markdown action", () => {
    const source = [
      "# clicks an indent guide",
      "",
      '- clickGuide: {"line":2,"kind":"indent","prefix":"  "}',
    ].join("\n");

    const { code } = mdSpecTransformer.process(
      source,
      "/repo/specs/click-guide.spec.md",
      { config: { cwd: "/repo" } },
    );

    expect(code).toContain(
      'await clickGuide({"line":2,"kind":"indent","prefix":"  "});',
    );
  });

  test("transforms an assertNativeListBullet Markdown action", () => {
    const source = [
      "# checks a native marker",
      "",
      '- assertNativeListBullet: {"line":2}',
    ].join("\n");

    const { code } = mdSpecTransformer.process(
      source,
      "/repo/specs/native-list-bullet.spec.md",
      { config: { cwd: "/repo" } },
    );

    expect(code).toContain('await assertNativeListBullet({"line":2});');
  });

  test("transforms annotated text actions from the real typing spec", () => {
    const fs = jest.requireActual<typeof import("node:fs")>("node:fs");
    const path = jest.requireActual<typeof import("node:path")>("node:path");
    const sourcePath = path.resolve(
      __dirname,
      "../../specs/features/BulletTypingGuard.spec.md",
    );
    const source = fs.readFileSync(sourcePath, "utf8");

    const { code } = mdSpecTransformer.process(source, sourcePath, {
      config: { cwd: path.resolve(__dirname, "../..") },
    });

    expect(code).toContain('await typeText("a");');
    expect(code).toContain('await pasteText("pasted");');
    expect(code).toContain('await typeText("`");');
    expect(code).toContain('await typeText("");');
    expect(code).toContain(
      [
        '    await typeText("-");',
        '    await typeText("-");',
        '    await typeText("-");',
      ].join("\n"),
    );
    expect(code).toContain(
      [
        '    await typeText("`");',
        '    await typeText("`");',
        '    await typeText("`");',
      ].join("\n"),
    );
  });

  test("preserves shorter Markdown fences inside a longer state fence", () => {
    const source = [
      "# types inside a fenced block",
      "",
      "- applyState:",
      "",
      "````md",
      "```",
      "cod|",
      "```",
      "````",
    ].join("\n");

    const { code } = mdSpecTransformer.process(
      source,
      "/repo/specs/fenced-state.spec.md",
      { config: { cwd: "/repo" } },
    );

    expect(code).toContain('await applyState(["```","cod|","```"]);');
  });
});

function readRendererCommandNames(sourceText?: string): string[] {
  const source = jest.requireActual<typeof import("typescript")>("typescript");
  const fs = jest.requireActual<typeof import("node:fs")>("node:fs");
  const path = jest.requireActual<typeof import("node:path")>("node:path");
  const filePath = path.resolve(
    __dirname,
    "../ObsidianBulletPluginWithTests.ts",
  );
  const sourceFile = source.createSourceFile(
    filePath,
    sourceText ?? fs.readFileSync(filePath, "utf8"),
    source.ScriptTarget.Latest,
    true,
  );
  const declaration = sourceFile.statements.find(
    (statement): statement is import("typescript").VariableStatement =>
      source.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (candidate) =>
          source.isIdentifier(candidate.name) &&
          candidate.name.text === "testCommandDecoders",
      ),
  );
  const initializer = declaration?.declarationList.declarations.find(
    (candidate) =>
      source.isIdentifier(candidate.name) &&
      candidate.name.text === "testCommandDecoders",
  )?.initializer;
  const objectLiteral =
    initializer && source.isSatisfiesExpression(initializer)
      ? initializer.expression
      : initializer;

  if (!objectLiteral || !source.isObjectLiteralExpression(objectLiteral)) {
    throw new Error("Unable to inspect renderer test command registry");
  }

  return objectLiteral.properties
    .map((property) => {
      if (source.isSpreadAssignment(property) || !property.name) {
        throw new Error(
          "Unsupported renderer test command registry member: expected a statically named property",
        );
      }

      const name = property.name;
      if (
        source.isIdentifier(name) ||
        source.isStringLiteral(name) ||
        source.isNumericLiteral(name)
      ) {
        return name.text;
      }
      if (source.isComputedPropertyName(name)) {
        const expression = name.expression;
        if (
          source.isStringLiteral(expression) ||
          source.isNumericLiteral(expression) ||
          source.isNoSubstitutionTemplateLiteral(expression)
        ) {
          return expression.text;
        }
      }

      throw new Error(
        "Unsupported renderer test command registry member: expected a statically named property",
      );
    })
    .sort();
}

function readDeclaredGlobalCommandNames(): string[] {
  const source = jest.requireActual<typeof import("typescript")>("typescript");
  const fs = jest.requireActual<typeof import("node:fs")>("node:fs");
  const path = jest.requireActual<typeof import("node:path")>("node:path");
  const filePath = path.resolve(__dirname, "../../jest/test-globals.d.ts");
  const sourceFile = source.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    source.ScriptTarget.Latest,
    true,
  );
  const globalDeclaration = sourceFile.statements.find(
    (statement): statement is import("typescript").ModuleDeclaration =>
      source.isModuleDeclaration(statement) &&
      source.isIdentifier(statement.name) &&
      statement.name.text === "global",
  );

  if (
    !globalDeclaration?.body ||
    !source.isModuleBlock(globalDeclaration.body)
  ) {
    throw new Error("Unable to inspect semantic driver global declarations");
  }

  const commandNames: string[] = [];
  for (const statement of globalDeclaration.body.statements) {
    if (source.isFunctionDeclaration(statement)) {
      if (!statement.name) {
        throw new Error("Unnamed semantic driver global declaration");
      }
      commandNames.push(statement.name.text);
      continue;
    }
    if (source.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!source.isIdentifier(declaration.name)) {
          throw new Error("Unsupported semantic driver global declaration");
        }
        commandNames.push(declaration.name.text);
      }
    }
  }

  const allowedDeclarationCounts: Record<string, number> = {
    applyState: 2,
    parseState: 2,
  };
  const declarationCounts = commandNames.reduce<Record<string, number>>(
    (counts, command) => ({
      ...counts,
      [command]: (counts[command] ?? 0) + 1,
    }),
    {},
  );
  for (const [command, count] of Object.entries(declarationCounts)) {
    const expectedCount = allowedDeclarationCounts[command] ?? 1;
    if (count !== expectedCount) {
      throw new Error(
        `Unexpected semantic driver global declaration count: ${command} has ${count}, expected ${expectedCount}`,
      );
    }
  }

  return Object.keys(declarationCounts).sort();
}
