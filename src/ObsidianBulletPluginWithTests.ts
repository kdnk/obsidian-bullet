import { App, MarkdownView, Vault } from "obsidian";

import ObsidianBulletPlugin from "./ObsidianBulletPlugin";
import { MyEditor, MyEditorPosition, MyEditorSelection } from "./editor";
import { EditorSelectionsBehaviourOverride } from "./features/EditorSelectionsBehaviourOverride";
import { KeepCursorWithinListContent } from "./operations/KeepCursorWithinListContent";
import { SettingsObject } from "./services/Settings";
import {
  getTestPlatformEnvironment,
  getTestPlatformWsUrl,
} from "./testPlatform";

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

interface GuideClickOptions {
  line: number;
  kind: "indent" | "outer";
  prefix?: string;
}

interface NativeListBulletAssertionOptions {
  line: number;
}

interface ParsedStateAccumulator {
  anchor: MyEditorPosition | null;
  head: MyEditorPosition | null;
  lines: string[];
  folds: number[];
}

type SettingCommand = {
  [K in keyof SettingsObject]: { k: K; v: SettingsObject[K] };
}[keyof SettingsObject];

interface TestCommandMap {
  applyState: State | string | string[];
  simulateKeydown: string;
  insertText: string;
  typeText: string;
  pasteText: string;
  executeCommandById: string;
  drag: { from: MyEditorPosition };
  move: { to: MyEditorPosition; offsetX: number; offsetY: number };
  drop: undefined;
  waitForIdle: undefined;
  adjustSelection: undefined;
  resetSettings: undefined;
  setSetting: SettingCommand;
  parseState: string | string[];
  getCurrentState: undefined;
  clickGuide: GuideClickOptions;
  assertNativeListBullet: NativeListBulletAssertionOptions;
}

type TestMessage = {
  [K in keyof TestCommandMap]: {
    id: string;
    type: K;
  } & (undefined extends TestCommandMap[K]
    ? { data?: TestCommandMap[K] }
    : { data: TestCommandMap[K] });
}[keyof TestCommandMap];

type TestCommandHandlers = {
  [K in keyof TestCommandMap]: (
    data: TestCommandMap[K],
  ) => State | void | Promise<State | void>;
};

type TestCommandDecoders = {
  [K in keyof TestCommandMap]: (data: unknown) => TestCommandMap[K];
};

type SettingCommandDecoders = {
  [K in keyof SettingsObject]: (
    value: unknown,
  ) => Extract<SettingCommand, { k: K }>;
};

const settingCommandDecoders = {
  styleLists: (value) => ({
    k: "styleLists",
    v: decodeBooleanSetting("styleLists", value),
  }),
  debug: (value) => ({
    k: "debug",
    v: decodeBooleanSetting("debug", value),
  }),
  stickCursor: (value) => ({
    k: "stickCursor",
    v: decodeStickCursorSetting(value),
  }),
  keepBodyTextInBullets: (value) => ({
    k: "keepBodyTextInBullets",
    v: decodeBooleanSetting("keepBodyTextInBullets", value),
  }),
  betterEnter: (value) => ({
    k: "betterEnter",
    v: decodeBooleanSetting("betterEnter", value),
  }),
  betterVimO: (value) => ({
    k: "betterVimO",
    v: decodeBooleanSetting("betterVimO", value),
  }),
  betterTab: (value) => ({
    k: "betterTab",
    v: decodeBooleanSetting("betterTab", value),
  }),
  selectAll: (value) => ({
    k: "selectAll",
    v: decodeBooleanSetting("selectAll", value),
  }),
  listLines: (value) => ({
    k: "listLines",
    v: decodeBooleanSetting("listLines", value),
  }),
  outerListLines: (value) => ({
    k: "outerListLines",
    v: decodeBooleanSetting("outerListLines", value),
  }),
  listLineAction: (value) => ({
    k: "listLineAction",
    v: decodeListLineActionSetting(value),
  }),
  mobileRightFoldControls: (value) => ({
    k: "mobileRightFoldControls",
    v: decodeBooleanSetting("mobileRightFoldControls", value),
  }),
  dnd: (value) => ({
    k: "dnd",
    v: decodeBooleanSetting("dnd", value),
  }),
} satisfies SettingCommandDecoders;

