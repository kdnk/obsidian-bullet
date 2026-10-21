import { syntaxTree } from "@codemirror/language";
import {
  ChangeSet,
  EditorSelection,
  EditorState,
  Extension,
  MapMode,
  StateEffect,
  Transaction,
  countColumn,
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  RectangleMarker,
  ViewPlugin,
  ViewUpdate,
  layer,
} from "@codemirror/view";

import { NestedCodeBlockPreviews } from "./NestedCodeBlockPreview";

import { getObsidianDomWindow } from "../obsidianDom";
import { MarkdownLineClassifier } from "../services/MarkdownLineClassifier";
import {
  getFenceContent,
  getFenceOpening,
  isFenceClosing,
} from "../utils/fencedCode";

const CODE_BLOCK_CLASS = "bullet-plugin-nested-code-block";
const CODE_CONTENT_CLASS = "bullet-plugin-nested-code-block-content";
const CODE_CURSOR_LINE_CLASS = "bullet-plugin-nested-code-cursor-line";
const CODE_CURSOR_LAYER_CLASS = "bullet-plugin-nested-code-cursor-layer";
const CODE_CURSOR_CLASS = "bullet-plugin-nested-code-cursor";
const CODE_CURSOR_BLINK_ALT_CLASS =
  "bullet-plugin-nested-code-cursor-blink-alt";
const CODE_CURSOR_OFFSET = "--bullet-code-cursor-offset";
const CODE_CONTENT_PADDING = "--bullet-code-content-padding";
const CODE_BLOCK_INSET = "--bullet-nested-code-block-inset";
const CODE_BLOCK_END = "--bullet-nested-code-block-end";
const PREVIEW_OPENING_CLASS = "bullet-plugin-code-preview-opening";
const PREVIEW_EMBED_CLASS = "bullet-plugin-code-preview-embed";
const PREVIEW_EMBED_OPENING_CLASS = "bullet-plugin-code-preview-embed-opening";
const HIDDEN_FENCE_CLASS = "bullet-plugin-code-preview-hidden-fence";
const PREVIEW_FIRST_CLASS = "bullet-plugin-code-preview-first";
const PREVIEW_LAST_CLASS = "bullet-plugin-code-preview-last";
const PREVIEW_BODY_CLASS = "bullet-plugin-code-preview-body";
const CODE_OWNER_PREFIX_CLASS = "bullet-plugin-code-owner-prefix";
const CODE_CONTENT_INDENT_CLASS = "bullet-plugin-code-content-indent";
const CODE_CONTINUATION_PREVIEW_PREFIX_CLASS =
  "bullet-plugin-code-continuation-preview-prefix";
const CODE_OWNER_GUIDE_CLIPPED_CLASS = "bullet-plugin-code-owner-guide-clipped";
const CODE_OWNER_GUIDE_CLIP = "--bullet-code-owner-guide-clip";
const CODE_OWNER_GUIDE_CLASS = "bullet-plugin-code-owner-guide";
const CODE_OWNER_GUIDE_OFFSET = "--bullet-code-owner-guide-offset";
const CODE_PREVIEW_OWNER_GUIDE_CLASS = "bullet-plugin-code-preview-owner-guide";
const CODE_PREVIEW_OWNER_GUIDE_TOP = "--bullet-code-preview-owner-guide-top";
const CODE_PREVIEW_OWNER_GUIDE_HEIGHT =
  "--bullet-code-preview-owner-guide-height";
const CODE_GUIDE_CONTINUATION_CLASS = "bullet-plugin-code-guide-continuation";
const CODE_INDENT_GUIDE_COVERED_CLASS =
  "bullet-plugin-code-indent-guide-covered";
