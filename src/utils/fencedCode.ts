export interface FenceMarker {
  character: "`" | "~";
  length: number;
}

function indentColumns(indent: string): number {
  let column = 0;
  for (const character of indent)
    column += character === "\t" ? 4 - (column % 4) : 1;
  return column;
}

export function reindentListPrefix(
  prefix: string,
  oldIndent: string,
  newIndent: string,
): string {
  const difference = indentColumns(newIndent) - indentColumns(oldIndent);
  if (!prefix.startsWith(oldIndent))
    return shiftIndentColumns(prefix, difference);
  const candidate = newIndent + prefix.slice(oldIndent.length);
  // A retained tab can reach a different stop after its prefix changes. Keep
  // the original code columns, expanding only the part that no longer fits.
  return shiftIndentColumns(
    candidate,
    indentColumns(prefix) + difference - indentColumns(candidate),
  );
}

export function shiftIndentColumns(indent: string, difference: number): string {
  if (difference >= 0) return indent + " ".repeat(difference);
  const target = Math.max(0, indentColumns(indent) + difference);
  let column = 0;
  let offset = 0;
  while (offset < indent.length) {
    const next = column + (indent[offset] === "\t" ? 4 - (column % 4) : 1);
    if (next > target) break;
    column = next;
    offset++;
  }
  return indent.slice(0, offset) + " ".repeat(target - column);
}

/** Resolve the container by columns without rewriting the source's tabs. */
export function getFenceContent(
  line: string,
  containerIndent: string,
): { offset: number; text: string } | null {
  const required = indentColumns(containerIndent);
  let column = 0;
  let offset = 0;
  while (column < required && offset < line.length) {
    const character = line[offset];
    if (character !== " " && character !== "\t") return null;
    column += character === "\t" ? 4 - (column % 4) : 1;
    offset++;
  }
  if (column < required) return null;
  // A tab may cross the container boundary. Its remaining columns count as
  // code indentation for fence matching, while offset retains the raw prefix.
  return { offset, text: " ".repeat(column - required) + line.slice(offset) };
}

export function getFenceOpening(text: string): FenceMarker | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
  if (!match) return null;
  const marker = match[1];
  if (marker[0] === "`" && match[2].includes("`")) return null;
  return {
    character: marker[0] as FenceMarker["character"],
    length: marker.length,
  };
}

export function isFenceClosing(text: string, opening: FenceMarker): boolean {
  const match = /^ {0,3}(`+|~+)[ \t]*$/.exec(text);
  return (
    match !== null &&
    match[1][0] === opening.character &&
    match[1].length >= opening.length
  );
}

export function endsWithClosedFence(lines: readonly string[]): boolean {
  let opening: FenceMarker | null = null;
  let lastClosing = -1;
  for (const [index, line] of lines.entries()) {
    if (opening) {
      if (isFenceClosing(line, opening)) {
        opening = null;
        lastClosing = index;
      }
      continue;
    }
    opening = getFenceOpening(line);
  }
  return opening === null && lastClosing === lines.length - 1;
}
