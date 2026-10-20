import { Setting } from "obsidian";

import { importLegacyFormattingSettings } from "../../formatting/settings";
import { Settings } from "../../services/Settings";
import { formattingSettingDefinitions } from "../FormattingSettings";

const mockNotices: string[] = [];
jest.mock(
  "obsidian",
  () => ({
    normalizePath: (path: string) => path,
    Notice: class {
      constructor(message: string) {
        mockNotices.push(message);
      }
    },
  }),
  { virtual: true },
);

async function settings() {
  const storage = {
    loadData: async () => null,
    saveData: jest.fn(async () => undefined),
  };
  const result = new Settings(storage);
  await result.load();
  return { result, storage };
}

function control(definition: { render(setting: Setting): void }) {
  let toggle!: (value: boolean) => Promise<void>;
  let change!: (value: string) => Promise<void>;
  let click!: () => Promise<void>;
  const setting = {
    addToggle(configure: (value: unknown) => void) {
      const input = {
        inputEl: { setCustomValidity: () => undefined },
        setValue: () => input,
        onChange: (callback: typeof toggle) => {
          toggle = callback;
          return input;
        },
      };
      configure(input);
    },
    addText(configure: (value: unknown) => void) {
      const input = {
        inputEl: { setCustomValidity: () => undefined },
        setValue: () => input,
        setPlaceholder: () => input,
        onChange: (callback: typeof change) => {
          change = callback;
          return input;
        },
      };
      configure(input);
    },
    addButton(configure: (value: unknown) => void) {
      const input = {
        setButtonText: () => input,
        onClick: (callback: typeof click) => {
          click = callback;
          return input;
        },
      };
      configure(input);
    },
  };
  definition.render(setting as unknown as Setting);
  return {
    toggle: (value: boolean) => toggle(value),
    change: (value: string) => change(value),
    click: () => click(),
  };
}

test("explicit import reads the enabled Linter, refreshes controls, and leaves save and scripts disabled", async () => {
  const current = await settings();
  const files: Record<string, string> = {
    ".obsidian/plugins/obsidian-linter/data.json": JSON.stringify({
      ruleConfigs: {
        "compact-yaml": { enabled: true },
        "yaml-timestamp": { enabled: false },
      },
      foldersToIgnore: ["templates"],
    }),
    ".obsidian/plugins/obsidian-linter-plus/data.json": JSON.stringify({
      ruleConfigs: { "yaml-timestamp": { enabled: true } },
    }),
    ".obsidian/plugins/automatic-linker/data.json": JSON.stringify({
      formatOnSave: true,
      runPrettierAfterFormatting: true,
    }),
  };
  const read = jest.fn(async (path: string) => files[path]);
  const refresh = jest.fn();
  const app = {
    plugins: { enabledPlugins: new Set(["obsidian-linter"]) },
    vault: {
      configDir: ".obsidian",
      adapter: { exists: async (path: string) => path in files, read },
    },
  };
  const definitions = formattingSettingDefinitions(
    app as never,
    current.result,
    refresh,
  );
  const definition = definitions.items.find(
    (item) => item.name === "Import current formatter settings",
  )!;
  await control(definition).click();
  expect(current.result.formatting.compactFrontmatter).toBe(true);
  expect(current.result.formatting.timestamps).toEqual({ kind: "disabled" });
  expect(current.result.formatting.linterIgnoredFolders).toEqual(["templates"]);
  expect(current.result.formatting.ignoredFolders).toEqual([]);
  expect(current.result.formatting.onSave).toBe(false);
  expect(current.result.formatting.script).toEqual({ kind: "disabled" });
  expect(read.mock.calls.map(([path]) => path)).toEqual([
    ".obsidian/plugins/obsidian-linter/data.json",
    ".obsidian/plugins/automatic-linker/data.json",
  ]);
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("enabling a group activates its imported disabled rules without enabling other groups", async () => {
  const current = await settings();
  current.result.formatting = importLegacyFormattingSettings(
    {
      ruleConfigs: {
        "footnote-after-punctuation": { enabled: true },
        "move-footnotes-to-the-bottom": { enabled: false },
        "re-index-footnotes": { enabled: false },
      },
    },
    {},
  ).settings;
  const definitions = formattingSettingDefinitions({} as never, current.result);
  const footnotes = control(
    definitions.items.find((item) => item.name === "Normalize footnotes")!,
  );
  await footnotes.toggle(false);
  await footnotes.toggle(true);
  expect(current.result.formatting.footnotes).toBe(true);
  expect(
    current.result.formatting.profile.disabledRules.filter((rule) =>
      rule.includes("footnote"),
    ),
  ).toEqual(["remove-leftover-footnotes-from-quote-on-paste"]);
  expect(current.result.formatting.profile.disabledRules).toContain(
    "compact-yaml",
  );
});

test("timestamp options survive disabling, persistence parsing, and re-enabling", async () => {
  const current = await settings();
  const timestamp = {
    kind: "enabled",
    created: false,
    modified: true,
    createdKey: "born",
    modifiedKey: "edited",
    createdSource: "frontmatter",
    modifiedSource: "filesystem",
    format: "YYYY/MM/DD",
    utc: true,
  } as const;
  current.result.formatting = {
    ...current.result.formatting,
    timestamps: timestamp,
  };
  const render = () =>
    formattingSettingDefinitions({} as never, current.result).items;
  await control(
    render().find((item) => item.name === "File timestamps")!,
  ).toggle(false);
  expect(current.result.formatting.timestamps).toEqual({
    kind: "disabled",
    previous: timestamp,
  });
  const saved = current.result.getValues();
  const reloaded = new Settings({
    loadData: async () => saved,
    saveData: async () => undefined,
  });
  await reloaded.load();
  const definitions = formattingSettingDefinitions({} as never, reloaded);
  await control(
    definitions.items.find((item) => item.name === "File timestamps")!,
  ).toggle(true);
  expect(reloaded.formatting.timestamps).toEqual(timestamp);
  expect(
    definitions.items
      .find((item) => item.name === "Timestamp date format")
      ?.visible?.(),
  ).toBe(true);
});

test("a script path must be an explicitly selected vault module and empty input disables it", async () => {
  const current = await settings();
  const definitions = formattingSettingDefinitions({} as never, current.result);
  const input = control(
    definitions.items.find(
      (item) => item.name === "Trusted save script module",
    )!,
  );
  await input.change("../outside.mjs");
  expect(current.result.formatting.script).toEqual({ kind: "disabled" });
  await input.change("scripts/format.mjs");
  expect(current.result.formatting.script).toEqual({
    kind: "module",
    path: "scripts/format.mjs",
  });
  await input.change("");
  expect(current.result.formatting.script).toEqual({ kind: "disabled" });
});
