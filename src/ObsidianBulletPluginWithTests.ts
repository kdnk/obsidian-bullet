import { App, MarkdownView, Vault } from "obsidian";

import ObsidianBulletPlugin from "./ObsidianBulletPlugin";
import { MyEditor, MyEditorPosition, MyEditorSelection } from "./editor";
import { EditorSelectionsBehaviourOverride } from "./features/EditorSelectionsBehaviourOverride";
import { KeepCursorWithinListContent } from "./operations/KeepCursorWithinListContent";
import { SettingsObject } from "./services/Settings";
import { getTestPlatformWsUrl } from "./testPlatform";

declare global {
  interface Window {
    ObsidianBulletPlugin?: ObsidianBulletPluginWithTests;
  }
}

interface AppWithCommands extends App {
  commands: {
    executeCommandById(id: string): void;
  };
}

interface VaultWithConfig extends Vault {
  setConfig(key: string, value: unknown): void;
}

type TestMessage =
  | { id: string; type: "applyState"; data: State | string | string[] }
  | { id: string; type: "simulateKeydown"; data: string }
  | { id: string; type: "insertText"; data: string }
  | { id: string; type: "executeCommandById"; data: string }
  | { id: string; type: "drag"; data: { from: MyEditorPosition } }
  | {
      id: string;
      type: "move";
      data: { to: MyEditorPosition; offsetX: number; offsetY: number };
    }
  | { id: string; type: "drop" }
  | { id: string; type: "waitForIdle" }
  | { id: string; type: "adjustSelection" }
  | { id: string; type: "resetSettings" }
  | {
      id: string;
      type: "setSetting";
      data: {
        k: keyof SettingsObject;
        v: SettingsObject[keyof SettingsObject];
      };
    }
  | { id: string; type: "parseState"; data: string | string[] }
  | { id: string; type: "getCurrentState" };

const keysMap: { [key: string]: number } = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46,
  KeyA: 65,
};

export default class ObsidianBulletPluginWithTests extends ObsidianBulletPlugin {
  private editor!: MyEditor;

  wait(time: number) {
    return new Promise((resolve) => window.setTimeout(resolve, time));
  }

  executeCommandById(id: string) {
    (this.app as AppWithCommands).commands.executeCommandById(id);
  }

  setSetting({
    k,
    v,
  }: {
    k: keyof SettingsObject;
    v: SettingsObject[keyof SettingsObject];
  }) {
    this.settings.setValue(k, v);
  }

  resetSettings() {
    this.settings.reset();

    for (const feature of this.features || []) {
      if (feature instanceof EditorSelectionsBehaviourOverride) {
        feature.resetState();
      }
    }

    const vault = this.app.vault as VaultWithConfig;
    if (typeof vault.setConfig === "function") {
      vault.setConfig("smartIndentList", true);
    }
  }

  simulateKeydown(keys: string) {
    const e = {
      type: "keydown",
      code: "",
      keyCode: 0,
      shiftKey: false,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
      defaultPrevented: false,
      returnValue: true,
      cancelBubble: false,
      preventDefault: function () {
        e.defaultPrevented = true;
        e.returnValue = true;
      },
      stopPropagation: function () {
        e.cancelBubble = true;
      },
    };

    for (const key of keys.split("-")) {
      switch (key.toLowerCase()) {
        case "cmd":
          e.metaKey = true;
          break;
        case "ctrl":
          e.ctrlKey = true;
          break;
        case "alt":
          e.altKey = true;
          break;
        case "shift":
          e.shiftKey = true;
          break;
        default:
          e.code = key;
          break;
      }
    }

    if (e.code in keysMap) {
      e.keyCode = keysMap[e.code];
    }

    if (e.keyCode === 0) {
      throw new Error("Unknown key: " + e.code);
    }

    this.editor.triggerOnKeyDown(e as KeyboardEvent);
  }

