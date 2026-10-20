import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { rollup } from "rollup";
import * as ts from "typescript";

import type { FormattingSettings } from "../types";

interface Example {
  alias: string;
  description: string;
  before: string;
  after: string;
  options: Record<string, unknown>;
}
interface Engine {
  formatMarkdown: typeof import("../formatMarkdown").formatMarkdown;
  lintMarkdown: typeof import("../lintMarkdown").lintMarkdown;
  formatPastedText: typeof import("../lintMarkdown").formatPastedText;
  defaultFormattingSettings: typeof import("../settings").defaultFormattingSettings;
  prettierMarkdown: typeof import("../prettier").formatMarkdown;
  parseFormattingSettings: typeof import("../settings").parseFormattingSettings;
  formatChanges: typeof import("../editorChanges").formatChanges;
  applyExample: (example: Example) => string;
}
function isEngine(value: unknown): value is Engine {
  return (
    typeof value === "object" &&
    value !== null &&
    [
      "formatMarkdown",
      "lintMarkdown",
      "formatPastedText",
      "defaultFormattingSettings",
      "prettierMarkdown",
      "parseFormattingSettings",
      "formatChanges",
      "applyExample",
    ].every(
      (key) => key in value && typeof Reflect.get(value, key) === "function",
    )
  );
}
function isExample(value: unknown): value is Example {
  return (
    typeof value === "object" &&
    value !== null &&
    "alias" in value &&
    typeof value.alias === "string" &&
    "description" in value &&
    typeof value.description === "string" &&
    "before" in value &&
    typeof value.before === "string" &&
    "after" in value &&
    typeof value.after === "string" &&
    "options" in value &&
    typeof value.options === "object" &&
    value.options !== null &&
    !Array.isArray(value.options)
  );
}
const saved: unknown = JSON.parse(
  readFileSync(join(__dirname, "fixtures/linter-examples.json"), "utf8"),
);
if (!Array.isArray(saved) || !saved.every(isExample))
  throw new Error("Invalid upstream examples");
const examples: Example[] = saved;
let engine: Engine;
let upstreamResults: string[];
const output = mkdtempSync(join(tmpdir(), "bullet-formatting-unit-"));
const root = resolve(__dirname, "../../..");
const file = {
  path: "test.md",
  basename: "test",
  ctime: 1577836800000,
  mtime: 1577923200000,
};

