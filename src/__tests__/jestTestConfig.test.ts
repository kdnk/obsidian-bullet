import { getTestPluginId, getVaultPluginDir } from "../../jest/test-config";

describe("test config helpers", () => {
  test("uses the manifest plugin id for the vault plugin directory", () => {
    expect(getTestPluginId()).toBe("outliner-plus");
    expect(getVaultPluginDir("/tmp/vault")).toBe(
      "/tmp/vault/.obsidian/plugins/outliner-plus",
    );
  });
});
