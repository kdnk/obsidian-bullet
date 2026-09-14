import { syntaxTree } from "@codemirror/language";
import { ChangeSet, EditorState, countColumn } from "@codemirror/state";
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
const listFenceRe = /^([ \t]*)([-*+]|\d+\.)([ \t]+)(`{3,}|~{3,})/;

interface MeasuredLine {
  element: HTMLElement;
  inset: string;
  end?: string;
  emptyBody?: boolean;
  preview?: { height: string; markerOffset: string };
  previewBlock?: HTMLElement;
  previewEmbed?: boolean;
}

interface FenceOpening {
  contentColumn: number;
  indentColumn: number;
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
  private styledLines = new Map<HTMLElement, MeasuredLine>();
  private animationFrame: number | null = null;
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
      rows: HTMLElement[];
      rowProbes: Map<string, HTMLElement>;
      fence: HTMLElement;
      source: string;
      hidden: string;
      from: number;
      to: number;
      flairWidth: number;
      flairRows: number;
    }
  >();

  private measurement = {
    read: () => this.measureLines(),
    write: (lines: MeasuredLine[]) => this.applyMeasurements(lines),
  };

  constructor(
    private view: EditorView,
    private lineNameAtOverride?: LineNameAt,
    private zoomRange?: (state: EditorState) => { indent: string } | null,
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
    const Observer = view.dom.ownerDocument.defaultView?.MutationObserver;
    if (Observer) {
      this.previewObserver = new Observer((records) => {
        if (this.destroyed) return;
        let childChanged = false;
        let rolesMayHaveChanged = false;
        for (const { target, type } of records) {
          const element =
            target.nodeType === 1 ? (target as HTMLElement) : null;
          const line =
            element &&
            (this.styledLines.has(element)
              ? element
              : element.closest<HTMLElement>(
                  ".cm-line, .cm-preview-code-block",
                ));
          if (type === "attributes") {
            if (line && this.styledLines.has(line)) rolesMayHaveChanged = true;
          } else if (target === view.contentDOM || line) {
            childChanged = true;
            rolesMayHaveChanged = true;
          }
        }
        // Native redraws replace line classes. Restore height ownership in the
        // same mutation turn, before another CodeMirror height-map read. This
        // only inspects current native markup; geometry stays in requestMeasure.
        const rolesChanged = rolesMayHaveChanged && this.applyLineRoles();
        if (childChanged || rolesChanged) {
          // A processor can replace placeholder content without changing the
          // widget's height, so geometryChanged alone misses its first line.
          this.scheduleMeasure();
        }
      });
      this.previewObserver.observe(view.contentDOM, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    }
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
      update.selectionSet ||
      treeChanged
    ) {
      this.scheduleMeasure();
    }
  }

  destroy() {
    this.destroyed = true;
    this.previewObserver?.disconnect();
    if (this.animationFrame !== null) {
      this.view.dom.ownerDocument.defaultView?.cancelAnimationFrame(
        this.animationFrame,
      );
      this.animationFrame = null;
    }
    this.clearStyles();
    this.previews.destroy();
    this.markerMeasureContainer?.remove();
    this.markerMeasureContainer = null;
    this.markerMeasurements.clear();
    this.codeMeasurements.clear();
  }

  private scheduleMeasure() {
    if (this.destroyed) return;
    this.prepareMarkerMeasurements();
    if (this.animationFrame !== null) return;
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
    const fenceText = opening.text.slice(
      match[1].length + match[2].length + match[3].length,
    );
    const fence = getFenceOpening(fenceText);
    if (!fence) return;
    const rows: string[] = [];
    let to = opening.to;
    let closingText = "";
    for (let i = n + 1; i <= state.doc.lines; i++) {
      const line = state.doc.line(i);
      const content = getFenceContent(line.text, container);
      if (!content && line.text.trim()) break;
      to = line.to;
      if (content && isFenceClosing(content.text, fence)) {
        closingText = content.text;
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
    const rowProbes = reusable?.rowProbes ?? new Map<string, HTMLElement>();
    const uniqueRows = new Set(rows);
    for (const [raw, row] of rowProbes) {
      if (!uniqueRows.has(raw)) {
        row.remove();
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
      row.appendChild(
        makeIndentMeasurement(doc, indent, hidden, state.tabSize),
      );
      row.appendChild(doc.createTextNode(raw.slice(indent.length)));
      row.className = "bullet-plugin-code-width-row";
      element.appendChild(row);
      rowProbes.set(raw, row);
    }
    const fenceProbe = reusable?.fence ?? win.createSpan();
    fenceProbe.className = "bullet-plugin-code-width-measure";
    const fenceSource = fenceText + "\n" + closingText;
    if (fenceProbe.textContent !== fenceSource)
      fenceProbe.textContent = fenceSource;
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
    const bodyEnd = probe.element.getBoundingClientRect().width;
    const leadingEnd = Math.max(
      Number.parseFloat(inset),
      ...probe.rows
        .slice(0, probe.flairRows)
        .map((row) => row.getBoundingClientRect().width),
    );
    const fenceEnd = editing
      ? Number.parseFloat(inset) + probe.fence.getBoundingClientRect().width
      : 0;
    const end = Math.max(
      bodyEnd,
      leadingEnd + (editing ? 0 : probe.flairWidth),
    );
    // The content-start decoration contributes one padding unit; keep another
    // after the final character, including empty blocks. Fences have no
    // content-start decoration, so they need only the trailing unit.
    return `max(calc(${inset} + 2 * var(--list-padding-inline-start)), calc(${end}px + 2 * var(--list-padding-inline-start)), calc(${fenceEnd}px + var(--list-padding-inline-start)))`;
  }

  private measureLines(): MeasuredLine[] {
    if (this.destroyed) return [];
    const elements = Array.from(
      this.view.contentDOM.querySelectorAll<HTMLElement>(
        ".cm-line, .cm-preview-code-block",
      ),
    );
    const measured: MeasuredLine[] = [];
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
          const lineHeight = Number.parseFloat(
            element.ownerDocument.defaultView?.getComputedStyle(element)
              .lineHeight ?? "0",
          );
          codeProbe.flairWidth = bounds.width;
          codeProbe.flairRows =
            lineHeight > 0
              ? Math.max(
                  1,
                  Math.ceil(
                    (bounds.bottom - element.getBoundingClientRect().top) /
                      lineHeight,
                  ),
                )
              : 1;
        }
        visibleInsets.set(opening.openingLineNumber, inset);
        const next = element.nextElementSibling;
        const nativePreview =
          isNativePreviewOpening(element) && isCodeBody(next);
        measured.push({
          element,
          inset,
          end: this.measureCodeEnd(opening.openingLineNumber, inset),
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
          end: this.measureCodeEnd(openingLineNumber, inset),
          emptyBody: true,
        });
    }
    return measured;
  }

  private applyMeasurements(lines: MeasuredLine[]) {
    if (this.destroyed) return;
    const current = new Map(lines.map((line) => [line.element, line]));
    for (const element of this.styledLines.keys()) {
      if (!current.has(element)) this.clearElementStyles(element);
    }

    let previewChanged = false;
    for (const { element, inset, end, preview } of lines) {
      setStyleProperty(element, CODE_BLOCK_INSET, inset);
      if (end) setStyleProperty(element, CODE_BLOCK_END, end);
      else element.style.removeProperty(CODE_BLOCK_END);
      if (preview) {
        setStyleProperty(element, PREVIEW_HEIGHT, preview.height);
        setStyleProperty(element, PREVIEW_MARKER_OFFSET, preview.markerOffset);
      } else {
        element.style.removeProperty(PREVIEW_HEIGHT);
        element.style.removeProperty(PREVIEW_MARKER_OFFSET);
      }
      if (element.classList.contains("cm-preview-code-block")) {
        previewChanged = this.correctPreviewContent(element) || previewChanged;
      }
    }
    this.styledLines = current;
    this.applyLineRoles();
    // Removing container whitespace can unwrap code rows. Let the next native
    // measurement update the embed height and the opening marker together.
    if (previewChanged) this.scheduleMeasure();
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

  private applyLineRoles(): boolean {
    let changed = false;
    for (const {
      element,
      preview,
      previewBlock,
      previewEmbed,
      emptyBody,
    } of this.styledLines.values()) {
      const nested =
        isNestedCodeBlockElement(element) ||
        (!!emptyBody &&
          element.classList.contains("HyperMD-codeblock") &&
          documentLineForElement(this.view, element)?.text.trim() === "");
      const embed = element.classList.contains("cm-preview-code-block");
      if (!nested && !embed) {
        this.clearElementStyles(element);
        this.styledLines.delete(element);
        changed = true;
        continue;
      }
      const next = element.nextElementSibling;
      const previous = element.previousElementSibling;
      const nativeOpening = isNativePreviewOpening(element) && isCodeBody(next);
      const embedOpening =
        !!preview &&
        previewBlock === next &&
        element.classList.contains("HyperMD-codeblock-begin") &&
        !element.querySelector(".cm-hmd-codeblock") &&
        !!next?.classList.contains("cm-preview-code-block");
      const roles: Array<[string, boolean]> = [
        [CODE_BLOCK_CLASS, true],
        [
          PREVIEW_OPENING_CLASS,
          !!preview && previewBlock === next && (nativeOpening || embedOpening),
        ],
        [PREVIEW_EMBED_CLASS, embed && !!previewEmbed],
        [PREVIEW_EMBED_OPENING_CLASS, embedOpening],
        [
          HIDDEN_FENCE_CLASS,
          nativeOpening || embedOpening || isHiddenClosingFence(element),
        ],
        [
          PREVIEW_FIRST_CLASS,
          isCodeBody(element) && isNativePreviewOpening(previous),
        ],
        [PREVIEW_LAST_CLASS, nested && isHiddenClosingFence(next)],
      ];
      for (const [name, enabled] of roles) {
        changed = setClass(element, name, enabled) || changed;
      }
    }
    return changed;
  }

  private clearStyles() {
    for (const element of this.styledLines.keys())
      this.clearElementStyles(element);
    this.styledLines.clear();
  }

  private clearElementStyles(element: HTMLElement) {
    this.previews.clear(element);
    element.classList.remove(CODE_BLOCK_CLASS);
    element.classList.remove(PREVIEW_OPENING_CLASS);
    element.classList.remove(PREVIEW_EMBED_CLASS);
    element.classList.remove(PREVIEW_EMBED_OPENING_CLASS);
    element.classList.remove(HIDDEN_FENCE_CLASS);
    element.classList.remove(PREVIEW_FIRST_CLASS);
    element.classList.remove(PREVIEW_LAST_CLASS);
    element.style.removeProperty(CODE_BLOCK_INSET);
    element.style.removeProperty(CODE_BLOCK_END);
    element.style.removeProperty(PREVIEW_HEIGHT);
    element.style.removeProperty(PREVIEW_MARKER_OFFSET);
  }
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
  const markerOffset =
    firstLine.top +
    firstLine.height / 2 -
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
  const content = view.coordsAtPos(position);
  if (!content) return null;

  return logicalInset(element, content, includeCodePadding);
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
