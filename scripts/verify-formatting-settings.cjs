const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

if (!process.argv[2] || !process.argv[3])
  throw Error(
    "Usage: node scripts/verify-formatting-settings.cjs <fresh-output-directory> <linter-data.json>",
  );
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const legacy = JSON.parse(
  fs.readFileSync(path.resolve(process.argv[3]), "utf8"),
);
const target = path.resolve(
  __dirname,
  "../vault/.obsidian/plugins/obsidian-linter-plus",
);
assert.ok(
  !fs.existsSync(target),
  "Do not replace an installed Linter Plus configuration",
);
const fixture = {
  ruleConfigs: Object.fromEntries(
    Object.entries(legacy.ruleConfigs).filter(
      ([, rule]) => rule.enabled === true,
    ),
  ),
  commonStyles: legacy.commonStyles,
  foldersToIgnore: legacy.foldersToIgnore,
  filesToIgnore: legacy.filesToIgnore,
};
let previous;

function clickSetting(name, control) {
  const point = () =>
    evaluate(
      async (name, control) => {
        window.focus();
        if (
          !document.title.includes("vault") ||
          document.title.includes("base") ||
          document.visibilityState !== "visible"
        )
          throw Error("Wrong renderer");
        const row = [...document.querySelectorAll(".setting-item")].find(
          (row) =>
            row.querySelector(".setting-item-name")?.textContent === name,
        );
        if (!row) throw Error(`Missing setting: ${name}`);
        row.scrollIntoView({ block: "center" });
        await new Promise((resolve) => setTimeout(resolve, 150));
        const element = row.querySelector(control);
        if (!element) throw Error(`Missing control: ${name}`);
        const rect = element.getBoundingClientRect();
        const x = rect.x + rect.width / 2,
          y = rect.y + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        if (hit !== element && !element.contains(hit))
          throw Error(`Setting is covered: ${name}`);
        return { x, y };
      },
      name,
      control,
    );
  cdp("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...point(),
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  cdp("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...point(),
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

try {
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, "data.json"), JSON.stringify(fixture));
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  previous = evaluate(() => {
    const plugin = app.plugins.plugins.bullet;
    const previous = {
      formatting: JSON.stringify(plugin.settings.formatting),
      popout: app.vault.config.settingsPopoutWindow,
    };
    app.vault.setConfig("settingsPopoutWindow", false);
    app.setting.open();
    app.setting.openTabById("bullet");
    return previous;
  });
  clickSetting("Import current formatter settings", "button");
  evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
  const imported = evaluate(() =>
    structuredClone(app.plugins.plugins.bullet.settings.formatting),
  );
  assert.equal(imported.onSave, false);
  assert.equal(imported.cjkSpacing, true);
  assert.equal(imported.footnotes, true);
  assert.equal(imported.listCleanup, true);
  assert.equal(imported.pasteFootnoteCleanup, true);
  assert.equal(imported.timestamps.kind, "enabled");
  assert.equal(imported.timestamps.createdKey, "created");
  assert.equal(imported.timestamps.modifiedKey, "modified");
  assert.equal(imported.timestamps.format, "YYYY-MM-DD-HHmmss");
  assert.deepEqual(imported.linterIgnoredFolders, ["templates"]);
  assert.deepEqual(imported.ignoredFolders, []);
  const controls = evaluate(() => {
    const row = (name) =>
      [...document.querySelectorAll(".setting-item")].find(
        (row) => row.querySelector(".setting-item-name")?.textContent === name,
      );
    return {
      cjk: row("Space Japanese, Chinese, and Korean text")
        ?.querySelector(".checkbox-container")
        ?.classList.contains("is-enabled"),
      timestamps: row("File timestamps")
        ?.querySelector(".checkbox-container")
        ?.classList.contains("is-enabled"),
    };
  });
  assert.deepEqual(controls, { cjk: true, timestamps: true });
  clickSetting("File timestamps", ".checkbox-container");
  assert.equal(
    evaluate(
      () => app.plugins.plugins.bullet.settings.formatting.timestamps.kind,
    ),
    "disabled",
  );
  clickSetting("File timestamps", ".checkbox-container");
  assert.deepEqual(
    evaluate(() =>
      structuredClone(
        app.plugins.plugins.bullet.settings.formatting.timestamps,
      ),
    ),
    imported.timestamps,
  );
  clickSetting("Format on explicit save", ".checkbox-container");
  assert.equal(
    evaluate(() => app.plugins.plugins.bullet.ownsExplicitSaveFormatting()),
    true,
  );
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(
      {
        imported,
        controls,
        nativeTimestampToggle: true,
        nativeSaveToggle: true,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(output, "settings.png"),
    Buffer.from(
      cdp("Page.captureScreenshot", { format: "png" }).data,
      "base64",
    ),
  );
  console.log(
    "PASS native settings import, refreshed controls, timestamps, and save toggle",
  );
} finally {
  if (previous)
    evaluate(async (previous) => {
      const settings = app.plugins.plugins.bullet.settings;
      settings.formatting = JSON.parse(previous.formatting);
      await settings.save();
      app.setting.close();
      app.vault.setConfig("settingsPopoutWindow", previous.popout);
    }, previous);
  cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
  if (fs.existsSync(target)) execFileSync("/usr/bin/trash", [target]);
}
