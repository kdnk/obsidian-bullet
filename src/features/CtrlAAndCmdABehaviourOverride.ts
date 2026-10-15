import { Plugin } from "obsidian";

import { EditorSelection, Text } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import { Feature } from "./Feature";

import { MyEditor } from "../editor";
import { SelectAllContent } from "../operations/SelectAllContent";
import { Position } from "../root";
import { IMEDetector } from "../services/IMEDetector";
import { OperationPerformer } from "../services/OperationPerformer";
import { Settings } from "../services/Settings";
import { createEditorCallback } from "../utils/createEditorCallback";
import { createKeymapRunCallback } from "../utils/createKeymapRunCallback";

export class CtrlAAndCmdABehaviourOverride implements Feature {
  private selectionCycles = new WeakMap<
    EditorView,
    { cursor: Position; doc: Text; selection: EditorSelection }
  >();

  constructor(
    private plugin: Plugin,
    private settings: Settings,
    private imeDetector: IMEDetector,
    private operationPerformer: OperationPerformer,
  ) {}

  async load() {
    this.plugin.registerEditorExtension(
      keymap.of([
        {
          key: "c-a",
          mac: "m-a",
          run: createKeymapRunCallback({
            check: this.check,
            run: this.run,
          }),
        },
      ]),
    );

    this.plugin.addCommand({
      id: "select-list-content",
      icon: "list",
      name: "Select list content",
      editorCallback: createEditorCallback(this.selectListContent),
    });
  }

  async unload() {
    this.selectionCycles = new WeakMap();
  }

  private check = () => {
    return (
      this.settings.overrideSelectAllBehaviour && !this.imeDetector.isOpened()
    );
  };

  private run = (editor: MyEditor) => {
    const view = editor.getCodeMirrorView();
    const cycle = this.selectionCycles.get(view);
    const cursor =
      cycle?.doc === view.state.doc && cycle.selection.eq(view.state.selection)
        ? cycle.cursor
        : null;
    const operationRef: { current: SelectAllContent | null } = {
      current: null,
    };
    const result = this.operationPerformer.perform((root) => {
      operationRef.current = new SelectAllContent(root, cursor);
      return operationRef.current;
    }, editor);

    const nextCursor = operationRef.current?.getCycleCursor();
    if (nextCursor) {
      this.selectionCycles.set(view, {
        cursor: nextCursor,
        doc: view.state.doc,
        selection: view.state.selection,
      });
    } else {
      this.selectionCycles.delete(view);
    }

    return result;
  };

  private selectListContent = (editor: MyEditor) => {
    const { shouldStopPropagation } = this.run(editor);
    return shouldStopPropagation;
  };
}
