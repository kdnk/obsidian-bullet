import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

const correctSnapshotAnchor = (view: EditorView, value: unknown) => {
  if (
    value &&
    typeof value === "object" &&
    "range" in value &&
    "yMargin" in value &&
    typeof value.yMargin === "number"
  ) {
    const { scrollTop } = view.scrollDOM;
    const viewportTop = view.scrollDOM.getBoundingClientRect().top;
    const { documentTop } = view;
    if (
      [scrollTop, viewportTop, documentTop].every((coordinate) =>
        Number.isFinite(coordinate),
      )
    ) {
      const anchor = view.lineBlockAtHeight(
        Math.max(0, viewportTop - documentTop + 8),
      );
      if (Number.isFinite(anchor.from) && Number.isFinite(anchor.top)) {
        const ratio = view.dom.ownerDocument.defaultView?.devicePixelRatio ?? 1;
        const pixelScale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
        value.range = EditorSelection.cursor(anchor.from);
        value.yMargin =
          Math.round((anchor.top - scrollTop) * pixelScale) / pixelScale;
      }
    }
  }
};
export const formattingScrollSnapshot = (view: EditorView) => {
  if (typeof view.scrollSnapshot !== "function") return;
  view.lineBlockAtHeight(0);
  const snapshot = view.scrollSnapshot();
  correctSnapshotAnchor(view, snapshot.value);
  return snapshot;
};