const CODE_OUTER_GUIDE_COVERED_CLASS = "bullet-plugin-code-outer-guide-covered";
const CODE_INDENT_GUIDE_HEIGHT = "--bullet-code-indent-guide-height";
const CODE_OUTER_GUIDE_HEIGHT = "--bullet-code-outer-guide-height";
const CODE_GUIDE_SEAM_CLASS = "bullet-plugin-code-guide-seam";
const CODE_INDENT_GUIDE_SEAM_CLIP = "--bullet-code-indent-guide-seam-clip";
const CODE_OUTER_GUIDE_SEAM_CLIP = "--bullet-code-outer-guide-seam-clip";
const OPENING_ALIGNED_CLASS = "bullet-plugin-code-opening-aligned";
const OPENING_MARKER_OFFSET = "--bullet-code-opening-marker-offset";
const BODY_FOLD_CLASS = "bullet-plugin-code-body-fold";
const BODY_FOLD_OFFSET = "--bullet-code-body-fold-offset";
const COMPACT_PREVIEW_CLASS = "bullet-plugin-code-preview-compact";
const HEADER_PREVIEW_CLASS = "bullet-plugin-code-preview-header";
const PREVIEW_OPENING_HEIGHT = "--bullet-code-preview-opening-height";
const PREVIEW_BACKGROUND = "--bullet-code-preview-background";
const PREVIEW_END = "--bullet-code-preview-end";
const PREVIEW_RADIUS = "--bullet-code-preview-radius";
const listFenceRe = /^([ \t]*)([-*+]|\d+\.)([ \t]+)(`{3,}|~{3,})/;

interface OpeningAlignment {
  markerOffset: string;
  ownerGuideClip: string;
}

interface FirstCodeLineGeometry {
  blockBounds: DOMRect;
  firstLine: { top: number; height: number };
  hasLineBox: boolean;
}

type PreviewAppearance = {
  background: string;
  end: string;
  radius: string;
} & ({ kind: "plain" } | { kind: "header"; openingHeight: string });

type PreviewOwnerGuide =
  | { kind: "row"; offset: string; clip?: string }
  | { kind: "opening"; offset: string; top: string; height: string };

interface MeasuredLine {
  element: HTMLElement;
  inset: string;
  end?: string;
  contentPadding?: string;
  emptyBody?: boolean;
  markerOffset?: string;
  bodyFoldOffset?: string;
  ownerGuideClip?: string;
  ownerGuideOffset?: string;
  previewOwnerGuide?: PreviewOwnerGuide;
  guideHeight?: string;
  outerGuideHeight?: string;
  indentGuideCovered?: boolean;
  outerGuideCovered?: boolean;
  guideSeam?: { element: HTMLElement; indentClip?: string; outerClip?: string };
  preview?: OpeningAlignment;
  previewBlock?: HTMLElement;
  previewEmbed?: boolean;
  previewAppearance?: PreviewAppearance;
}

interface SourceRow {
  from: number;
  openingFrom: number;
  openingText: string;
  prefix: string;
  residualColumns: number;
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
  markerOffset: string | undefined;
  bodyFoldOffset: string | undefined;
  ownerGuideClip: string | undefined;
  ownerGuideOffset: string | undefined;
  previewOwnerGuide: PreviewOwnerGuide | undefined;
  guideHeight: string | undefined;
  outerGuideHeight: string | undefined;
  indentGuideCovered: boolean;
  outerGuideCovered: boolean;
  presentation: NativePresentation;
}

interface NativeSnapshot {
  doc: EditorState["doc"];
  epoch: number;
  rows: ReadonlyMap<number, NativeRowLayout>;
  seams: ReadonlyMap<number, GuideSeam>;
}

interface GuideSeam {
  indentClip?: string;
  outerClip?: string;
}

interface ProcessorLayout {
  element: HTMLElement;
  openingFrom: number;
  inset: string;
  previewEmbed: boolean;
  appearance: PreviewAppearance | undefined;
}

interface ProcessorCodeSource {
  element: HTMLElement;
  openingFrom: number;
  rawLines: readonly string[];
  contentColumn: number;
  fenceInfo: string;
}

interface MeasuredFrame {
  native: NativeSnapshot;
  processors: ProcessorLayout[];
  previewSources: ProcessorCodeSource[];
}

const NATIVE_CLASSES = [
  CODE_BLOCK_CLASS,
  OPENING_ALIGNED_CLASS,
  PREVIEW_OPENING_CLASS,
  PREVIEW_EMBED_OPENING_CLASS,
  COMPACT_PREVIEW_CLASS,
  HEADER_PREVIEW_CLASS,
  HIDDEN_FENCE_CLASS,
  PREVIEW_FIRST_CLASS,
  PREVIEW_LAST_CLASS,
  PREVIEW_BODY_CLASS,
  CODE_OWNER_GUIDE_CLIPPED_CLASS,
  CODE_OWNER_GUIDE_CLASS,
  CODE_PREVIEW_OWNER_GUIDE_CLASS,
  CODE_GUIDE_CONTINUATION_CLASS,
  CODE_INDENT_GUIDE_COVERED_CLASS,
  CODE_OUTER_GUIDE_COVERED_CLASS,
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

interface CodeContentBoundary {
  readonly offset: number;
  readonly residualColumns: number;
}

const contentGlyph = Decoration.mark({ class: CODE_CONTENT_CLASS });
const owningListContinuation = Decoration.mark({
  class: CODE_OWNER_PREFIX_CLASS,
});
const codeContentIndent = Decoration.mark({
  class: CODE_CONTENT_INDENT_CLASS,
});
const continuationPreviewPrefix = Decoration.mark({
  class: CODE_CONTINUATION_PREVIEW_PREFIX_CLASS,
});

interface CodeSourceDecorations {
  readonly content: DecorationSet;
  readonly prefixRoles: DecorationSet;
}

const nestedCodeBlockCursorLayer = layer({
  above: true,
  class: CODE_CURSOR_LAYER_CLASS,
  markers(view) {
    const range = singleCursor(view.state);
    if (
      !view.hasFocus ||
      !range ||
      !view.dom.closest(".markdown-source-view.mod-cm6.is-live-preview")
    )
      return [];
    const caretColor =
      view.dom.ownerDocument.defaultView?.getComputedStyle(view.contentDOM)
        .caretColor ?? "";
    if (nativeCaretIsTransparent(caretColor)) return [];
    const { node } = view.domAtPos(range.head);
    const element =
      node.nodeType === 1 ? (node as Element) : node.parentElement;
    if (!element?.closest(`.${CODE_CURSOR_LINE_CLASS}`)) return [];
    const className = `cm-cursor cm-cursor-primary ${CODE_CURSOR_CLASS}`;
    const markers = RectangleMarker.forRange(view, className, range);
    if (markers.length !== 1) return markers;
    const line = element.closest<HTMLElement>(".cm-line");
    const glyph = line?.querySelector<HTMLElement>(`.${CODE_CONTENT_CLASS}`);
    if (glyph) {
      try {
        if (range.head === view.posAtDOM(glyph, 0))
          return RectangleMarker.forRange(
            view,
            className,
            EditorSelection.cursor(range.head, 1),
          );
      } catch {
        return markers;
      }
    }
    const screenLeft =
      line && blankCodeBoundaryScreenLeft(view, line, range.head);
    if (screenLeft === null || screenLeft === undefined) return markers;
    const native = view.coordsAtPos(range.head, range.assoc || 1);
    if (!native) return markers;
    const marker = markers[0];
    return [
      new RectangleMarker(
        className,
        marker.left + screenLeft - native.left,
        marker.top,
        marker.width,
        marker.height,
      ),
    ];
  },
  update(update, dom) {
    if (update.transactions.some((transaction) => transaction.selection))
      dom.classList.toggle(CODE_CURSOR_BLINK_ALT_CLASS);
    return (
      update.docChanged ||
      update.selectionSet ||
      update.focusChanged ||
      update.viewportChanged ||
      update.geometryChanged
    );
  },
  mount(dom) {
    dom.classList.add("cm-cursorLayer");
  },
});

function singleCursor(state: EditorState) {
  const { main, ranges } = state.selection;
  return ranges.length === 1 && main.empty ? main : null;
}

function nativeCaretIsTransparent(caretColor: string) {
  const normalized = caretColor.toLowerCase().replace(/ /g, "");
  return (
    normalized === "transparent" ||
    normalized === "rgba(0,0,0,0)" ||
    normalized.endsWith("/0)")
  );
}

function blankCodeBoundaryScreenLeft(
  view: EditorView,
  lineElement: HTMLElement,
  position: number,
): number | null {
  const line = view.state.doc.lineAt(position);
  if (line.text.trim() !== "" || position !== line.to) return null;
  if (lineElement.querySelector(`.${CODE_CONTENT_CLASS}`)) {
    const { node } = view.domAtPos(position);
    const element =
      node.nodeType === 1 ? (node as Element) : node.parentElement;
    const indent = element?.closest<HTMLElement>(".cm-indent");
    if (
      indent &&
      view.posAtDOM(indent, indent.childNodes.length) === position
    ) {
      const bounds = indent.getBoundingClientRect();
      return lineElement.ownerDocument.defaultView?.getComputedStyle(
        lineElement,
      ).direction === "rtl"
        ? bounds.left
        : bounds.right;
    }
    return view.coordsAtPos(position, 1)?.left ?? null;
  }
  const inset = Number.parseFloat(
    lineElement.style.getPropertyValue(CODE_BLOCK_INSET),
  );
  const padding = Number.parseFloat(
    lineElement.ownerDocument.defaultView?.getComputedStyle(
      lineElement,
      "::after",
    ).inlineSize ?? "",
  );
  if (!Number.isFinite(inset) || !Number.isFinite(padding)) return null;
  return lineElement.getBoundingClientRect().left + inset + padding;
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
  prefixRoleDecorations: DecorationSet;
  private nativeRows: ReadonlyMap<number, NativeRowLayout> = new Map();
  private guideSeams: ReadonlyMap<number, GuideSeam> = new Map();
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
  private correctedProcessors = new Set<HTMLElement>();
  private classifier = new MarkdownLineClassifier();
  private markerMeasureContainer: HTMLElement | null = null;
  private ownerGuideMeasure: HTMLElement | null = null;
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
      closingFence: CodeRowProbe;
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
    const decorations = this.buildDecorations();
    this.decorations = decorations.layout;
    this.prefixRoleDecorations = decorations.prefixRoles;
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
      if (update.docChanged) this.guideSeams = new Map();
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
          this.guideSeams = effect.value.seams;
          published = true;
        }
      }
    }
    if (
      update.docChanged ||
      update.viewportChanged ||
      treeChanged ||
      published ||
      presentationChanged ||
      selectionChanged
    ) {
      const decorations = this.buildDecorations();
      this.decorations = decorations.layout;
      this.prefixRoleDecorations = decorations.prefixRoles;
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
    this.correctedProcessors.clear();
    this.markerMeasureContainer?.remove();
    this.markerMeasureContainer = null;
    this.ownerGuideMeasure = null;
    this.markerMeasurements.clear();
    this.codeMeasurements.clear();
  }

  private buildDecorations(): {
    readonly layout: DecorationSet;
    readonly prefixRoles: DecorationSet;
  } {
    const { state, visibleRanges } = this.view;
    const sourceDecorations = codeBlockSourceDecorations(
      state,
      visibleRanges,
      this.syntaxContext.lineNameAt,
      this.syntaxContext.fenceOpenings.at,
      this.classifier,
    );
    const positions = new Set(this.nativeRows.keys());
    const cursor = singleCursor(state);
    const cursorLine = cursor ? state.doc.lineAt(cursor.head).from : null;
    const cursorSource =
      cursorLine !== null
        ? sourceRowAt(state, this.syntaxContext, cursorLine)
        : null;
    const cursorLines = new Set(
      cursor !== null &&
        cursorLine !== null &&
        cursorSource &&
        (cursor?.head === cursorSource.from + cursorSource.prefix.length ||
          (state.doc.lineAt(cursor.head).text.trim() === "" &&
            cursor.head === state.doc.lineAt(cursor.head).to))
        ? [cursorLine]
        : [],
    );
    for (const range of visibleRanges) {
      const last = state.doc.lineAt(range.to).number;
      for (let n = state.doc.lineAt(range.from).number; n <= last; n++) {
        const from = state.doc.line(n).from;
        if (sourceRowAt(state, this.syntaxContext, from)) positions.add(from);
      }
    }
    return {
      layout: sourceDecorations.content.update({
        add: [
          ...Array.from(positions, (from) =>
            Decoration.line(
              nativeAttributes(
                this.nativeRows.get(from),
                cursorLines.has(from),
              ),
            ).range(from),
          ),
          ...Array.from(this.guideSeams, ([from, clip]) =>
            Decoration.line(guideSeamAttributes(clip)).range(from),
          ),
        ],
        sort: true,
      }),
      prefixRoles: sourceDecorations.prefixRoles,
    };
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
      this.view.dom.appendChild(container);
      this.markerMeasureContainer = container;
      const indent = win.createSpan();
      indent.className = "cm-hmd-list-indent";
      const guide = win.createSpan();
      guide.className = "cm-indent";
      guide.textContent = "\t";
      indent.appendChild(guide);
      container.appendChild(indent);
      this.ownerGuideMeasure = guide;
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
    if (
      !closingFence ||
      reusable?.closingSource !== closingSource ||
      reusable.containerColumn !== containerColumn
    ) {
      closingFence?.element.remove();
      const closingElement = win.createSpan();
      closingElement.className = "bullet-plugin-code-width-row";
      const closingIndent = /^[ \t]*/.exec(closingSource)![0];
      const indent = makeIndentMeasurement(
        doc,
        closingIndent,
        hidden,
        state.tabSize,
      );
      closingElement.appendChild(indent);
      const offset =
        offsetAtColumn(closingSource, containerColumn, state.tabSize) ?? 0;
      const residualColumns = Math.max(
        0,
        countColumn(closingSource.slice(0, offset), state.tabSize) -
          containerColumn,
      );
      let residual: HTMLElement | undefined;
      if (residualColumns) {
        residual = win.createSpan();
        residual.className = "bullet-plugin-code-width-residual";
        residual.textContent = " ".repeat(residualColumns);
        closingElement.appendChild(residual);
      }
      closingElement.appendChild(
        doc.createTextNode(closingSource.slice(closingIndent.length)),
      );
      fenceProbe.appendChild(closingElement);
      closingFence = {
        element: closingElement,
        indent,
        residual,
        contentOffset: Math.max(
          0,
          offset - hiddenIndentEnd(closingIndent, hidden, state.tabSize),
        ),
      };
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
          Number.parseFloat(inset) +
            probe.closingFence.element.getBoundingClientRect().width -
            measureProbeContentStart(probe.closingFence) +
            (probe.closingFence.residual?.getBoundingClientRect().width ?? 0),
        )
      : 0;
    const end = Math.max(
      bodyEnd,
      fenceEnd,
      leadingEnd + (editing ? 0 : probe.flairWidth),
    );
    return `max(calc(${inset} + 2 * var(--size-4-4)), calc(${end}px + 2 * var(--size-4-4)))`;
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
    const renderedGuideOwners = new Map<
      number,
      { indent: boolean; outer: boolean }
    >();
    const firstBodyGuideClips = new Map<Element, string>();
    const pendingEmptyRows: Array<{
      element: HTMLElement;
      opening: FenceOpening;
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
            const alignment = measureOpeningAlignment(
              preceding.element,
              element,
            );
            preceding.preview = alignment;
            const offset = this.measureOwnerGuideOffset(opening, currentInset);
            if (offset !== undefined)
              preceding.previewOwnerGuide = measureOpeningPreviewOwnerGuide(
                preceding.element,
                element,
                offset,
              );
            const guide = measureCodeGuideContinuation(
              preceding.element,
              element,
            );
            preceding.guideHeight = guide.height;
            preceding.outerGuideHeight = guide.outerHeight;
            preceding.guideSeam = guide.seam;
            renderedGuideOwners.set(opening.openingLineNumber, {
              indent: guide.coversIndent,
              outer: guide.coversOuter,
            });
            const emptySource =
              opening.openingLineNumber < this.view.state.doc.lines &&
              hasClassName(
                this.syntaxContext.lineNameAt(opening.openingLineNumber + 1) ??
                  "",
                "HyperMD-codeblock-end",
              );
            preceding.markerOffset =
              emptySource ||
              preceding.element.querySelector(".cm-hmd-codeblock")
                ? undefined
                : alignment?.markerOffset;
            preceding.previewBlock = element;
            measured[measured.length - 1].previewEmbed = !!preceding.preview;
            preceding.previewAppearance = measurePreviewAppearance(
              preceding.element,
              element,
              this.view.scaleY,
            );
            measured[measured.length - 1].previewAppearance =
              preceding.previewAppearance;
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
      const boundary = codeContentBoundary(
        line,
        opening,
        this.view.state.tabSize,
      );
      if (!boundary) continue;

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
                line.from + boundary.offset,
                false,
              ));
      } else if (
        previousLineNumber !== line.number - 1 ||
        currentInset === null
      ) {
        currentInset = marker
          ? nativeInset()
          : emptyBody
            ? null
            : measureContentInset(
                this.view,
                element,
                line.from + boundary.offset,
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
        const guide =
          isOpening && next && isCodeCardContinuation(next)
            ? measureCodeGuideContinuation(element, next as HTMLElement)
            : undefined;
        if (guide)
          renderedGuideOwners.set(opening.openingLineNumber, {
            indent: guide.coversIndent,
            outer: guide.coversOuter,
          });
        const alignment =
          isOpening && isCodeBody(next)
            ? measureOpeningAlignment(
                element,
                next as HTMLElement,
                next?.querySelector(`.${CODE_CONTENT_CLASS}`) ?? next,
              )
            : undefined;
        if (alignment?.ownerGuideClip && next)
          firstBodyGuideClips.set(next, alignment.ownerGuideClip);
        const nativePreview =
          isNativePreviewOpening(element) && isCodeBody(next);
        const firstBody =
          isCodeBody(element) && line.number === opening.openingLineNumber + 1;
        const codeContent = element.querySelector(`.${CODE_CONTENT_CLASS}`);
        const ownerGuideOffset = this.measureOwnerGuideOffset(opening, inset);
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
          markerOffset:
            nativePreview || element.querySelector(".list-bullet")
              ? alignment?.markerOffset
              : undefined,
          bodyFoldOffset:
            isCodeBody(element) && element.querySelector(".cm-fold-indicator")
              ? line.text.search(/\S/) === boundary.offset
                ? "calc(var(--bullet-code-content-padding, 0px) - var(--size-4-4) / 2)"
                : "calc(0px - var(--size-4-4) / 2)"
              : undefined,
          ownerGuideClip: firstBody
            ? (firstBodyGuideClips.get(element) ??
              measureOwnerGuideClip(element, codeContent ?? element))
            : undefined,
          ownerGuideOffset: isOpening ? undefined : ownerGuideOffset,
          previewOwnerGuide: this.measureNativePreviewOwnerGuide(
            element,
            opening,
            ownerGuideOffset,
            isOpening,
          ),
          guideHeight: guide?.height,
          outerGuideHeight: guide?.outerHeight,
          indentGuideCovered:
            !isOpening &&
            renderedGuideOwners.get(opening.openingLineNumber)?.indent,
          outerGuideCovered:
            !isOpening &&
            renderedGuideOwners.get(opening.openingLineNumber)?.outer,
          guideSeam: guide?.seam,
          previewBlock: nativePreview ? (next as HTMLElement) : undefined,
          preview: nativePreview ? alignment : undefined,
        });
      } else if (emptyBody) {
        // An empty row has no source indentation to measure. Resolve it from
        // another visible row of this same fence during this measurement pass.
        pendingEmptyRows.push({
          element,
          opening,
        });
      }
      previousLineNumber = line.number;
      if (element.classList.contains("HyperMD-codeblock-end")) {
        currentInset = null;
        previousLineNumber = null;
      }
    }

    for (const { element, opening } of pendingEmptyRows) {
      const openingLineNumber = opening.openingLineNumber;
      const probe = this.markerMeasurements.get(openingLineNumber);
      const inset =
        visibleInsets.get(openingLineNumber) ??
        (probe ? measureIntrinsicInset(probe.indent, probe.marker) : undefined);
      if (inset !== undefined) {
        const ownerGuideOffset = this.measureOwnerGuideOffset(opening, inset);
        measured.push({
          element,
          inset,
          end: codeEndFor(openingLineNumber, inset),
          contentPadding: measureCodeContentPadding(
            this.view,
            element,
            opening,
            inset,
          ),
          emptyBody: true,
          previewOwnerGuide: this.measureNativePreviewOwnerGuide(
            element,
            opening,
            ownerGuideOffset,
            false,
          ),
          ownerGuideOffset,
          ownerGuideClip:
            documentLineForElement(this.view, element)?.number ===
            openingLineNumber + 1
              ? measureOwnerGuideClip(element, element)
              : undefined,
          indentGuideCovered:
            renderedGuideOwners.get(openingLineNumber)?.indent,
          outerGuideCovered: renderedGuideOwners.get(openingLineNumber)?.outer,
        });
      }
    }
    return measured;
  }

  private measureNativePreviewOwnerGuide(
    element: HTMLElement,
    opening: FenceOpening,
    offset: string | undefined,
    isOpening: boolean,
  ): PreviewOwnerGuide | undefined {
    if (offset === undefined) return;
    if (isOpening) {
      if (isHiddenClosingFence(element.nextElementSibling))
        return measureOpeningPreviewOwnerGuide(element, element, offset);
      return;
    }
    const line = documentLineForElement(this.view, element);
    const firstBody = line?.number === opening.openingLineNumber + 1;
    const geometry = firstBody
      ? measureFirstCodeLine(
          element,
          element.querySelector(`.${CODE_CONTENT_CLASS}`) ?? element,
        )
      : undefined;
    return {
      kind: "row",
      offset,
      clip: geometry
        ? `${Math.max(0, geometry.firstLine.top + geometry.firstLine.height - geometry.blockBounds.top)}px`
        : undefined,
    };
  }

  private measureOwnerGuideOffset(
    opening: FenceOpening,
    inset: string,
  ): string | undefined {
    const hidden = this.zoomRange?.(this.view.state)?.indent ?? "";
    if (countColumn(hidden, this.view.state.tabSize) > opening.indentColumn)
      return;
    const marker = this.markerMeasurements.get(
      opening.openingLineNumber,
    )?.marker;
    const guide = this.ownerGuideMeasure;
    if (
      !marker ||
      !guide ||
      !Array.from(marker.children).some(
        (child) => child.className === "list-bullet",
      )
    )
      return;
    const win = marker.ownerDocument.defaultView;
    if (!win) return;
    const markerBounds = marker.getBoundingClientRect();
    const guideBounds = guide.getBoundingClientRect();
    const style = win.getComputedStyle(guide, "::before");
    if (style.transform !== "none" || style.translate !== "none") return;
    const container =
      win.getComputedStyle(guide).position === "static"
        ? guide.offsetParent
        : guide;
    if (!container) return;
    const width = Number.parseFloat(style.width);
    if (!Number.isFinite(width) || width <= 0) return;
    const length = (value: string, size: number) =>
      value.endsWith("%")
        ? (Number.parseFloat(value) * size) / 100
        : Number.parseFloat(value);
    const borderLeft = Number.parseFloat(style.borderLeftWidth);
    const borderRight = Number.parseFloat(style.borderRightWidth);
    const paddingLeft = Number.parseFloat(style.paddingLeft);
    const paddingRight = Number.parseFloat(style.paddingRight);
    if (
      ![borderLeft, borderRight, paddingLeft, paddingRight].every(
        Number.isFinite,
      )
    )
      return;
    if (borderLeft > 0 && borderRight > 0) return;
    const boxWidth =
      style.boxSizing === "border-box"
        ? width
        : width + paddingLeft + paddingRight + borderLeft + borderRight;
    const paintCenter =
      borderRight > 0
        ? boxWidth - borderRight / 2
        : borderLeft > 0
          ? borderLeft / 2
          : boxWidth / 2;
    const marginLeft = length(style.marginLeft, container.clientWidth);
    const marginRight = length(style.marginRight, container.clientWidth);
    const left =
      style.left === "auto"
        ? container.clientWidth -
          length(style.right, container.clientWidth) -
          marginLeft -
          marginRight -
          boxWidth
        : length(style.left, container.clientWidth);
    const center =
      container.getBoundingClientRect().left +
      container.clientLeft +
      left +
      marginLeft +
      paintCenter;
    const markerStyle = win.getComputedStyle(marker);
    const rtl = markerStyle.direction === "rtl";
    const offset = rtl ? guideBounds.right - center : center - guideBounds.left;
    const margin = Number.parseFloat(markerStyle.marginInlineEnd) || 0;
    const distance = markerBounds.width + margin - offset;
    if (!Number.isFinite(distance)) return;
    return rtl
      ? `calc(100% - ${inset} + ${distance}px)`
      : `calc(${inset} - ${distance}px)`;
  }

  private measureLayout(): MeasuredFrame {
    const native: NativeSnapshot = {
      doc: this.view.state.doc,
      epoch: this.epoch,
      rows: new Map(),
      seams: new Map(),
    };
    const rows = new Map<number, NativeRowLayout>();
    const seams = new Map<number, GuideSeam>();
    const processors: ProcessorLayout[] = [];
    for (const measurement of this.measureLines()) {
      const {
        element,
        inset,
        end,
        contentPadding,
        markerOffset,
        bodyFoldOffset,
        ownerGuideClip,
        ownerGuideOffset,
        previewOwnerGuide,
        guideHeight,
        outerGuideHeight,
        indentGuideCovered,
        outerGuideCovered,
      } = measurement;
      const line = documentLineForElement(this.view, element);
      if (!line) continue;
      if (measurement.guideSeam) {
        const seamLine = documentLineForElement(
          this.view,
          measurement.guideSeam.element,
        );
        if (seamLine)
          seams.set(seamLine.from, {
            indentClip: measurement.guideSeam.indentClip,
            outerClip: measurement.guideSeam.outerClip,
          });
      }
      if (element.classList.contains("cm-preview-code-block")) {
        const opening = this.syntaxContext.fenceOpenings.at(line.number);
        if (opening)
          processors.push({
            element,
            openingFrom: this.view.state.doc.line(opening.openingLineNumber)
              .from,
            inset,
            previewEmbed: !!measurement.previewEmbed,
            appearance: measurement.previewAppearance,
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
          markerOffset,
          bodyFoldOffset,
          ownerGuideClip,
          ownerGuideOffset,
          previewOwnerGuide,
          guideHeight:
            guideHeight ?? this.nativeRows.get(source.from)?.guideHeight,
          outerGuideHeight:
            outerGuideHeight ??
            this.nativeRows.get(source.from)?.outerGuideHeight,
          // Coverage belongs to a rendered opening in this measurement pass.
          // Unlike geometry, it must never survive after that opener leaves
          // the DOM or its continuation paint would hide native body guides.
          indentGuideCovered: indentGuideCovered ?? false,
          outerGuideCovered: outerGuideCovered ?? false,
          presentation: nativePresentation(
            measurement,
            selectionInBlock(
              this.view.state,
              this.syntaxContext,
              this.view.state.selection,
              source.openingFrom,
            ),
          ),
        });
    }
    const previewSources: ProcessorCodeSource[] = [];
    for (const element of Array.from(
      this.view.contentDOM.querySelectorAll<HTMLElement>(
        ".cm-preview-code-block",
      ),
    )) {
      if (!element.classList.contains("cm-preview-code-block")) continue;
      const source = this.readPreviewSource(element);
      if (source) previewSources.push(source);
    }
    return {
      native: { ...native, rows, seams },
      processors,
      previewSources,
    };
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
    for (const processor of frame.processors) {
      const { element, openingFrom, inset, previewEmbed, appearance } =
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
      setClass(element, COMPACT_PREVIEW_CLASS, !!appearance);
      setClass(element, HEADER_PREVIEW_CLASS, appearance?.kind === "header");
      if (appearance?.kind === "header")
        setStyleProperty(
          element,
          PREVIEW_OPENING_HEIGHT,
          appearance.openingHeight,
        );
      else element.style.removeProperty(PREVIEW_OPENING_HEIGHT);
      current.set(element, processor);
    }
    for (const element of this.styledProcessors.keys()) {
      if (!current.has(element)) this.clearProcessor(element);
    }
    this.styledProcessors = current;
    const corrected = new Set<HTMLElement>();
    let previewChanged = false;
    for (const source of frame.previewSources) {
      const { element, openingFrom, rawLines, contentColumn, fenceInfo } =
        source;
      if (
        !element.classList.contains("cm-preview-code-block") ||
        !this.view.contentDOM.contains(element) ||
        documentLineForElement(this.view, element)?.from !== openingFrom
      )
        continue;
      previewChanged =
        this.previews.synchronize(
          element,
          rawLines,
          contentColumn,
          this.view.state.tabSize,
          fenceInfo,
        ) || previewChanged;
      corrected.add(element);
    }
    for (const element of this.correctedProcessors) {
      if (!corrected.has(element))
        previewChanged = this.previews.clear(element) || previewChanged;
    }
    this.correctedProcessors = corrected;
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
    const seams = new Map(this.guideSeams);
    for (const [from, clip] of snapshot.seams) seams.set(from, clip);
    if (
      sameNativeRows(this.nativeRows, rows) &&
      sameGuideSeams(this.guideSeams, seams)
    )
      return;
    this.view.dispatch({
      effects: this.layoutReady.of({ ...snapshot, rows, seams }),
      annotations: Transaction.addToHistory.of(false),
    });
  }

  private readPreviewSource(element: HTMLElement): ProcessorCodeSource | null {
    if (!element.querySelector(".expressive-code")) return null;
    const { state } = this.view;
    const line = documentLineForElement(this.view, element);
    const context = line && this.classifier.getCodeFence(state, line.number);
    if (
      !context ||
      !line ||
      context.openingLineNumber !== line.number ||
      !context.containerIndent
    )
      return null;
    const attached = parseFenceOpening(state, line.number);
    const openingText = attached
      ? line.text.slice(attached.sourceOffset)
      : getFenceContent(line.text, context.containerIndent)?.text;
    if (openingText === undefined) return null;
    const fence = getFenceOpening(openingText);
    if (!fence) return null;
    const rawLines: string[] = [];
    for (let n = line.number + 1; n <= state.doc.lines; n++) {
      const text = state.doc.line(n).text;
      const content = getFenceContent(text, context.containerIndent);
      if (content && isFenceClosing(content.text, fence)) {
        return {
          element,
          openingFrom: line.from,
          rawLines,
          contentColumn: countColumn(context.containerIndent, state.tabSize),
          fenceInfo: openingText,
        };
      }
      if (text.trim() !== "" && !content) return null;
      rawLines.push(text);
    }
    return null;
  }

  private clearProcessor(element: HTMLElement) {
    if (!element.classList.contains("cm-preview-code-block")) return;
    element.classList.remove(CODE_BLOCK_CLASS);
    element.classList.remove(PREVIEW_EMBED_CLASS);
    element.classList.remove(COMPACT_PREVIEW_CLASS);
    element.classList.remove(HEADER_PREVIEW_CLASS);
    element.style.removeProperty(PREVIEW_OPENING_HEIGHT);
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
  const boundary = codeContentBoundary(line, opening, state.tabSize);
  if (!boundary) return null;
  return {
    from,
    openingFrom: openingLine.from,
    openingText: openingLine.text,
    prefix: line.text.slice(0, boundary.offset),
    residualColumns: boundary.residualColumns,
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
      source.residualColumns !== row.source.residualColumns ||
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

function nativePresentation(
  measurement: MeasuredLine,
  selectionInsideBlock: boolean,
): NativePresentation {
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
  if (isCodeBody(element)) {
    const opening = precedingCodeOpening(element);
    if (
      (opening && !isNativePreviewOpening(opening)) ||
      (!opening && selectionInsideBlock)
    )
      return { kind: "source" };
    return {
      kind: "native-body",
      first: isNativePreviewOpening(element.previousElementSibling),
      last: isHiddenClosingFence(next),
    };
  }
  return { kind: "source" };
}

function precedingCodeOpening(element: Element): Element | null {
  let preceding = element.previousElementSibling;
  while (preceding && isCodeBody(preceding))
    preceding = preceding.previousElementSibling;
  return preceding?.classList.contains("HyperMD-codeblock-begin")
    ? preceding
    : null;
}

function nativeAttributes(
  row: NativeRowLayout | undefined,
  cursorLine = false,
): {
  class: string;
  attributes: { style: string };
} {
  const classes = [CODE_BLOCK_CLASS];
  if (cursorLine) classes.push(CODE_CURSOR_LINE_CLASS);
  const properties: Array<[string, string | undefined]> = [];
  if (row) {
    properties.push(
      [CODE_BLOCK_INSET, row.inset],
      [CODE_BLOCK_END, row.end],
      [CODE_CONTENT_PADDING, row.contentPadding],
    );
    if (cursorLine)
      properties.push([
        CODE_CURSOR_OFFSET,
        `calc(${row.source.residualColumns}ch + var(--size-4-4))`,
      ]);
    if (row.markerOffset !== undefined) {
      classes.push(OPENING_ALIGNED_CLASS);
      properties.push([OPENING_MARKER_OFFSET, row.markerOffset]);
    }
    if (row.guideHeight !== undefined) {
      classes.push(CODE_GUIDE_CONTINUATION_CLASS);
      properties.push(
        [CODE_INDENT_GUIDE_HEIGHT, row.guideHeight],
        [CODE_OUTER_GUIDE_HEIGHT, row.outerGuideHeight],
      );
    }
    if (row.indentGuideCovered) classes.push(CODE_INDENT_GUIDE_COVERED_CLASS);
    if (row.outerGuideCovered) classes.push(CODE_OUTER_GUIDE_COVERED_CLASS);
    const presentation = row.presentation;
    if (
      row.bodyFoldOffset !== undefined &&
      (presentation.kind === "source" || presentation.kind === "native-body")
    ) {
      classes.push(BODY_FOLD_CLASS);
      properties.push([BODY_FOLD_OFFSET, row.bodyFoldOffset]);
    }
    if (presentation.kind !== "source" && row.previewOwnerGuide) {
      const guide = row.previewOwnerGuide;
      properties.push([CODE_OWNER_GUIDE_OFFSET, guide.offset]);
      if (guide.kind === "opening") {
        classes.push(CODE_PREVIEW_OWNER_GUIDE_CLASS);
        properties.push(
          [CODE_PREVIEW_OWNER_GUIDE_TOP, guide.top],
          [CODE_PREVIEW_OWNER_GUIDE_HEIGHT, guide.height],
        );
      } else {
        classes.push(CODE_OWNER_GUIDE_CLASS);
        properties.push([CODE_OWNER_GUIDE_CLIP, guide.clip]);
      }
    }
    switch (presentation.kind) {
      case "native-opening":
      case "processor-opening": {
        const { alignment } = presentation;
        if (alignment) {
          classes.push(PREVIEW_OPENING_CLASS);
        }
        if (presentation.kind === "processor-opening") {
          classes.push(PREVIEW_EMBED_OPENING_CLASS);
          if (presentation.appearance) {
            classes.push(COMPACT_PREVIEW_CLASS);
            if (presentation.appearance.kind === "header") {
              classes.push(HEADER_PREVIEW_CLASS);
              properties.push([
                PREVIEW_OPENING_HEIGHT,
                presentation.appearance.openingHeight,
              ]);
            }
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
        classes.push(PREVIEW_BODY_CLASS);
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
        if (row.ownerGuideOffset !== undefined) {
          classes.push(CODE_OWNER_GUIDE_CLASS);
          properties.push([CODE_OWNER_GUIDE_OFFSET, row.ownerGuideOffset]);
        }
        if (row.ownerGuideClip !== undefined) {
          classes.push(CODE_OWNER_GUIDE_CLIPPED_CLASS);
          properties.push([CODE_OWNER_GUIDE_CLIP, row.ownerGuideClip]);
        }
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
            `${name}: ${
              name === CODE_INDENT_GUIDE_HEIGHT ||
              name === CODE_OUTER_GUIDE_HEIGHT
                ? value
                : value?.replace(
                    /-?\d+(?:\.\d+)?px\b/g,
                    (pixels) =>
                      `${Math.round(Number.parseFloat(pixels) * 100) / 100}px`,
                  )
            };`,
        )
        .join(" "),
    },
  };
}

function guideSeamAttributes(seam: GuideSeam) {
  return {
    class: CODE_GUIDE_SEAM_CLASS,
    attributes: {
      style: [
        seam.indentClip === undefined
          ? ""
          : `${CODE_INDENT_GUIDE_SEAM_CLIP}: ${seam.indentClip};`,
        seam.outerClip === undefined
          ? ""
          : `${CODE_OUTER_GUIDE_SEAM_CLIP}: ${seam.outerClip};`,
      ]
        .filter(Boolean)
        .join(" "),
    },
  };
}

function sameGuideSeams(
  previous: ReadonlyMap<number, GuideSeam>,
  next: ReadonlyMap<number, GuideSeam>,
): boolean {
  if (previous.size !== next.size) return false;
  for (const [from, seam] of next) {
    const old = previous.get(from);
    if (
      old?.indentClip !== seam.indentClip ||
      old?.outerClip !== seam.outerClip
    )
      return false;
  }
  return true;
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
  scaleY = 1,
): PreviewAppearance | undefined {
  const pre = embed.querySelector<HTMLElement>(".expressive-code pre");
  const frame = embed.querySelector<HTMLElement>(".expressive-code .frame");
  const header = embed.querySelector<HTMLElement>(".expressive-code .header");
  const win = embed.ownerDocument.defaultView;
  if (!pre || !frame || !win) return;
  const end = logicalInset(opening, pre.getBoundingClientRect(), false, true);
  if (end === null) return;
  const appearance = {
    background: win.getComputedStyle(pre).backgroundColor,
    end,
    radius: win.getComputedStyle(frame).borderStartStartRadius,
  };
  if (!header || header.getBoundingClientRect().height <= 0)
    return { kind: "plain", ...appearance };
  const openingHeight = opening.getBoundingClientRect().height / scaleY;
  if (!Number.isFinite(openingHeight) || openingHeight <= 0) return;
  return { kind: "header", openingHeight: `${openingHeight}px`, ...appearance };
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
  return codeBlockSourceDecorations(
    state,
    visibleRanges,
    lineNameAt,
    new FenceOpeningIndex(state, lineNameAt).at,
    new MarkdownLineClassifier(),
  ).content;
}

function codeBlockSourceDecorations(
  state: EditorState,
  visibleRanges: readonly { from: number; to: number }[],
  lineNameAt: LineNameAt,
  fenceOpeningAt: FenceOpeningAt,
  classifier: MarkdownLineClassifier,
): CodeSourceDecorations {
  const contentDecorations = [];
  const prefixRoleDecorations = [];
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
      const fence =
        name === null ||
        hasClassName(name, "HyperMD-codeblock") ||
        line.text.trim() === ""
          ? classifier.getCodeFence(state, line.number)
          : null;
      if (fence && line.number !== fence.openingLineNumber) {
        const content = getFenceContent(line.text, fence.containerIndent);
        const indentEnd = /^[ \t]*/.exec(line.text)![0].length;
        if (content && content.offset < indentEnd) {
          const openingLine = state.doc.line(fence.openingLineNumber);
          const openingOffset =
            parseFenceOpening(state, fence.openingLineNumber)?.sourceOffset ??
            getFenceContent(openingLine.text, fence.containerIndent)?.offset;
          const marker =
            openingOffset !== undefined &&
            getFenceOpening(openingLine.text.slice(openingOffset));
          if (marker && !isFenceClosing(content.text, marker))
            prefixRoleDecorations.push(
              codeContentIndent.range(
                line.from + content.offset,
                line.from + indentEnd,
              ),
            );
        }
      }
      const owner = fence && classifier.getListOwner(state, line.number);
      if (
        fence &&
        owner !== null &&
        owner !== fence.openingLineNumber &&
        !state.selection.ranges.some((range) => {
          const openingFrom = state.doc.line(fence.openingLineNumber).from;
          return (
            (range.from <= openingFrom && range.to >= openingFrom) ||
            classifier.getCodeFence(state, state.doc.lineAt(range.from).number)
              ?.openingLineNumber === fence.openingLineNumber ||
            classifier.getCodeFence(state, state.doc.lineAt(range.to).number)
              ?.openingLineNumber === fence.openingLineNumber
          );
        })
      ) {
        const ownerIndent = /^[ \t]*/.exec(state.doc.line(owner).text)![0];
        const prefixStart = offsetAtColumn(
          line.text,
          countColumn(ownerIndent, state.tabSize),
          state.tabSize,
        );
        const prefixEnd = getFenceContent(
          line.text,
          fence.containerIndent,
        )?.offset;
        if (
          prefixStart !== null &&
          prefixEnd !== undefined &&
          prefixStart < prefixEnd
        )
          prefixRoleDecorations.push(
            continuationPreviewPrefix.range(
              line.from + prefixStart,
              line.from + prefixEnd,
            ),
          );
      }
      if (
        (name !== null && isNestedCodeBlockName(name)) ||
        line.text.trim() === ""
      ) {
        const opening = fenceOpeningAt(line.number);
        const boundary = opening
          ? codeContentBoundary(line, opening, state.tabSize)
          : null;
        if (opening && boundary) {
          const from = line.from + boundary.offset;
          if (from < line.to)
            contentDecorations.push(contentGlyph.range(from, from + 1));
          if (line.number !== opening.openingLineNumber) {
            const prefixStart = offsetAtColumn(
              line.text,
              opening.indentColumn,
              state.tabSize,
            );
            if (prefixStart !== null && prefixStart < boundary.offset) {
              prefixRoleDecorations.push(
                owningListContinuation.range(
                  line.from + prefixStart,
                  line.from + boundary.offset,
                ),
              );
            }
          }
        }
      }

      if (line.number === state.doc.lines) break;
      line = state.doc.line(line.number + 1);
    }
  }

  return {
    content: Decoration.set(contentDecorations, true),
    prefixRoles: Decoration.set(prefixRoleDecorations, true),
  };
}

export function nestedCodeBlockLayoutExtension(
  zoomRange?: (state: EditorState) => { indent: string } | null,
): Extension {
  const layoutPlugin = ViewPlugin.define(
    (view) => new NestedCodeBlockLayoutPluginValue(view, undefined, zoomRange),
    { decorations: (value) => value.decorations },
  );

  return [
    nestedCodeBlockCursorLayer,
    layoutPlugin,
    EditorView.outerDecorations.of(
      (view) =>
        view.plugin(layoutPlugin)?.prefixRoleDecorations ?? Decoration.none,
    ),
  ];
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

function measureOpeningAlignment(
  opening: HTMLElement,
  embed: HTMLElement,
  code: Element | null = embed.querySelector(".ec-line .code") ??
    embed.querySelector("code"),
): OpeningAlignment | undefined {
  const bullet = opening.querySelector<HTMLElement>(".list-bullet");
  const marker =
    bullet ??
    opening.querySelector<HTMLElement>(".list-number") ??
    opening.querySelector<HTMLElement>(".cm-formatting-list");
  if (!marker || !code) return;

  const geometry = measureFirstCodeLine(embed, code);
  if (!geometry) return;
  const { blockBounds, firstLine, hasLineBox } = geometry;

  const lineBounds = opening.getBoundingClientRect();
  const markerBounds = marker.getBoundingClientRect();
  const previousOffset = bullet
    ? 0
    : Number.parseFloat(
        opening.ownerDocument.defaultView?.getComputedStyle(marker)
          .insetBlockStart ?? "0",
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

  // Move only the marker paint. The source-bearing opening row keeps its
  // native line box so Vim navigation and editing coordinates stay intact.
  return {
    markerOffset: `${markerOffset}px`,
    ownerGuideClip: `${Math.max(0, firstLineCenter - blockBounds.top)}px`,
  };
}

function measureOpeningPreviewOwnerGuide(
  opening: HTMLElement,
  block: HTMLElement,
  offset: string,
): PreviewOwnerGuide | undefined {
  const code =
    block.querySelector(".ec-line .code") ??
    block.querySelector("code") ??
    block;
  const geometry = measureFirstCodeLine(block, code);
  if (!geometry) return;
  const openingTop = opening.getBoundingClientRect().top;
  const start = geometry.firstLine.top + geometry.firstLine.height;
  let end = geometry.blockBounds.top + geometry.blockBounds.height;
  let next = block.nextElementSibling;
  while (next && isCodeCardContinuation(next)) {
    const bounds = next.getBoundingClientRect();
    end = Math.max(end, bounds.top + bounds.height);
    next = next.nextElementSibling;
  }
  if (next?.classList.contains("cm-line")) {
    const guideStart = measureGuideStarts(next as HTMLElement).indent;
    if (guideStart !== undefined) end = Math.max(end, guideStart);
  }
  if (![openingTop, start, end].every(Number.isFinite)) return;
  return {
    kind: "opening",
    offset,
    top: `${Math.max(0, start - openingTop)}px`,
    height: `${Math.max(0, end - start)}px`,
  };
}

function measureCodeGuideContinuation(
  opening: HTMLElement,
  firstContinuation: HTMLElement,
): {
  height: string;
  outerHeight?: string;
  coversIndent: boolean;
  coversOuter: boolean;
  seam?: { element: HTMLElement; indentClip?: string; outerClip?: string };
} {
  const openingBounds = opening.getBoundingClientRect();
  const openingStarts = measureGuideStarts(opening);
  const coversIndent = opening.querySelectorAll(".cm-indent").length > 0;
  const coversOuter =
    opening.querySelectorAll(".bullet-plugin-outer-list-guide").length > 0;
  let paintEnd =
    openingBounds.top +
    (Number.isFinite(openingBounds.height) ? openingBounds.height : 0);
  let element: Element | null = firstContinuation;
  while (element && isCodeCardContinuation(element)) {
    const bounds = element.getBoundingClientRect();
    paintEnd = Math.max(
      paintEnd,
      bounds.top + (Number.isFinite(bounds.height) ? bounds.height : 0),
    );
    element = element.nextElementSibling;
  }
  let indentEnd = paintEnd;
  let outerEnd = paintEnd;
  let seam:
    | { element: HTMLElement; indentClip?: string; outerClip?: string }
    | undefined;
  if (element?.classList.contains("cm-line")) {
    const target = element as HTMLElement;
    const starts = measureGuideStarts(target);
    const dpr = opening.ownerDocument.defaultView?.devicePixelRatio || 1;
    const snappedIndent = snapGuideStart(starts.indent, dpr);
    const snappedOuter = snapGuideStart(starts.outer, dpr);
    if (snappedIndent !== undefined)
      indentEnd = Math.max(paintEnd, snappedIndent);
    if (snappedOuter !== undefined) outerEnd = Math.max(paintEnd, snappedOuter);
    if (starts.indent !== undefined || starts.outer !== undefined)
      seam = {
        element: target,
        indentClip:
          starts.indent === undefined || snappedIndent === undefined
            ? undefined
            : `${snappedIndent - starts.indent}px`,
        outerClip:
          starts.outer === undefined || snappedOuter === undefined
            ? undefined
            : `${snappedOuter - starts.outer}px`,
      };
  }
  return {
    height: `${Math.max(
      0,
      indentEnd - (openingStarts.indent ?? openingBounds.top),
    )}px`,
    outerHeight: coversOuter
      ? `${Math.max(
          0,
          outerEnd - (openingStarts.outer ?? openingBounds.top),
        )}px`
      : undefined,
    // The continuation selector paints every matching guide on the opening.
    // Its geometric start can be unavailable when CodeMirror wraps the same
    // guide differently, so paint ownership must follow selector membership.
    coversIndent,
    coversOuter,
    seam,
  };
}

function snapGuideStart(start: number | undefined, dpr: number) {
  return start === undefined ? undefined : Math.ceil(start * dpr) / dpr;
}

function measureGuideStarts(line: HTMLElement): {
  indent?: number;
  outer?: number;
} {
  const lineTop = line.getBoundingClientRect().top;
  const starts = (selector: string) => {
    const tops = Array.from(line.querySelectorAll<HTMLElement>(selector))
      .map((guide) => {
        const win = line.ownerDocument.defaultView;
        const paint = win?.getComputedStyle(guide, "::before");
        const top = Number.parseFloat(paint?.top ?? "");
        if (paint?.position !== "absolute" || !Number.isFinite(top))
          return guide.getBoundingClientRect().top;
        const container =
          win?.getComputedStyle(guide).position === "static"
            ? guide.offsetParent
            : guide;
        return container
          ? container.getBoundingClientRect().top + container.clientTop + top
          : guide.getBoundingClientRect().top;
      })
      .filter((top) => Number.isFinite(top) && top >= lineTop);
    return tops.length ? Math.max(...tops) : undefined;
  };
  return {
    indent: starts(".cm-hmd-list-indent > .cm-indent"),
    outer: starts(".bullet-plugin-outer-list-guide"),
  };
}

function isCodeCardContinuation(element: Element): boolean {
  return (
    element.classList.contains("cm-preview-code-block") ||
    (element.classList.contains("HyperMD-codeblock") &&
      !element.classList.contains("HyperMD-codeblock-begin"))
  );
}

function measureOwnerGuideClip(
  body: HTMLElement,
  code: Element,
): string | undefined {
  const geometry = measureFirstCodeLine(body, code);
  if (!geometry) return;
  const offset =
    geometry.firstLine.top +
    geometry.firstLine.height / 2 -
    geometry.blockBounds.top;
  return Number.isFinite(offset) ? `${Math.max(0, offset)}px` : undefined;
}

function measureFirstCodeLine(
  block: HTMLElement,
  code: Element,
): FirstCodeLineGeometry | undefined {
  const doc = block.ownerDocument;
  const walker =
    typeof doc.createTreeWalker === "function"
      ? doc.createTreeWalker(code, NodeFilter.SHOW_TEXT)
      : null;
  let node: Node | null;
  let firstLine: { top: number; height: number } | undefined;
  while (walker && (node = walker.nextNode())) {
    const range = doc.createRange();
    range.selectNodeContents(node);
    firstLine = range.getClientRects()[0];
    if (firstLine?.height) break;
  }
  const blockBounds = block.getBoundingClientRect();
  const hasLineBox = !!firstLine || isCodeBody(block);
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
  return { blockBounds, firstLine, hasLineBox };
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

function codeContentBoundary(
  line: { text: string; number: number },
  opening: FenceOpening,
  tabSize: number,
): CodeContentBoundary | null {
  const offset =
    line.number === opening.openingLineNumber
      ? opening.sourceOffset
      : (offsetAtColumn(line.text, opening.contentColumn, tabSize) ??
        (line.text.trim() === "" ? line.text.length : null));
  if (offset === null) return null;
  return {
    offset,
    residualColumns: Math.max(
      0,
      countColumn(line.text.slice(0, offset), tabSize) - opening.contentColumn,
    ),
  };
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
  const boundary = codeContentBoundary(line, opening, view.state.tabSize);
  if (!boundary) return;
  // The mark precedes literal code whitespace. If its source tab straddles
  // the container boundary, keep that tab's remaining columns as code indent.
  return `calc(${inset} - ${start} + ${boundary.residualColumns}ch + var(--size-4-4))`;
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
