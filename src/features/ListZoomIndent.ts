import { EditorState, Range, countColumn } from "@codemirror/state";
import { Decoration, DecorationSet } from "@codemirror/view";

export function zoomIndentDecorations(
  state: EditorState,
  from: number,
  to: number,
  indent: string,
): DecorationSet {
  const base = countColumn(indent, state.tabSize);
  if (!base) return Decoration.none;
  const decorations: Range<Decoration>[] = [];
  for (
    let n = state.doc.lineAt(from).number;
    n <= state.doc.lineAt(to).number;
    n++
  ) {
    const line = state.doc.line(n);
    const prefix = /^[ \t]*/.exec(line.text)![0];
    let column = 0;
    let hidden = 0;
    for (let i = 0; i < prefix.length; i++) {
      const tab = prefix[i] === "\t";
      const next =
        column + (tab ? state.tabSize - (column % state.tabSize) : 1);
      if (next <= base) {
        hidden = i + 1;
      } else if (tab) {
        const visibleBefore = Math.max(0, column - base);
        const retained = next - base - visibleBefore;
        if (retained !== state.tabSize - (visibleBefore % state.tabSize))
          decorations.push(
            Decoration.mark({
              class: "bullet-zoom-tab",
              attributes: { style: `--bullet-zoom-tab-width: ${retained}ch` },
            }).range(line.from + i, line.from + i + 1),
          );
      }
      column = next;
    }
    if (hidden)
      decorations.push(
        Decoration.replace({}).range(line.from, line.from + hidden),
      );
  }
  return Decoration.set(decorations, true);
}
