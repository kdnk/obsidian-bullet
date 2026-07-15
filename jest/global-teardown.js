const cp = require("child_process");
const fs = require("fs");
const debug = require("debug")("jest-obsidian");

module.exports = async () => {
  if (process.env.SKIP_OBSIDIAN) {
    return;
  }

  if (global.obsidianTestCleanup) {
    await global.obsidianTestCleanup();
    return;
  }

  if (global.obsidianRelay) {
    await global.obsidianRelay.close();
    delete global.obsidianRelay;
  }

  cp.spawnSync(global.KILL_CMD[0], global.KILL_CMD.slice(1));

  if (
    global.originalObsidianConfig !== null &&
    global.originalObsidianConfig !== undefined
  ) {
    debug(`Restoring ${global.OBSIDIAN_CONFIG_PATH}`);
    fs.writeFileSync(
      global.OBSIDIAN_CONFIG_PATH,
      global.originalObsidianConfig,
    );
  }
  global.originalObsidianConfig = null;
  delete process.env.TEST_PLATFORM_WS_PORT;
  delete process.env.TEST_PLATFORM_WS_TOKEN;
};
