import { Editor, editorInfoField } from "obsidian";

import {
  foldEffect,
  foldable,
  foldedRanges,
  unfoldEffect,
} from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";

export interface MyEditorPosition {
  line: number;
  ch: number;
}

export interface MyEditorRange {
  from: MyEditorPosition;
  to: MyEditorPosition;
}

export interface MyEditorSelection {
  anchor: MyEditorPosition;
  head: MyEditorPosition;
}

interface EditorWithCodeMirrorView extends Editor {
  cm: EditorView;
}

export function getEditorFromState(state: EditorState) {
  const editorInfo = state.field(editorInfoField);
  const editor = editorInfo?.editor;

  if (!editor) {
    return null;
  }

  return new MyEditor(editor);
}

export function getFoldedLinesFromState(state: EditorState): number[] {
  const editorInfo = state.field(editorInfoField);
  const editor = editorInfo?.editor;

  if (!editor) {
    return [];
  }

  const c = foldedRanges(state).iter();
  const res: number[] = [];
  while (c.value) {
    res.push(editor.offsetToPos(c.from).line);
    c.next();
  }
  return res;
}

function foldInside(view: EditorView, from: number, to: number) {
  let found: { from: number; to: number } | null = null;
  foldedRanges(view.state).between(from, to, (from, to) => {
    if (!found || found.from > from) found = { from, to };
  });
  return found;
}

export class MyEditor {
  private view: EditorView;

  constructor(private e: Editor) {
    this.view = (this.e as unknown as EditorWithCodeMirrorView).cm;
  }

  getCursor(): MyEditorPosition {
    return this.e.getCursor();
  }

  getLine(n: number): string {
    return this.e.getLine(n);
  }

  lastLine(): number {
    return this.e.lastLine();
  }

  listSelections(): MyEditorSelection[] {
    return this.e.listSelections();
  }

  getRange(from: MyEditorPosition, to: MyEditorPosition): string {
    return this.e.getRange(from, to);
  }

  replaceRange(
    replacement: string,
    from: MyEditorPosition,
    to: MyEditorPosition,
  ): void {
    return this.e.replaceRange(replacement, from, to);
  }

  setSelections(selections: MyEditorSelection[]): void {
    this.e.setSelections(selections);
    this.dispatchSelectionsTransaction(selections);
  }

  dispatchCurrentSingleSelectionTransaction(): void {
    const selection = this.view.state.selection.main;

    this.view.dispatch({
      selection: {
        anchor: selection.anchor,
        head: selection.head,
      },
    });
  }

  dispatchSingleSelectionTransaction(selection: MyEditorSelection): void {
    this.dispatchSelectionsTransaction([selection]);
  }

  dispatchSelectionsTransaction(selections: MyEditorSelection[]): void {
    const ranges = selections.map((selection) =>
      EditorSelection.range(
        this.posToDocOffset(selection.anchor),
        this.posToDocOffset(selection.head),
      ),
    );

    this.view.dispatch({
      selection: EditorSelection.create(ranges, ranges.length - 1),
    });
  }

  setValue(text: string): void {
    this.e.setValue(text);
  }

  getValue(): string {
    return this.e.getValue();
  }

  offsetToPos(offset: number): MyEditorPosition {
    return this.e.offsetToPos(offset);
  }

  posToOffset(pos: MyEditorPosition): number {
    return this.e.posToOffset(pos);
  }

  private posToDocOffset(pos: MyEditorPosition): number {
    const line = this.view.state.doc.line(pos.line + 1);

    return Math.min(line.from + pos.ch, line.to);
  }

  fold(n: number): void {
    const { view } = this;
    const l = view.lineBlockAt(view.state.doc.line(n + 1).from);
    const range = foldable(view.state, l.from, l.to);

    if (!range || range.from === range.to) {
      return;
    }

    view.dispatch({ effects: [foldEffect.of(range)] });
  }

  unfold(n: number): void {
    const { view } = this;
    const l = view.lineBlockAt(view.state.doc.line(n + 1).from);
    const range = foldInside(view, l.from, l.to);

    if (!range) {
      return;
    }

    view.dispatch({ effects: [unfoldEffect.of(range)] });
  }

  getAllFoldedLines(): number[] {
    const c = foldedRanges(this.view.state).iter();
    const res: number[] = [];
    while (c.value) {
      res.push(this.offsetToPos(c.from).line);
      c.next();
    }
    return res;
  }

  triggerOnKeyDown(e: KeyboardEvent): void {
    runScopeHandlers(this.view, e, "editor");
  }
}
