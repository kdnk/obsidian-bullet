interface Mutation {
  node: Node;
  read: () => string | null;
  write: (value: string | null) => void;
  before: string | null;
  after: string;
}

interface Preview {
  signature: string;
  pre: HTMLElement;
  button: HTMLElement;
  contents: HTMLElement[];
  text: string[];
  mutations: Mutation[];
}

/** Correct only source-matched processor output; the editor document is untouched. */
export class NestedCodeBlockPreviews {
  private previews = new Map<HTMLElement, Preview>();

  synchronize(
    embed: HTMLElement,
    rawLines: readonly string[],
    contentColumn: number,
    tabSize: number,
    fenceInfo: string,
  ): boolean {
    const pres = embed.querySelectorAll<HTMLElement>(".expressive-code pre");
    const buttons = embed.querySelectorAll<HTMLElement>(
      ".expressive-code .copy button[data-code]",
    );
    const pre = pres.length === 1 ? pres[0] : null;
    const button = buttons.length === 1 ? buttons[0] : null;
    const frame = pre?.closest("figure.frame");
    const terminal = Boolean(
      frame?.classList.contains("is-terminal") &&
      button?.closest("figure.frame") === frame,
    );
    const rows = Array.from(
      pre?.querySelectorAll<HTMLElement>(".ec-line") ?? [],
    );
    const contents = rows.map((row) =>
      row.querySelector<HTMLElement>(":scope > .code"),
    );
    const signature = JSON.stringify([
      rawLines,
      contentColumn,
      tabSize,
      fenceInfo,
      terminal,
    ]);
    const previous = this.previews.get(embed);
    if (
      previous?.signature === signature &&
      previous.pre === pre &&
      previous.button === button &&
      previous.contents.length === contents.length &&
      previous.contents.every(
        (content, i) =>
          content === contents[i] && content.textContent === previous.text[i],
      ) &&
      previous.mutations.every(
        (mutation) =>
          embed.contains(mutation.node) && mutation.read() === mutation.after,
      )
    )
      return false;

    const restored = this.restore(embed);
    const options = wrapOptions(fenceInfo);
    if (
      !pre ||
      !button ||
      !options ||
      !Number.isInteger(contentColumn) ||
      contentColumn <= 0 ||
      !Number.isInteger(tabSize) ||
      tabSize <= 0
    )
      return restored;
    // EC itself trims trailing whitespace and boundary empty rows. Recognize
    // that existing projection, without changing its choice of displayed rows.
    const matchingSource = [
      rawLines.length ? rawLines : [""],
      expressiveCodeLines(rawLines),
    ]
      .flatMap((lines) =>
        (terminal ? [false, true] : [false]).map((filterTerminalComments) => ({
          lines,
          filterTerminalComments,
        })),
      )
      .find(
        ({ lines, filterTerminalComments }) =>
          contents.length === lines.length &&
          button.getAttribute("data-code") ===
            copyCode(lines, filterTerminalComments) &&
          contents.every(
            (content, i) => content?.textContent === (lines[i] || "\n"),
          ),
      );
    if (!matchingSource) return restored;
    const { lines, filterTerminalComments } = matchingSource;
    const normalized = lines.map((line) =>
      normalizeLine(line, contentColumn, tabSize),
    );
    if (normalized.some((line) => line === null)) return restored;
    const text = normalized.map((line) => line!.text);
    // EC counts UTF-16 characters here, including each tab as one character.
    const wrapping = pre.style.getPropertyValue("--ecMaxLine") !== "";
    if (
      wrapping &&
      pre.style.getPropertyValue("--ecMaxLine") !==
        `${Math.max(...lines.map((line) => line.length))}ch`
    )
      return restored;
    const indent = (line: string) =>
      (options.preserveIndent ? /^\s*/.exec(line)![0].length : 0) +
      options.hangingIndent;
    if (
      rows.some(
        (row, i) =>
          row.style.getPropertyValue("--ecIndent") !==
          (wrapping && indent(lines[i]) > 0 ? `${indent(lines[i])}ch` : ""),
      )
    )
      return restored;
    if (
      [pre, ...rows].some(
        (node) =>
          node.style.getPropertyPriority("--ecIndent") ||
          node.style.getPropertyPriority("--ecMaxLine"),
      )
    )
      return restored;

    const mutations: Mutation[] = [];
    const change = (
      node: Node,
      read: Mutation["read"],
      write: Mutation["write"],
      after: string,
    ) => {
      const before = read();
      if (before !== after)
        mutations.push({ node, read, write, before, after });
    };
    const style = (node: HTMLElement, key: string, value: string) =>
      change(
        node,
        () => node.style.getPropertyValue(key),
        (value) => {
          if (value) node.style.setProperty(key, value);
          else node.style.removeProperty(key);
        },
        value,
      );
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === text[i]) continue;
      let remaining = normalized[i]!.removed;
      let prefix = text[i] ? normalized[i]!.prefix : "\n";
      for (const node of textNodes(contents[i]!)) {
        const removed = Math.min(remaining, node.data.length);
        remaining -= removed;
        const after = prefix + node.data.slice(removed);
        prefix = "";
        change(
          node,
          () => node.data,
          (value) => {
            node.data = value ?? "";
          },
          after,
        );
        if (remaining === 0) break;
      }
      if (wrapping)
        style(
          rows[i],
          "--ecIndent",
          indent(text[i]) > 0 ? `${indent(text[i])}ch` : "",
        );
    }
    if (wrapping)
      style(
        pre,
        "--ecMaxLine",
        `${Math.max(...text.map((line) => line.length))}ch`,
      );
    change(
      button,
      () => button.getAttribute("data-code"),
      (value) => {
        if (value === null) button.removeAttribute("data-code");
        else button.setAttribute("data-code", value);
      },
      copyCode(text, filterTerminalComments),
    );
    for (const mutation of mutations) mutation.write(mutation.after);
    this.previews.set(embed, {
      signature,
      pre,
      button,
      contents: contents as HTMLElement[],
      text: text.map((line) => line || "\n"),
      mutations,
    });
    return restored || mutations.length > 0;
  }

  clear(embed: HTMLElement): void {
    this.restore(embed);
  }

  destroy(): void {
    for (const embed of this.previews.keys()) this.restore(embed);
  }

  private restore(embed: HTMLElement): boolean {
    let changed = false;
    for (const mutation of this.previews.get(embed)?.mutations ?? []) {
      if (mutation.read() !== mutation.after) continue;
      mutation.write(mutation.before);
      changed ||= embed.contains(mutation.node);
    }
    this.previews.delete(embed);
    return changed;
  }
}

