import { Plugin } from "obsidian";

import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { Feature } from "./Feature";

import {
  MyEditor,
  MyEditorPosition,
  getEditorFromState,
  getFoldedLinesFromState,
} from "../editor";
import { KeepCursorOutsideFoldedLines } from "../operations/KeepCursorOutsideFoldedLines";
import { KeepCursorWithinListContent } from "../operations/KeepCursorWithinListContent";
import { RecoverCursorAfterArrowUp } from "../operations/RecoverCursorAfterArrowUp";
import { RecoverCursorAfterFoldedNavigation } from "../operations/RecoverCursorAfterFoldedNavigation";
import { OperationPerformer } from "../services/OperationPerformer";
import { Parser } from "../services/Parser";
import { Settings } from "../services/Settings";

export function getTrackedNavigationKey(
  e: KeyboardEvent,
): "ArrowUp" | "ArrowDown" | null {
  if (shouldSkipSelectionAdjustmentsForKeydown(e)) {
    return null;
  }

  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    return e.key;
  }

  if (e.key === "j") {
    return "ArrowDown";
  }

  if (e.key === "k") {
    return "ArrowUp";
  }

  return null;
}

export function shouldSkipSelectionAdjustmentsForKeydown(e: KeyboardEvent) {
  if (e.altKey) {
    return true;
  }

  return (
    (e.key === "ArrowUp" || e.key === "ArrowDown") &&
    (e.altKey || e.ctrlKey || e.metaKey)
  );
}

export function shouldSkipSelectionAdjustmentsForMousedown(e: MouseEvent) {
  return e.altKey;
}

export class EditorSelectionsBehaviourOverride implements Feature {
  private lastKey: string | null = null;
  private skipSelectionAdjustments = false;
  private suppressSelectionAdjustments = 0;
  private pendingSelectionAdjustment: number | null = null;
  private selectionAdjustmentVersion = 0;

  constructor(
    private plugin: Plugin,
    private settings: Settings,
    private parser: Parser,
    private operationPerformer: OperationPerformer,
  ) {}

  async load() {
    this.plugin.registerEditorExtension([
      EditorView.domEventObservers({
        keydown: this.handleKeyDown,
        mousedown: this.handleMouseDown,
      }),
      EditorState.transactionExtender.of(this.transactionExtender),
    ]);
  }

  async unload() {}

  resetState() {
    this.lastKey = null;
    this.skipSelectionAdjustments = false;
    this.suppressSelectionAdjustments = 0;
    this.clearPendingSelectionAdjustment();
  }

  hasPendingSelectionAdjustment() {
    return this.pendingSelectionAdjustment !== null;
  }

  beginSuppressingSelectionAdjustments() {
    this.suppressSelectionAdjustments++;
  }

  endSuppressingSelectionAdjustments() {
    if (this.suppressSelectionAdjustments > 0) {
      this.suppressSelectionAdjustments--;
    }
  }

  private transactionExtender = (tr: Transaction): null => {
    if (
      this.suppressSelectionAdjustments > 0 ||
      this.settings.keepCursorWithinContent === "never" ||
      !tr.selection
    ) {
      return null;
    }

    const editor = getEditorFromState(tr.startState);
    if (!editor) {
      return null;
    }

    const previousCursor = this.getSingleCursor(tr.startState);
    const previousFoldedLines = getFoldedLinesFromState(tr.startState);
    const pressedKey = this.lastKey;
    const shouldSkipSelectionAdjustments = this.skipSelectionAdjustments;
    this.skipSelectionAdjustments = false;

    if (shouldSkipSelectionAdjustments) {
      return null;
    }

    this.clearPendingSelectionAdjustment();
    const version = ++this.selectionAdjustmentVersion;

    this.pendingSelectionAdjustment = window.setTimeout(() => {
      this.pendingSelectionAdjustment = null;

      if (version !== this.selectionAdjustmentVersion) {
        return;
      }

      this.handleSelectionsChanges(
        editor,
        previousCursor,
        previousFoldedLines,
        pressedKey,
      );
    }, 0);

    return null;
  };

  private handleSelectionsChanges = (
    editor: MyEditor,
    previousCursor: MyEditorPosition | null,
    previousFoldedLines: number[],
    pressedKey: string | null,
  ) => {
    const root = this.parser.parse(editor);

    if (!root) {
      return;
    }

    {
      const recovery = new RecoverCursorAfterFoldedNavigation(
        root,
        previousCursor,
        previousFoldedLines,
        pressedKey,
      );
      const { shouldStopPropagation } = this.operationPerformer.eval(
        root,
        recovery,
        editor,
      );

      if (shouldStopPropagation) {
        const refoldLine = recovery.getRefoldLine();

        if (refoldLine !== null) {
          editor.fold(refoldLine);
        }

        return;
      }
    }

    {
      const { shouldStopPropagation } = this.operationPerformer.eval(
        root,
        new KeepCursorOutsideFoldedLines(root),
        editor,
      );

      if (shouldStopPropagation) {
        return;
      }
    }

    if (pressedKey === "ArrowUp" && previousCursor) {
      const { shouldStopPropagation } = this.operationPerformer.eval(
        root,
        new RecoverCursorAfterArrowUp(root, previousCursor),
        editor,
      );

      if (shouldStopPropagation) {
        return;
      }
    }

    this.operationPerformer.eval(
      root,
      new KeepCursorWithinListContent(root),
      editor,
    );
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    this.skipSelectionAdjustments = shouldSkipSelectionAdjustmentsForKeydown(e);
    this.lastKey = getTrackedNavigationKey(e);
  };

  private handleMouseDown = (e: MouseEvent) => {
    this.skipSelectionAdjustments =
      shouldSkipSelectionAdjustmentsForMousedown(e);
    this.lastKey = null;
  };

  private clearPendingSelectionAdjustment() {
    if (this.pendingSelectionAdjustment !== null) {
      window.clearTimeout(this.pendingSelectionAdjustment);
      this.pendingSelectionAdjustment = null;
    }

    this.selectionAdjustmentVersion++;
  }

  private getSingleCursor(state: EditorState): MyEditorPosition | null {
    const ranges = state.selection.ranges;

    if (ranges.length !== 1) {
      return null;
    }

    const range = ranges[0];
    if (!range) {
      return null;
    }

    const { anchor, head } = range;

    if (anchor !== head) {
      return null;
    }

    const editor = getEditorFromState(state);
    return editor ? editor.offsetToPos(head) : null;
  }
}
