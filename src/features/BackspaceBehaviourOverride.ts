import { Plugin } from "obsidian";

import { getIndentUnit } from "@codemirror/language";
import { keymap } from "@codemirror/view";

import { codeEnterBackspace } from "./CodeEnterBackspace";
import { Feature } from "./Feature";

import { MyEditor } from "../editor";
import {
  BackspaceIndentation,
  DeleteTillPreviousLineContentEnd,
} from "../operations/DeleteTillPreviousLineContentEnd";
import { IMEDetector } from "../services/IMEDetector";
import { ObsidianSettings } from "../services/ObsidianSettings";
import { OperationPerformer } from "../services/OperationPerformer";
import { Settings } from "../services/Settings";
import { createKeymapRunCallback } from "../utils/createKeymapRunCallback";

export class BackspaceBehaviourOverride implements Feature {
  constructor(
    private plugin: Plugin,
    private settings: Settings,
    private imeDetector: IMEDetector,
    private obsidianSettings: ObsidianSettings,
    private operationPerformer: OperationPerformer,
  ) {}

  async load() {
    this.plugin.registerEditorExtension([
      codeEnterBackspace(this.check),
      keymap.of(
        [{ key: "Backspace" }, { mac: "Ctrl-h" }].map((binding) => ({
          ...binding,
          run: (view) => {
            if (view.state.readOnly || view.composing) return false;
            return createKeymapRunCallback({
              check: this.check,
              run: (editor) =>
                this.run(editor, {
                  tabSize: view.state.tabSize,
                  indentUnit: getIndentUnit(view.state),
                }),
            })(view);
          },
        })),
      ),
    ]);
  }

  async unload() {}

  private check = () => {
    return (
      (this.settings.keepCursorWithinContent !== "never" ||
        this.settings.keepBodyTextInBullets) &&
      !this.imeDetector.isOpened()
    );
  };

  private run = (editor: MyEditor, indentation?: BackspaceIndentation) => {
    return this.operationPerformer.perform(
      (root) =>
        new DeleteTillPreviousLineContentEnd(
          root,
          this.obsidianSettings.isSmartIndentListEnabled(),
          this.settings.keepBodyTextInBullets,
          indentation,
        ),
      editor,
    );
  };
}
