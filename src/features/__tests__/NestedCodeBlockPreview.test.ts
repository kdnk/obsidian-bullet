import { NestedCodeBlockPreviews } from "../NestedCodeBlockPreview";

function element(children: Array<ReturnType<typeof text> | HTMLElement> = []) {
  const values = new Map<string, string>();
  const attributes = new Map<string, string>();
  const selectors = new Map<string, HTMLElement[]>();
  const result = {
    nodeType: 1,
    childNodes: children,
    replaceChildren: (...nodes: HTMLElement[]) =>
      children.splice(0, children.length, ...nodes),
    get textContent(): string {
      return children.map((child) => child.textContent).join("");
    },
    style: {
      getPropertyValue: (key: string) => values.get(key) ?? "",
      getPropertyPriority: () => "",
      setProperty: (key: string, value: string) => values.set(key, value),
      removeProperty: (key: string) => values.delete(key),
    },
    getAttribute: (key: string) => attributes.get(key) ?? null,
    setAttribute: (key: string, value: string) => attributes.set(key, value),
    removeAttribute: (key: string) => attributes.delete(key),
    classList: {
      contains: (name: string) =>
        (attributes.get("class") ?? "").split(" ").includes(name),
    },
    querySelectorAll: (selector: string) => selectors.get(selector) ?? [],
    querySelector: (selector: string) => selectors.get(selector)?.[0] ?? null,
    closest: (selector: string) =>
      selectors.get(`closest:${selector}`)?.[0] ?? null,
    contains: (node: Node): boolean =>
      node === (result as unknown) ||
      children.some(
        (child) =>
          child === node || ("contains" in child && child.contains(node)),
      ),
    selectors,
  };
  return result as unknown as HTMLElement & { selectors: typeof selectors };
}

function text(data: string) {
  return {
    nodeType: 3,
    data,
    get textContent() {
      return this.data;
    },
  };
}

function fixture(lines: readonly string[]) {
  const tokens = lines.map((line) => {
    const prefix = line.match(/^[ \t]*/)?.[0] ?? "";
    return [
      text(prefix),
      text(line.slice(prefix.length) || (line ? "" : "\n")),
    ];
  });
  const contents = tokens.map(([prefix, token]) =>
    element([element([element([prefix])]), element([token])]),
  );
  const rows = contents.map((content) => {
    const row = element([content]);
    row.selectors.set(":scope > .code", [content]);
    return row;
  });
  const pre = element(rows);
  pre.selectors.set(".ec-line", rows);
  const button = element();
  button.setAttribute("data-code", lines.join("\u007f"));
  const frame = element([pre, button]);
  frame.setAttribute("class", "frame");
  pre.selectors.set("closest:figure.frame", [frame]);
  button.selectors.set("closest:figure.frame", [frame]);
  const embed = element([frame]);
  embed.selectors.set(".expressive-code pre", [pre]);
  embed.selectors.set(".expressive-code .copy button[data-code]", [button]);
  return { embed, frame, pre, rows, contents, tokens, button };
}

function rendererStyle(node: HTMLElement, name: string, value: string) {
  node.style.setProperty(name, value);
}

test.each([
  { raw: ["  hello", "    nested"], column: 2, want: ["hello", "  nested"] },
  {
    raw: ["\t\t  hello", "\t\t  \tdeep"],
    column: 10,
    want: ["hello", "\tdeep"],
  },
  { raw: ["\tvalue"], column: 2, want: ["  value"] },
  { raw: ["", " ", "  ", "    x"], column: 2, want: ["\n", "\n", "\n", "  x"] },
])("removes only structural columns from $raw", ({ raw, column, want }) => {
  const preview = fixture(raw);
  const owner = new NestedCodeBlockPreviews();
  expect(owner.synchronize(preview.embed, raw, column, 4, "js")).toBe(true);
  expect(preview.contents.map((content) => content.textContent)).toEqual(want);
  expect(preview.button.getAttribute("data-code")).toBe(
    want.map((line) => (line === "\n" ? "" : line)).join("\u007f"),
  );
  expect(owner.synchronize(preview.embed, raw, column, 4, "js")).toBe(false);
  owner.destroy();
  expect(preview.contents.map((content) => content.textContent)).toEqual(
    raw.map((line) => line || "\n"),
  );
});

