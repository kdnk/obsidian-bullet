const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { cdp, evaluate } = require("./obsidian-scroll-driver.cjs");

if (!process.argv[2])
  throw Error(
    "Usage: node scripts/verify-formatting-settings.cjs <fresh-output-directory>",
  );
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
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
  cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  previous = evaluate(async () => {
    const plugin = app.plugins.plugins.bullet;
    const previous = {
      formatting: JSON.stringify(plugin.settings.formatting),
      popout: app.vault.config.settingsPopoutWindow,
    };
    const defaults = new plugin.settings.constructor({
      loadData: async () => null,
      saveData: async () => undefined,
    });
    await defaults.load();
    plugin.settings.formatting = defaults.formatting;
    app.vault.setConfig("settingsPopoutWindow", false);
    app.setting.open();
    app.setting.openTabById("bullet");
    return previous;
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    if (
      evaluate(() =>
        [...document.querySelectorAll(".setting-item-name")].some(
          (element) => element.textContent === "File timestamps",
        ),
      )
    )
      break;
    evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  }
  assert.equal(
    evaluate(() =>
      [...document.querySelectorAll(".setting-item-name")].some(
        (element) =>
          element.textContent === "Import current formatter settings",
      ),
    ),
    false,
  );
  const defaults = evaluate(() =>
    structuredClone(app.plugins.plugins.bullet.settings.formatting),
  );
  assert.equal(defaults.onSave, true);
  assert.equal(defaults.cjkSpacing, true);
  assert.equal(defaults.footnotes, true);
  assert.equal(defaults.listCleanup, true);
  assert.equal(defaults.pasteFootnoteCleanup, true);
  assert.equal(defaults.timestamps.kind, "enabled");
  assert.equal(defaults.timestamps.createdKey, "created");
  assert.equal(defaults.timestamps.modifiedKey, "modified");
  assert.equal(defaults.timestamps.format, "YYYY-MM-DD-HHmmss");
  assert.deepEqual(defaults.linterIgnoredFolders, ["templates"]);
  assert.deepEqual(defaults.ignoredFolders, []);
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
    defaults.timestamps,
  );
  clickSetting("Format on explicit save", ".checkbox-container");
  assert.equal(
    evaluate(() => app.plugins.plugins.bullet.ownsExplicitSaveFormatting()),
    false,
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
        defaults,
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
  console.log("PASS native default settings, timestamps, and save toggle");
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
}
