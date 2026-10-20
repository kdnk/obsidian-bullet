import { Editor, Notice, Plugin, TFile, htmlToMarkdown } from "obsidian";

import { isolateHistory } from "@codemirror/commands";
import { ChangeSet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { Feature } from "./Feature";

import { formatChanges } from "../formatting/editorChanges";
import { formatMarkdown, formatPastedText } from "../formatting/formatMarkdown";
import { formattingScrollSnapshot } from "../formatting/formattingScroll";
import { FormattingSettings } from "../formatting/types";
import { runUserScript } from "../formatting/userScript";
import { Settings } from "../services/Settings";

interface FormattingEditor extends Editor {
  cm: EditorView;
}

interface FormattingOwner {
  editor: FormattingEditor;
  file: TFile | null;
  save?: () => void | Promise<void>;
}

type SaveCallback = (checking: boolean) => boolean | void;
interface SaveCommand {
  checkCallback: SaveCallback;
}

interface FormattingHost {
  commands?: { commands?: Record<string, SaveCommand | undefined> };
  plugins?: { plugins: Record<string, unknown> };
  workspace: { activeEditor: FormattingOwner | null };
  vault: { getConfig(key: string): unknown };
}

interface Linker {
  isFormatOnSaveEnabled(): boolean;
  formatText(text: string, file: TFile): Promise<string>;
}

interface SaveIntent {
  finish(): void | Promise<void>;
}

interface PendingRun {
  controller: AbortController;
  file: TFile | null;
  path: string | undefined;
  settings: FormattingSettings;
  queued: SaveIntent[];
  completion: Promise<void>;
}

const FORMAT_TIMEOUT_MS = 15_000;

export class Formatting implements Feature {
  private active = false;
  private command: SaveCommand | undefined;
  private original: SaveCallback | undefined;
  private wrapper: SaveCallback | undefined;
  private runs = new Map<EditorView, PendingRun>();
  private readonly host: FormattingHost;

  constructor(
    private plugin: Plugin,
    private settings: Settings,
  ) {
    this.host = plugin.app as unknown as FormattingHost;
  }

  ownsExplicitSaveFormatting(): boolean {
    return (
      this.active &&
      !!this.wrapper &&
      this.settings.formatting.onSave &&
      !this.legacyLinkerEnabled()
    );
  }

  async load(): Promise<void> {
    this.active = true;
    this.settings.onChange(["formatting"], this.cancelRuns);
    this.plugin.addCommand({
      id: "format-document",
      name: "Format current note",
      checkCallback: (checking) => {
        if (!this.host.workspace.activeEditor?.file) return false;
        if (!checking) void this.formatActiveEditor();
        return true;
      },
    });
    this.plugin.registerEvent(
      this.plugin.app.workspace.on("editor-paste", (event, editor) =>
        this.paste(event, editor),
      ),
    );
    this.installSaveWrapper();
    this.plugin.app.workspace.onLayoutReady(() => this.installSaveWrapper());
  }

  async unload(): Promise<void> {
    this.active = false;
    this.settings.removeCallback(this.cancelRuns);
    this.cancelRuns();
    if (
      this.command &&
      this.command.checkCallback === this.wrapper &&
      this.original
    ) {
      this.command.checkCallback = this.original;
    }
  }

  async formatActiveEditor(): Promise<void> {
    const owner = this.host.workspace.activeEditor;
    if (!this.active || !owner?.file || !owner.editor.cm) return;
    await this.enqueue(owner, { finish: () => undefined });
  }

  private installSaveWrapper(): void {
    if (!this.active || this.wrapper) return;
    const command = this.host.commands?.commands?.["editor:save-file"];
    if (!command || typeof command.checkCallback !== "function") return;
    const original = command.checkCallback;
    this.command = command;
    this.original = original;
    const feature = this;
    this.wrapper = function (this: unknown, checking) {
      const owner = feature.host.workspace.activeEditor;
      if (
        !checking &&
        feature.active &&
        feature.settings.formatting.onSave &&
        feature.legacyLinkerEnabled()
      ) {
        new Notice(
          "Bullet save formatting requires the updated Automatic Linker. Update Automatic Linker or disable its format-on-save setting.",
        );
      }
      if (
        checking ||
        !feature.ownsExplicitSaveFormatting() ||
        !owner?.file ||
        !owner.editor.cm
      ) {
        return original.call(this, checking);
      }
      const context = this;
      const file = owner.file;
      const editor = owner.editor;
      const view = editor.cm;
      void feature.enqueue(owner, {
        finish: async () => {
          if (
            owner.file !== file ||
            owner.editor !== editor ||
            editor.cm !== view ||
            !view.dom.isConnected
          )
            return;
          try {
            if (feature.host.workspace.activeEditor === owner) {
              original.call(context, false);
            } else if (typeof owner.save === "function") {
              await owner.save();
            }
          } catch (error) {
            new Notice(
              `Bullet could not save ${file.path}. ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        },
      });
      return true;
    };
    command.checkCallback = this.wrapper;
  }

  private enqueue(owner: FormattingOwner, intent: SaveIntent): Promise<void> {
    const view = owner.editor.cm;
    const running = this.runs.get(view);
    if (running) {
      running.queued.push(intent);
      return running.completion.then(() => this.runs.get(view)?.completion);
    }
    const run: PendingRun = {
      controller: new AbortController(),
      file: owner.file,
      path: owner.file?.path,
      settings: this.settings.formatting,
      queued: [],
      completion: Promise.resolve(),
    };
    this.runs.set(view, run);
    run.completion = this.execute(owner, view, run).finally(async () => {
      try {
        await intent.finish();
      } finally {
        if (this.runs.get(view) === run) this.runs.delete(view);
        const queued = run.queued;
        if (queued.length) {
          if (
            this.active &&
            owner.file === run.file &&
            owner.file?.path === run.path &&
            this.settings.formatting === run.settings &&
            owner.editor.cm === view &&
            view.dom.isConnected
          ) {
            void this.enqueue(owner, {
              finish: async () => {
                for (const next of queued) await next.finish();
              },
            });
          } else {
            for (const next of queued) await next.finish();
          }
        }
      }
    });
    return run.completion;
  }

  private async execute(
    owner: FormattingOwner,
    view: EditorView,
    run: PendingRun,
  ): Promise<void> {
    const file = owner.file;
    if (!file) return;
    const editor = owner.editor;
    const originalDoc = view.state.doc;
    const path = file.path;
    const settings = this.settings.formatting;
    const current = () =>
      this.active &&
      !run.controller.signal.aborted &&
      this.runs.get(view) === run &&
      this.settings.formatting === settings &&
      owner.editor === editor &&
      owner.file === file &&
      file.path === path &&
      editor.cm === view &&
      view.dom.isConnected &&
      view.state.doc === originalDoc;
    const candidate = this.host.plugins?.plugins["automatic-linker"];
    const linker =
      isLinker(candidate) && candidate.isFormatOnSaveEnabled()
        ? (text: string) => candidate.formatText(text, file)
        : undefined;
    const tabSize = this.host.vault.getConfig("tabSize");
    const timerWindow = view.dom.ownerDocument.defaultView;
    if (!timerWindow) return;
    let timer: number | undefined;
    try {
      const aborted = new Promise<never>((_, reject) => {
        run.controller.signal.addEventListener(
          "abort",
          () => reject(new Error("Formatting cancelled")),
          { once: true },
        );
      });
      timer = timerWindow.setTimeout(
        () => run.controller.abort(),
        FORMAT_TIMEOUT_MS,
      );
      const result = await Promise.race([
        formatMarkdown({
          text: originalDoc.toString(),
          file: {
            path,
            basename: file.basename,
            ctime: file.stat.ctime,
            mtime: file.stat.mtime,
          },
          indent: {
            useTabs: this.host.vault.getConfig("useTab") !== false,
            tabWidth: typeof tabSize === "number" && tabSize > 0 ? tabSize : 4,
          },
          settings,
          signal: run.controller.signal,
          linker,
          script:
            settings.script.kind === "module"
              ? (text: string) =>
                  runUserScript({
                    app: this.plugin.app,
                    path:
                      settings.script.kind === "module"
                        ? settings.script.path
                        : "",
                    text,
                    file,
                    signal: run.controller.signal,
                  })
              : undefined,
        }),
        aborted,
      ]);
      if (!current() || result === originalDoc.toString()) return;
      const changes = ChangeSet.of(
        formatChanges(originalDoc.toString(), result),
        originalDoc.length,
      );
      const snapshot = formattingScrollSnapshot(view);
      if (!current()) return;
      view.dispatch({
        changes,
        selection: view.state.selection.map(changes),
        effects: snapshot?.map(changes),
        filter: false,
        annotations: isolateHistory.of("full"),
      });
    } catch (error) {
      if (this.active) {
        new Notice(
          `Bullet formatting skipped. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } finally {
      if (timer !== undefined) timerWindow.clearTimeout(timer);
    }
  }

  private cancelRuns = (): void => {
    for (const run of this.runs.values()) run.controller.abort();
  };

  private legacyLinkerEnabled(): boolean {
    const linker = this.host.plugins?.plugins["automatic-linker"];
    if (!linker || isLinker(linker) || typeof linker !== "object") return false;
    return !(
      "settings" in linker &&
      linker.settings &&
      typeof linker.settings === "object" &&
      "formatOnSave" in linker.settings &&
      linker.settings.formatOnSave === false
    );
  }

  private paste(event: ClipboardEvent, editor: Editor): void {
    if (
      !this.active ||
      event.defaultPrevented ||
      !this.settings.formatting.pasteFootnoteCleanup
    )
      return;
    const plain = event.clipboardData?.getData("text/plain");
    if (!plain || /^https?:\/\/\S+$/i.test(plain.trim())) return;
    const html = event.clipboardData?.getData("text/html");
    const source =
      html &&
      this.host.vault.getConfig("autoConvertHtml") &&
      !html.includes("<!-- obsidian -->")
        ? htmlToMarkdown(html)
        : plain;
    const formatted = formatPastedText(source, this.settings.formatting);
    if (formatted === source) return;
    event.preventDefault();
    if (!event.defaultPrevented) return;
    event.stopPropagation();
    if ("cm" in editor && editor.cm instanceof EditorView) {
      editor.cm.dispatch({
        ...editor.cm.state.replaceSelection(formatted),
        userEvent: "input.paste",
      });
    } else {
      editor.replaceSelection(formatted);
    }
  }
}

function isLinker(value: unknown): value is Linker {
  return (
    !!value &&
    typeof value === "object" &&
    "isFormatOnSaveEnabled" in value &&
    typeof value.isFormatOnSaveEnabled === "function" &&
    "formatText" in value &&
    typeof value.formatText === "function"
  );
}
