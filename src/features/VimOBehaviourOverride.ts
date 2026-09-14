import { MarkdownView, Notice, Plugin } from "obsidian";

import { MyEditor } from "src/editor";
import { CreateNewItem } from "src/operations/CreateNewItem";
import { ObsidianSettings } from "src/services/ObsidianSettings";
import { OperationPerformer } from "src/services/OperationPerformer";
import { Settings } from "src/services/Settings";
import { insertPlainLine } from "src/utils/insertPlainLine";

import { Feature } from "./Feature";

import { MarkdownLineClassifier } from "../services/MarkdownLineClassifier";
import { getFenceContent, getFenceOpening } from "../utils/fencedCode";

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
  private classifier = new MarkdownLineClassifier();

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
        const state = editor.getCodeMirrorView().state;
        const line = state.doc.lineAt(state.selection.main.head);
        let useNativeLineInsertion =
          this.classifier.classify(state, line.number) === "structure";
        let codeIndent: string | null = null;

        const res = operationPerformer.perform((root) => {
          const list = root.getListUnderCursor();
          const listStart = list.getFirstLineContentStart().line + 1;
          const firstLine = this.classifier.inspect(state, listStart);
          const listItem = firstLine.listItem;
          // Replacing marker characters keeps separator tabs at their original stops.
          const attachedFenceIndent =
            listItem &&
            getFenceOpening(firstLine.text.slice(listItem.contentStart))
              ? listItem.prefix.replace(/\S/g, " ")
              : null;
          if (useNativeLineInsertion) {
            const notesIndent = attachedFenceIndent ?? list.getNotesIndent();
            const ownsFence = listItem !== null;
            // Blank code rows can omit their container whitespace in source.
            // Restore it on the new row so the next input stays inside code.
            if (
              ownsFence &&
              notesIndent !== null &&
              line.text.trim().length === 0 &&
              !getFenceContent(line.text, notesIndent)
            ) {
              codeIndent = notesIndent;
              return null;
            }
            // O before a closing fence is still code. Only o on a real list's
            // fence boundary may create a sibling; list-looking code is literal.
            const mayCreateSiblingAfterFence =
              operatorArgs.after &&
              getFenceOpening(line.text.trimStart()) !== null &&
              ownsFence;
            if (!mayCreateSiblingAfterFence) return null;
          }

          if (attachedFenceIndent !== null) {
            useNativeLineInsertion = true;
            // Native Vim copies only the opening row's whitespace, omitting
            // the marker's width from its fenced-code continuation indent.
            if (operatorArgs.after && line.number === listStart) {
              codeIndent = attachedFenceIndent;
              return null;
            }
          }
          return new CreateNewItem(
            root,
            obsidianSettings.getDefaultIndentChars(),
            obsidianSettings.isSmartIndentListEnabled(),
            operatorArgs.after,
          );
        }, editor);

        if (!res.shouldStopPropagation) {
          if (codeIndent !== null) {
            insertPlainLine(editor, operatorArgs.after, codeIndent);
          } else if (useNativeLineInsertion) {
            vim.handleEx(cm, operatorArgs.after ? "normal! o" : "normal! O");
          } else {
            insertPlainLine(editor, operatorArgs.after);
          }
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
