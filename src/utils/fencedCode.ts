export interface FenceMarker {
  character: "`" | "~";
  length: number;
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