beforeAll(async () => {
  const bundle = await rollup({
    input: "formatting-fixture-entry",
    plugins: [
      {
        name: "formatting-test-typescript",
        resolveId(id, importer) {
          if (
            id === "formatting-fixture-entry" ||
            id === "formatting-fixture-obsidian"
          )
            return id;
          if (id === "obsidian") return "formatting-fixture-obsidian";
          if (id.startsWith(".") && importer) {
            const path = resolve(dirname(importer), id) + ".ts";
            if (existsSync(path)) return path;
          }
          return null;
        },
        load(id) {
          if (id === "formatting-fixture-obsidian")
            return 'export {default as moment} from "moment";';
          if (id === "formatting-fixture-entry")
            return `
        export * from ${JSON.stringify(join(root, "src/formatting/formatMarkdown.ts"))};
        export * from ${JSON.stringify(join(root, "src/formatting/lintMarkdown.ts"))};
        export * from ${JSON.stringify(join(root, "src/formatting/settings.ts"))};
        export * from ${JSON.stringify(join(root, "src/formatting/editorChanges.ts"))};
        export {formatMarkdown as prettierMarkdown} from ${JSON.stringify(join(root, "src/formatting/prettier.ts"))};
        import * as Rules from ${JSON.stringify(join(root, "src/formatting/vendor/linterRules.ts"))};
        import {ignoreListOfTypes,IgnoreTypes} from ${JSON.stringify(join(root, "src/formatting/vendor/linterHelpers.ts"))};
        import moment from "moment";
        const names={"empty-line-around-math-blocks":"EmptyLineAroundMathBlock","space-between-chinese-japanese-or-korean-and-english-or-numbers":"SpaceBetweenChineseJapaneseOrKoreanAndEnglishOrNumbers","yaml-timestamp":"YamlTimestamp","compact-yaml":"CompactYaml","re-index-footnotes":"ReIndexFootnotes"};
        const common=[IgnoreTypes.code,IgnoreTypes.math,IgnoreTypes.yaml,IgnoreTypes.link,IgnoreTypes.wikiLink,IgnoreTypes.tag];
        const ignores={
          "yaml-timestamp":[],"compact-yaml":[],"correct-closing-fence-indentation":[],"empty-line-around-code-fences":[],"empty-line-around-horizontal-rules":[],"line-break-at-document-end":[],
          "footnote-after-punctuation":[...common,IgnoreTypes.inlineCode,IgnoreTypes.footnoteAtStartOfLine,IgnoreTypes.footnoteAfterATask],
          "move-footnotes-to-the-bottom":[IgnoreTypes.code,IgnoreTypes.inlineCode,IgnoreTypes.math,IgnoreTypes.yaml],
          "re-index-footnotes":[IgnoreTypes.code,IgnoreTypes.inlineCode,IgnoreTypes.math,IgnoreTypes.yaml,IgnoreTypes.tag],
          "empty-line-around-math-blocks":[IgnoreTypes.yaml,IgnoreTypes.code],
          "empty-line-around-tables":[IgnoreTypes.yaml,IgnoreTypes.code,IgnoreTypes.math,IgnoreTypes.inlineMath,IgnoreTypes.wikiLink,IgnoreTypes.link],
          "heading-blank-lines":[IgnoreTypes.code,IgnoreTypes.math,IgnoreTypes.yaml,IgnoreTypes.link,IgnoreTypes.wikiLink],
          "remove-empty-lines-between-list-markers-and-checklists":[...common,IgnoreTypes.thematicBreak],
          "space-between-chinese-japanese-or-korean-and-english-or-numbers":[...common,IgnoreTypes.inlineCode,IgnoreTypes.inlineMath,IgnoreTypes.html,IgnoreTypes.image],
          "remove-leftover-footnotes-from-quote-on-paste":[IgnoreTypes.wikiLink,IgnoreTypes.link,IgnoreTypes.image]
        };
        export function applyExample(example){
          const options={...example.options,locale:"en"};
          if(options.currentTime?.$moment)options.currentTime=moment(...options.currentTime.$moment);
          const className=names[example.alias]??example.alias.split("-").map(part=>part[0].toUpperCase()+part.slice(1)).join("");
          return ignoreListOfTypes([IgnoreTypes.customIgnore,...(ignores[example.alias]??common)],example.before,value=>new Rules[className]().apply(value,options));
        }
      `;
          if (id.endsWith(".ts"))
            return ts.transpileModule(readFileSync(id, "utf8"), {
              compilerOptions: {
                module: ts.ModuleKind.ESNext,
                target: ts.ScriptTarget.ES2022,
              },
            }).outputText;
          return null;
        },
      },
      nodeResolve(),
      commonjs(),
    ],
    onwarn(warning) {
      if (warning.code !== "CIRCULAR_DEPENDENCY")
        throw new Error(warning.message);
    },
  });
  try {
    const path = join(output, "engine.cjs");
    await bundle.write({ file: path, format: "cjs" });
    const loaded: unknown = createRequire(__filename)(path);
    if (!isEngine(loaded)) throw new Error("Invalid formatting engine exports");
    engine = loaded;
    const results: unknown = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "-e",
          `const fs=require("node:fs");const engine=require(process.argv[1]);const fixtures=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));process.stdout.write(JSON.stringify(fixtures.map(example=>engine.applyExample(example))));`,
          path,
          join(__dirname, "fixtures/linter-examples.json"),
        ],
        { encoding: "utf8", env: { ...process.env, TZ: "UTC" } },
      ),
    );
    if (
      !Array.isArray(results) ||
      !results.every((item): item is string => typeof item === "string")
    )
      throw new Error("Invalid upstream fixture results");
    upstreamResults = results;
  } finally {
    await bundle.close();
  }
}, 30000);
afterAll(() => rmSync(output, { recursive: true, force: true }));

for (const [index, example] of examples.entries())
  test(`upstream ${example.alias}: ${example.description}`, () => {
    expect(upstreamResults[index]).toBe(example.after);
  });

function settings(): FormattingSettings {
  const result = engine.defaultFormattingSettings();
  result.timestamps = { kind: "disabled" };
  return result;
}

test("formats Markdown, CJK spacing and footnotes in the real pipeline", async () => {
  const result = await engine.formatMarkdown({
    text: "# Heading\n- 日本語ABC\n\ntext[^x].\n\n[^x]: footnote",
    file,
    indent: { useTabs: true, tabWidth: 4 },
    settings: settings(),
    signal: new AbortController().signal,
  });
  expect(result).toBe(
    "# Heading\n\n- 日本語 ABC\n\ntext.[^1]\n\n[^1]: footnote\n",
  );
});

