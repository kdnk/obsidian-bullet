#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "../../../..");
const vault = path.join(root, "vault");
const { cdp } = require(path.join(root, "scripts/obsidian-scroll-driver.cjs"));
const [command, argument] = process.argv.slice(2);
assert.ok(
  ["start", "doctor", "capture", "cleanup"].includes(command) && argument,
  "Usage: control.cjs start|doctor|capture|cleanup <absolute-proof-directory>",
);
assert.equal(process.cwd(), root, "Run from the repository root");
assert.equal(
  process.platform,
  "darwin",
  "This lifecycle targets the local macOS installation",
);
const [major, minor, patch] = process.versions.node.split(".").map(Number);
assert.ok(
  major === 22 && (minor > 23 || (minor === 23 && patch >= 1)),
  "Use Node.js 22.23.1 or later in the 22.x line",
);
assert.ok(path.isAbsolute(argument), "Use an absolute evidence path");
const proof = path.resolve(argument);
assert.ok(
  proof !== vault && !proof.startsWith(vault + path.sep),
  "Evidence belongs outside the vault",
);
const lease = path.join(vault, ".obsidian/bullet-verification-lock");
const statePath = path.join(proof, "session.json");
const files = [
  "test.md",
  ".obsidian/app.json",
  ".obsidian/workspace.json",
  ".obsidian/community-plugins.json",
  ...["main.js", "manifest.json", "styles.css", "data.json"].map(
    (name) => `.obsidian/plugins/bullet/${name}`,
  ),
];
const assets = ["main.js", "manifest.json", "styles.css"];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (file) =>
  fs.existsSync(file)
    ? createHash("sha256").update(fs.readFileSync(file)).digest("hex")
    : null;
function write(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(temporary, file);
}

