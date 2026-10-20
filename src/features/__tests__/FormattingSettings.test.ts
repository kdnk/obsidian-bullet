import { Setting } from "obsidian";

import { Settings } from "../../services/Settings";
import { formattingSettingDefinitions } from "../FormattingSettings";

jest.mock("obsidian", () => ({ normalizePath: (path: string) => path }), {
  virtual: true,
});

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
  };
  definition.render(setting as unknown as Setting);
  return {
    toggle: (value: boolean) => toggle(value),
    change: (value: string) => change(value),
  };
}

test("formatting controls are available without reading another plugin configuration", async () => {
  const current = await settings();
  const definitions = formattingSettingDefinitions(current.result);
  expect(definitions.items.map((item) => item.name)).toContain(
    "Format on explicit save",
  );
  expect(definitions.items.some((item) => item.name.includes("Import"))).toBe(
    false,
  );
  expect(current.result.formatting.onSave).toBe(true);
  expect(current.result.formatting.cjkSpacing).toBe(true);
  expect(current.result.formatting.pasteFootnoteCleanup).toBe(true);
});

test("enabling a group activates its disabled rules without enabling other groups", async () => {
  const current = await settings();
  current.result.formatting = {
    ...current.result.formatting,
    footnotes: false,
    compactFrontmatter: false,
    profile: {
      ...current.result.formatting.profile,
      disabledRules: [
        "move-footnotes-to-the-bottom",
        "re-index-footnotes",
        "remove-leftover-footnotes-from-quote-on-paste",
        "compact-yaml",
      ],
    },
  };
  const definitions = formattingSettingDefinitions(current.result);
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

test("the Automatic Linker toggle persists without changing unrelated formatting rules", async () => {
  const current = await settings();
  current.result.formatting = {
    ...current.result.formatting,
    footnotes: false,
    profile: {
      ...current.result.formatting.profile,
      disabledRules: ["re-index-footnotes", "compact-yaml"],
    },
  };
  const original = current.result.formatting;
  const definitions = formattingSettingDefinitions(current.result);
  const input = control(
    definitions.items.find(
      (item) => item.name === "Integrate with Automatic Linker",
    )!,
  );

  await input.toggle(false);
  expect(current.result.formatting).toEqual({
    ...original,
    automaticLinker: false,
  });
  expect(current.storage.saveData).toHaveBeenLastCalledWith(
    expect.objectContaining({
      formatting: { ...original, automaticLinker: false },
    }),
  );
  const reloaded = new Settings({
    loadData: async () => current.result.getValues(),
    saveData: async () => undefined,
  });
  await reloaded.load();
  expect(reloaded.formatting).toEqual({
    ...original,
    automaticLinker: false,
  });

  await input.toggle(true);
  expect(current.result.formatting).toEqual(original);
  expect(current.storage.saveData).toHaveBeenLastCalledWith(
    expect.objectContaining({ formatting: original }),
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
  const render = () => formattingSettingDefinitions(current.result).items;
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
  const definitions = formattingSettingDefinitions(reloaded);
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
  const definitions = formattingSettingDefinitions(current.result);
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
