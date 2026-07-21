const cp = require("child_process");
const path = require("path");
const fs = require("fs");
const debug = require("debug")("jest-obsidian");
const promisify = require("util").promisify;
const levelup = require("levelup");
const leveldown = require("leveldown");
const { runObsidianBootstrap } = require("./obsidian-bootstrap-lifecycle");
const { startObsidianGlobalLifecycle } = require("./obsidian-global-lifecycle");
const { startObsidianRelay } = require("./obsidian-relay");
const {
  getTestPluginId,
  getVaultPluginDir,
  TEST_VAULT_APP_CONFIG,
} = require("./test-config");

const KILL_CMD =
  process.platform === "darwin"
    ? ["killall", "Obsidian"]
    : ["flatpak", "kill", "md.obsidian.Obsidian"];
const OBSIDIAN_CONFIG_DIR =
  process.platform === "darwin"
    ? process.env.HOME + "/Library/Application Support/obsidian"
    : process.env.HOME + "/.var/app/md.obsidian.Obsidian/config/obsidian";
const OBSIDIAN_CONFIG_PATH = OBSIDIAN_CONFIG_DIR + "/obsidian.json";
const OBSIDIAN_APP_CMD =
  process.platform === "darwin"
    ? ["/Applications/Obsidian.app/Contents/MacOS/Obsidian"]
    : ["flatpak", "run", "md.obsidian.Obsidian"];
const OBSIDIAN_LOCAL_STORAGE_PATH =
  process.platform === "darwin"
    ? process.env.HOME +
      "/Library/Application Support/obsidian/Local Storage/leveldb"
    : process.env.HOME +
      "/.var/app/md.obsidian.Obsidian/config/obsidian/Local Storage/leveldb";
const OBISDIAN_TEST_VAULT_ID = "5a15473126091111";
const VAULT_DIR = process.cwd() + "/vault";

global.originalObsidianConfig = null;
global.OBSIDIAN_CONFIG_PATH = OBSIDIAN_CONFIG_PATH;
global.KILL_CMD = KILL_CMD;

function wait(t) {
  return new Promise((resolve) => setTimeout(resolve, t));
}

function runForAWhile({ timeout, fileToCheck }) {
  return runObsidianBootstrap({
    args: OBSIDIAN_APP_CMD.slice(1),
    command: OBSIDIAN_APP_CMD[0],
    fileExists: fs.existsSync,
    fileToCheck,
    killProcess: () => {
      cp.spawnSync(KILL_CMD[0], KILL_CMD.slice(1));
    },
    spawnProcess: cp.spawn,
    timeoutMs: timeout,
  });
}

async function prepareObsidian() {
  debug(`Preparing Obsidian`);

  if (!fs.existsSync(OBSIDIAN_CONFIG_PATH)) {
    debug(`  Creating ${OBSIDIAN_CONFIG_PATH}`);
    fs.mkdirSync(OBSIDIAN_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
      OBSIDIAN_CONFIG_PATH,
      '{"vaults":{},"updateDisabled":true}',
    );

    debug("  Running Obsidian for 90 seconds to setup");
    await runForAWhile({
      timeout: 90000,
      fileToCheck: OBSIDIAN_LOCAL_STORAGE_PATH,
    });
    await wait(2000);
  }

  const originalObsidianConfig = fs.readFileSync(OBSIDIAN_CONFIG_PATH, "utf-8");
  global.originalObsidianConfig = originalObsidianConfig;

  const obsidianConfig = JSON.parse(originalObsidianConfig);
  for (const key of Object.keys(obsidianConfig.vaults)) {
    debug(`  Closing vault ${obsidianConfig.vaults[key].path}`);
    obsidianConfig.vaults[key].open = false;
  }
  debug(`  Opening vault ${VAULT_DIR}`);
  obsidianConfig.vaults[OBISDIAN_TEST_VAULT_ID] = {
    path: VAULT_DIR,
    ts: Date.now(),
    open: true,
  };

  debug(`  Saving ${OBSIDIAN_CONFIG_PATH}`);
  fs.writeFileSync(OBSIDIAN_CONFIG_PATH, JSON.stringify(obsidianConfig));
}

