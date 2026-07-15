import { MarkdownView, Notice, Plugin } from "obsidian";

import { MyEditor } from "src/editor";
import { CreateNewItem } from "src/operations/CreateNewItem";
import { ObsidianSettings } from "src/services/ObsidianSettings";
import { OperationPerformer } from "src/services/OperationPerformer";
import { Settings } from "src/services/Settings";
import { insertPlainLine } from "src/utils/insertPlainLine";

import { Feature } from "./Feature";

declare global {
  type CM = object;

  interface Vim {
    defineAction<T>(name: string, fn: (cm: CM, args: T) => void): void;

    handleEx(cm: CM, command: string): void;

    enterInsertMode(cm: CM): void;

    mapCommand(
      keys: string,
      type: string,
      name: string,
      args: Record<string, unknown>,
      extra: Record<string, unknown>,
    ): void;
  }

  interface Window {
    CodeMirrorAdapter?: {
      Vim?: Vim;
    };
  }
}

export class VimOBehaviourOverride implements Feature {
  private inited = false;

  constructor(
    private plugin: Plugin,
    private settings: Settings,
    private obsidianSettings: ObsidianSettings,
    private operationPerformer: OperationPerformer,
  ) {}

  async load() {
    this.settings.onChange(["betterVimO"], this.handleSettingsChange);
    this.handleSettingsChange();
  }

  private handleSettingsChange = () => {
    if (!this.settings.overrideVimOBehaviour) {
      return;
    }

    if (!window.CodeMirrorAdapter || !window.CodeMirrorAdapter.Vim) {
      console.error("Vim adapter not found");
      return;
    }

    const vim = window.CodeMirrorAdapter.Vim;
    const plugin = this.plugin;
    const obsidianSettings = this.obsidianSettings;
    const operationPerformer = this.operationPerformer;
    const settings = this.settings;

    vim.defineAction(
      "insertLineAfterBullet",
      (cm, operatorArgs: { after: boolean }) => {
        // Move the cursor to the end of the line
        vim.handleEx(cm, "normal! A");

        if (!settings.overrideVimOBehaviour) {
          if (operatorArgs.after) {
            vim.handleEx(cm, "normal! o");
          } else {
            vim.handleEx(cm, "normal! O");
          }
          vim.enterInsertMode(cm);
          return;
        }

        const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
          new Notice("No active markdown view found", 5000);
          vim.enterInsertMode(cm);
          return;
        }

        const editor = new MyEditor(view.editor);

        const res = operationPerformer.perform(
          (root) =>
            new CreateNewItem(
              root,
              obsidianSettings.getDefaultIndentChars(),
              obsidianSettings.isSmartIndentListEnabled(),
              operatorArgs.after,
            ),
          editor,
        );

        if (!res.shouldStopPropagation) {
          insertPlainLine(editor, operatorArgs.after);
        }

        // Ensure the editor is always left in insert mode
        vim.enterInsertMode(cm);
      },
    );

    vim.mapCommand(
      "o",
      "action",
      "insertLineAfterBullet",
      {},
      {
        isEdit: true,
        context: "normal",
        interlaceInsertRepeat: true,
        actionArgs: { after: true },
      },
    );

    vim.mapCommand(
      "O",
      "action",
      "insertLineAfterBullet",
      {},
      {
        isEdit: true,
        context: "normal",
        interlaceInsertRepeat: true,
        actionArgs: { after: false },
      },
    );

    this.inited = true;
  };

  async unload() {
    this.settings.removeCallback(this.handleSettingsChange);

    if (!this.inited) {
      return;
    }

    new Notice(
      `To fully unload obsidian-bullet plugin, please restart the app`,
      5000,
    );
  }
}
