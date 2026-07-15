import { installObsidianDriver } from "../../jest/obsidian-driver";
import { getTestPluginId, getVaultPluginDir } from "../../jest/test-config";

const mdSpecTransformer = jest.requireActual<{
  process: (
    sourceText: string,
    sourcePath: string,
    options: { config: { cwd: string } },
  ) => { code: string };
}>("../../jest/md-spec-transformer");

describe("test config helpers", () => {
  test("uses the manifest plugin id for the vault plugin directory", () => {
    expect(getTestPluginId()).toBe("bullet");
    expect(getVaultPluginDir("/tmp/vault")).toBe(
      "/tmp/vault/.obsidian/plugins/bullet",
    );
  });

  test("installs the semantic Obsidian driver commands", () => {
    const target: Record<string, unknown> = {};
    const runCommand = jest.fn();

    installObsidianDriver(target, runCommand);

    expect(Object.keys(target)).toEqual(
      expect.arrayContaining([
        "applyState",
        "assertNativeListBullet",
        "clickGuide",
        "parseState",
        "drag",
        "move",
        "drop",
      ]),
    );
    for (const command of Object.values(target)) {
      expect(command).toEqual(expect.any(Function));
    }
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
});
