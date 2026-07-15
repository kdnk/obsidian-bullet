import { installObsidianDriver } from "../../jest/obsidian-driver";
import { getTestPluginId, getVaultPluginDir } from "../../jest/test-config";

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
});