const testCommandDecoders: TestCommandDecoders = {
  applyState: (data) => decodeStateSource("applyState", data),
  simulateKeydown: (data) => decodeString("simulateKeydown", data),
  insertText: (data) => decodeString("insertText", data),
  typeText: (data) => decodeString("typeText", data),
  pasteText: (data) => decodeString("pasteText", data),
  executeCommandById: (data) => decodeString("executeCommandById", data),
  drag: (data) => {
    const record = decodeRecord("drag", data);
    return { from: decodeEditorPosition("drag", record.from) };
  },
  move: (data) => {
    const record = decodeRecord("move", data);
    return {
      to: decodeEditorPosition("move", record.to),
      offsetX: decodeFiniteNumber("move", record.offsetX),
      offsetY: decodeFiniteNumber("move", record.offsetY),
    };
  },
  drop: (data) => decodeUndefined("drop", data),
  waitForIdle: (data) => decodeUndefined("waitForIdle", data),
  adjustSelection: (data) => decodeUndefined("adjustSelection", data),
  resetSettings: (data) => decodeUndefined("resetSettings", data),
  setSetting: (data) => decodeSetting(data),
  parseState: (data) => decodeStateText("parseState", data),
  getCurrentState: (data) => decodeUndefined("getCurrentState", data),
  clickGuide: (data) => decodeGuideClickOptions(data),
  assertNativeListBullet: (data) => {
    const record = decodeRecord("assertNativeListBullet", data);
    return {
      line: decodeInteger("assertNativeListBullet", record.line),
    };
  },
} satisfies TestCommandDecoders;

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
  KeyZ: 90,
};

const RENDERER_TEST_CONNECT_DELAY_MS = 1_000;
const RENDERER_TEST_CONNECT_TIMEOUT_MS = 10_000;

function getRendererSocketErrorMessage(event: Event): string {
  const message = (event as Event & { message?: unknown }).message;
  return typeof message === "string" && message.length > 0
    ? message
    : "unknown error";
}

function closeRendererSocket(socket: WebSocket | undefined): void {
  if (
    socket &&
    socket.readyState !== WebSocket.CLOSING &&
    socket.readyState !== WebSocket.CLOSED
  ) {
    socket.close();
  }
}

export default class ObsidianBulletPluginWithTests extends ObsidianBulletPlugin {
  private editor!: MyEditor;
  private testConnectTimer: number | undefined;
  private rejectTestConnection: ((error: Error) => void) | undefined;
  private testSocket: WebSocket | undefined;
  private testSocketCleanup: (() => void) | undefined;
  private testPreparationToken: object | undefined;
  private testPlatformUnloaded = false;

  wait(time: number) {
    return new Promise((resolve) => window.setTimeout(resolve, time));
  }

  executeCommandById(id: string) {
    (this.app as AppWithCommands).commands.executeCommandById(id);
  }

  setSetting(setting: SettingCommand) {
    this.settings.setValue(setting.k, setting.v);
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
    const cursor = this.editor.getCursor();
    const shouldCloseWikiLink =
      text === "[" &&
      cursor.ch > 0 &&
      this.editor.getLine(cursor.line)[cursor.ch - 1] === "[";
    const nextCursor = advancePosition(cursor, text);

    this.editor.replaceRange(text, cursor, cursor);

    if (shouldCloseWikiLink) {
      this.editor.replaceRange("]]", nextCursor, nextCursor);
    }

    this.editor.setSelections([
      {
        anchor: nextCursor,
        head: nextCursor,
      },
    ]);
  }

