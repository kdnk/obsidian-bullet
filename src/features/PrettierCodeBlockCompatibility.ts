import { EditorPosition, EventRef, Plugin, TFile } from "obsidian";

import { isolateHistory } from "@codemirror/commands";
import { ChangeSet, EditorState, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { Feature } from "./Feature";

import {
  expandCompactCodeBlocks,
  hasExpandableCodeBlockAncestor,
} from "../utils/expandCompactCodeBlocks";

interface FormattingEditor {
  cm: EditorView;
  getValue(): string;
  posToOffset(position: EditorPosition): number;
}

interface FormattingEditorInfo {
  editor: FormattingEditor;
  file: TFile | null;
}

interface FormattingWorkspace {
  activeEditor: FormattingEditorInfo | null;
  getActiveFile(): TFile | null;
  onLayoutReady(callback: () => void): void;
}

interface Formatter {
  app: { workspace: FormattingWorkspace };
  manifest: { id: string; version: string };
  format: (this: Formatter, ...args: unknown[]) => Promise<void>;
}

interface FormatterManager {
  plugins: Record<string, unknown>;
  on(event: "changed", callback: () => void): EventRef;
  offref(reference: EventRef): void;
}

interface CompatibilityApp {
  plugins?: FormatterManager;
  workspace: FormattingWorkspace;
}

interface FormatterPatch {
  formatter: Formatter;
  original: Formatter["format"];
  wrapper: Formatter["format"];
}

const FORMATTER_ID = "prettier-format";

/** Keep Prettier's compact empty ancestors out of Obsidian's editor parser. */
export class PrettierCodeBlockCompatibility implements Feature {
  private active = false;
  private manager: FormatterManager | undefined;
  private changed: EventRef | null = null;
  private patch: FormatterPatch | null = null;
  private pending = new WeakMap<EditorView, object>();

  constructor(private plugin: Plugin) {}

  async load() {
    this.active = true;
    const app = this.plugin.app as unknown as CompatibilityApp;
    this.manager = app.plugins;
    // Older Obsidian versions (including 1.12.7) have no plugin Events API.
    // Leave formatters untouched when their lifecycle cannot be observed.
    if (
      !this.manager ||
      typeof this.manager.on !== "function" ||
      typeof this.manager.offref !== "function"
    )
      return;
    this.changed = this.manager.on("changed", this.reconcile);
    this.plugin.registerEvent(this.changed);
    this.reconcile();
    app.workspace.onLayoutReady(this.reconcile);
  }

  async unload() {
    this.active = false;
    if (this.changed) this.manager?.offref(this.changed);
    this.changed = null;
    this.restore();
  }

  private reconcile = () => {
    if (!this.active) return;
    const candidate = this.manager?.plugins[FORMATTER_ID];
    if (candidate === this.patch?.formatter) return;
    this.restore();
    // This adapter implements the editor surface used by this released
    // formatter version. Unknown versions retain their original behavior.
    if (!isSupportedFormatter(candidate)) return;
    const original = candidate.format;
    const feature = this;
    const wrapper: Formatter["format"] = function (this: Formatter, ...args) {
      return feature.format(this, original, args);
    };
    this.patch = { formatter: candidate, original, wrapper };
    candidate.format = wrapper;
  };

  private restore() {
    const patch = this.patch;
    if (patch && patch.formatter.format === patch.wrapper)
      patch.formatter.format = patch.original;
    this.patch = null;
  }

  private async format(
    formatter: Formatter,
    original: Formatter["format"],
    args: unknown[],
  ): Promise<void> {
    const patch = this.patch;
    const owner = formatter.app.workspace.activeEditor;
    const editor = owner?.editor;
    const view = editor?.cm;
    const file = owner?.file;
    if (
      !this.active ||
      patch?.formatter !== formatter ||
      !view ||
      !file ||
      !hasExpandableCodeBlockAncestor(editor.getValue())
    ) {
      return original.apply(formatter, args);
    }

    const initial = view.state;
    const path = file.path;
    const run = {};
    this.pending.set(view, run);
    let shadow = EditorState.create({
      doc: initial.doc,
      selection: initial.selection,
      extensions: EditorState.tabSize.of(initial.tabSize),
    });
    let changes = ChangeSet.empty(initial.doc.length);
    const dispatch = (...specs: TransactionSpec[]) => {
      const transaction = shadow.update(...specs);
      changes = changes.compose(transaction.changes);
      shadow = transaction.state;
    };
    const shadowEditor = {
      getValue: () => shadow.doc.toString(),
      posToOffset: (position: EditorPosition) =>
        shadow.doc.line(position.line + 1).from + position.ch,
      cm: { dispatch },
    };
    // Prettier captures its editor before awaiting format(). Give only this
    // invocation a private workspace; other panes and typing stay live.
    const workspace = Object.create(formatter.app.workspace, {
      activeEditor: { value: { editor: shadowEditor, file } },
      getActiveFile: { value: () => file },
    }) as FormattingWorkspace;
    const app = Object.create(formatter.app, {
      workspace: { value: workspace },
    }) as Formatter["app"];
    const context = Object.create(formatter, {
      app: { value: app },
    }) as Formatter;

    try {
      await original.apply(context, args);
      dispatch({
        changes: expandCompactCodeBlocks(shadow.doc),
        filter: false,
      });
      if (
        !this.active ||
        this.patch !== patch ||
        this.pending.get(view) !== run ||
        this.manager?.plugins[FORMATTER_ID] !== formatter ||
        owner.editor !== editor ||
        owner.file !== file ||
        file.path !== path ||
        editor.cm !== view ||
        !view.dom.isConnected ||
        view.state.doc !== initial.doc ||
        changes.empty ||
        shadow.doc.eq(initial.doc)
      )
        return;

      view.dispatch({
        changes,
        selection: view.state.selection.map(changes),
        filter: false,
        annotations: isolateHistory.of("full"),
      });
    } finally {
      if (this.pending.get(view) === run) this.pending.delete(view);
    }
  }
}

function isSupportedFormatter(value: unknown): value is Formatter {
  if (!value || typeof value !== "object") return false;
  const formatter = value as Partial<Formatter>;
  return (
    formatter.manifest?.id === FORMATTER_ID &&
    formatter.manifest.version === "0.2.0" &&
    typeof formatter.format === "function" &&
    formatter.app?.workspace !== undefined
  );
}
