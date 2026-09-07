import { Text } from "@codemirror/state";
import {
  EditorView,
  PluginValue,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";

import { stableFoldScrollSnapshot } from "./FoldScroll";

type Checkpoint = {
  doc: Text;
  width: number;
  snapshot: ReturnType<EditorView["scrollSnapshot"]>;
};

export class FoldScrollResizePluginValue implements PluginValue {
  private checkpoint?: Checkpoint;
  private synchronizing = false;
  private pendingIntent = false;
  private captureScheduled = false;
  private destroyed = false;
  private window: Window | null;

  private measure = {
    read: () => (this.pendingIntent ? undefined : this.capture()),
    write: (checkpoint: Checkpoint | undefined) => {
      if (!this.destroyed && !this.pendingIntent && checkpoint)
        this.checkpoint = checkpoint;
    },
  };

  constructor(private view: EditorView) {
    this.window = view.dom.ownerDocument.defaultView;
    this.window?.addEventListener("resize", this.synchronize, true);
    this.view.requestMeasure(this.measure);
  }

  update(update: ViewUpdate) {
    // Effect types for CodeMirror navigation are private. Treat effects as a
    // newer intent as well as explicit selection reveals, including fold/zoom.
    const newIntent = update.transactions.some(
      (transaction) =>
        transaction.scrollIntoView || transaction.effects.length > 0,
    );
    if (update.docChanged || newIntent) this.checkpoint = undefined;
    if (update.docChanged || newIntent) {
      this.pendingIntent = true;
      this.scheduleCapture();
    }
    if (update.docChanged || update.geometryChanged || update.viewportChanged)
      this.view.requestMeasure(this.measure);
  }

  private scheduleCapture() {
    if (this.captureScheduled) return;
    this.captureScheduled = true;
    queueMicrotask(() => {
      this.captureScheduled = false;
      // Even background effects can invalidate without producing a geometry
      // update. Re-arm after their layout, before the next input event. This
      // records a new checkpoint; the invalidated one is never replayed here.
      if (!this.destroyed && this.pendingIntent) this.synchronize();
    });
  }

  // Called outside a ViewPlugin update, before CodeMirror's scroll measure or
  // after its completed measurement. A standard snapshot is the only scroll
  // operation: the browser can clamp before CodeMirror sees a narrower document.
  synchronize = () => {
    if (this.destroyed || this.synchronizing) return;
    this.synchronizing = true;
    try {
      if (this.pendingIntent) {
        // requestMeasure reads precede scroll-target application. Keep the old
        // checkpoint invalid until this callback can finish that navigation.
        this.view.lineBlockAtHeight(0);
        this.pendingIntent = false;
      }
      const width = this.view.scrollDOM.clientWidth;
      const checkpoint = this.checkpoint;
      if (width <= 0) return;
      if (
        checkpoint &&
        checkpoint.doc === this.view.state.doc &&
        width !== checkpoint.width
      ) {
        this.checkpoint = undefined;
        this.view.dispatch({ effects: checkpoint.snapshot });
        // Finish that queued snapshot in this layout turn, before repainting.
        this.view.lineBlockAtHeight(0);
        this.pendingIntent = false;
      }
      this.checkpoint = this.capture();
    } finally {
      this.synchronizing = false;
    }
  };

  private capture(): Checkpoint | undefined {
    const width = this.view.scrollDOM.clientWidth;
    if (
      this.destroyed ||
      width <= 0 ||
      (this.checkpoint && width !== this.checkpoint.width)
    )
      return;
    // A public layout read completes any pending navigation before recording
    // its destination. Reading scrollSnapshot first would capture the old offset.
    this.view.lineBlockAtHeight(0);
    return {
      doc: this.view.state.doc,
      width,
      snapshot: stableFoldScrollSnapshot(this.view),
    };
  }

  destroy() {
    this.destroyed = true;
    this.checkpoint = undefined;
    this.window?.removeEventListener("resize", this.synchronize, true);
  }
}

const resizePlugin = ViewPlugin.fromClass(FoldScrollResizePluginValue, {
  eventObservers: {
    scroll() {
      this.synchronize();
    },
  },
});

export function foldScrollResize() {
  return [
    resizePlugin,
    EditorView.updateListener.of((update) => {
      // Measure requests run before pending scroll targets. Refresh the snapshot
      // only after the complete layout cycle has applied those targets.
      if (!update.transactions.length)
        update.view.plugin(resizePlugin)?.synchronize();
    }),
  ];
}