  private dispatchText(text: string, userEvent: "input.type" | "input.paste") {
    const view = this.editor.getCodeMirrorView();
    const selection = view.state.selection.main;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: text },
      selection: { anchor: selection.from + text.length },
      userEvent,
    });
  }

  private typeText(text: string) {
    this.dispatchText(text, "input.type");
  }

  private pasteText(text: string) {
    this.dispatchText(text, "input.paste");
  }

  async onload() {
    await super.onload();

    this.testPlatformUnloaded = false;
    window.ObsidianBulletPlugin = this;

    if (getTestPlatformEnvironment(window).TEST_PLATFORM) {
      this.testConnectTimer = window.setTimeout(() => {
        this.testConnectTimer = undefined;
        void this.connect().catch((error) => {
          if (!this.testPlatformUnloaded) {
            console.error("Obsidian test renderer connection failed", error);
          }
        });
      }, RENDERER_TEST_CONNECT_DELAY_MS);
    }
  }

  onunload() {
    this.testPlatformUnloaded = true;
    this.testPreparationToken = undefined;
    if (this.testConnectTimer !== undefined) {
      window.clearTimeout(this.testConnectTimer);
      this.testConnectTimer = undefined;
    }
    this.rejectTestConnection?.(
      new Error("Obsidian test renderer connection cancelled by unload"),
    );
    this.rejectTestConnection = undefined;
    const socket = this.testSocket;
    this.testSocketCleanup?.();
    this.testSocketCleanup = undefined;
    this.testSocket = undefined;
    closeRendererSocket(socket);

    super.onunload();

    delete window.ObsidianBulletPlugin;
  }

  protected async prepareSettings() {
    await super.prepareSettings();

    if (getTestPlatformEnvironment(window).TEST_PLATFORM) {
      this.resetSettings();
    }
  }

  private async prepareForTests(preparationToken: object) {
    this.assertTestPreparationActive(preparationToken);
    const filePath = `test.md`;
    let file = this.app.vault
      .getMarkdownFiles()
      .find((f) => f.path === filePath);
    if (!file) {
      file = await this.app.vault.create(filePath, "");
      this.assertTestPreparationActive(preparationToken);
    }
    for (let i = 0; i < 10; i++) {
      await this.wait(1000);
      this.assertTestPreparationActive(preparationToken);
      await this.app.workspace.getLeaf(false).openFile(file);
      this.assertTestPreparationActive(preparationToken);
      break;
    }
    await this.wait(1000);
    this.assertTestPreparationActive(preparationToken);

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      throw new Error("No active markdown view found");
    }
    this.editor = new MyEditor(view.editor);
  }

  private assertTestPreparationActive(preparationToken: object): void {
    if (
      this.testPlatformUnloaded ||
      this.testPreparationToken !== preparationToken
    ) {
      throw new Error("Obsidian test renderer connection cancelled by unload");
    }
  }

  async connect() {
    if (this.testPlatformUnloaded) {
      throw new Error("Obsidian test renderer connection cancelled by unload");
    }

    const ws = new WebSocket(getTestPlatformWsUrl());
    this.testPreparationToken = undefined;
    this.testSocketCleanup?.();
    closeRendererSocket(this.testSocket);
    this.testSocket = ws;
    const preparationToken = {};
    this.testPreparationToken = preparationToken;

    let resolveOpen: (() => void) | undefined;
    let rejectLifecycle: ((error: Error) => void) | undefined;
    let lifecycleSettled = false;

    const open = new Promise<void>((resolve) => {
      resolveOpen = resolve;
    });
    const lifecycleFailure = new Promise<never>((_resolve, reject) => {
      rejectLifecycle = (error) => {
        if (lifecycleSettled) {
          return;
        }
        lifecycleSettled = true;
        reject(error);
      };
    });
    const cancelPreparation = () => {
      if (this.testPreparationToken === preparationToken) {
        this.testPreparationToken = undefined;
      }
    };
    const fail = (error: Error) => {
      cancelPreparation();
      rejectLifecycle?.(error);
    };
    const handleOpen = () => resolveOpen?.();
    const handleError = (event: Event) =>
      fail(
        new Error(
          `Obsidian test renderer connection error: ${getRendererSocketErrorMessage(event)}`,
        ),
      );
    const handleClose = () =>
      fail(new Error("Obsidian test renderer connection closed before ready"));
    const timeout = window.setTimeout(
      () => fail(new Error("Obsidian test renderer connection timed out")),
      RENDERER_TEST_CONNECT_TIMEOUT_MS,
    );
    this.rejectTestConnection = fail;

    ws.addEventListener("open", handleOpen);
    ws.addEventListener("error", handleError);
    ws.addEventListener("close", handleClose);
    if (ws.readyState === WebSocket.OPEN) {
      resolveOpen?.();
    }

    const prepareAndSignalReady = async () => {
      await open;
      if (this.testPlatformUnloaded || this.testSocket !== ws) {
        throw new Error(
          "Obsidian test renderer connection cancelled by unload",
        );
      }
      await this.prepareForTests(preparationToken);
      if (this.testPlatformUnloaded || this.testSocket !== ws) {
        throw new Error(
          "Obsidian test renderer connection cancelled by unload",
        );
      }
      if (ws.readyState !== WebSocket.OPEN) {
        throw new Error(
          "Obsidian test renderer connection closed before ready",
        );
      }
      try {
        ws.send("ready");
      } catch (error) {
        const rendererError = new Error(
          `Obsidian test renderer send error: ${error instanceof Error ? error.message : String(error)}`,
        );
        (rendererError as Error & { cause: unknown }).cause = error;
        throw rendererError;
      }
    };

    try {
      await Promise.race([prepareAndSignalReady(), lifecycleFailure]);
      lifecycleSettled = true;
      cancelPreparation();
    } catch (error) {
      cancelPreparation();
      if (this.testSocket === ws) {
        this.testSocket = undefined;
      }
      closeRendererSocket(ws);
      throw error;
    } finally {
      window.clearTimeout(timeout);
      if (this.rejectTestConnection === fail) {
        this.rejectTestConnection = undefined;
      }
      ws.removeEventListener("open", handleOpen);
      ws.removeEventListener("error", handleError);
      ws.removeEventListener("close", handleClose);
    }

    const handleMessage = (event: MessageEvent) => {
      void this.handleTestMessage(ws, event).catch((error) => {
        if (!this.testPlatformUnloaded && this.testSocket === ws) {
          console.error("Obsidian test renderer message failed", error);
        }
      });
    };
    const releaseSocket = () => {
      if (this.testSocket === ws) {
        this.testSocket = undefined;
        this.testSocketCleanup = undefined;
      }
      ws.removeEventListener("message", handleMessage);
      ws.removeEventListener("error", handleRuntimeError);
      ws.removeEventListener("close", handleRuntimeClose);
    };
    const handleRuntimeError = () => {
      releaseSocket();
      closeRendererSocket(ws);
    };
    const handleRuntimeClose = () => releaseSocket();
    this.testSocketCleanup = releaseSocket;
    ws.addEventListener("message", handleMessage);
    ws.addEventListener("error", handleRuntimeError);
    ws.addEventListener("close", handleRuntimeClose);
  }

  private async handleTestMessage(ws: WebSocket, event: MessageEvent) {
    const message = JSON.parse(String(event.data)) as TestMessage;
    const { id, type, data } = message;

    let result: State | undefined;
    let error: string | undefined;

    try {
      result = await this.handleTestCommand(type, data);
    } catch (e) {
      error = e instanceof Error ? e.stack || e.message : JSON.stringify(e);
    }

    if (this.testSocket === ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ id, data: result, error }));
    }
  }

  private async handleTestCommand(
    type: string,
    data: unknown,
  ): Promise<State | undefined> {
    const handlers = {
      applyState: async (state) => await this.applyState(state),
      simulateKeydown: (keys) => this.simulateKeydown(keys),
      insertText: (text) => this.insertText(text),
      typeText: (text) => this.typeText(text),
      pasteText: (text) => this.pasteText(text),
      executeCommandById: (id) => this.executeCommandById(id),
      drag: (options) => this.drag(options),
      move: (options) => this.move(options),
      drop: () => this.drop(),
      waitForIdle: async () => await this.waitForIdle(),
      adjustSelection: async () => await this.adjustSelection(),
      resetSettings: () => this.resetSettings(),
      setSetting: (setting) => this.setSetting(setting),
      parseState: (state) => this.parseState(state),
      getCurrentState: () => this.getCurrentState(),
      clickGuide: async (options) => await this.clickGuide(options),
      assertNativeListBullet: (options) => this.assertNativeListBullet(options),
    } satisfies TestCommandHandlers;

    if (!isTestCommand(type)) {
      throw new Error(`Unknown test command: ${type}`);
    }

    return await invokeTestCommand(handlers, type, data);
  }

  private assertNativeListBullet(
    options: NativeListBulletAssertionOptions,
  ): void {
    const lineCount = this.editor.getValue().split("\n").length;
    if (options.line < 0 || options.line >= lineCount) {
      throw new Error(
        `Unable to assert native list bullet on line ${options.line}: line must be between 0 and ${lineCount - 1}`,
      );
    }

    const lineElement = this.resolveRenderedLine(options.line);
    if (!lineElement) {
      throw new Error(
        `Unable to assert native list bullet on line ${options.line}: the rendered line is missing`,
      );
    }

    const visibleNativeBullet = Array.from(
      lineElement.querySelectorAll(".list-bullet"),
    ).find(isElementVisible);
    if (!visibleNativeBullet) {
      throw new Error(
        `Unable to assert native list bullet on line ${options.line}: found 0 visible native .list-bullet elements`,
      );
    }

    const rawMarker = Array.from(
      lineElement.querySelectorAll(".cm-formatting-list"),
    ).find(isVisibleRawListMarker);
    if (rawMarker) {
      throw new Error(
        `Unable to assert native list bullet on line ${options.line}: found a visible raw formatting marker`,
      );
    }
  }

  async clickGuide(options: GuideClickOptions): Promise<void> {
    const lineCount = this.editor.getValue().split("\n").length;
    if (
      !Number.isInteger(options.line) ||
      options.line < 0 ||
      options.line >= lineCount
    ) {
      throw new Error(
        `Unable to click ${options.kind} guide on line ${options.line}: line must be between 0 and ${lineCount - 1}`,
      );
    }
    if (options.kind === "indent" && typeof options.prefix !== "string") {
      throw new Error(
        `Unable to click indent guide on line ${options.line}: prefix is required`,
      );
    }

    const lineElement = this.resolveRenderedLine(options.line);
    if (!lineElement) {
      throw new Error(
        `Unable to click ${options.kind} guide on line ${options.line}: found 0 guide candidates because the rendered line is missing`,
      );
    }

    let target: Element | undefined;
    if (options.kind === "indent") {
      const candidates = Array.from(
        lineElement.querySelectorAll(".cm-indent"),
      ).filter((guide) => guide.parentElement?.matches(".cm-hmd-list-indent"));
      target = candidates.find(
        (guide) => getGuideIndentPrefix(guide) === options.prefix,
      );
      if (!target) {
        throw new Error(
          `Unable to click indent guide on line ${options.line} with prefix ${JSON.stringify(options.prefix)}: found ${candidates.length} indent guide candidates`,
        );
      }
    } else {
      const candidates = Array.from(
        lineElement.querySelectorAll(".bullet-plugin-outer-list-guide"),
      );
      target = candidates[0];
      if (!target) {
        throw new Error(
          `Unable to click outer guide on line ${options.line}: found ${candidates.length} outer guide candidates`,
        );
      }
    }

    for (const type of ["mousedown", "mouseup", "click"]) {
      target.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true }),
      );
    }

    await this.waitForIdle();
  }

  private resolveRenderedLine(line: number): Element | null {
    const view = this.editor.getCodeMirrorView();
    const offset = this.editor.posToOffset({ line, ch: 0 });
    const { node } = view.domAtPos(offset);
    let lineElement =
      node.nodeType === 1 ? (node as Element) : node.parentElement;
    while (lineElement && !lineElement.matches(".cm-line")) {
      lineElement = lineElement.parentElement;
    }
    return lineElement;
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
    const originalSelections = this.editor.listSelections();
    let targetSelections: MyEditorSelection[] | null = null;

    if (shouldAdjustCursor) {
      const root = this.parser.parse(this.editor);

      if (root) {
        const op = new KeepCursorWithinListContent(root);
        this.operationPerformer.execute(root, op, this.editor);

        targetSelections = root.getSelections();
      } else {
        this.editor.dispatchCurrentSingleSelectionTransaction();
      }

      targetSelections = this.ensureCursorWithinListPrefix(
        stickCursor,
        targetSelections,
        originalSelections,
      );
    } else {
      this.editor.dispatchCurrentSingleSelectionTransaction();
    }

    if (targetSelections) {
      this.beginSuppressingSelectionAdjustments();
      try {
        await this.forceSelectionsToApply(targetSelections);
      } finally {
        this.endSuppressingSelectionAdjustments();
      }
    }

    await this.waitForSelectionAdjustmentsToSettle();
  }

  private ensureCursorWithinListPrefix(
    stickCursor: SettingsObject["stickCursor"],
    targetSelections: MyEditorSelection[] | null,
    originalSelections = this.editor.listSelections(),
  ): MyEditorSelection[] | null {
    const selections = targetSelections || originalSelections;

    if (selections.length !== 1 || originalSelections.length !== 1) {
      return targetSelections;
    }

    const selection = selections[0];
    const originalSelection = originalSelections[0];
    if (
      !selection ||
      !originalSelection ||
      selection.anchor.line !== selection.head.line ||
      selection.anchor.ch !== selection.head.ch ||
      originalSelection.anchor.line !== originalSelection.head.line ||
      originalSelection.anchor.ch !== originalSelection.head.ch
    ) {
      return targetSelections;
    }

    const cursor = originalSelection.head;
    const line = this.editor.getLine(cursor.line);
    const matches = /^([ \t]*)([-*+]|\d+\.)( |\t)(\[[^[\]]\][ \t])?/.exec(line);

    if (!matches) {
      return targetSelections;
    }

    const [, indent, bullet, spaceAfterBullet, checkbox = ""] = matches;
    const shouldSkipCheckbox = stickCursor !== "bullet-only";
    const contentStart =
      indent.length +
      bullet.length +
      spaceAfterBullet.length +
      (shouldSkipCheckbox ? checkbox.length : 0);

    if (cursor.ch >= contentStart) {
      return targetSelections;
    }

    const nextCursor = { line: cursor.line, ch: contentStart };
    return [{ anchor: nextCursor, head: nextCursor }];
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
    const lines = typeof content === "string" ? content.split("\n") : content;

    const acc = lines.reduce<ParsedStateAccumulator>(
      (acc, line, lineNo) => {
        if (line.includes("#folded")) {
          line = line.replace("#folded", "").replace(/\s+$/, "");
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
        anchor: null,
        head: null,
        lines: [],
        folds: [],
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

function advancePosition(
  position: MyEditorPosition,
  insertedText: string,
): MyEditorPosition {
  const lines = insertedText.split("\n");
  if (lines.length === 1) {
    return {
      line: position.line,
      ch: position.ch + insertedText.length,
    };
  }

  return {
    line: position.line + lines.length - 1,
    ch: lines[lines.length - 1].length,
  };
}

function getGuideIndentPrefix(guide: Element): string | null {
  const indentContainer = guide.parentElement;
  if (!indentContainer?.matches(".cm-hmd-list-indent")) {
    return null;
  }

  let prefix = "";
  for (const child of Array.from(indentContainer.childNodes)) {
    if (child === guide) {
      return prefix;
    }
    prefix += child.textContent ?? "";
  }

  return null;
}

function isVisibleRawListMarker(marker: Element): boolean {
  if (
    marker.querySelector(".list-bullet") ||
    (marker.textContent ?? "").trim().length === 0
  ) {
    return false;
  }

  return isElementVisible(marker);
}

function isElementVisible(element: Element): boolean {
  if (element.getClientRects().length === 0) {
    return false;
  }

  const window = element.ownerDocument?.defaultView;
  if (!window) {
    return false;
  }
  const style = window.getComputedStyle(element);
  const opacity = Number.parseFloat(style.opacity);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.visibility !== "collapse" &&
    (!Number.isFinite(opacity) || opacity > 0)
  );
}

async function invokeTestCommand<K extends keyof TestCommandMap>(
  handlers: TestCommandHandlers,
  type: K,
  data: unknown,
): Promise<State | undefined> {
  return (await handlers[type](testCommandDecoders[type](data))) as
    | State
    | undefined;
}

function isTestCommand(type: string): type is keyof TestCommandMap {
  return Object.prototype.hasOwnProperty.call(testCommandDecoders, type);
}

function decodeStateSource(
  type: "applyState",
  data: unknown,
): State | string | string[] {
  if (typeof data === "string" || isStringArray(data)) {
    return data;
  }
  if (isState(data)) {
    return data;
  }
  return invalidCommandData(type, "expected an editor state or state text");
}

function decodeStateText(type: "parseState", data: unknown): string | string[] {
  if (typeof data === "string" || isStringArray(data)) {
    return data;
  }
  return invalidCommandData(type, "expected a string or string array");
}

function isState(data: unknown): data is State {
  if (!isRecord(data) || typeof data.value !== "string") {
    return false;
  }
  if (
    !Array.isArray(data.folds) ||
    !data.folds.every((line) => Number.isInteger(line))
  ) {
    return false;
  }
  return (
    Array.isArray(data.selections) &&
    data.selections.every(
      (selection) =>
        isRecord(selection) &&
        isEditorPosition(selection.anchor) &&
        isEditorPosition(selection.head),
    )
  );
}

function decodeGuideClickOptions(data: unknown): GuideClickOptions {
  const type = "clickGuide";
  const record = decodeRecord(type, data);
  const line = decodeInteger(type, record.line);
  if (record.kind !== "indent" && record.kind !== "outer") {
    return invalidCommandData(type, 'kind must be "indent" or "outer"');
  }
  if (record.kind === "indent") {
    return {
      line,
      kind: record.kind,
      prefix: decodeString(type, record.prefix),
    };
  }
  if (record.prefix !== undefined && typeof record.prefix !== "string") {
    return invalidCommandData(type, "prefix must be a string when provided");
  }
  return { line, kind: record.kind, prefix: record.prefix };
}

function decodeSetting(data: unknown): TestCommandMap["setSetting"] {
  const type = "setSetting";
  const record = decodeRecord(type, data);
  const { k, v } = record;
  if (typeof k !== "string" || !isSettingKey(k)) {
    return invalidCommandData(type, "k must be a known setting key");
  }
  return settingCommandDecoders[k](v);
}

function isSettingKey(key: string): key is keyof SettingsObject {
  return Object.prototype.hasOwnProperty.call(settingCommandDecoders, key);
}

function decodeBooleanSetting(
  key: keyof SettingsObject,
  data: unknown,
): boolean {
  if (typeof data !== "boolean") {
    return invalidCommandData("setSetting", `${key} must be a boolean`);
  }
  return data;
}

function decodeStickCursorSetting(
  data: unknown,
): SettingsObject["stickCursor"] {
  if (
    typeof data !== "boolean" &&
    data !== "never" &&
    data !== "bullet-only" &&
    data !== "bullet-and-checkbox"
  ) {
    return invalidCommandData("setSetting", "stickCursor has an invalid value");
  }
  return data;
}

function decodeListLineActionSetting(
  data: unknown,
): SettingsObject["listLineAction"] {
  if (data !== "none" && data !== "toggle-folding") {
    return invalidCommandData(
      "setSetting",
      "listLineAction has an invalid value",
    );
  }
  return data;
}

function decodeEditorPosition(
  type: "drag" | "move",
  data: unknown,
): MyEditorPosition {
  const record = decodeRecord(type, data);
  return {
    line: decodeInteger(type, record.line),
    ch: decodeInteger(type, record.ch),
  };
}

function isEditorPosition(data: unknown): data is MyEditorPosition {
  return (
    isRecord(data) && Number.isInteger(data.line) && Number.isInteger(data.ch)
  );
}

function decodeRecord(
  type: keyof TestCommandMap,
  data: unknown,
): Record<string, unknown> {
  if (!isRecord(data)) {
    return invalidCommandData(type, "expected an object");
  }
  return data;
}

function isRecord(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}

function decodeString<T extends keyof TestCommandMap>(
  type: T,
  data: unknown,
): string {
  if (typeof data !== "string") {
    return invalidCommandData(type, "expected a string");
  }
  return data;
}

function isStringArray(data: unknown): data is string[] {
  return (
    Array.isArray(data) && data.every((value) => typeof value === "string")
  );
}

function decodeFiniteNumber(type: keyof TestCommandMap, data: unknown): number {
  if (typeof data !== "number" || !Number.isFinite(data)) {
    return invalidCommandData(type, "expected a finite number");
  }
  return data;
}

function decodeInteger(type: keyof TestCommandMap, data: unknown): number {
  if (!Number.isInteger(data)) {
    return invalidCommandData(type, "expected an integer");
  }
  return data as number;
}

function decodeUndefined(type: keyof TestCommandMap, data: unknown): undefined {
  if (data !== undefined) {
    return invalidCommandData(type, "expected no data");
  }
  return undefined;
}

function invalidCommandData(type: keyof TestCommandMap, detail: string): never {
  throw new Error(`Invalid data for test command: ${type} (${detail})`);
}