function normalizeLine(line: string, target: number, tabSize: number) {
  let column = 0;
  let removed = 0;
  while (removed < line.length && column < target) {
    const character = line[removed];
    if (character !== " " && character !== "\t") return null;
    column += character === "\t" ? tabSize - (column % tabSize) : 1;
    removed++;
  }
  const prefix = " ".repeat(Math.max(0, column - target));
  return { text: prefix + line.slice(removed), removed, prefix };
}

function expressiveCodeLines(raw: readonly string[]): string[] {
  const lines = raw.map((line) => line.trimEnd());
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start++;
  while (end > start && lines[end - 1] === "") end--;
  return start === end ? [""] : lines.slice(start, end);
}

function copyCode(lines: readonly string[], filterTerminalComments: boolean) {
  let code = lines.join("\n");
  // Match EC's terminal copy option only when the existing payload proves it
  // is enabled; displaying a terminal frame alone does not imply filtering.
  if (filterTerminalComments)
    code = code.replace(/(?<=^|\n)\s*#.*($|\n+)/g, "").trim();
  return code.replace(/\n/g, "\u007f");
}

function textNodes(node: Node): Text[] {
  if (node.nodeType === 3) return [node as Text];
  return Array.from(node.childNodes).flatMap(textNodes);
}

function wrapOptions(info: string) {
  const result = { preserveIndent: true, hangingIndent: 0 };
  for (const key of ["preserveIndent", "hangingIndent"] as const) {
    const mentions = info.match(new RegExp(key, "g")) ?? [];
    if (!mentions.length) continue;
    const match = new RegExp(`(?:^|\\s)${key}(?:=([^\\s]+))?(?=\\s|$)`).exec(
      info,
    );
    if (mentions.length !== 1 || !match) return null;
    if (key === "preserveIndent") {
      if (match[1] && match[1] !== "true" && match[1] !== "false") return null;
      result.preserveIndent = match[1] !== "false";
    } else {
      if (!/^\d+$/.test(match[1] ?? "")) return null;
      result.hangingIndent = Number(match[1]);
      if (!Number.isSafeInteger(result.hangingIndent)) return null;
    }
  }
  return result;
}
