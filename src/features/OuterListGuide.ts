import { MyEditor } from "../editor";
import { List, Root } from "../root";
import { Parser, Reader } from "../services/Parser";

export interface OuterListChunk {
  root: Root;
  startLine: number;
  endLine: number;
  id: string;
  actionable: boolean;
}

export function collectOuterListChunks(
  parser: Parser,
  editor: Reader,
): OuterListChunk[] {
  const roots: Root[] = [];
  let segmentStart = 0;

  const appendSegment = (segmentEnd: number) => {
    if (segmentStart <= segmentEnd) {
      roots.push(...parser.parseRange(editor, segmentStart, segmentEnd));
    }
  };

  for (let line = 0; line <= editor.lastLine(); line++) {
    if (editor.getLine(line).trim().length > 0) continue;
    appendSegment(line - 1);
    segmentStart = line + 1;
  }
  appendSegment(editor.lastLine());

  return roots.map((root) => {
    const startLine = root.getContentStart().line;
    const endLine = root.getContentEnd().line;
    return {
      root,
      startLine,
      endLine,
      id: `${startLine}:${endLine}`,
      actionable: isOuterListChunkActionable(root),
    };
  });
}

function isFoldableTopLevelList(list: List) {
  return list.getLineCount() > 1 || !list.isEmpty();
}

export function isOuterListChunkActionable(root: Root) {
  return root.getChildren().some(isFoldableTopLevelList);
}

export function toggleOuterListChunk(
  editor: Pick<MyEditor, "foldEnsuringCursorVisible" | "unfold">,
  root: Root,
) {
  const targets = root.getChildren().filter(isFoldableTopLevelList);
  if (targets.length === 0) return false;

  const shouldUnfold = targets.every((target) => target.isFolded());
  for (const target of targets) {
    const fallbackCursor = target.getFirstLineContentStart();
    if (shouldUnfold) {
      editor.unfold(fallbackCursor.line);
    } else {
      editor.foldEnsuringCursorVisible(fallbackCursor.line, fallbackCursor);
    }
  }
  return true;
}
