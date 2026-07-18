import { Plugin } from "obsidian";

import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";

import { Feature } from "./Feature";

import { MyEditor } from "../editor";
import { CreateNewItem } from "../operations/CreateNewItem";
import { CreateNewRootItemAfterEmpty } from "../operations/CreateNewRootItemAfterEmpty";
import { InsertNewLineWithoutBullet } from "../operations/InsertNewLineWithoutBullet";
import { OutdentListIfItsEmpty } from "../operations/OutdentListIfItsEmpty";
import { IMEDetector } from "../services/IMEDetector";
import { ObsidianSettings } from "../services/ObsidianSettings";
import { OperationPerformer } from "../services/OperationPerformer";
import { Settings } from "../services/Settings";
import { createEditorCallback } from "../utils/createEditorCallback";
import { createKeymapRunCallback } from "../utils/createKeymapRunCallback";
import { isEmptyLineOrEmptyCheckbox } from "../utils/isEmptyLineOrEmptyCheckbox";

export class EnterBehaviourOverride implements Feature {
  constructor(
    private plugin: Plugin,
    private settings: Settings,
    private imeDetector: IMEDetector,
    private obsidianSettings: ObsidianSettings,
    private operationPerformer: OperationPerformer,
  ) {}

  async load() {
    this.plugin.registerEditorExtension(
      Prec.highest(
        keymap.of([
          {
            key: "Shift-Enter",
            run: createKeymapRunCallback({
              check: this.check,
              run: this.runShiftEnter,
            }),
          },
          {
            key: "Enter",
            run: createKeymapRunCallback({
              check: this.check,
              run: this.run,
            }),
          },
        ]),
      ),
    );

    this.plugin.addCommand({
      id: "insert-note-line",
      icon: "list-plus",
      name: "Insert note line",
      editorCallback: createEditorCallback(this.insertNoteLine),
    });
  }

  async unload() {}

  private check = () => {
    return (
      (this.settings.overrideEnterBehaviour ||
        this.settings.keepBodyTextInBullets) &&
      !this.imeDetector.isOpened()
    );
  };

  private run = (editor: MyEditor) => {
    return this.operationPerformer.perform((root) => {
      const currentList = root.getListUnderCursor();
      const orderedList = /^\d+\.$/.test(currentList.getBullet());
      const smartIndentListEnabled =
        this.obsidianSettings.isSmartIndentListEnabled();
      const lines = currentList.getLines();
      const shouldHandleEmptyList =
        root.hasSingleCursor() &&
        lines.length === 1 &&
        isEmptyLineOrEmptyCheckbox(lines[0]);

      if (
        shouldHandleEmptyList &&
        this.settings.keepBodyTextInBullets &&
        currentList.getLevel() === 1
      ) {
        return new CreateNewRootItemAfterEmpty(root, smartIndentListEnabled);
      }

      if (
        shouldHandleEmptyList &&
        this.settings.keepBodyTextInBullets &&
        currentList.getLevel() !== 1
      ) {
        return new OutdentListIfItsEmpty(root, smartIndentListEnabled);
      }

      if (orderedList && !smartIndentListEnabled) {
        return null;
      }

      if (shouldHandleEmptyList && currentList.getLevel() !== 1) {
        return new OutdentListIfItsEmpty(root, smartIndentListEnabled);
      }

      const defaultIndentChars = this.obsidianSettings.getDefaultIndentChars();
      const documentPrefixBeforeRoot = editor.getRange(
        { line: 0, ch: 0 },
        { line: root.getContentStart().line, ch: 0 },
      );

      return new CreateNewItem(
        root,
        defaultIndentChars,
        smartIndentListEnabled,
        true,
        documentPrefixBeforeRoot,
      );
    }, editor);
  };

  private runShiftEnter = (editor: MyEditor) => {
    return this.operationPerformer.perform(
      (root) => new InsertNewLineWithoutBullet(root),
      editor,
    );
  };

  private insertNoteLine = (editor: MyEditor) => {
    const { shouldStopPropagation } = this.runShiftEnter(editor);
    return shouldStopPropagation;
  };
}