test("preserves wrapping indentation and restores its previous styles", () => {
  const raw = ["\tvalue", "\t  longer"];
  const preview = fixture(raw);
  rendererStyle(preview.pre, "--ecMaxLine", "9ch");
  rendererStyle(preview.rows[0], "--ecIndent", "4ch");
  rendererStyle(preview.rows[1], "--ecIndent", "6ch");
  const owner = new NestedCodeBlockPreviews();
  expect(
    owner.synchronize(preview.embed, raw, 2, 4, "js wrap hangingIndent=3"),
  ).toBe(true);
  expect(
    preview.rows.map((row) => row.style.getPropertyValue("--ecIndent")),
  ).toEqual(["5ch", "7ch"]);
  expect(preview.pre.style.getPropertyValue("--ecMaxLine")).toBe("10ch");
  owner.clear(preview.embed);
  expect(preview.pre.style.getPropertyValue("--ecMaxLine")).toBe("9ch");
  expect(
    preview.rows.map((row) => row.style.getPropertyValue("--ecIndent")),
  ).toEqual(["4ch", "6ch"]);
});

test("keeps hanging indentation when preserving source indentation is disabled", () => {
  const raw = ["  hello"];
  const preview = fixture(raw);
  rendererStyle(preview.pre, "--ecMaxLine", "7ch");
  rendererStyle(preview.rows[0], "--ecIndent", "3ch");
  const owner = new NestedCodeBlockPreviews();
  expect(
    owner.synchronize(
      preview.embed,
      raw,
      2,
      4,
      "js preserveIndent=false hangingIndent=3",
    ),
  ).toBe(true);
  expect(preview.rows[0].style.getPropertyValue("--ecIndent")).toBe("3ch");
});

test("matches EC's existing blank-line and trailing-space normalization", () => {
  const raw = ["", "  ", "\t  hello  ", " \t", "\t    deeper\t", ""];
  const rendered = ["\t  hello", "", "\t    deeper"];
  const preview = fixture(rendered);
  const owner = new NestedCodeBlockPreviews();
  expect(owner.synchronize(preview.embed, raw, 6, 4, "js")).toBe(true);
  expect(preview.contents.map((content) => content.textContent)).toEqual([
    "hello",
    "\n",
    "  deeper",
  ]);
  expect(preview.button.getAttribute("data-code")).toBe(
    "hello\u007f\u007f  deeper",
  );
  expect(owner.synchronize(preview.embed, raw, 6, 4, "js")).toBe(false);
  owner.destroy();
  expect(preview.contents.map((content) => content.textContent)).toEqual([
    "\t  hello",
    "\n",
    "\t    deeper",
  ]);
  expect(preview.button.getAttribute("data-code")).toBe(
    "\t  hello\u007f\u007f\t    deeper",
  );
});

test("retains terminal comment filtering and trimming while removing structural columns", () => {
  const raw = ["  # Setup", "    echo one", "  # Skip", "    echo two"];
  const preview = fixture(raw);
  preview.frame.setAttribute("class", "frame is-terminal");
  preview.button.setAttribute("data-code", "echo one\u007f    echo two");
  const owner = new NestedCodeBlockPreviews();
  expect(owner.synchronize(preview.embed, raw, 2, 4, "bash")).toBe(true);
  expect(preview.contents.map((content) => content.textContent)).toEqual([
    "# Setup",
    "  echo one",
    "# Skip",
    "  echo two",
  ]);
  expect(preview.button.getAttribute("data-code")).toBe(
    "echo one\u007f  echo two",
  );
  expect(owner.synchronize(preview.embed, raw, 2, 4, "bash")).toBe(false);
  owner.destroy();
  expect(preview.button.getAttribute("data-code")).toBe(
    "echo one\u007f    echo two",
  );
  expect(preview.contents.map((content) => content.textContent)).toEqual(raw);
});

