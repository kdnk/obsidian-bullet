import { Plugin } from "obsidian";

import { keymap } from "@codemirror/view";

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
  private cycleCursor: Position | null = null;

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
      hotkeys: [],
    });
  }

  async unload() {}

  private check = () => {
    return (
      this.settings.overrideSelectAllBehaviour && !this.imeDetector.isOpened()
    );
  };

  private run = (editor: MyEditor) => {
    const operationRef: { current: SelectAllContent | null } = {
      current: null,
    };
    const result = this.operationPerformer.perform((root) => {
      operationRef.current = new SelectAllContent(root, this.cycleCursor);
      return operationRef.current;
    }, editor);

    this.cycleCursor = operationRef.current?.getCycleCursor() ?? null;

    return result;
  };

  private selectListContent = (editor: MyEditor) => {
    const { shouldStopPropagation } = this.run(editor);
    return shouldStopPropagation;
  };
}