async function prepareVault() {
  debug(`Prepare vault`);

  fs.mkdirSync(VAULT_DIR, { recursive: true });
  fs.writeFileSync(VAULT_DIR + "/test.md", "");

  const vaultConfigFilePath = `${VAULT_DIR}/.obsidian/app.json`;
  const vaultCommunityPluginsConfigFilePath = `${VAULT_DIR}/.obsidian/community-plugins.json`;
  const vaultPluginDir = getVaultPluginDir(VAULT_DIR);

  if (!fs.existsSync(vaultConfigFilePath)) {
    debug("  Running Obsidian for 90 seconds to setup vault");
    await runForAWhile({ timeout: 90000, fileToCheck: vaultConfigFilePath });
    await wait(2000);
  }

  const vaultConfig = JSON.parse(fs.readFileSync(vaultConfigFilePath));
  const newVaultConfig = {
    ...vaultConfig,
    ...TEST_VAULT_APP_CONFIG,
  };
  if (JSON.stringify(vaultConfig) !== JSON.stringify(newVaultConfig)) {
    debug(`  Saving ${vaultConfigFilePath}`);
    fs.writeFileSync(vaultConfigFilePath, JSON.stringify(newVaultConfig));
  }

  debug(`  Saving ${vaultCommunityPluginsConfigFilePath}`);
  fs.writeFileSync(
    vaultCommunityPluginsConfigFilePath,
    JSON.stringify([getTestPluginId()]),
  );

  debug(`  Disabling Safe Mode`);
  fs.mkdirSync(OBSIDIAN_LOCAL_STORAGE_PATH, { recursive: true });
  const localStorage = levelup(leveldown(OBSIDIAN_LOCAL_STORAGE_PATH));
  const key = Buffer.from(
    "5f6170703a2f2f6f6273696469616e2e6d640001656e61626c652d706c7567696e2d35613135343733313236303931313131",
    "hex",
  );
  const value = Buffer.from("0174727565", "hex");
  await promisify(localStorage.put.bind(localStorage))(key, value);
  await promisify(localStorage.close.bind(localStorage))();

  fs.mkdirSync(vaultPluginDir, { recursive: true });

  debug(`  Copying ${vaultPluginDir}/main.js`);
  fs.copyFileSync("dist/main.js", `${vaultPluginDir}/main.js`);
  debug(`  Copying ${vaultPluginDir}/manifest.json`);
  fs.copyFileSync("manifest.json", `${vaultPluginDir}/manifest.json`);
  debug(`  Copying ${vaultPluginDir}/styles.css`);
  fs.copyFileSync("styles.css", `${vaultPluginDir}/styles.css`);
}

module.exports = async () => {
  if (process.env.SKIP_OBSIDIAN) {
    return;
  }

  cp.spawnSync(KILL_CMD[0], KILL_CMD.slice(1));
  await wait(2000);

  await startObsidianGlobalLifecycle({
    env: process.env,
    globals: global,
    killObsidian: () => {
      cp.spawnSync(KILL_CMD[0], KILL_CMD.slice(1));
    },
    launchObsidian: () => {
      debug(`Running "${OBSIDIAN_APP_CMD[0]}"`);
      return cp.exec(OBSIDIAN_APP_CMD.join(" "), {
        env: {
          ...process.env,
          TEST_PLATFORM: "1",
        },
      });
    },
    prepareObsidian,
    prepareVault,
    restoreObsidianConfig: (config) => {
      debug(`Restoring ${OBSIDIAN_CONFIG_PATH}`);
      fs.writeFileSync(OBSIDIAN_CONFIG_PATH, config);
    },
    startRelay: startObsidianRelay,
  });
};