test("preserves per-note rule disables and custom ignored sections", () => {
  const s = settings();
  s.profile.disabledRules = ["line-break-at-document-end"];
  expect(
    engine.lintMarkdown(
      "---\ndisabled rules: [all]\n---\n日本語ABC   ",
      file,
      s,
    ),
  ).toBe("---\ndisabled rules: [all]\n---\n日本語ABC   ");
  expect(
    engine.lintMarkdown(
      "<!-- linter-disable -->\n日本語ABC   \n<!-- linter-enable -->\n日本語ABC",
      file,
      s,
    ),
  ).toBe(
    "<!-- linter-disable -->\n日本語ABC   \n<!-- linter-enable -->\n日本語 ABC",
  );
});

test("protects code, math, links and YAML scalar content", () => {
  const s = settings();
  const input =
    "---\nvalue: |\n  日本語ABC  \n\n  keep\n---\n\n日本語ABC `日本語ABC` [日本語ABC](https://example.test/日本語ABC) $日本語ABC$\n\n```txt\n日本語ABC  \n\n\n- literal\n```\n";
  expect(engine.lintMarkdown(input, file, s)).toBe(
    "---\nvalue: |\n  日本語ABC  \n\n  keep\n---\n\n日本語 ABC `日本語ABC` [日本語ABC](https://example.test/日本語ABC) $日本語ABC$\n\n```txt\n日本語ABC  \n\n\n- literal\n```\n",
  );
});

test("keeps template exclusions specific to Linter while Prettier still formats", async () => {
  const s = settings();
  s.linterIgnoredFolders = ["templates"];
  expect(
    await engine.formatMarkdown({
      text: "# heading\n日本語ABC",
      file: { ...file, path: "templates/note.md" },
      indent: { useTabs: true, tabWidth: 4 },
      settings: s,
      signal: new AbortController().signal,
    }),
  ).toBe("# heading\n\n日本語ABC\n");
  s.ignoredFolders = ["templates"];
  expect(
    await engine.formatMarkdown({
      text: "# heading\n日本語ABC",
      file: { ...file, path: "templates/note.md" },
      indent: { useTabs: true, tabWidth: 4 },
      settings: s,
      signal: new AbortController().signal,
    }),
  ).toBe("# heading\n日本語ABC");
});

test("runs the quote footnote rule on paste separately from save", () => {
  const s = settings();
  s.pasteFootnoteCleanup = true;
  expect(
    engine.formatPastedText("a quote.50 [a link](https://example.test/1)", s),
  ).toBe("a quote [a link](https://example.test/1)");
  expect(engine.lintMarkdown("a quote[1]", file, s)).toBe("a quote[1]\n");
});

test("preserves valid created timestamp and updates modified only when required", () => {
  const s = settings();
  s.markdown = false;
  s.timestamps = {
    kind: "enabled",
    created: true,
    modified: true,
    createdKey: "created",
    modifiedKey: "modified",
    format: "YYYY-MM-DD-HHmmss",
    createdSource: "filesystem",
    modifiedSource: "filesystem",
    utc: true,
  };
  const input = "---\ncreated: 20190101\nmodified: invalid\n---\n\nbody\n";
  const first = engine.lintMarkdown(input, file, s, 1577923205000);
  expect(first).toBe(
    "---\ncreated: 2020-01-01-000000\nmodified: 2020-01-02-000005\n---\n\nbody\n",
  );
  expect(
    engine.lintMarkdown(
      first,
      { ...file, ctime: 1893456000000, mtime: 1577923205000 },
      s,
      1577923300000,
    ),
  ).toBe(first);
});

test("awaits linker and script before formatting and labels stage failures", async () => {
  const s = settings();
  s.markdown = false;
  const request = {
    text: "body",
    file,
    indent: { useTabs: true, tabWidth: 4 },
    settings: s,
    signal: new AbortController().signal,
  };
  expect(
    await engine.formatMarkdown({
      ...request,
      linker: async (value) => value + " linker",
      script: async (value) => value + " script",
    }),
  ).toBe("body linker script\n");
  await expect(
    engine.formatMarkdown({
      ...request,
      script: () => {
        throw new Error("bad script");
      },
    }),
  ).rejects.toThrow("Save script: bad script");
  const controller = new AbortController();
  controller.abort();
  await expect(
    engine.formatMarkdown({ ...request, signal: controller.signal }),
  ).rejects.toThrow("Formatting cancelled");
});

test("safe Prettier keeps nested fenced content and is idempotent", async () => {
  const input =
    "- aaa\n\t- ```go\n\t  aaa  \n\t  \n\t  - literal list marker\n\t  ```\n-";
  const expected = input + "\n";
  expect(
    await engine.prettierMarkdown(input, { useTabs: true, tabWidth: 4 }),
  ).toBe(expected);
  expect(
    await engine.prettierMarkdown(expected, { useTabs: true, tabWidth: 4 }),
  ).toBe(expected);
});

