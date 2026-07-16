import { EditorView } from "@codemirror/view";

export function ensureFoldScrollReserve(view: EditorView): void {
  const expected =
    view.scrollDOM.clientHeight -
    view.defaultLineHeight -
    view.documentPadding.top -
    0.5;
  const current = Number.parseFloat(view.contentDOM.style.paddingBottom);
  if (
    Number.isFinite(expected) &&
    expected >= 0 &&
    (!Number.isFinite(current) || current < expected)
  ) {
    view.contentDOM.style.paddingBottom = `${expected}px`;
  }
}
