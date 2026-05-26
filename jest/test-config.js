const manifest = require("../manifest.json");

function getTestPluginId() {
  return manifest.id;
}

function getVaultPluginDir(vaultDir) {
  return `${vaultDir}/.obsidian/plugins/${getTestPluginId()}`;
}

module.exports = {
  getTestPluginId,
  getVaultPluginDir,
};