test("keeps comments when terminal copy filtering is disabled", () => {
  const raw = ["  # Setup", "  echo one", "  echo two"];
  const preview = fixture(raw);
  preview.frame.setAttribute("class", "frame is-terminal");
  const owner = new NestedCodeBlockPreviews();
  expect(owner.synchronize(preview.embed, raw, 2, 4, "bash")).toBe(true);
  expect(preview.button.getAttribute("data-code")).toBe(
    "# Setup\u007fecho one\u007fecho two",
  );
});

test.each([
  [
    ["  echo one", "  # first", "  # second", "", "  echo two"],
    "echo one\u007f  echo two",
    "echo one\u007fecho two",
  ],
  [
    ["  # first", "", "  # second", "  echo # inline", "  # last"],
    "echo # inline",
    "echo # inline",
  ],
  [
    ["  echo one", "", "  # comment", "", "  echo two", "", "  echo three"],
    "echo one\u007f  echo two\u007f\u007f  echo three",
    "echo one\u007fecho two\u007f\u007fecho three",
  ],
  [["  # first", "  # second"], "", ""],
])(
  "preserves terminal copy filtering across comment boundaries: %j",
  (raw, before, after) => {
    const preview = fixture(raw);
    preview.frame.setAttribute("class", "frame is-terminal");
    preview.button.setAttribute("data-code", before);
    const owner = new NestedCodeBlockPreviews();
    expect(owner.synchronize(preview.embed, raw, 2, 4, "bash")).toBe(true);
    expect(preview.button.getAttribute("data-code")).toBe(after);
    expect(owner.synchronize(preview.embed, raw, 2, 4, "bash")).toBe(false);
    owner.destroy();
    expect(preview.button.getAttribute("data-code")).toBe(before);
    expect(preview.contents.map((content) => content.textContent)).toEqual(
      raw.map((line) => line || "\n"),
    );
  },
);

test("does not match terminal copy content owned by another frame", () => {
  const raw = ["  # Setup", "  echo one", "  echo two"];
  const preview = fixture(raw);
  preview.frame.setAttribute("class", "frame is-terminal");
  preview.button.setAttribute("data-code", "echo one\u007f  echo two");
  preview.button.selectors.set("closest:figure.frame", [element()]);
  const owner = new NestedCodeBlockPreviews();
  expect(owner.synchronize(preview.embed, raw, 2, 4, "bash")).toBe(false);
  expect(preview.contents.map((content) => content.textContent)).toEqual(raw);
});

test.each(["body", "copy", "metadata", "style"])(
  "leaves ambiguous %s output unchanged",
  (mismatch) => {
    const raw = ["  hello"];
    const preview = fixture(raw);
    if (mismatch === "body") preview.tokens[0][1].data = "other";
    if (mismatch === "copy") preview.button.setAttribute("data-code", "hello");
    if (mismatch === "style") {
      rendererStyle(preview.pre, "--ecMaxLine", "7ch");
      rendererStyle(preview.rows[0], "--ecIndent", "9ch");
    }
    const before = preview.embed.textContent;
    const owner = new NestedCodeBlockPreviews();
    expect(
      owner.synchronize(
        preview.embed,
        raw,
        2,
        4,
        mismatch === "metadata" ? 'js preserveIndent="false"' : "js",
      ),
    ).toBe(false);
    expect(preview.embed.textContent).toBe(before);
  },
);

test("normalizes replacement nodes and does not overwrite a renderer's later edits", () => {
  const raw = ["  hello"];
  const initial = fixture(raw);
  const owner = new NestedCodeBlockPreviews();
  owner.synchronize(initial.embed, raw, 2, 4, "js");
  const replacement = fixture(raw);
  initial.embed.replaceChildren(replacement.frame);
  initial.embed.selectors.set(".expressive-code pre", [replacement.pre]);
  initial.embed.selectors.set(".expressive-code .copy button[data-code]", [
    replacement.button,
  ]);
  expect(owner.synchronize(initial.embed, raw, 2, 4, "js")).toBe(true);
  expect(replacement.contents[0].textContent).toBe("hello");
  replacement.tokens[0][0].data = "renderer edit";
  owner.clear(initial.embed);
  expect(replacement.tokens[0][0].data).toBe("renderer edit");
});
