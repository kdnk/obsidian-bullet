import { syntaxTree } from "@codemirror/language";
import { ChangeSet, EditorState, countColumn } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewUpdate,
} from "@codemirror/view";

const CODE_BLOCK_CLASS = "bullet-plugin-nested-code-block";
const CODE_CONTENT_CLASS = "bullet-plugin-nested-code-block-content";
const CODE_BLOCK_INSET = "--bullet-nested-code-block-inset";
const listFenceRe = /^([ \t]*)([-*+]|\d+\.)([ \t]+)(`{3,}|~{3,})/;

interface MeasuredLine {
  element: HTMLElement;
  inset: string;
}

interface FenceOpening {
  contentColumn: number;
  sourceOffset: number;
  openingLineNumber: number;
}

type LineNameAt = (lineNumber: number) => string | null;
type FenceOpeningAt = (lineNumber: number) => FenceOpening | null;

interface SyntaxContext {
  tree: ReturnType<typeof syntaxTree>;
  lineNameAt: LineNameAt;
  fenceOpenings: FenceOpeningIndex;
}

class FenceOpeningIndex {
  private cache = new Map<number, FenceOpening | null>();

  constructor(
    private state: EditorState,
    private lineNameAt: LineNameAt,
  ) {}

  at = (lineNumber: number): FenceOpening | null => {
    const requestedName = this.lineNameAt(lineNumber);
    if (requestedName === null || !isNestedCodeBlockName(requestedName)) {
      this.cache.set(lineNumber, null);
      return null;
    }
    if (hasClassName(requestedName, "HyperMD-codeblock-begin")) {
      const opening = parseFenceOpening(this.state, lineNumber);
      this.cache.set(lineNumber, opening);
      return opening;
    }
    if (this.cache.has(lineNumber)) return this.cache.get(lineNumber) ?? null;

    let result: FenceOpening | null = null;
    for (let current = lineNumber; current >= 1; current--) {
      if (this.cache.has(current)) {
        result = this.cache.get(current) ?? null;
        break;
      }
      const name = this.lineNameAt(current);
      if (name === null || !isNestedCodeBlockName(name)) break;
      if (!hasClassName(name, "HyperMD-codeblock-begin")) continue;
      result = parseFenceOpening(this.state, current);
      break;
    }

    this.cache.set(lineNumber, result);
    if (result) this.cache.set(result.openingLineNumber, result);
    return result;
  };

  map(
    changes: ChangeSet,
    nextState: EditorState,
    nextLineNameAt: LineNameAt,
  ): FenceOpeningIndex {
    const next = new FenceOpeningIndex(nextState, nextLineNameAt);
    const changedRanges: Array<{
      fromA: number;
      toA: number;
      fromB: number;
      toB: number;
    }> = [];
    changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      changedRanges.push({ fromA, toA, fromB, toB });
    });

    for (const [lineNumber, opening] of this.cache) {
      if (!opening) continue;
      const line = this.state.doc.line(lineNumber);
      const structurallyChanged = changedRanges.some((range) => {
        if (
          range.toA < this.state.doc.line(opening.openingLineNumber).from ||
          range.fromA > line.to
        ) {
          return false;
        }
        const changeStaysOnLine =
          range.fromA >= line.from &&
          range.toA <= line.to &&
          !this.state.doc.sliceString(range.fromA, range.toA).includes("\n") &&
          !nextState.doc.sliceString(range.fromB, range.toB).includes("\n");
        return !changeStaysOnLine;
      });
      if (structurallyChanged) continue;

      const mappedLine = nextState.doc.lineAt(changes.mapPos(line.from, -1));
      const oldOpeningLine = this.state.doc.line(opening.openingLineNumber);
      const mappedOpeningLine = nextState.doc.lineAt(
        changes.mapPos(oldOpeningLine.from, -1),
      );
      const mappedOpening = parseFenceOpening(
        nextState,
        mappedOpeningLine.number,
      );
      const mappedName = nextLineNameAt(mappedLine.number);
      if (
        mappedOpening &&
        mappedName !== null &&
        isNestedCodeBlockName(mappedName)
      ) {
        next.cache.set(mappedLine.number, mappedOpening);
      }
    }

    return next;
  }

  retainVisible(
    state: EditorState,
    visibleRanges: readonly { from: number; to: number }[],
  ) {
    const retained = new Set<number>();
    for (const range of visibleRanges) {
      const firstLine = state.doc.lineAt(range.from).number;
      const lastLine = state.doc.lineAt(range.to).number;
      for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) {
        retained.add(lineNumber);
        const opening = this.cache.get(lineNumber);
        if (opening) retained.add(opening.openingLineNumber);
      }
    }
    for (const lineNumber of this.cache.keys()) {
      if (!retained.has(lineNumber)) this.cache.delete(lineNumber);
    }
  }
}

export class NestedCodeBlockLayoutPluginValue {
  decorations: DecorationSet;
  private styledLines = new Set<HTMLElement>();
  private animationFrame: number | null = null;
  private destroyed = false;
  private syntaxContext: SyntaxContext;

  private measurement = {
    read: () => this.measureLines(),
    write: (lines: MeasuredLine[]) => this.applyMeasurements(lines),
  };

  constructor(
    private view: EditorView,
    private lineNameAtOverride?: LineNameAt,
  ) {
    this.syntaxContext = makeSyntaxContext(view.state, this.lineNameAtOverride);
    this.decorations = codeBlockContentDecorations(
      view.state,
      view.visibleRanges,
      this.syntaxContext.lineNameAt,
      this.syntaxContext.fenceOpenings.at,
    );
    this.syntaxContext.fenceOpenings.retainVisible(
      view.state,
      view.visibleRanges,
    );
    this.scheduleMeasure();
  }

  update(update: ViewUpdate) {
    const treeChanged = this.syntaxContext.tree !== syntaxTree(update.state);
    if (update.docChanged || treeChanged) {
      const nextContext = makeSyntaxContext(
        update.state,
        this.lineNameAtOverride,
      );
      if (update.docChanged) {
        nextContext.fenceOpenings = this.syntaxContext.fenceOpenings.map(
          update.changes,
          update.state,
          nextContext.lineNameAt,
        );
      }
      this.syntaxContext = nextContext;
    }
    if (update.docChanged || update.viewportChanged || treeChanged) {
      this.decorations = codeBlockContentDecorations(
        update.state,
        update.view.visibleRanges,
        this.syntaxContext.lineNameAt,
        this.syntaxContext.fenceOpenings.at,
      );
      this.syntaxContext.fenceOpenings.retainVisible(
        update.state,
        update.view.visibleRanges,
      );
    }
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.geometryChanged ||
      treeChanged
    ) {
      this.scheduleMeasure();
    }
  }

  destroy() {
    this.destroyed = true;
    if (this.animationFrame !== null) {
      this.view.dom.ownerDocument.defaultView?.cancelAnimationFrame(
        this.animationFrame,
      );
      this.animationFrame = null;
    }
    this.clearStyles();
  }

  private scheduleMeasure() {
    if (this.destroyed || this.animationFrame !== null) return;
    const win = this.view.dom.ownerDocument.defaultView;
    if (!win) {
      this.view.requestMeasure(this.measurement);
      return;
    }
    this.animationFrame = win.requestAnimationFrame(() => {
      this.animationFrame = null;
      if (this.destroyed) return;
      this.view.requestMeasure(this.measurement);
    });
  }

  private measureLines(): MeasuredLine[] {
    if (this.destroyed) return [];
    const elements = Array.from(
      this.view.contentDOM.querySelectorAll<HTMLElement>(".cm-line"),
    );
    const measured: MeasuredLine[] = [];
    const fenceOpeningAt = this.syntaxContext.fenceOpenings.at;
    let currentInset: string | null = null;
    let previousLineNumber: number | null = null;

    for (const element of elements) {
      if (!isNestedCodeBlockElement(element)) continue;

      const line = documentLineForElement(this.view, element);
      if (!line) continue;
      const opening = fenceOpeningAt(line.number);
      if (!opening) continue;

      const isOpening = element.classList.contains("HyperMD-codeblock-begin");
      if (isOpening) {
        currentInset =
          measureOpeningInset(element) ??
          measureContentInset(
            this.view,
            element,
            line.from + opening.sourceOffset,
            false,
          );
      } else if (
        previousLineNumber !== line.number - 1 ||
        currentInset === null
      ) {
        const contentOffset = offsetAtColumn(
          line.text,
          opening.contentColumn,
          this.view.state.tabSize,
        );
        currentInset =
          contentOffset === null
            ? null
            : measureContentInset(
                this.view,
                element,
                line.from + contentOffset,
                true,
              );
      }
      const inset = currentInset;
      if (inset !== null) measured.push({ element, inset });
      previousLineNumber = line.number;
      if (element.classList.contains("HyperMD-codeblock-end")) {
        currentInset = null;
        previousLineNumber = null;
      }
    }

    return measured;
  }

  private applyMeasurements(lines: MeasuredLine[]) {
    if (this.destroyed) return;
    this.clearStyles();

    for (const { element, inset } of lines) {
      element.classList.add(CODE_BLOCK_CLASS);
      element.style.setProperty(CODE_BLOCK_INSET, inset);
      this.styledLines.add(element);
    }
  }

  private clearStyles() {
    for (const element of this.styledLines) {
      element.classList.remove(CODE_BLOCK_CLASS);
      element.style.removeProperty(CODE_BLOCK_INSET);
    }
    this.styledLines.clear();
  }
}

export function nestedCodeBlockContentDecorations(
  state: EditorState,
  visibleRanges: readonly { from: number; to: number }[] = [
    { from: 0, to: state.doc.length },
  ],
  lineNameAt: LineNameAt = makeLineNameResolver(state),
): DecorationSet {
  return codeBlockContentDecorations(
    state,
    visibleRanges,
    lineNameAt,
    new FenceOpeningIndex(state, lineNameAt).at,
  );
}

function codeBlockContentDecorations(
  state: EditorState,
  visibleRanges: readonly { from: number; to: number }[],
  lineNameAt: LineNameAt,
  fenceOpeningAt: FenceOpeningAt,
): DecorationSet {
  const decorations = [];
  const visitedLines = new Set<number>();

  for (const range of visibleRanges) {
    let line = state.doc.lineAt(range.from);
    const lastLine = state.doc.lineAt(range.to).number;

    while (line.number <= lastLine) {
      if (visitedLines.has(line.number)) {
        if (line.number === state.doc.lines) break;
        line = state.doc.line(line.number + 1);
        continue;
      }
      visitedLines.add(line.number);
      const name = lineNameAt(line.number);
      if (
        name !== null &&
        isNestedCodeBlockName(name) &&
        !hasClassName(name, "HyperMD-codeblock-begin") &&
        !hasClassName(name, "HyperMD-codeblock-end")
      ) {
        const opening = fenceOpeningAt(line.number);
        const contentOffset = opening
          ? offsetAtColumn(line.text, opening.contentColumn, state.tabSize)
          : null;
        if (contentOffset !== null && contentOffset < line.text.length) {
          decorations.push(
            Decoration.mark({ class: CODE_CONTENT_CLASS }).range(
              line.from + contentOffset,
              line.from + contentOffset + 1,
            ),
          );
        }
      }

      if (line.number === state.doc.lines) break;
      line = state.doc.line(line.number + 1);
    }
  }

  return Decoration.set(decorations, true);
}

function makeSyntaxContext(
  state: EditorState,
  lineNameAtOverride?: LineNameAt,
): SyntaxContext {
  const tree = syntaxTree(state);
  const lineNameAt = lineNameAtOverride ?? makeLineNameResolver(state, tree);
  return {
    tree,
    lineNameAt,
    fenceOpenings: new FenceOpeningIndex(state, lineNameAt),
  };
}

function makeLineNameResolver(
  state: EditorState,
  tree = syntaxTree(state),
): LineNameAt {
  return (lineNumber) => {
    const line = state.doc.line(lineNumber);
    let node: ReturnType<typeof tree.resolve> | null = tree.resolve(
      line.from,
      1,
    );
    let lineNodeName: string | null = null;
    while (node !== null) {
      if (
        node.from === line.from &&
        node.to === line.to &&
        node.name.startsWith("HyperMD")
      ) {
        lineNodeName = node.name;
      }
      node = node.parent;
    }
    return lineNodeName;
  };
}

function parseFenceOpening(
  state: EditorState,
  lineNumber: number,
): FenceOpening | null {
  const match = listFenceRe.exec(state.doc.line(lineNumber).text);
  if (!match) return null;
  const [, indent, marker, spacing] = match;
  return {
    contentColumn: countColumn(indent + marker + spacing, state.tabSize),
    sourceOffset: indent.length + marker.length + spacing.length,
    openingLineNumber: lineNumber,
  };
}

function hasClassName(nodeName: string, className: string): boolean {
  return nodeName.split("_").includes(className);
}

function isNestedCodeBlockName(nodeName: string): boolean {
  return (
    hasClassName(nodeName, "HyperMD-codeblock") &&
    hasClassName(nodeName, "HyperMD-list-line")
  );
}

function isNestedCodeBlockElement(element: HTMLElement): boolean {
  return (
    element.classList.contains("HyperMD-codeblock") &&
    element.classList.contains("HyperMD-list-line")
  );
}

function documentLineForElement(view: EditorView, element: HTMLElement) {
  try {
    return view.state.doc.lineAt(view.posAtDOM(element));
  } catch {
    return null;
  }
}

function measureOpeningInset(element: HTMLElement): string | null {
  const marker = element.querySelector<HTMLElement>(".cm-formatting-list");
  const contentStart = marker?.nextElementSibling as HTMLElement | null;
  if (!contentStart) return null;

  return logicalInset(element, contentStart.getBoundingClientRect(), false);
}

function measureContentInset(
  view: EditorView,
  element: HTMLElement,
  position: number,
  includeCodePadding: boolean,
): string | null {
  const content = view.coordsAtPos(position);
  if (!content) return null;

  return logicalInset(element, content, includeCodePadding);
}

function logicalInset(
  element: HTMLElement,
  content: { left: number; right: number },
  includeCodePadding: boolean,
): string | null {
  const line = element.getBoundingClientRect();
  const rtl =
    element.ownerDocument.defaultView?.getComputedStyle(element).direction ===
    "rtl";
  const inset = rtl ? line.right - content.right : content.left - line.left;
  if (!Number.isFinite(inset) || inset < 0) return null;

  const measured = `${inset}px`;
  return includeCodePadding
    ? `calc(${measured} + var(--list-padding-inline-start))`
    : measured;
}

function offsetAtColumn(
  text: string,
  targetColumn: number,
  tabSize: number,
): number | null {
  let column = 0;
  let offset = 0;

  while (offset < text.length && column < targetColumn) {
    const character = text[offset];
    if (character !== " " && character !== "\t") break;
    column += character === "\t" ? tabSize - (column % tabSize) : 1;
    offset++;
  }

  return column >= targetColumn ? offset : null;
}