  insertText(text: string) {
    activeDocument.execCommand("insertText", false, text);
  }

  async onload() {
    await super.onload();

    window.ObsidianBulletPlugin = this;

    if (process.env.TEST_PLATFORM) {
      window.setTimeout(() => {
        void (async () => {
          await this.wait(1000);
          await this.connect();
        })();
      }, 0);
    }
  }

  onunload() {
    super.onunload();

    delete window.ObsidianBulletPlugin;
  }

  protected async prepareSettings() {
    await super.prepareSettings();

    if (process.env.TEST_PLATFORM) {
      this.resetSettings();
    }
  }

  async prepareForTests() {
    const filePath = `test.md`;
    let file = this.app.vault
      .getMarkdownFiles()
      .find((f) => f.path === filePath);
    if (!file) {
      file = await this.app.vault.create(filePath, "");
    }
    for (let i = 0; i < 10; i++) {
      await this.wait(1000);
      if (this.app.workspace.activeLeaf) {
        // TODO: Fix deprecation issue
        await this.app.workspace.activeLeaf.openFile(file);
        break;
      }
    }
    await this.wait(1000);

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      throw new Error("No active markdown view found");
    }
    this.editor = new MyEditor(view.editor);
  }

  async connect() {
    const ws = new WebSocket(getTestPlatformWsUrl());
    await this.prepareForTests();
    ws.send("ready");

    ws.addEventListener("message", (event) => {
      void this.handleTestMessage(ws, event);
    });
  }

  private async handleTestMessage(ws: WebSocket, event: MessageEvent) {
    const message = JSON.parse(String(event.data)) as TestMessage;
    const { id, type } = message;

    let result: State | undefined;
    let error: string | undefined;

    try {
      switch (type) {
        case "applyState":
          await this.applyState(message.data);
          break;
        case "simulateKeydown":
          this.simulateKeydown(message.data);
          break;
        case "insertText":
          this.insertText(message.data);
          break;
        case "executeCommandById":
          this.executeCommandById(message.data);
          break;
        case "drag":
          this.drag(message.data);
          break;
        case "move":
          this.move(message.data);
          break;
        case "drop":
          this.drop();
          break;
        case "waitForIdle":
          await this.waitForIdle();
          break;
        case "adjustSelection":
          await this.adjustSelection();
          break;
        case "resetSettings":
          this.resetSettings();
          break;
        case "setSetting":
          this.setSetting(message.data);
          break;
        case "parseState":
          result = this.parseState(message.data);
          break;
        case "getCurrentState":
          result = this.getCurrentState();
          break;
      }
    } catch (e) {
      error = e instanceof Error ? e.stack || e.message : JSON.stringify(e);
    }

    ws.send(JSON.stringify({ id, data: result, error }));
  }

  private drag(opts: { from: { line: number; ch: number } }) {
    const view = this.editor.getCodeMirrorView();
    this.assertValidEditorPosition(opts.from);

    const offset = this.editor.posToOffset(opts.from);
    const coords = view.coordsAtPos(offset);
    if (!coords) {
      throw new Error(
        `Unable to drag from ${JSON.stringify(opts.from)}: missing editor coordinates`,
      );
    }

    const x = coords.left;
    const y = coords.top;
    const e = new MouseEvent("mousedown", {
      screenX: x,
      screenY: y,
      clientX: x,
      clientY: y,
    });
    const { node } = view.domAtPos(offset);
    let el = node.instanceOf(HTMLElement) ? node : node.parentElement;
    while (el && !el.classList.contains("cm-line")) {
      el = el.parentElement;
    }
    if (!el) {
      throw new Error(
        `Unable to drag from ${JSON.stringify(opts.from)}: missing line element`,
      );
    }
    el =
      el.querySelector(".cm-formatting-list") ||
      el.querySelector(".cm-fold-indicator");
    if (!el) {
      throw new Error(
        `Unable to drag from ${JSON.stringify(opts.from)}: missing draggable list marker`,
      );
    }
    el.dispatchEvent(e);
  }

  private move(opts: {
    to: { line: number; ch: number };
    offsetX: number;
    offsetY: number;
  }) {
    const view = this.editor.getCodeMirrorView();
    this.assertValidEditorPosition(opts.to);

    const coords = view.coordsAtPos(this.editor.posToOffset(opts.to));
    if (!coords) {
      throw new Error(
        `Unable to move to ${JSON.stringify(opts.to)}: missing editor coordinates`,
      );
    }

    const x = coords.left + opts.offsetX;
    const y = coords.top + opts.offsetY;
    const e = new MouseEvent("mousemove", {
      screenX: x,
      screenY: y,
      clientX: x,
      clientY: y,
    });
    view.dom.ownerDocument.dispatchEvent(e);
  }

  private drop() {
    const e = new MouseEvent("mouseup");
    this.editor.getCodeMirrorView().dom.ownerDocument.dispatchEvent(e);
  }

  private assertValidEditorPosition(pos: MyEditorPosition) {
    const lineCount = this.editor.getValue().split("\n").length;
    if (pos.line < 0 || pos.line >= lineCount) {
      throw new Error(
        `Invalid editor position ${JSON.stringify(pos)}: line must be between 0 and ${lineCount - 1}`,
      );
    }

    const lineLength = this.editor.getLine(pos.line).length;
    if (pos.ch < 0 || pos.ch > lineLength) {
      throw new Error(
        `Invalid editor position ${JSON.stringify(pos)}: ch must be between 0 and ${lineLength}`,
      );
    }
  }

  async applyState(state: string[]): Promise<void>;
  async applyState(state: string): Promise<void>;
  async applyState(state: State): Promise<void>;
  async applyState(state: State | string | string[]): Promise<void>;
  async applyState(state: State | string | string[]) {
    if (typeof state === "string") {
      state = state.split("\n");
    }
    if (Array.isArray(state)) {
      state = this.parseState(state);
    }

    this.beginSuppressingSelectionAdjustments();

    try {
      this.editor.setValue("");
      this.editor.setValue(state.value);
      this.editor.setSelections(state.selections);
      // TODO: recursive bottom-top folding, because it's impossible to fold inside already folded range
      for (const l of state.folds) {
        this.editor.fold(l);
      }

      await this.waitForStateToApply(state);
      await this.wait(0);
    } finally {
      this.endSuppressingSelectionAdjustments();
    }

    await this.waitForSelectionAdjustmentsToSettle();
  }

  private async adjustSelection() {
    await this.wait(0);

    const stickCursor = this.settings.getValues().stickCursor;
    const shouldAdjustCursor = stickCursor !== false && stickCursor !== "never";
    let targetSelections: MyEditorSelection[] | null = null;

    if (shouldAdjustCursor) {
      const root = this.parser.parse(this.editor);

      if (root) {
        const op = new KeepCursorWithinListContent(root);
        this.operationPerformer.eval(root, op, this.editor);

        targetSelections = root.getSelections();
      } else {
        this.editor.dispatchCurrentSingleSelectionTransaction();
      }
    } else {
      this.editor.dispatchCurrentSingleSelectionTransaction();
    }

    if (targetSelections) {
      await this.forceSelectionsToApply(targetSelections);
    }

    await this.waitForSelectionAdjustmentsToSettle();
  }

  private async forceSelectionsToApply(selections: MyEditorSelection[]) {
    for (let i = 0; i < 5; i++) {
      this.editor.setSelections(selections);

      if (selections.length === 1) {
        this.editor.dispatchSingleSelectionTransaction(selections[0]);
      } else {
        this.editor.dispatchCurrentSingleSelectionTransaction();
      }

      await this.wait(0);

      if (
        JSON.stringify(this.editor.listSelections()) ===
        JSON.stringify(selections)
      ) {
        return;
      }
    }
  }

  private beginSuppressingSelectionAdjustments() {
    for (const feature of this.features || []) {
      if (feature instanceof EditorSelectionsBehaviourOverride) {
        feature.beginSuppressingSelectionAdjustments();
        return;
      }
    }
  }

  private endSuppressingSelectionAdjustments() {
    for (const feature of this.features || []) {
      if (feature instanceof EditorSelectionsBehaviourOverride) {
        feature.endSuppressingSelectionAdjustments();
        return;
      }
    }
  }

  private async waitForStateToApply(state: State) {
    for (let i = 0; i < 20; i++) {
      await this.wait(0);

      const hasExpectedValue = this.editor.getValue() === state.value;
      const hasExpectedSelections =
        JSON.stringify(this.editor.listSelections()) ===
        JSON.stringify(state.selections);
      const hasExpectedFolds =
        JSON.stringify(this.editor.getAllFoldedLines()) ===
        JSON.stringify(state.folds);

      if (hasExpectedValue && hasExpectedSelections && hasExpectedFolds) {
        return;
      }
    }

    await this.wait(25);
  }

  async waitForIdle() {
    await this.waitForSelectionAdjustmentsToSettle();
  }

  private async waitForSelectionAdjustmentsToSettle() {
    // Cursor corrections run in deferred timers, and some test cases schedule
    // multiple editor transactions back-to-back. Wait until they fully drain.
    for (let i = 0; i < 20; i++) {
      await this.wait(0);

      if (this.hasPendingSelectionAdjustments()) {
        continue;
      }

      await this.wait(0);

      if (!this.hasPendingSelectionAdjustments()) {
        return;
      }
    }

    await this.wait(25);
  }

  private hasPendingSelectionAdjustments() {
    for (const feature of this.features || []) {
      if (
        feature instanceof EditorSelectionsBehaviourOverride &&
        feature.hasPendingSelectionAdjustment()
      ) {
        return true;
      }
    }

    return false;
  }
  getCurrentState(): State {
    return {
      folds: this.editor.getAllFoldedLines(),
      selections: this.editor.listSelections().map((range) => ({
        anchor: {
          line: range.anchor.line,
          ch: range.anchor.ch,
        },
        head: {
          line: range.head.line,
          ch: range.head.ch,
        },
      })),
      value: this.editor.getValue(),
    };
  }

  parseState(content: string[]): State;
  parseState(content: string): State;
  parseState(content: string | string[]): State;
  parseState(content: string | string[]): State {
    if (typeof content === "string") {
      content = content.split("\n");
    }

    const acc = content.reduce(
      (acc, line, lineNo) => {
        if (line.includes("#folded")) {
          line = line.replace("#folded", "").trimEnd();
          acc.folds.push(lineNo);
        }

        if (!acc.anchor) {
          const dashIndex = line.indexOf("|");
          if (dashIndex >= 0) {
            acc.anchor = {
              line: lineNo,
              ch: dashIndex,
            };
            line = line.substring(0, dashIndex) + line.substring(dashIndex + 1);
          }
        }

        if (!acc.head) {
          const dashIndex = line.indexOf("|");
          if (dashIndex >= 0) {
            acc.head = {
              line: lineNo,
              ch: dashIndex,
            };
            line = line.substring(0, dashIndex) + line.substring(dashIndex + 1);
          }
        }

        acc.lines.push(line);

        return acc;
      },
      {
        anchor: null as MyEditorPosition | null,
        head: null as MyEditorPosition | null,
        lines: [] as string[],
        folds: [] as number[],
      },
    );
    if (!acc.anchor) {
      acc.anchor = { line: 0, ch: 0 };
    }
    if (!acc.head) {
      acc.head = { ...acc.anchor };
    }

    return {
      folds: acc.folds,
      selections: [{ anchor: acc.anchor, head: acc.head }],
      value: acc.lines.join("\n"),
    };
  }
}
