import { EditorSelection, Text, Transaction } from "@codemirror/state";
import {
  EditorView,
  PluginValue,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";

import { selectionLayout } from "./selectionLayout";

import { getObsidianDomWindow } from "../obsidianDom";

export function supportsFoldScrollReserve(view: EditorView): boolean {
  return view.dom.closest(".table-cell-wrapper") === null;
}

function topScrollMargin(view: EditorView): number {
  return view.state
    .facet(EditorView.scrollMargins)
    .reduce((margin, source) => Math.max(margin, source(view)?.top ?? 0), 0);
}

export function foldScrollLinePosition(
  view: EditorView,
  line: Element,
): number {
  const walker = line.ownerDocument.createTreeWalker(
    line,
    NodeFilter.SHOW_TEXT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (
      !node.textContent?.trim() ||
      node.parentElement?.closest(
        '.cm-formatting, .cm-hmd-list-indent, .cm-widgetBuffer, [contenteditable="false"]',
      )
    )
      continue;
    const range = line.ownerDocument.createRange();
    range.selectNodeContents(node);
    if (Array.from(range.getClientRects()).some((rect) => rect.height > 0)) {
      return view.posAtDOM(node);
    }
  }
  return view.posAtDOM(line);
}

export function foldScrollViewportPosition(
  view: EditorView,
  hiddenRanges: readonly { from: number; to: number }[] = [],
): number | undefined {
  const bounds = view.scrollDOM.getBoundingClientRect();
  const content = view.contentDOM.getBoundingClientRect();
  let position = view.posAtCoords(
    {
      x: Math.max(bounds.left, content.left) + 8,
      y: Math.max(bounds.top + topScrollMargin(view), content.top) + 1,
    },
    false,
  );
  if (position === null) return;
  for (const range of hiddenRanges) {
    if (range.from < position && position <= range.to) position = range.from;
  }
  return position;
}

type FoldScrollEffect = ReturnType<typeof EditorView.scrollIntoView>;
type FoldStage =
  | { kind: "prepared" }
  | { kind: "applied" }
  | { kind: "probe"; base: number }
  | { kind: "height" };
type ReserveIntent =
  | { kind: "idle" }
  | { kind: "navigation" }
  | {
      kind: "fold";
      stage: FoldStage;
      doc: Text;
      position: number;
      top: number;
      effect: FoldScrollEffect;
    }
  | { kind: "destroyed" };
type ReserveMeasurement =
  | { kind: "padding"; padding: string; intent: ReserveIntent }
  | { kind: "probe"; base: number; height: number; intent: ReserveIntent }
  | {
      kind: "height";
      height: number;
      offset: number;
      intent: ReserveIntent;
    }
  | null;

export class FoldScrollReservePluginValue implements PluginValue {
  private intent: ReserveIntent = { kind: "idle" };
  private tail: HTMLDivElement | null = null;
  private paddingProbe: HTMLDivElement | null = null;
  private quantizer: {
    container: HTMLElement;
    viewport: HTMLDivElement;
    content: HTMLDivElement;
  } | null = null;
  private offset = 0;
  private refreshLayers = false;
  private settling: ReserveIntent | null = null;
  private expiry: number | null = null;

  private readonly measure = {
    read: (): ReserveMeasurement => {
      const { tail, paddingProbe, quantizer, intent } = this;
      if (
        !tail ||
        !paddingProbe ||
        intent.kind === "destroyed" ||
        intent.kind === "navigation" ||
        (intent.kind === "fold" && intent.stage.kind === "prepared")
      )
        return null;
      const win = getObsidianDomWindow(this.view.dom.ownerDocument);
      const padding = win.getComputedStyle(this.view.scrollDOM).paddingBottom;
      if (paddingProbe.style.paddingBottom !== padding)
        return { kind: "padding", padding, intent };
      const scale = this.view.scaleY;
      const scroll = this.view.scrollDOM.getBoundingClientRect();
      const host = tail.parentElement?.getBoundingClientRect();
      if (!host || !(scale > 0)) return null;
      const anchor =
        intent.kind === "fold" && intent.doc === this.view.state.doc
          ? this.view.coordsAtPos(intent.position)
          : null;
      const delta =
        anchor && intent.kind === "fold"
          ? (anchor.top - intent.top) / scale
          : 0;
      const pixels = (win.devicePixelRatio || 1) * scale;
      let offset = this.offset;
      if (
        quantizer &&
        intent.kind === "fold" &&
        intent.stage.kind !== "height" &&
        delta !== 0
      ) {
        const base = this.view.scrollDOM.scrollTop + delta - offset;
        if (Number.isFinite(base) && base >= 0) {
          if (intent.stage.kind !== "probe" || intent.stage.base !== base) {
            return {
              kind: "probe",
              base,
              height: Math.ceil(base) + this.view.scrollDOM.clientHeight + 1,
              intent,
            };
          }
          const measured = quantizer.viewport.scrollTop - base;
          if (
            quantizer.viewport.clientHeight > 0 &&
            quantizer.viewport.clientWidth > 0 &&
            quantizer.viewport.scrollHeight - quantizer.viewport.clientHeight >=
              base &&
            Number.isFinite(measured) &&
            Math.abs(measured) <= 1 / pixels
          )
            offset = measured;
        }
      }
      const needed = Math.max(
        0,
        (scroll.bottom -
          host.bottom +
          tail.getBoundingClientRect().height -
          paddingProbe.getBoundingClientRect().height) /
          scale +
          delta +
          offset -
          this.offset,
      );
      return {
        kind: "height",
        height: Math.ceil(needed * pixels) / pixels,
        offset,
        intent,
      };
    },
    write: (measurement: ReserveMeasurement) => {
      if (
        !measurement ||
        measurement.intent !== this.intent ||
        this.intent.kind === "destroyed"
      )
        return;
      if (measurement.kind === "padding") {
        if (this.paddingProbe)
          this.paddingProbe.style.paddingBottom = measurement.padding;
        this.view.requestMeasure(this.measure);
      } else if (measurement.kind === "probe") {
        if (!this.quantizer || this.intent.kind !== "fold") return;
        this.quantizer.content.style.height = `${measurement.height}px`;
        this.quantizer.viewport.scrollTop = measurement.base;
        this.intent.stage = { kind: "probe", base: measurement.base };
        this.view.requestMeasure(this.measure);
      } else if (this.tail && Number.isFinite(measurement.height)) {
        if (this.intent.kind === "fold") this.intent.stage = { kind: "height" };
        this.restoreOffset(measurement.offset);
        const height = `${measurement.height}px`;
        if (this.tail.style.height !== height) this.tail.style.height = height;
        if (
          this.refreshLayers &&
          !this.view.composing &&
          !this.view.compositionStarted
        )
          this.scheduleSettle();
      }
    },
  };

  constructor(private view: EditorView) {
    if (!supportsFoldScrollReserve(view)) return;
    const host = view.contentDOM.closest(".cm-sizer");
    if (!host || !view.scrollDOM.contains(host)) return;
    const win = getObsidianDomWindow(view.dom.ownerDocument);
    this.tail = win.createDiv();
    this.tail.className = "bullet-plugin-fold-scroll-reserve";
    this.tail.setAttribute("contenteditable", "false");
    this.tail.setAttribute("aria-hidden", "true");
    this.paddingProbe = win.createDiv();
    this.paddingProbe.className = "bullet-plugin-fold-scroll-padding-probe";
    this.tail.append(this.paddingProbe);
    const container = view.contentDOM.closest<HTMLElement>(
      ".cm-contentContainer",
    );
    if (
      container &&
      host.contains(container) &&
      container.contains(view.contentDOM)
    ) {
      const style = win.getComputedStyle(container);
      if (
        style.transform === "none" &&
        (!style.translate || style.translate === "none")
      ) {
        const viewport = win.createDiv();
        viewport.className = "bullet-plugin-fold-scroll-quantizer";
        const content = win.createDiv();
        viewport.append(content);
        this.tail.append(viewport);
        this.quantizer = { container, viewport, content };
      }
    }
    host.append(this.tail);
    this.view.requestMeasure(this.measure);
  }

  prime(position?: number): void {
    if (!this.tail || this.intent.kind === "destroyed") return;
    const bounds = this.view.scrollDOM.getBoundingClientRect();
    const anchor =
      position === undefined ? null : this.view.coordsAtPos(position);
    const height = Math.max(
      0,
      (bounds.bottom - (anchor?.bottom ?? bounds.top)) / this.view.scaleY,
    );
    this.tail.style.height = `${Math.max(Number.parseFloat(this.tail.style.height) || 0, Math.ceil(height))}px`;
    void this.view.scrollDOM.scrollHeight;
    this.intent = { kind: "navigation" };
    this.clearExpiry();
    this.expiry =
      this.view.dom.ownerDocument.defaultView?.setTimeout(() => {
        this.expiry = null;
        this.scheduleSettle();
      }, 0) ?? null;
  }

  prepare(position = foldScrollViewportPosition(this.view)): FoldScrollEffect {
    if (position === undefined || !this.tail)
      return stableFoldScrollSnapshot(this.view);
    const anchor = this.view.coordsAtPos(position);
    if (!anchor) return stableFoldScrollSnapshot(this.view);
    this.prime(position);
    const effect = EditorView.scrollIntoView(position, {
      y: "start",
      yMargin:
        anchor.top -
        this.view.scrollDOM.getBoundingClientRect().top -
        topScrollMargin(this.view),
    });
    this.intent = {
      kind: "fold",
      stage: { kind: "prepared" },
      doc: this.view.state.doc,
      position,
      top: anchor.top,
      effect,
    };
    this.view.requestMeasure(this.measure);
    return effect;
  }

  update(update: ViewUpdate): void {
    if (!this.tail || this.intent.kind === "destroyed") return;
    const navigation =
      update.docChanged ||
      update.transactions.some(
        (transaction) =>
          transaction.scrollIntoView || transaction.effects.length > 0,
      );
    if (navigation || update.geometryChanged) {
      if (
        this.intent.kind === "fold" &&
        !update.docChanged &&
        update.transactions.some(
          (transaction) =>
            this.intent.kind === "fold" &&
            transaction.effects.includes(this.intent.effect),
        )
      ) {
        this.intent = { ...this.intent, stage: { kind: "applied" } };
        this.view.requestMeasure(this.measure);
      } else if (
        this.intent.kind !== "fold" ||
        update.docChanged ||
        navigation
      ) {
        this.intent = { kind: "navigation" };
      }
      if (this.intent.kind !== "fold" || this.intent.stage.kind !== "prepared")
        this.scheduleSettle();
    }
    if (update.docChanged || update.geometryChanged || update.viewportChanged)
      this.view.requestMeasure(this.measure);
    if (
      this.refreshLayers &&
      !this.view.composing &&
      !this.view.compositionStarted &&
      (this.intent.kind !== "fold" || this.intent.stage.kind !== "prepared")
    )
      this.scheduleSettle();
  }

  private scheduleSettle(): void {
    const intent = this.intent;
    if (intent.kind === "destroyed" || this.settling === intent) return;
    this.clearExpiry();
    this.settling = intent;
    queueMicrotask(() => {
      if (this.settling !== intent || this.intent !== intent) return;
      this.view.lineBlockAtHeight(0);
      if (
        this.intent === intent &&
        this.refreshLayers &&
        !this.view.composing &&
        !this.view.compositionStarted
      ) {
        this.refreshLayers = false;
        this.view.dispatch({
          selection: this.view.state.selection,
          filter: false,
          annotations: [
            selectionLayout.of(true),
            Transaction.addToHistory.of(false),
          ],
        });
        this.view.lineBlockAtHeight(0);
      }
      if (this.intent === intent) {
        this.intent = { kind: "idle" };
        this.settling = null;
        this.view.requestMeasure(this.measure);
      }
    });
  }

  private clearExpiry(): void {
    if (this.expiry === null) return;
    this.view.dom.ownerDocument.defaultView?.clearTimeout(this.expiry);
    this.expiry = null;
  }

  onScroll(): void {
    if (this.tail && this.intent.kind === "idle")
      this.view.requestMeasure(this.measure);
  }

  onCompositionEnd(): void {
    if (this.tail && this.refreshLayers) this.view.requestMeasure(this.measure);
  }

  currentOffset(): number {
    return this.offset;
  }

  restoreOffset(offset: number): void {
    if (!this.quantizer || offset === this.offset) return;
    this.offset = offset;
    this.refreshLayers = true;
    this.quantizer.container.classList.add("bullet-plugin-fold-scroll-offset");
    this.quantizer.container.style.setProperty(
      "--bullet-plugin-fold-scroll-offset",
      `${offset}px`,
    );
    this.view.requestMeasure(this.measure);
  }

  destroy(): void {
    this.clearExpiry();
    this.intent = { kind: "destroyed" };
    this.tail?.remove();
    this.tail = this.paddingProbe = null;
    this.quantizer?.container.classList.remove(
      "bullet-plugin-fold-scroll-offset",
    );
    this.quantizer?.container.style.removeProperty(
      "--bullet-plugin-fold-scroll-offset",
    );
    this.quantizer = null;
  }
}

const reservePlugin = ViewPlugin.fromClass(FoldScrollReservePluginValue, {
  eventObservers: {
    scroll() {
      this.onScroll();
    },
    compositionend() {
      this.onCompositionEnd();
    },
  },
});

export function foldScrollReserveExtension() {
  return [
    reservePlugin,
    EditorView.baseTheme({
      "& .bullet-plugin-fold-scroll-reserve": {
        height: "0",
        flex: "none",
        position: "relative",
        overflow: "hidden",
        pointerEvents: "none",
      },
      "& .bullet-plugin-fold-scroll-padding-probe": {
        position: "absolute",
        visibility: "hidden",
        boxSizing: "content-box",
        height: "0",
        width: "0",
        border: "0",
        padding: "0",
        margin: "0",
      },
      "& .bullet-plugin-fold-scroll-quantizer": {
        position: "absolute",
        visibility: "hidden",
        overflow: "hidden",
        height: "1px",
        width: "1px",
        padding: "0",
        border: "0",
        margin: "0",
      },
      "& .bullet-plugin-fold-scroll-offset": {
        translate: "0 var(--bullet-plugin-fold-scroll-offset)",
      },
    }),
  ];
}

export function primeTailReserve(view: EditorView): void {
  view.plugin(reservePlugin)?.prime();
}

export function captureFoldScrollCheckpoint(view: EditorView) {
  const effect = stableFoldScrollSnapshot(view);
  return { effect, offset: view.plugin(reservePlugin)?.currentOffset() ?? 0 };
}

export function restoreFoldScrollCheckpoint(
  view: EditorView,
  checkpoint: ReturnType<typeof captureFoldScrollCheckpoint>,
) {
  const owner = view.plugin(reservePlugin);
  owner?.prime();
  owner?.restoreOffset(checkpoint.offset);
  return checkpoint.effect;
}

export function prepareFoldScroll(
  view: EditorView,
  position?: number,
): FoldScrollEffect {
  return (
    view.plugin(reservePlugin)?.prepare(position) ??
    stableFoldScrollSnapshot(view)
  );
}

function correctFoldScrollSnapshotAnchor(
  view: EditorView,
  value: unknown,
): void {
  if (
    !value ||
    typeof value !== "object" ||
    !("range" in value) ||
    !("yMargin" in value) ||
    typeof value.yMargin !== "number"
  ) {
    return;
  }

  const scaleY = view.scaleY;
  const scrollTop = view.scrollDOM.scrollTop;
  const scrollViewportTop = view.scrollDOM.getBoundingClientRect().top;
  const documentTop = view.documentTop;
  if (
    !Number.isFinite(scaleY) ||
    scaleY <= 0 ||
    !Number.isFinite(scrollTop) ||
    !Number.isFinite(scrollViewportTop) ||
    !Number.isFinite(documentTop)
  ) {
    return;
  }

  const viewportDocumentTop = scrollViewportTop - documentTop;
  const anchor = view.lineBlockAtHeight(Math.max(0, viewportDocumentTop + 8));
  if (!Number.isFinite(anchor.from) || !Number.isFinite(anchor.top)) {
    return;
  }

  value.range = EditorSelection.cursor(anchor.from);
  value.yMargin = anchor.top - scrollTop;
}

export function stableFoldScrollSnapshot(view: EditorView) {
  const snapshot = view.scrollSnapshot();
  const value: unknown = snapshot.value;
  correctFoldScrollSnapshotAnchor(view, value);
  if (
    !value ||
    typeof value !== "object" ||
    !("yMargin" in value) ||
    typeof value.yMargin !== "number" ||
    !Number.isFinite(value.yMargin)
  ) {
    return snapshot;
  }

  const window = view.dom.ownerDocument.defaultView;
  const devicePixelRatio = window?.devicePixelRatio ?? 1;
  const pixelScale =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  // Keep repeated fold cycles on the physical-pixel grid.
  value.yMargin = Math.round(value.yMargin * pixelScale) / pixelScale;
  return snapshot;
}
