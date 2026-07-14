import { Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

import { MyEditor } from "../editor";
import { List, Root } from "../root";
import { Parser, Reader } from "../services/Parser";

export const OUTER_LIST_GUIDE_CLASS = "bullet-plugin-outer-list-guide";
export const OUTER_LIST_GUIDE_SELECTOR = `.${OUTER_LIST_GUIDE_CLASS}`;

export interface OuterListChunk {
  root: Root;
  startLine: number;
  endLine: number;
  id: string;
  actionable: boolean;
}

export class OuterListGuideWidget extends WidgetType {
  constructor(
    private chunk: Pick<
      OuterListChunk,
      "id" | "startLine" | "endLine" | "actionable"
    >,
  ) {
    super();
  }

  eq(other: WidgetType) {
    return (
      other instanceof OuterListGuideWidget &&
      this.chunk.id === other.chunk.id &&
      this.chunk.actionable === other.chunk.actionable
    );
  }

  toDOM(view: EditorView) {
    const element = view.dom.ownerDocument.createElement("span");
    element.className = OUTER_LIST_GUIDE_CLASS;
    element.dataset.chunkId = this.chunk.id;
    element.dataset.chunkStart = String(this.chunk.startLine);
    element.dataset.chunkEnd = String(this.chunk.endLine);
    element.dataset.actionable = String(this.chunk.actionable);
    element.setAttribute("aria-hidden", "true");
    return element;
  }

  ignoreEvent() {
    return false;
  }
}

export function buildOuterListGuideDecorations(
  doc: Text,
  chunks: readonly OuterListChunk[],
) {
  const ranges = chunks.flatMap((chunk) =>
    Array.from({ length: chunk.endLine - chunk.startLine + 1 }, (_, index) =>
      Decoration.widget({
        widget: new OuterListGuideWidget(chunk),
        side: -1,
      }).range(doc.line(chunk.startLine + index + 1).from),
    ),
  );
  return Decoration.set(ranges, true);
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