function evaluate(fn, ...args) {
  const response = cdp("Runtime.evaluate", {
    expression: `(async () => {
      if (app.vault.adapter.getBasePath() !== ${JSON.stringify(vault)} ||
          app.vault.config.useTab !== true || app.vault.config.tabSize !== 4 ||
          !document.title.includes("vault") || document.title.includes("base"))
        throw Error("Verification vault guard");
      return (${fn.toString()})(...${JSON.stringify(args)});
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails)
    throw Error(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text,
    );
  return response.result.value;
}

function inspect() {
  return evaluate(() => {
    const view = app.workspace.activeLeaf?.view;
    const cm = view?.editor?.cm;
    return {
      title: document.title,
      vault: app.vault.adapter.getBasePath(),
      pid: process.pid,
      version: app.plugins.plugins.bullet?.manifest.version,
      enabled: !!app.plugins.plugins.bullet,
      file: view?.file?.path,
      editable: cm?.contentDOM.isContentEditable === true,
      livePreview: !!view?.containerEl.querySelector(
        ".markdown-source-view.is-live-preview",
      ),
      mobile: document.body.classList.contains("is-mobile"),
      font: app.getBaseFontSize(),
      zoom: require("electron").webFrame.getZoomLevel(),
      viewport: {
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      },
      bounds: require("electron").remote.getCurrentWindow().getBounds(),
      useTab: app.vault.config.useTab,
      tabSize: app.vault.config.tabSize,
    };
  });
}

async function ready() {
  const deadline = Date.now() + 45000;
  let error;
  do {
    try {
      return inspect();
    } catch (caught) {
      error = caught;
      if (String(error).includes("Verification vault guard")) throw error;
    }
    await pause(250);
  } while (Date.now() < deadline);
  throw error;
}

function load() {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(state.root, root);
  assert.equal(state.proof, proof);
  assert.equal(state.vault, vault);
  if (
    state.phase !== "cleaned" &&
    !(state.phase === "restored" && !fs.existsSync(lease))
  ) {
    const owner = JSON.parse(fs.readFileSync(lease, "utf8"));
    assert.equal(owner.token, state.token, "Another run owns the test vault");
    assert.equal(owner.proof, proof);
  }
  return state;
}

function doctor(state) {
  assert.equal(state.phase, "ready", "Start must finish before driving");
  const current = inspect();
  assert.equal(
    current.pid,
    state.renderer,
    "The test renderer changed; run cleanup before restarting",
  );
  assert.equal(
    current.mobile,
    false,
    "Return from mobile emulation before continuing",
  );
  assert.ok(
    current.editable && current.livePreview,
    "An editable Live Preview pane is required",
  );
  assert.equal(current.version, state.version, "Runtime manifest is stale");
  const deployed = Object.fromEntries(
    assets.map((name) => [
      name,
      hash(path.join(vault, ".obsidian/plugins/bullet", name)),
    ]),
  );
  assert.deepEqual(
    deployed,
    state.deployed,
    "Deployed assets changed during this run",
  );
  const report = {
    at: new Date().toISOString(),
    node: process.version,
    ...current,
    deployed,
  };
  write(path.join(proof, "doctor.json"), report);
  return report;
}

async function cleanup(state) {
  if (state.phase === "cleaned")
    return JSON.parse(
      fs.readFileSync(path.join(proof, "cleanup.json"), "utf8"),
    );
  if (state.phase === "restored") return finalize(state);
  const backupPrefix = path.join(
    os.tmpdir(),
    "obsidian-bullet-verification-backup-",
  );
  assert.ok(
    state.backup.startsWith(backupPrefix) &&
      path.dirname(state.backup) === os.tmpdir(),
  );
  assert.ok(!fs.lstatSync(state.backup).isSymbolicLink());
  if (
    state.phase === "snapshotting" ||
    (!state.renderer && !state.windowOpened)
  ) {
    write(path.join(proof, "cleanup.json"), {
      snapshotOnly: true,
      evidencePreserved: proof,
    });
    state.phase = "restored";
    write(statePath, state);
    return finalize(state);
  }
  assert.ok(
    state.renderer || state.phase === "reopening",
    "No verified renderer; retain the lease and backup until the launched window is identified",
  );
  if (state.phase === "reopening") {
    state.renderer = (await ready()).pid;
    state.closed = false;
    state.phase = "restoring";
    write(statePath, state);
  }
  if (state.renderer && !state.closed) {
    let alive = true;
    try {
      process.kill(state.renderer, 0);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
      alive = false;
    }
    if (alive) {
      const current = inspect();
      assert.equal(
        current.pid,
        state.renderer,
        "Refusing to close a replacement renderer",
      );
      if (current.mobile) {
        evaluate(() => window.setTimeout(() => app.emulateMobile(false), 0));
        await ready();
      }
      cdp("Emulation.clearDeviceMetricsOverride");
      cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
      cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
      evaluate(() => {
        window.setTimeout(
          () => require("electron").remote.getCurrentWindow().close(),
          100,
        );
        return true;
      });
      const deadline = Date.now() + 45000;
      do {
        try {
          process.kill(state.renderer, 0);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
          alive = false;
          break;
        }
        await pause(250);
      } while (Date.now() < deadline);
      assert.equal(
        alive,
        false,
        "Renderer has not exited; retain the backup and retry cleanup",
      );
    }
    state.closed = true;
    state.exitVerified = true;
    write(statePath, state);
  }
  const restored = {};
  for (const file of files) {
    const target = path.join(vault, file);
    const saved = path.join(state.backup, file);
    if (state.original[file] === null) {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } else {
      assert.equal(
        hash(saved),
        state.original[file],
        `Backup changed: ${file}`,
      );
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(saved, target);
    }
    restored[file] = hash(target);
    assert.equal(
      restored[file],
      state.original[file],
      `Restore failed: ${file}`,
    );
  }
  await pause(500);
  for (const file of files)
    assert.equal(hash(path.join(vault, file)), state.original[file]);
  let reopened;
  if (state.initial) {
    state.phase = "reopening";
    write(statePath, state);
    execFileSync("open", ["-a", "Obsidian", "obsidian://open?vault=vault"]);
    reopened = await ready();
    state.renderer = reopened.pid;
    state.closed = false;
    state.phase = "restoring";
    write(statePath, state);
    evaluate(
      (bounds) =>
        require("electron").remote.getCurrentWindow().setBounds(bounds),
      state.initial.bounds,
    );
    assert.equal(
      reopened.enabled,
      state.initial.enabled,
      "Original plugin enablement must return",
    );
    if (state.initial.enabled)
      assert.equal(reopened.version, state.initial.version);
    for (const file of files.filter(
      (file) => file !== ".obsidian/workspace.json",
    ))
      assert.equal(
        hash(path.join(vault, file)),
        state.original[file],
        `Reopening changed ${file}`,
      );
  }
  const report = {
    at: new Date().toISOString(),
    restored,
    rendererExited: state.exitVerified ?? false,
    borrowedWindowReopened: !!reopened,
    evidencePreserved: proof,
  };
  write(path.join(proof, "cleanup.json"), report);
  state.phase = "restored";
  write(statePath, state);
  return finalize(state);
}

function finalize(state) {
  if (fs.existsSync(state.backup))
    execFileSync("/usr/bin/trash", [state.backup]);
  if (fs.existsSync(lease)) {
    const owner = JSON.parse(fs.readFileSync(lease, "utf8"));
    assert.equal(owner.token, state.token, "Another run owns the lease");
    fs.unlinkSync(lease);
  }
  state.phase = "cleaned";
  write(statePath, state);
  return JSON.parse(fs.readFileSync(path.join(proof, "cleanup.json"), "utf8"));
}

async function start() {
  assert.ok(
    !fs.existsSync(proof),
    "Use a fresh proof directory for each lifecycle",
  );
  const config = JSON.parse(
    fs.readFileSync(path.join(vault, ".obsidian/app.json"), "utf8"),
  );
  assert.ok(
    config.useTab === true && config.tabSize === 4,
    "Test vault must use tabs at width 4",
  );
  execFileSync("obsidian-cli", ["--help"], { timeout: 20000, stdio: "pipe" });
  fs.mkdirSync(proof, { recursive: true });
  const state = {
    root,
    proof,
    vault,
    token: randomUUID(),
    phase: "snapshotting",
    backup: fs.mkdtempSync(
      path.join(os.tmpdir(), "obsidian-bullet-verification-backup-"),
    ),
    original: {},
  };
  write(statePath, state);
  let acquired = false;
  try {
    fs.symlinkSync(statePath, lease);
    acquired = true;
    for (const file of files) {
      const source = path.join(vault, file);
      state.original[file] = hash(source);
      if (state.original[file] !== null) {
        const target = path.join(state.backup, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
      }
    }
    state.phase = "starting";
    write(statePath, state);
    try {
      state.initial = inspect();
    } catch (error) {
      if (String(error).includes("Verification vault guard")) throw error;
      state.windowOpened = true;
      write(statePath, state);
      execFileSync("open", ["-a", "Obsidian", "obsidian://open?vault=vault"]);
    }
    const running = await ready();
    state.renderer = running.pid;
    write(statePath, state);
    assert.equal(running.mobile, false, "Start in desktop mode");
    cdp("Emulation.clearDeviceMetricsOverride");
    cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
    cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
    const log = fs.openSync(path.join(proof, "build.log"), "w");
    try {
      execFileSync("npm", ["run", "build"], {
        cwd: root,
        timeout: 60000,
        stdio: ["ignore", log, log],
      });
    } finally {
      fs.closeSync(log);
    }
    evaluate(async () => {
      if (app.plugins.plugins.bullet) await app.plugins.disablePlugin("bullet");
    });
    for (const name of assets)
      fs.copyFileSync(
        path.join(root, name === "main.js" ? "dist/main.js" : name),
        path.join(vault, ".obsidian/plugins/bullet", name),
      );
    state.version = JSON.parse(
      fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
    ).version;
    state.deployed = Object.fromEntries(
      assets.map((name) => [
        name,
        hash(path.join(vault, ".obsidian/plugins/bullet", name)),
      ]),
    );
    write(statePath, state);
    evaluate(async () => {
      await app.plugins.loadManifest(".obsidian/plugins/bullet");
      await app.plugins.enablePlugin("bullet");
      require("electron")
        .remote.getCurrentWindow()
        .setBounds({ width: 1200, height: 950 });
    });
    execFileSync("obsidian-cli", ["vault=vault", "open", "path=test.md"], {
      timeout: 20000,
      stdio: "pipe",
    });
    await ready();
    state.phase = "ready";
    write(statePath, state);
    return doctor(state);
  } catch (error) {
    write(path.join(proof, "failure.json"), { error: String(error) });
    try {
      if (acquired) await cleanup(state);
      else {
        execFileSync("/usr/bin/trash", [state.backup]);
        write(path.join(proof, "cleanup.json"), {
          leaseAcquired: false,
          evidencePreserved: proof,
        });
        state.phase = "cleaned";
        write(statePath, state);
      }
    } catch (cleanupError) {
      write(path.join(proof, "cleanup-error.json"), {
        error: String(cleanupError),
      });
    }
    throw error;
  }
}

async function main() {
  if (command === "start") return start();
  const state = load();
  if (command === "cleanup") return cleanup(state);
  const current = doctor(state);
  if (command === "doctor") return current;
  const name = `capture-${Date.now()}`;
  const snapshot = evaluate(() => {
    const view = app.workspace.activeLeaf.view;
    return {
      file: view.file?.path,
      markdown: view.editor.getValue(),
      cursor: view.editor.getCursor(),
      scrollTop: view.editor.cm.scrollDOM.scrollTop,
      dom: view.editor.cm.dom.outerHTML,
    };
  });
  write(path.join(proof, name + ".json"), { ...current, ...snapshot });
  const screenshot = cdp("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  fs.writeFileSync(
    path.join(proof, name + ".png"),
    Buffer.from(screenshot.data, "base64"),
  );
  return { snapshot: name + ".json", screenshot: name + ".png" };
}

main()
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
