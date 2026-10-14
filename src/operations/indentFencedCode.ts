import { countColumn } from "@codemirror/state";

import {
  OperationOutcome,
  STOP_ONLY_OUTCOME,
  UPDATED_OUTCOME,
} from "./Operation";

import { Position, Root, maxPos, minPos } from "../root";
import {
  getFenceContent,
  getFenceOpening,
  isFenceClosing,
  reindentListPrefix,
  shiftIndentColumns,
} from "../utils/fencedCode";

export function indentFencedCode(
  root: Root,
  direction: "indent" | "outdent",
  indentChars: string,
): OperationOutcome | null {
  if (!root.hasSingleSelection()) return null;
  const selection = root.getSelection();
  const from = minPos(selection.anchor, selection.head);
  const to = maxPos(selection.anchor, selection.head);
  const lastLine = to.line > from.line && to.ch === 0 ? to.line - 1 : to.line;
  const list = root.getListUnderLine(from.line);
  if (!list || list !== root.getListUnderLine(lastLine)) return null;
  const startLine = root.getContentLinesRangeOf(list)[0];
  const first = from.line - startLine;
  const last = lastLine - startLine;
  const lines = list.getLinesForFenceParsing();
  const blocks: (number | null)[] = [];
  const delimiters = new Set<number>();
  let opening: ReturnType<typeof getFenceOpening> = null;
  let block = -1;
  for (const [index, line] of lines.entries()) {
    if (opening) {
      if (isFenceClosing(line, opening)) {
        delimiters.add(index);
        opening = null;
        blocks.push(null);
      } else {
        blocks.push(block);
      }
    } else {
      opening = getFenceOpening(line);
      if (opening) {
        block = index;
        delimiters.add(index);
      }
      blocks.push(null);
    }
  }
  if (first === last && first > 0 && delimiters.has(first))
    return STOP_ONLY_OUTCOME;
  const selectedBlock = blocks[first];
  if (selectedBlock === null || selectedBlock === undefined) return null;
  if (blocks.slice(first, last + 1).some((block) => block !== selectedBlock))
    return STOP_ONLY_OUTCOME;

  const container = list.getNotesIndentOrThrow();
  const containerWidth = countColumn(container, 4);
  const unitWidth = countColumn(indentChars, 4);
  const rawLines = list.print().split("\n");
  const changes = new Map<
    number,
    {
      from: number;
      before: number;
      after: number;
      minimum: number;
    }
  >();
  for (let index = first; index <= last; index++) {
    const raw = rawLines[index];
    const prefix = raw.match(/^[ \t]*/)?.[0] ?? "";
    const width = countColumn(prefix, 4);
    const nextPrefix =
      direction === "indent"
        ? reindentListPrefix(
            width < containerWidth ? container : prefix,
            "",
            indentChars,
          )
        : shiftIndentColumns(
            prefix,
            -Math.min(unitWidth, Math.max(0, width - containerWidth)),
          );
    if (prefix === nextPrefix) continue;
    const adjusted = nextPrefix + raw.slice(prefix.length);
    const content = getFenceContent(adjusted, container);
    if (!content) return STOP_ONLY_OUTCOME;
    list.replaceLine(
      index,
      adjusted.slice(content.offset),
      adjusted.slice(0, content.offset),
    );
    let from = 0;
    while (
      from < Math.min(prefix.length, nextPrefix.length) &&
      prefix[from] === nextPrefix[from]
    )
      from++;
    let before = prefix.length;
    let after = nextPrefix.length;
    while (
      before > from &&
      after > from &&
      prefix[before - 1] === nextPrefix[after - 1]
    ) {
      before--;
      after--;
    }
    changes.set(startLine + index, {
      from,
      before,
      after,
      minimum: content.offset,
    });
  }
  if (changes.size === 0) return STOP_ONLY_OUTCOME;
  const mapPosition = (position: Position): Position => {
    const change = changes.get(position.line);
    if (!change) return position;
    const ch =
      position.ch < change.from
        ? position.ch
        : position.ch >= change.before
          ? position.ch + change.after - change.before
          : change.after;
    return { ...position, ch: Math.max(change.minimum, ch) };
  };
  root.replaceSelections([
    {
      anchor: mapPosition(selection.anchor),
      head: mapPosition(selection.head),
    },
  ]);
  return UPDATED_OUTCOME;
}
