import { syntaxTree } from "@codemirror/language";
import {
  ChangeSet,
  EditorState,
  MapMode,
  StateEffect,
  Transaction,
  countColumn,
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewUpdate,
} from "@codemirror/view";

import { NestedCodeBlockPreviews } from "./NestedCodeBlockPreview";

import { getObsidianDomWindow } from "../obsidianDom";
import {
  getFenceContent,
  getFenceOpening,
  isFenceClosing,
} from "../utils/fencedCode";

const CODE_BLOCK_CLASS = "bullet-plugin-nested-code-block";
const CODE_CONTENT_CLASS = "bullet-plugin-nested-code-block-content";
const CODE_CONTENT_PADDING = "--bullet-code-content-padding";
const CODE_BLOCK_INSET = "--bullet-nested-code-block-inset";
const CODE_BLOCK_END = "--bullet-nested-code-block-end";
const PREVIEW_OPENING_CLASS = "bullet-plugin-code-preview-opening";
const PREVIEW_EMBED_CLASS = "bullet-plugin-code-preview-embed";
const PREVIEW_EMBED_OPENING_CLASS = "bullet-plugin-code-preview-embed-opening";
const HIDDEN_FENCE_CLASS = "bullet-plugin-code-preview-hidden-fence";
const PREVIEW_FIRST_CLASS = "bullet-plugin-code-preview-first";
const PREVIEW_LAST_CLASS = "bullet-plugin-code-preview-last";
const PREVIEW_HEIGHT = "--bullet-code-preview-height";
const PREVIEW_MARKER_OFFSET = "--bullet-code-preview-marker-offset";
const PLAIN_PREVIEW_CLASS = "bullet-plugin-code-preview-plain";
const PREVIEW_BACKGROUND = "--bullet-code-preview-background";
const PREVIEW_END = "--bullet-code-preview-end";
const PREVIEW_RADIUS = "--bullet-code-preview-radius";
const listFenceRe = /^([ \t]*)([-*+]|\d+\.)([ \t]+)(`{3,}|~{3,})/;

interface MeasuredLine {
  element: HTMLElement;
  inset: string;
  end?: string;
  contentPadding?: string;
  emptyBody?: boolean;
  preview?: { height: string; markerOffset: string };
  previewBlock?: HTMLElement;
  previewEmbed?: boolean;
  plainPreview?: boolean;
  previewAppearance?: { background: string; end: string; radius: string };
}

interface SourceRow {
  from: number;
  openingFrom: number;
  openingText: string;
  prefix: string;
  kind: "opening" | "body" | "closing";
}

type NativePresentation =
  | { kind: "source" }
  | { kind: "native-opening"; alignment: MeasuredLine["preview"] }
  | { kind: "native-body"; first: boolean; last: boolean }
  | { kind: "native-closing" }
  | { kind: "empty-opening" }
  | {
      kind: "processor-opening";
      alignment: NonNullable<MeasuredLine["preview"]>;
      appearance: MeasuredLine["previewAppearance"];
    };

interface NativeRowLayout {
  source: SourceRow;
  inset: string;
  end: string | undefined;
  contentPadding: string | undefined;
  presentation: NativePresentation;
}

interface NativeSnapshot {
  doc: EditorState["doc"];
  epoch: number;
  rows: ReadonlyMap<number, NativeRowLayout>;
}

interface ProcessorLayout {
  element: HTMLElement;
  openingFrom: number;
  inset: string;
  previewEmbed: boolean;
  plainPreview: boolean;
}

interface MeasuredFrame {
  native: NativeSnapshot;
  processors: ProcessorLayout[];
}

const NATIVE_CLASSES = [
  CODE_BLOCK_CLASS,
  PREVIEW_OPENING_CLASS,
  PREVIEW_EMBED_OPENING_CLASS,
  PLAIN_PREVIEW_CLASS,
  HIDDEN_FENCE_CLASS,
  PREVIEW_FIRST_CLASS,
  PREVIEW_LAST_CLASS,
];

function withoutLayoutClasses(value: string): string {
  return value
    .split(/\s+/)
    .filter(
      (name) =>
        name && !NATIVE_CLASSES.includes(name) && name !== PREVIEW_EMBED_CLASS,
    )
    .sort()
    .join(" ");
}

interface FenceOpening {
  contentColumn: number;
  indentColumn: number;
  sourceOffset: number;
  openingLineNumber: number;
}

interface CodeRowProbe {
  element: HTMLElement;
  indent: HTMLElement;
  contentOffset: number;
  residual?: HTMLElement;
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
    if (
      (requestedName === null || !isNestedCodeBlockName(requestedName)) &&
      this.state.doc.line(lineNumber).text.trim() !== ""
    ) {
      this.cache.set(lineNumber, null);
      return null;
    }
    if (
      requestedName !== null &&
      hasClassName(requestedName, "HyperMD-codeblock-begin")
    ) {
      const opening = parseFenceOpening(this.state, lineNumber);
      this.cache.set(lineNumber, opening);
      return opening;
    }
    if (this.cache.has(lineNumber)) return this.cache.get(lineNumber) ?? null;

    let result: FenceOpening | null = null;
    for (let current = lineNumber; current >= 1; current--) {
      const name = this.lineNameAt(current);
      // Empty physical code rows have no list class (and a zero-length syntax
      // node may not resolve at all). They preserve ownership, but a closing
      // fence must stop a later row from inheriting the preceding block.
      if (
        current !== lineNumber &&
        name !== null &&
        hasClassName(name, "HyperMD-codeblock-end")
      ) {
        break;
      }
      if (this.cache.has(current)) {
        result = this.cache.get(current) ?? null;
        break;
      }
      if (this.state.doc.line(current).text.trim() === "") continue;
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
  private nativeRows: ReadonlyMap<number, NativeRowLayout> = new Map();
  private styledProcessors = new Map<HTMLElement, ProcessorLayout>();
  private layoutReady = StateEffect.define<NativeSnapshot>({
    map: (snapshot, changes) => (changes.empty ? snapshot : undefined),
  });
  private pendingNative: NativeSnapshot | null = null;
  private publicationQueued = false;
  private epoch = 0;
  private presentationSignature = "";
  private destroyed = false;
  private syntaxContext: SyntaxContext;
  private previewObserver: MutationObserver | null = null;
  private previews = new NestedCodeBlockPreviews();
  private markerMeasureContainer: HTMLElement | null = null;
  private markerMeasurements = new Map<
    number,
    { marker: HTMLElement; indent: HTMLElement; signature: string }
  >();

  private codeMeasurements = new Map<
    number,
    {
      doc: EditorState["doc"];
      element: HTMLElement;
      rows: CodeRowProbe[];
      rowProbes: Map<string, CodeRowProbe>;
      fence: HTMLElement;
      openingFence: HTMLElement;
      closingFence: HTMLElement;
      closingSource: string;
      containerColumn: number;
      source: string;
      hidden: string;
      from: number;
      to: number;
      flairWidth: number;
      flairRows: number;
    }
  >();

  private measurement = {
    read: () => this.measureLayout(),
    write: (frame: MeasuredFrame) => this.acceptMeasurement(frame),
  };

  constructor(
    private view: EditorView,
    private lineNameAtOverride?: LineNameAt,
    private zoomRange?: (state: EditorState) => { indent: string } | null,
  ) {
    this.syntaxContext = makeSyntaxContext(view.state, this.lineNameAtOverride);
    this.decorations = this.buildDecorations();
    this.presentationSignature = this.readPresentationSignature();
    this.syntaxContext.fenceOpenings.retainVisible(
      view.state,
      view.visibleRanges,
    );
    const Observer = view.dom.ownerDocument.defaultView?.MutationObserver;
    if (Observer) {
      this.previewObserver = new Observer((records) => {
        if (this.destroyed) return;
        let changed = false;
        let nativeChildrenChanged = false;
        for (const { target, type, oldValue } of records) {
          if (target === view.dom.ownerDocument.body) {
            changed = true;
            continue;
          }
          const element =
            target.nodeType === 1 ? (target as HTMLElement) : null;
          if (type === "attributes") {
            if (
              element &&
              withoutLayoutClasses(oldValue ?? "") !==
                withoutLayoutClasses(Array.from(element.classList).join(" "))
            )
              changed = true;
          } else if (element?.closest(".cm-preview-code-block")) {
            changed = true;
          } else {
            nativeChildrenChanged = true;
          }
        }
        if (nativeChildrenChanged) {
          const signature = this.readPresentationSignature();
          changed ||= signature !== this.presentationSignature;
          this.presentationSignature = signature;
        }
        if (changed) this.invalidateMeasurement();
      });
      this.previewObserver.observe(view.contentDOM, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
        attributeOldValue: true,
      });
      if (view.dom.ownerDocument.body)
        this.previewObserver.observe(view.dom.ownerDocument.body, {
          attributes: true,
          attributeFilter: ["class"],
        });
    }
    this.scheduleMeasure();
  }

  update(update: ViewUpdate) {
    const treeChanged = this.syntaxContext.tree !== syntaxTree(update.state);
    const selectionChanged = !update.startState.selection.eq(
      update.state.selection,
    );
    const configurationChanged =
      update.startState.tabSize !== update.state.tabSize ||
      this.zoomRange?.(update.startState)?.indent !==
        this.zoomRange?.(update.state)?.indent;
    const inputsChanged =
      update.docChanged ||
      update.viewportChanged ||
      update.geometryChanged ||
      selectionChanged ||
      configurationChanged ||
      treeChanged;
    if (inputsChanged) this.epoch++;
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
      this.nativeRows = retainNativeRows(
        update,
        this.syntaxContext,
        this.nativeRows,
      );
    }
    let presentationChanged = false;
    if (selectionChanged) {
      const previousSelection = update.startState.selection.map(update.changes);
      const changedBlocks = new Set<number>();
      for (const openingFrom of new Set(
        Array.from(this.nativeRows.values(), (row) => row.source.openingFrom),
      )) {
        if (
          selectionInBlock(
            update.state,
            this.syntaxContext,
            previousSelection,
            openingFrom,
          ) !==
          selectionInBlock(
            update.state,
            this.syntaxContext,
            update.state.selection,
            openingFrom,
          )
        )
          changedBlocks.add(openingFrom);
      }
      if (changedBlocks.size) {
        this.nativeRows = new Map(
          Array.from(this.nativeRows, ([from, row]) => [
            from,
            changedBlocks.has(row.source.openingFrom)
              ? { ...row, presentation: { kind: "source" } }
              : row,
          ]),
        );
        presentationChanged = true;
      }
    }
    let published = false;
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (effect.is(this.layoutReady) && this.isCurrent(effect.value)) {
          this.nativeRows = effect.value.rows;
          published = true;
        }
      }
    }
    if (
      update.docChanged ||
      update.viewportChanged ||
      treeChanged ||
      published ||
      presentationChanged
    ) {
      this.decorations = this.buildDecorations();
      this.syntaxContext.fenceOpenings.retainVisible(
        update.state,
        update.view.visibleRanges,
      );
    }
    if (inputsChanged) this.scheduleMeasure();
  }

  destroy() {
    this.destroyed = true;
    this.pendingNative = null;
    this.previewObserver?.disconnect();
    for (const element of this.styledProcessors.keys())
      this.clearProcessor(element);
    this.styledProcessors.clear();
    this.previews.destroy();
    this.markerMeasureContainer?.remove();
    this.markerMeasureContainer = null;
    this.markerMeasurements.clear();
    this.codeMeasurements.clear();
  }

  private buildDecorations(): DecorationSet {
    const { state, visibleRanges } = this.view;
    const marks = codeBlockContentDecorations(
      state,
      visibleRanges,
      this.syntaxContext.lineNameAt,
      this.syntaxContext.fenceOpenings.at,
    );
    const positions = new Set(this.nativeRows.keys());
    for (const range of visibleRanges) {
      const last = state.doc.lineAt(range.to).number;
      for (let n = state.doc.lineAt(range.from).number; n <= last; n++) {
        const from = state.doc.line(n).from;
        if (sourceRowAt(state, this.syntaxContext, from)) positions.add(from);
      }
    }
    return marks.update({
      add: Array.from(positions, (from) =>
        Decoration.line(nativeAttributes(this.nativeRows.get(from))).range(
          from,
        ),
      ),
      sort: true,
    });
  }

  private readPresentationSignature(): string {
    return Array.from(
      this.view.contentDOM.querySelectorAll<HTMLElement>(
        ".cm-line, .cm-preview-code-block",
      ),
    )
      .flatMap((element) => {
        const line = documentLineForElement(this.view, element);
        if (!line) return [];
        if (element.classList.contains("cm-preview-code-block"))
          return [`${line.from}:processor`];
        if (element.classList.contains("HyperMD-codeblock-begin"))
          return [
            `${line.from}:opening:${!!element.querySelector(".cm-hmd-codeblock")}:${!!element.querySelector(".code-block-flair")}`,
          ];
        if (element.classList.contains("HyperMD-codeblock-end"))
          return [
            `${line.from}:closing:${!!element.querySelector(".cm-hmd-codeblock")}`,
          ];
        return [];
      })
      .join("|");
  }

  private invalidateMeasurement() {
    this.epoch++;
    this.scheduleMeasure();
  }

  private scheduleMeasure() {
    if (this.destroyed) return;
    this.prepareMarkerMeasurements();
    this.view.requestMeasure(this.measurement);
  }

  private prepareMarkerMeasurements() {
    const doc = this.view.dom.ownerDocument;
    if (!doc.win) return;
    const visible = new Set<number>();
    for (const range of this.view.visibleRanges) {
      const first = this.view.state.doc.lineAt(range.from).number;
      const last = this.view.state.doc.lineAt(range.to).number;
      for (let n = first; n <= last; n++) {
        const opening = this.syntaxContext.fenceOpenings.at(n);
        if (opening) visible.add(opening.openingLineNumber);
      }
    }
    for (const [n, measurement] of this.markerMeasurements) {
      if (!visible.has(n)) {
        measurement.marker.remove();
        measurement.indent.remove();
        this.markerMeasurements.delete(n);
        this.codeMeasurements.get(n)?.element.remove();
        this.codeMeasurements.get(n)?.fence.remove();
        this.codeMeasurements.delete(n);
      }
    }
    if (!visible.size) return;
    const win = getObsidianDomWindow(doc);
    if (!this.markerMeasureContainer) {
      const container = win.createDiv();
      container.className =
        "bullet-plugin-code-marker-measure cm-line HyperMD-codeblock HyperMD-list-line";
      container.setAttribute("aria-hidden", "true");
      // Native marker typography differs from code typography. Keep only this
      // nonpainted intrinsic-size probe outside CodeMirror's managed content;
      // it contains no indentation guides and cannot change scroll dimensions.
      this.view.dom.appendChild(container);
      this.markerMeasureContainer = container;
    }
    for (const n of visible) {
      const match = listFenceRe.exec(this.view.state.doc.line(n).text);
      if (!match) continue;
      const [, rawIndent, text, spacing] = match;
      const hiddenIndent = this.zoomRange?.(this.view.state)?.indent ?? "";
      const ordered = /^\d/.test(text);
      const level = /(?:^|_)HyperMD-list-line-(\d+)(?:_|$)/.exec(
        this.syntaxContext.lineNameAt(n) ?? "",
      )?.[1];
      const signature = `${rawIndent}\0${hiddenIndent}\0${text}${spacing}\0${level ?? ""}`;
      this.prepareCodeMeasurement(n, hiddenIndent);
      if (this.markerMeasurements.get(n)?.signature === signature) continue;
      this.markerMeasurements.get(n)?.marker.remove();
      this.markerMeasurements.get(n)?.indent.remove();
      const indent = makeIndentMeasurement(
        doc,
        rawIndent,
        hiddenIndent,
        this.view.state.tabSize,
      );
      const marker = win.createSpan();
      marker.className = `cm-formatting cm-formatting-list cm-formatting-list-${ordered ? "ol" : "ul"}${level ? ` cm-list-${level}` : ""}`;
      if (ordered) marker.textContent = text + spacing;
      else {
        const bullet = win.createSpan();
        bullet.className = "list-bullet";
        bullet.textContent = text;
        marker.appendChild(bullet);
        marker.appendChild(doc.createTextNode(spacing));
      }
      this.markerMeasureContainer.appendChild(indent);
      this.markerMeasureContainer.appendChild(marker);
      this.markerMeasurements.set(n, { marker, indent, signature });
    }
  }

  private prepareCodeMeasurement(n: number, hidden: string) {
    const state = this.view.state;
    const previous = this.codeMeasurements.get(n);
    if (previous?.doc === state.doc && previous.hidden === hidden) return;
    const opening = state.doc.line(n);
    const match = listFenceRe.exec(opening.text);
    if (!match || !this.markerMeasureContainer) return;
    const container = match[1] + " ".repeat(match[2].length) + match[3];
    const containerColumn = countColumn(container, state.tabSize);
    const fenceText = opening.text.slice(
      match[1].length + match[2].length + match[3].length,
    );
    const fence = getFenceOpening(fenceText);
    if (!fence) return;
    const rows: string[] = [];
    let to = opening.to;
    let closingSource = "";
    for (let i = n + 1; i <= state.doc.lines; i++) {
      const line = state.doc.line(i);
      const content = getFenceContent(line.text, container);
      if (!content && line.text.trim()) break;
      to = line.to;
      if (content && isFenceClosing(content.text, fence)) {
        closingSource = line.text;
        break;
      }
      rows.push(line.text);
    }
    const source = state.doc.sliceString(opening.from, to);
    if (previous?.source === source && previous.hidden === hidden) {
      previous.doc = state.doc;
      previous.from = opening.from;
      previous.to = to;
      return;
    }
    const reusable = previous?.hidden === hidden ? previous : undefined;
    if (!reusable) {
      previous?.element.remove();
      previous?.fence.remove();
    }
    const doc = this.view.dom.ownerDocument;
    const win = getObsidianDomWindow(doc);
    const element = reusable?.element ?? win.createSpan();
    element.className = "bullet-plugin-code-width-measure";
    const rowProbes = reusable?.rowProbes ?? new Map<string, CodeRowProbe>();
    const uniqueRows = new Set(rows);
    for (const [raw, row] of rowProbes) {
      if (
        !uniqueRows.has(raw) ||
        reusable?.containerColumn !== containerColumn
      ) {
        row.element.remove();
        rowProbes.delete(raw);
      }
    }
    // Probe complete source, not just mounted rows: scrolling must not change
    // the width when the longest code line leaves the viewport. Native indent
    // boxes retain their minimum widths independently of the code text.
    for (const raw of uniqueRows) {
      if (rowProbes.has(raw)) continue;
      const row = win.createSpan();
      const indent = /^[ \t]*/.exec(raw)![0];
      const indentProbe = makeIndentMeasurement(
        doc,
        indent,
        hidden,
        state.tabSize,
      );
      row.appendChild(indentProbe);
      const content = getFenceContent(raw, container);
      const offset = content?.offset ?? 0;
      const residualColumns = Math.max(
        0,
        countColumn(raw.slice(0, offset), state.tabSize) - containerColumn,
      );
      let residual: HTMLElement | undefined;
      if (residualColumns) {
        residual = win.createSpan();
        residual.className = "bullet-plugin-code-width-residual";
        residual.textContent = " ".repeat(residualColumns);
        row.appendChild(residual);
      }
      row.appendChild(doc.createTextNode(raw.slice(indent.length)));
      row.className = "bullet-plugin-code-width-row";
      element.appendChild(row);
      rowProbes.set(raw, {
        element: row,
        indent: indentProbe,
        contentOffset: Math.max(
          0,
          offset - hiddenIndentEnd(indent, hidden, state.tabSize),
        ),
        residual,
      });
    }
    const fenceProbe = reusable?.fence ?? win.createSpan();
    fenceProbe.className = "bullet-plugin-code-width-measure";
    const openingFence = reusable?.openingFence ?? win.createSpan();
    openingFence.className = "bullet-plugin-code-width-row";
    if (openingFence.textContent !== fenceText)
      openingFence.textContent = fenceText;
    if (!reusable) fenceProbe.appendChild(openingFence);
    let closingFence = reusable?.closingFence;
    if (!closingFence || reusable?.closingSource !== closingSource) {
      closingFence?.remove();
      closingFence = win.createSpan();
      closingFence.className = "bullet-plugin-code-width-row";
      const closingIndent = /^[ \t]*/.exec(closingSource)![0];
      closingFence.appendChild(
        makeIndentMeasurement(doc, closingIndent, hidden, state.tabSize),
      );
      closingFence.appendChild(
        doc.createTextNode(closingSource.slice(closingIndent.length)),
      );
      fenceProbe.appendChild(closingFence);
    }
    if (!reusable) {
      this.markerMeasureContainer.appendChild(element);
      this.markerMeasureContainer.appendChild(fenceProbe);
    }
    this.codeMeasurements.set(n, {
      doc: state.doc,
      element,
      rows: rows.map((raw) => rowProbes.get(raw)!),
      rowProbes,
      fence: fenceProbe,
      openingFence,
      closingFence,
      closingSource,
      containerColumn,
      source,
      hidden,
      from: opening.from,
      to,
      flairWidth: previous?.flairWidth ?? 0,
      flairRows: previous?.flairRows ?? 1,
    });
  }

  private measureCodeEnd(opening: number, inset: string): string | undefined {
    const probe = this.codeMeasurements.get(opening);
    if (!probe) return;
    const editing = this.view.state.selection.ranges.some(
      (range) => range.from <= probe.to && range.to >= probe.from,
    );
    // Fit the same code-only extent used by the visible content padding.
    // The probes have no padding of their own, so remeasurement cannot feed
    // the previous correction back into the next width.
    const rowEnds = probe.rows.map(
      (row) =>
        Number.parseFloat(inset) +
        row.element.getBoundingClientRect().width -
        measureProbeContentStart(row) +
        (row.residual?.getBoundingClientRect().width ?? 0),
    );
    const bodyEnd = Math.max(Number.parseFloat(inset), ...rowEnds);
    const leadingEnd = Math.max(
      Number.parseFloat(inset),
      ...rowEnds.slice(0, probe.flairRows),
    );
    const fenceEnd = editing
      ? Math.max(
          Number.parseFloat(inset) +
            probe.openingFence.getBoundingClientRect().width,
          probe.closingFence.getBoundingClientRect().width,
        )
      : 0;
    const end = Math.max(
      bodyEnd,
      leadingEnd + (editing ? 0 : probe.flairWidth),
    );
    // Body rows have matching code padding at both edges. Source fences have
    // no content-start decoration and need only the trailing padding.
    return `max(calc(${inset} + 2 * var(--size-4-4)), calc(${end}px + 2 * var(--size-4-4)), calc(${fenceEnd}px + var(--size-4-4)))`;
  }

  private measureLines(): MeasuredLine[] {
    if (this.destroyed) return [];
    const elements = Array.from(
      this.view.contentDOM.querySelectorAll<HTMLElement>(
        ".cm-line, .cm-preview-code-block",
      ),
    );
    const measured: MeasuredLine[] = [];
    const codeEnds = new Map<string, string | undefined>();
    const codeEndFor = (opening: number, inset: string) => {
      const key = `${opening}\0${inset}`;
      if (!codeEnds.has(key))
        codeEnds.set(key, this.measureCodeEnd(opening, inset));
      return codeEnds.get(key);
    };
    const visibleInsets = new Map<number, string>();
    const pendingEmptyRows: Array<{
      element: HTMLElement;
      openingLineNumber: number;
    }> = [];
    const fenceOpeningAt = this.syntaxContext.fenceOpenings.at;
    let currentInset: string | null = null;
    let previousLineNumber: number | null = null;

    for (const element of elements) {
      if (element.classList.contains("cm-preview-code-block")) {
        const line = documentLineForElement(this.view, element);
        const opening = line && fenceOpeningAt(line.number);
        // A rendered processor block shares the opening fence's document
        // position, but its hidden source coordinates resolve to the embed.
        // Reuse the preceding, parser-confirmed list marker's measured edge.
        if (
          opening &&
          previousLineNumber === opening.openingLineNumber &&
          currentInset !== null
        ) {
          measured.push({ element, inset: currentInset });
          const preceding = measured[measured.length - 2];
          if (preceding) {
            preceding.preview = measurePreviewOpening(
              preceding.element,
              element,
            );
            preceding.previewBlock = element;
            measured[measured.length - 1].previewEmbed = !!preceding.preview;
            preceding.previewAppearance = measurePreviewAppearance(
              preceding.element,
              element,
            );
            measured[measured.length - 1].plainPreview =
              !!preceding.previewAppearance;
          }
        }
        currentInset = null;
        previousLineNumber = null;
        continue;
      }
      if (!element.classList.contains("HyperMD-codeblock")) continue;

      const line = documentLineForElement(this.view, element);
      if (!line) continue;
      const emptyBody = line.text.trim() === "";
      if (!isNestedCodeBlockElement(element) && !emptyBody) continue;
      const opening = fenceOpeningAt(line.number);
      if (!opening) continue;

      const marker = this.markerMeasurements.get(
        opening.openingLineNumber,
      )?.marker;
      const indentOffset = marker
        ? offsetAtColumn(
            line.text,
            opening.indentColumn,
            this.view.state.tabSize,
          )
        : null;
      const nativeInset = () =>
        marker && indentOffset !== null
          ? measureNativeContinuationInset(
              this.view,
              element,
              line.from + indentOffset,
              marker,
            )
          : null;
      const isOpening =
        line.number === opening.openingLineNumber &&
        element.classList.contains("HyperMD-codeblock-begin");
      if (isOpening) {
        currentInset =
          measureOpeningInset(element) ??
          (marker
            ? nativeInset()
            : measureContentInset(
                this.view,
                element,
                line.from + opening.sourceOffset,
                false,
              ));
      } else if (
        previousLineNumber !== line.number - 1 ||
        currentInset === null
      ) {
        const contentOffset = offsetAtColumn(
          line.text,
          opening.contentColumn,
          this.view.state.tabSize,
        );
        currentInset = marker
          ? nativeInset()
          : contentOffset === null
            ? null
            : measureContentInset(
                this.view,
                element,
                line.from + contentOffset,
                true,
              );
      }
      const inset = currentInset;
      if (inset !== null) {
        const flair = element.querySelector<HTMLElement>(".code-block-flair");
        const codeProbe = this.codeMeasurements.get(opening.openingLineNumber);
        if (flair && codeProbe) {
          const bounds = flair.getBoundingClientRect();
          codeProbe.flairWidth = bounds.width;
          // A navigable opening fence owns its height. Count the actual body
          // rows under the control, including wrapped rows and physical blanks.
          // Dividing from the opener's top incorrectly reserves another row.
          let rowCount = 0;
          let lastOverlap = 0;
          for (
            let row = element.nextElementSibling;
            isCodeBody(row);
            row = row!.nextElementSibling
          ) {
            const rowBounds = row!.getBoundingClientRect();
            if (rowBounds.top >= bounds.bottom) break;
            rowCount++;
            if (rowBounds.bottom > bounds.top) lastOverlap = rowCount;
          }
          codeProbe.flairRows = lastOverlap;
        }
        visibleInsets.set(opening.openingLineNumber, inset);
        const next = element.nextElementSibling;
        const nativePreview =
          isNativePreviewOpening(element) && isCodeBody(next);
        measured.push({
          element,
          inset,
          end: codeEndFor(opening.openingLineNumber, inset),
          contentPadding: measureCodeContentPadding(
            this.view,
            element,
            opening,
            inset,
          ),
          emptyBody,
          previewBlock: nativePreview ? (next as HTMLElement) : undefined,
          preview:
            nativePreview && next
              ? measurePreviewOpening(
                  element,
                  next as HTMLElement,
                  next.querySelector(`.${CODE_CONTENT_CLASS}`) ?? next,
                )
              : undefined,
        });
      } else if (emptyBody) {
        // An empty row has no source indentation to measure. Resolve it from
        // another visible row of this same fence during this measurement pass.
        pendingEmptyRows.push({
          element,
          openingLineNumber: opening.openingLineNumber,
        });
      }
      previousLineNumber = line.number;
      if (element.classList.contains("HyperMD-codeblock-end")) {
        currentInset = null;
        previousLineNumber = null;
      }
    }

    for (const { element, openingLineNumber } of pendingEmptyRows) {
      const probe = this.markerMeasurements.get(openingLineNumber);
      const inset =
        visibleInsets.get(openingLineNumber) ??
        (probe ? measureIntrinsicInset(probe.indent, probe.marker) : undefined);
      if (inset !== undefined)
        measured.push({
          element,
          inset,
          end: codeEndFor(openingLineNumber, inset),
          emptyBody: true,
        });
    }
    return measured;
  }

  private measureLayout(): MeasuredFrame {
    const native: NativeSnapshot = {
      doc: this.view.state.doc,
      epoch: this.epoch,
      rows: new Map(),
    };
    const rows = new Map<number, NativeRowLayout>();
    const processors: ProcessorLayout[] = [];
    for (const measurement of this.measureLines()) {
      const { element, inset, end, contentPadding } = measurement;
      const line = documentLineForElement(this.view, element);
      if (!line) continue;
      if (element.classList.contains("cm-preview-code-block")) {
        const opening = this.syntaxContext.fenceOpenings.at(line.number);
        if (opening)
          processors.push({
            element,
            openingFrom: this.view.state.doc.line(opening.openingLineNumber)
              .from,
            inset,
            previewEmbed: !!measurement.previewEmbed,
            plainPreview: !!measurement.plainPreview,
          });
        continue;
      }
      if (this.view.posAtDOM(element) !== line.from) continue;
      const source = sourceRowAt(
        this.view.state,
        this.syntaxContext,
        line.from,
      );
      if (source)
        rows.set(source.from, {
          source,
          inset,
          end,
          contentPadding,
          presentation: nativePresentation(measurement),
        });
    }
    return { native: { ...native, rows }, processors };
  }

  private isCurrent(snapshot: NativeSnapshot): boolean {
    return (
      !this.destroyed &&
      snapshot.doc === this.view.state.doc &&
      snapshot.epoch === this.epoch
    );
  }

  private acceptMeasurement(frame: MeasuredFrame) {
    if (!this.isCurrent(frame.native)) {
      this.scheduleMeasure();
      return;
    }
    const current = new Map<HTMLElement, ProcessorLayout>();
    let previewChanged = false;
    for (const processor of frame.processors) {
      const { element, openingFrom, inset, previewEmbed, plainPreview } =
        processor;
      const line = documentLineForElement(this.view, element);
      if (
        !element.classList.contains("cm-preview-code-block") ||
        !this.view.contentDOM.contains(element) ||
        line?.from !== openingFrom
      )
        continue;
      setStyleProperty(element, CODE_BLOCK_INSET, inset);
      setClass(element, CODE_BLOCK_CLASS, true);
      setClass(element, PREVIEW_EMBED_CLASS, previewEmbed);
      setClass(element, PLAIN_PREVIEW_CLASS, plainPreview);
      previewChanged = this.correctPreviewContent(element) || previewChanged;
      current.set(element, processor);
    }
    for (const element of this.styledProcessors.keys()) {
      if (!current.has(element)) this.clearProcessor(element);
    }
    this.styledProcessors = current;
    if (previewChanged) {
      this.invalidateMeasurement();
      return;
    }
    this.pendingNative = frame.native;
    if (this.publicationQueued) return;
    this.publicationQueued = true;
    // CodeMirror remains in its measuring update until every write returns.
    queueMicrotask(() => this.publishPending());
  }

  private publishPending() {
    this.publicationQueued = false;
    const snapshot = this.pendingNative;
    this.pendingNative = null;
    if (!snapshot || this.destroyed) return;
    if (!this.isCurrent(snapshot)) {
      this.scheduleMeasure();
      return;
    }
    const rows = new Map(this.nativeRows);
    const ends = new Map<number, string | undefined>();
    for (const [from, row] of snapshot.rows) {
      rows.set(from, row);
      ends.set(row.source.openingFrom, row.end);
    }
    for (const [from, row] of rows) {
      if (ends.has(row.source.openingFrom))
        rows.set(from, { ...row, end: ends.get(row.source.openingFrom) });
    }
    if (sameNativeRows(this.nativeRows, rows)) return;
    this.view.dispatch({
      effects: this.layoutReady.of({ ...snapshot, rows }),
      annotations: Transaction.addToHistory.of(false),
    });
  }

  private correctPreviewContent(element: HTMLElement): boolean {
    if (!element.querySelector(".expressive-code")) {
      this.previews.clear(element);
      return false;
    }
    const line = documentLineForElement(this.view, element);
    const opening = line && this.syntaxContext.fenceOpenings.at(line.number);
    if (!opening) return false;
    const source: string[] = [];
    for (
      let n = opening.openingLineNumber + 1;
      n <= this.view.state.doc.lines;
      n++
    ) {
      const name = this.syntaxContext.lineNameAt(n);
      if (name && hasClassName(name, "HyperMD-codeblock-end")) {
        return this.previews.synchronize(
          element,
          source,
          opening.contentColumn,
          this.view.state.tabSize,
          this.view.state.doc.line(opening.openingLineNumber).text,
        );
      }
      const text = this.view.state.doc.line(n).text;
      if (text.trim() !== "" && (!name || !isNestedCodeBlockName(name))) break;
      source.push(text);
    }
    this.previews.clear(element);
    return false;
  }

  private clearProcessor(element: HTMLElement) {
    if (!element.classList.contains("cm-preview-code-block")) return;
    this.previews.clear(element);
    element.classList.remove(CODE_BLOCK_CLASS);
    element.classList.remove(PREVIEW_EMBED_CLASS);
    element.classList.remove(PLAIN_PREVIEW_CLASS);
    element.style.removeProperty(CODE_BLOCK_INSET);
  }
}

function selectionInBlock(
  state: EditorState,
  context: SyntaxContext,
  selection: EditorState["selection"],
  openingFrom: number,
): boolean {
  return selection.ranges.some((range) => {
    if (range.from <= openingFrom && range.to >= openingFrom) return true;
    return [range.from, range.to].some((position) => {
      const opening = context.fenceOpenings.at(
        state.doc.lineAt(position).number,
      );
      return (
        opening !== null &&
        state.doc.line(opening.openingLineNumber).from === openingFrom
      );
    });
  });
}

function sourceRowAt(
  state: EditorState,
  context: SyntaxContext,
  from: number,
): SourceRow | null {
  if (from < 0 || from > state.doc.length) return null;
  const line = state.doc.lineAt(from);
  if (line.from !== from) return null;
  const opening = context.fenceOpenings.at(line.number);
  if (!opening) return null;
  const openingLine = state.doc.line(opening.openingLineNumber);
  const kind =
    line.number === opening.openingLineNumber
      ? "opening"
      : hasClassName(
            context.lineNameAt(line.number) ?? "",
            "HyperMD-codeblock-end",
          )
        ? "closing"
        : "body";
  const offset =
    kind === "opening"
      ? opening.sourceOffset
      : offsetAtColumn(line.text, opening.contentColumn, state.tabSize);
  return {
    from,
    openingFrom: openingLine.from,
    openingText: openingLine.text,
    prefix: line.text.slice(0, offset ?? line.text.length),
    kind,
  };
}

function retainNativeRows(
  update: ViewUpdate,
  context: SyntaxContext,
  previous: ReadonlyMap<number, NativeRowLayout>,
): ReadonlyMap<number, NativeRowLayout> {
  const rows = new Map<number, NativeRowLayout>();
  const collisions = new Set<number>();
  for (const row of previous.values()) {
    const from = update.changes.mapPos(row.source.from, 1, MapMode.TrackAfter);
    const openingFrom = update.changes.mapPos(
      row.source.openingFrom,
      1,
      MapMode.TrackAfter,
    );
    if (from === null || openingFrom === null || collisions.has(from)) continue;
    const source = sourceRowAt(update.state, context, from);
    if (
      !source ||
      source.openingFrom !== openingFrom ||
      source.openingText !== row.source.openingText ||
      source.prefix !== row.source.prefix ||
      source.kind !== row.source.kind
    )
      continue;
    if (rows.has(from)) {
      rows.delete(from);
      collisions.add(from);
    } else {
      rows.set(from, { ...row, source });
    }
  }
  return rows;
}

function nativePresentation(measurement: MeasuredLine): NativePresentation {
  const { element, preview, previewBlock, previewAppearance } = measurement;
  const next = element.nextElementSibling;
  if (
    preview &&
    previewBlock === next &&
    element.classList.contains("HyperMD-codeblock-begin") &&
    !element.querySelector(".cm-hmd-codeblock") &&
    next?.classList.contains("cm-preview-code-block")
  )
    return {
      kind: "processor-opening",
      alignment: preview,
      appearance: previewAppearance,
    };
  if (isNativePreviewOpening(element)) {
    if (isCodeBody(next)) return { kind: "native-opening", alignment: preview };
    if (isHiddenClosingFence(next)) return { kind: "empty-opening" };
  }
  if (isHiddenClosingFence(element)) return { kind: "native-closing" };
  if (isCodeBody(element))
    return {
      kind: "native-body",
      first: isNativePreviewOpening(element.previousElementSibling),
      last: isHiddenClosingFence(next),
    };
  return { kind: "source" };
}

function nativeAttributes(row: NativeRowLayout | undefined): {
  class: string;
  attributes: { style: string };
} {
  const classes = [CODE_BLOCK_CLASS];
  const properties: Array<[string, string | undefined]> = [];
  if (row) {
    properties.push(
      [CODE_BLOCK_INSET, row.inset],
      [CODE_BLOCK_END, row.end],
      [CODE_CONTENT_PADDING, row.contentPadding],
    );
    const presentation = row.presentation;
    switch (presentation.kind) {
      case "native-opening":
      case "processor-opening": {
        const { alignment } = presentation;
        if (alignment) {
          classes.push(PREVIEW_OPENING_CLASS);
          properties.push(
            [PREVIEW_HEIGHT, alignment.height],
            [PREVIEW_MARKER_OFFSET, alignment.markerOffset],
          );
        }
        if (presentation.kind === "processor-opening") {
          classes.push(PREVIEW_EMBED_OPENING_CLASS);
          if (presentation.appearance) {
            classes.push(PLAIN_PREVIEW_CLASS);
            properties.push(
              [PREVIEW_BACKGROUND, presentation.appearance.background],
              [PREVIEW_END, presentation.appearance.end],
              [PREVIEW_RADIUS, presentation.appearance.radius],
            );
          }
        }
        classes.push(HIDDEN_FENCE_CLASS);
        break;
      }
      case "native-body":
        if (presentation.first) classes.push(PREVIEW_FIRST_CLASS);
        if (presentation.last) classes.push(PREVIEW_LAST_CLASS);
        break;
      case "native-closing":
        classes.push(HIDDEN_FENCE_CLASS);
        break;
      case "empty-opening":
        classes.push(PREVIEW_LAST_CLASS);
        break;
      case "source":
        break;
      default: {
        const exhaustive: never = presentation;
        return exhaustive;
      }
    }
  }
  return {
    class: classes.join(" "),
    attributes: {
      style: properties
        .filter(([, value]) => value !== undefined)
        .map(
          ([name, value]) =>
            `${name}: ${value?.replace(/-?\d+(?:\.\d+)?px\b/g, (pixels) => `${Math.round(Number.parseFloat(pixels) * 100) / 100}px`)};`,
        )
        .join(" "),
    },
  };
}

function sameNativeRows(
  previous: ReadonlyMap<number, NativeRowLayout>,
  next: ReadonlyMap<number, NativeRowLayout>,
): boolean {
  if (previous.size !== next.size) return false;
  for (const [from, row] of next) {
    const old = previous.get(from);
    if (!old) return false;
    const before = nativeAttributes(old);
    const after = nativeAttributes(row);
    if (
      before.class !== after.class ||
      before.attributes.style !== after.attributes.style
    )
      return false;
  }
  return true;
}

function measurePreviewAppearance(
  opening: HTMLElement,
  embed: HTMLElement,
): MeasuredLine["previewAppearance"] {
  const pre = embed.querySelector<HTMLElement>(".expressive-code pre");
  const frame = embed.querySelector<HTMLElement>(".expressive-code .frame");
  const header = embed.querySelector<HTMLElement>(".expressive-code .header");
  const win = embed.ownerDocument.defaultView;
  // Terminal and titled frames own their headers and keep their native layout.
  if (
    !pre ||
    !frame ||
    !win ||
    (header && header.getBoundingClientRect().height > 0)
  )
    return;
  const end = logicalInset(opening, pre.getBoundingClientRect(), false, true);
  if (end === null) return;
  return {
    background: win.getComputedStyle(pre).backgroundColor,
    end,
    radius: win.getComputedStyle(frame).borderStartStartRadius,
  };
}

function setStyleProperty(element: HTMLElement, name: string, value: string) {
  if (element.style.getPropertyValue(name) !== value) {
    element.style.setProperty(name, value);
  }
}

function setClass(element: HTMLElement, name: string, enabled: boolean) {
  if (element.classList.contains(name) !== enabled) {
    if (enabled) element.classList.add(name);
    else element.classList.remove(name);
    return true;
  }
  return false;
}

function isNativePreviewOpening(element: Element | null | undefined): boolean {
  return (
    !!element?.classList.contains("HyperMD-codeblock-begin") &&
    !!element.querySelector(".code-block-flair") &&
    !element.querySelector(".cm-hmd-codeblock")
  );
}

function isCodeBody(element: Element | null | undefined): boolean {
  return (
    !!element?.classList.contains("HyperMD-codeblock") &&
    !element.classList.contains("HyperMD-codeblock-begin") &&
    !element.classList.contains("HyperMD-codeblock-end")
  );
}

function isHiddenClosingFence(element: Element | null | undefined): boolean {
  return (
    !!element?.classList.contains("HyperMD-codeblock-end") &&
    !element.querySelector(".cm-hmd-codeblock")
  );
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
    indentColumn: countColumn(indent, state.tabSize),
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

function measurePreviewOpening(
  opening: HTMLElement,
  embed: HTMLElement,
  code: Element | null = embed.querySelector(".ec-line .code") ??
    embed.querySelector("code"),
): MeasuredLine["preview"] {
  const marker =
    opening.querySelector<HTMLElement>(".list-bullet") ??
    opening.querySelector<HTMLElement>(".cm-formatting-list");
  if (!marker || !code) return;

  const doc = embed.ownerDocument;
  const walker = doc.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  let firstLine: { top: number; height: number } | undefined;
  while ((node = walker.nextNode())) {
    const range = doc.createRange();
    range.selectNodeContents(node);
    firstLine = range.getClientRects()[0];
    if (firstLine?.height) break;
  }
  const blockBounds = embed.getBoundingClientRect();
  const hasLineBox = !!firstLine || isCodeBody(embed);
  if (!firstLine) {
    const style = doc.defaultView?.getComputedStyle(code);
    const height = Number.parseFloat(style?.lineHeight ?? "0");
    if (!height) return;
    const codeBounds = code.getBoundingClientRect();
    const paddingTop = Number.parseFloat(style?.paddingTop ?? "0") || 0;
    const paddingBottom = Number.parseFloat(style?.paddingBottom ?? "0") || 0;
    // Empty processor output can consist only of padding, with no text row.
    firstLine =
      codeBounds.height <= paddingTop + paddingBottom
        ? blockBounds
        : { top: codeBounds.top + paddingTop, height };
  }

  const lineBounds = opening.getBoundingClientRect();
  const markerBounds = marker.getBoundingClientRect();
  const markerContainer = opening.querySelector<HTMLElement>(
    ".cm-formatting-list",
  );
  const previousOffset =
    Number.parseFloat(
      markerContainer
        ? (opening.ownerDocument.defaultView?.getComputedStyle(markerContainer)
            .insetBlockStart ?? "0")
        : "0",
    ) || 0;
  const firstLineCenter = firstLine.top + firstLine.height / 2;
  const markerCenter = hasLineBox
    ? firstLineCenter
    : Math.max(
        lineBounds.top + markerBounds.height / 2,
        Math.min(
          firstLineCenter,
          blockBounds.top + blockBounds.height - markerBounds.height / 2,
        ),
      );
  const markerOffset =
    markerCenter -
    lineBounds.top -
    (markerBounds.top + markerBounds.height / 2 - lineBounds.top) +
    previousOffset;
  if (!Number.isFinite(markerOffset) || blockBounds.height <= 0) return;

  // Only the native guide spans the opening row and the preview. Keep each
  // CodeMirror child's own height, including the navigable opening fence.
  return {
    height: `${blockBounds.top + blockBounds.height - lineBounds.top}px`,
    markerOffset: `${markerOffset}px`,
  };
}

function measureOpeningInset(element: HTMLElement): string | null {
  const marker = element.querySelector<HTMLElement>(".cm-formatting-list");
  if (!marker) return null;
  const win = element.ownerDocument.defaultView;
  const bounds = marker.getBoundingClientRect();
  const margin =
    Number.parseFloat(win?.getComputedStyle(marker).marginInlineEnd ?? "0") ||
    0;
  return logicalInset(
    element,
    {
      left: bounds.left - margin,
      right: bounds.right + margin,
    },
    false,
    true,
  );
}

function measureContentInset(
  view: EditorView,
  element: HTMLElement,
  position: number,
  includeCodePadding: boolean,
): string | null {
  if (includeCodePadding) {
    const mark = element.querySelector<HTMLElement>(`.${CODE_CONTENT_CLASS}`);
    if (mark) {
      // A fallback may run while the opener is offscreen or being rebuilt.
      // Read the unpadded mark edge, not cursor coordinates moved by our CSS.
      return logicalInset(element, mark.getBoundingClientRect(), true);
    }
  }
  const content = view.coordsAtPos(position);
  if (!content) return null;

  return logicalInset(element, content, includeCodePadding);
}

function measureCodeContentPadding(
  view: EditorView,
  element: HTMLElement,
  opening: FenceOpening,
  inset: string,
): string | undefined {
  const mark = element.querySelector<HTMLElement>(`.${CODE_CONTENT_CLASS}`);
  if (!mark) return;
  const start = logicalInset(element, mark.getBoundingClientRect(), false);
  const line = documentLineForElement(view, element);
  if (start === null || !line) return;
  const offset = offsetAtColumn(
    line.text,
    opening.contentColumn,
    view.state.tabSize,
  );
  if (offset === null) return;
  // The mark precedes literal code whitespace. If its source tab straddles
  // the container boundary, keep that tab's remaining columns as code indent.
  const residual =
    countColumn(line.text.slice(0, offset), view.state.tabSize) -
    opening.contentColumn;
  return `calc(${inset} - ${start} + ${residual}ch + var(--size-4-4))`;
}

function hiddenIndentEnd(raw: string, hidden: string, tabSize: number): number {
  const base = countColumn(hidden, tabSize);
  let column = 0;
  let offset = 0;
  while (offset < raw.length) {
    const next =
      column + (raw[offset] === "\t" ? tabSize - (column % tabSize) : 1);
    if (next > base) break;
    column = next;
    offset++;
  }
  return offset;
}

function measureProbeContentStart(probe: CodeRowProbe): number {
  let remaining = probe.contentOffset;
  if (!remaining) return 0;
  const origin = probe.element.getBoundingClientRect();
  const rtl =
    probe.element.ownerDocument.defaultView?.getComputedStyle(probe.element)
      .direction === "rtl";
  const endInset = (bounds: { left: number; right: number }) =>
    rtl ? origin.right - bounds.left : bounds.right - origin.left;
  for (const span of Array.from(probe.indent.children)) {
    const length = span.textContent?.length ?? 0;
    if (remaining > length) {
      remaining -= length;
      continue;
    }
    if (remaining === length) return endInset(span.getBoundingClientRect());
    const range = span.ownerDocument.createRange();
    range.selectNodeContents(span);
    if (!span.firstChild) return 0;
    range.setEnd(span.firstChild, remaining);
    const rects = range.getClientRects();
    const bounds = rects[rects.length - 1];
    return bounds ? endInset(bounds) : 0;
  }
  return probe.indent.getBoundingClientRect().width;
}

// A viewport can consist entirely of physical empty code rows. In that case
// there is no native prefix to measure. Reproduce its whitespace markup only
// inside the existing nonpainted probe, without native guide classes. Text is
// retained rather than pixel widths, so font, theme and zoom changes remeasure.
function makeIndentMeasurement(
  doc: Document,
  raw: string,
  hidden: string,
  tabSize: number,
): HTMLElement {
  const win = getObsidianDomWindow(doc);
  const indent = win.createSpan();
  indent.className = "bullet-plugin-code-indent-measure";
  const base = countColumn(hidden, tabSize);
  let column = 0;
  let hiddenEnd = 0;
  const partialTabs = new Set<number>();
  for (let i = 0; i < raw.length; i++) {
    const next = column + (raw[i] === "\t" ? tabSize - (column % tabSize) : 1);
    if (next <= base) hiddenEnd = i + 1;
    else if (raw[i] === "\t") {
      const visibleBefore = Math.max(0, column - base);
      const retained = next - base - visibleBefore;
      if (retained !== tabSize - (visibleBefore % tabSize)) partialTabs.add(i);
    }
    column = next;
  }
  // Obsidian marks tabs and groups of four spaces; adjacent complete units
  // share one inline box, while a remaining space prefix uses code typography.
  const pieces: Array<{ from: number; to: number; unit: boolean }> = [];
  for (let i = 0; i < raw.length; ) {
    const from = i;
    const unit = raw[i] === "\t" || raw.slice(i, i + 4) === "    ";
    if (unit) i += raw[i] === "\t" ? 1 : 4;
    else while (raw[i] === " ") i++;
    const previous = pieces[pieces.length - 1];
    if (
      unit &&
      previous?.unit &&
      previous.to === from &&
      !partialTabs.has(from) &&
      !partialTabs.has(previous.from)
    )
      previous.to = i;
    else pieces.push({ from, to: i, unit });
  }
  for (const piece of pieces) {
    const from = Math.max(hiddenEnd, piece.from);
    if (from >= piece.to) continue;
    const span = win.createSpan();
    span.className = piece.unit
      ? "bullet-plugin-code-indent-unit"
      : "bullet-plugin-code-indent-spacing";
    // Zoom's tab marks split native indent boxes. Obsidian keeps raw tab text
    // in these boxes, so the existing minimum width still applies; assigning
    // the mark's ch width directly would incorrectly shrink the whole box.
    span.textContent = raw.slice(from, piece.to);
    indent.appendChild(span);
  }
  return indent;
}

function measureIntrinsicInset(
  indent: HTMLElement,
  marker: HTMLElement,
): string {
  const margin =
    parseFloat(
      marker.ownerDocument.defaultView?.getComputedStyle(marker)
        .marginInlineEnd ?? "0",
    ) || 0;
  return `${indent.getBoundingClientRect().width + marker.getBoundingClientRect().width + margin}px`;
}

function measureNativeContinuationInset(
  view: EditorView,
  element: HTMLElement,
  position: number,
  marker: HTMLElement,
): string | null {
  const line = documentLineForElement(view, element);
  if (!line) return null;
  let indentInset: string | null = position === line.from ? "0px" : null;
  for (const prefix of Array.from(
    element.querySelectorAll<HTMLElement>(".cm-indent, .cm-indent-spacing"),
  )) {
    const from = view.posAtDOM(prefix, 0);
    const to = view.posAtDOM(prefix, prefix.childNodes.length);
    if (position < from || position > to) continue;
    if (position === from || position === to) {
      // A native indentation span may be wider than its text because of its
      // minimum width. Preserve that box at whole-span boundaries.
      indentInset = logicalInset(
        element,
        prefix.getBoundingClientRect(),
        false,
        position === to,
      );
    } else {
      const point = view.domAtPos(position);
      if (!prefix.contains(point.node)) continue;
      const range = element.ownerDocument.createRange();
      range.setStart(prefix, 0);
      range.setEnd(point.node, point.offset);
      const rects = range.getClientRects();
      const bounds = rects[rects.length - 1];
      if (bounds) indentInset = logicalInset(element, bounds, false, true);
    }
    break;
  }
  if (indentInset === null) return null;
  const style = marker.ownerDocument.defaultView?.getComputedStyle(marker);
  const width = marker.getBoundingClientRect().width;
  const margin = Number.parseFloat(style?.marginInlineEnd ?? "0") || 0;
  return `${Number.parseFloat(indentInset) + width + margin}px`;
}

function logicalInset(
  element: HTMLElement,
  content: { left: number; right: number },
  includeCodePadding: boolean,
  useEnd = false,
): string | null {
  const line = element.getBoundingClientRect();
  const rtl =
    element.ownerDocument.defaultView?.getComputedStyle(element).direction ===
    "rtl";
  const inset = rtl
    ? line.right - (useEnd ? content.left : content.right)
    : (useEnd ? content.right : content.left) - line.left;
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