test.each([
  {
    description: "a list-attached malformed closing fence",
    input: "- ```txt\n  日本語ABC  \n  - literal marker\n```\n- tail",
    expected: "- ```txt\n  日本語ABC  \n  - literal marker\n  ```\n- tail\n",
  },
  {
    description: "a compact empty ancestor around a code fence",
    input: "- - ```txt\n    日本語ABC  \n    - literal marker\n    ```\n- tail",
    expected:
      "- \n\t- ```txt\n\t  日本語ABC  \n\t  - literal marker\n\t  ```\n- tail\n",
  },
  {
    description: "an expanded empty ancestor around a code fence",
    input:
      "- \n  - ```txt\n    日本語ABC  \n    - literal marker\n    ```\n- tail",
    expected:
      "- \n\t- ```txt\n\t  日本語ABC  \n\t  - literal marker\n\t  ```\n- tail\n",
  },
  {
    description: "multiple compact empty ancestors",
    input:
      "- - - ```txt\n      日本語ABC  \n      <div>- literal</div>\n      ~~~not a fence\n      ```\n- tail",
    expected:
      "- \n\t- \n\t\t- ```txt\n\t\t  日本語ABC  \n\t\t  <div>- literal</div>\n\t\t  ~~~not a fence\n\t\t  ```\n- tail\n",
  },
  {
    description: "bare empty ancestors with tab indentation",
    input: "-\n\t-\n\t\t- ```txt\n\t\t  日本語ABC  \n\t\t  ```",
    expected: "- \n\t- \n\t\t- ```txt\n\t\t  日本語ABC  \n\t\t  ```\n",
  },
  {
    description: "an ordered empty ancestor",
    input: "9. - ```txt\n     日本語ABC  \n     ```",
    expected: "9. \n\t- ```txt\n\t  日本語ABC  \n\t  ```\n",
  },
  {
    description: "blank and indented literal code rows",
    input: "- - ```txt\n    \n      日本語ABC  \n    ```",
    expected: "- \n\t- ```txt\n\t  \n\t    日本語ABC  \n\t  ```\n",
  },
])(
  "the default rule profile preserves literal code across repeated full passes for $description",
  async ({ input, expected }) => {
    const request = {
      file,
      indent: { useTabs: true, tabWidth: 4 },
      settings: settings(),
      signal: new AbortController().signal,
    };
    expect(await engine.formatMarkdown({ ...request, text: input })).toBe(
      expected,
    );
    expect(await engine.formatMarkdown({ ...request, text: expected })).toBe(
      expected,
    );
  },
);

test("keeps ordinary formatting and literal token text beside protected code ancestors", async () => {
  const transformed: string[] = [];
  const transform = async (value: string) => {
    transformed.push(value);
    return value;
  };
  const request = {
    file,
    indent: { useTabs: true, tabWidth: 4 },
    settings: settings(),
    signal: new AbortController().signal,
    linker: transform,
    script: transform,
  };
  const input =
    "- - ```txt\n    BULLETEMPTYCODEANCESTOR\n    BULLETEMPTYCODEANCESTORX 日本語ABC  \n    ```\n- 日本語ABC\n- \n\nprose日本語ABC";
  const expected =
    "- \n\t- ```txt\n\t  BULLETEMPTYCODEANCESTOR\n\t  BULLETEMPTYCODEANCESTORX 日本語ABC  \n\t  ```\n- 日本語 ABC\n\nprose 日本語 ABC\n";
  expect(await engine.formatMarkdown({ ...request, text: input })).toBe(
    expected,
  );
  expect(await engine.formatMarkdown({ ...request, text: expected })).toBe(
    expected,
  );
  expect(transformed).toEqual([input, input, expected, expected]);
});

test("does not remove timestamp values that match the internal ancestor marker", async () => {
  const s = settings();
  s.profile.disabledRules = s.profile.disabledRules.filter(
    (rule) => rule !== "yaml-timestamp",
  );
  s.timestamps = {
    kind: "enabled",
    created: true,
    modified: false,
    createdKey: "created",
    modifiedKey: "modified",
    format: "[BULLETEMPTYCODEANCESTOR]",
    createdSource: "filesystem",
    modifiedSource: "filesystem",
    utc: true,
  };
  const request = {
    file,
    indent: { useTabs: true, tabWidth: 4 },
    settings: s,
    signal: new AbortController().signal,
    now: 1577923200000,
  };
  expect(
    await engine.formatMarkdown({
      ...request,
      text: "- - ```txt\n    日本語ABC  \n    ```",
    }),
  ).toBe(
    "---\ncreated: BULLETEMPTYCODEANCESTOR\n---\n- \n\t- ```txt\n\t  日本語ABC  \n\t  ```\n",
  );
});
