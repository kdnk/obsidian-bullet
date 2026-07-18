import type { SettingsObject } from "../src/services/Settings";

type SettingCommand = {
  [K in keyof SettingsObject]: { k: K; v: SettingsObject[K] };
}[keyof SettingsObject];

export type DeclaredSemanticDriverCommandName =
  | "adjustSelection"
  | "applyState"
  | "assertNativeListBullet"
  | "clickGuide"
  | "drag"
  | "drop"
  | "executeCommandById"
  | "getCurrentState"
  | "insertText"
  | "move"
  | "parseState"
  | "pasteText"
  | "resetSettings"
  | "setSetting"
  | "simulateKeydown"
  | "typeText"
  | "waitForIdle";

declare global {
  namespace jest {
    interface Matchers<R> {
      toEqualEditorState(s: string): Promise<R>;
      toEqualEditorState(s: string[]): Promise<R>;
    }
  }

  interface StatePosition {
    line: number;
    ch: number;
  }

  interface StateSelection {
    anchor: StatePosition;
    head: StatePosition;
  }

  interface State {
    folds: number[];
    selections: StateSelection[];
    value: string;
  }

  function applyState(state: string): Promise<void>;
  function applyState(state: string[]): Promise<void>;
  function parseState(state: string): Promise<State>;
  function parseState(state: string[]): Promise<State>;
  function simulateKeydown(keys: string): Promise<void>;
  function insertText(text: string): Promise<void>;
  function typeText(text: string): Promise<void>;
  function pasteText(text: string): Promise<void>;
  function executeCommandById(keys: string): Promise<void>;
  function setSetting(opts: SettingCommand): Promise<void>;
  function resetSettings(): Promise<void>;
  function waitForIdle(): Promise<void>;
  function adjustSelection(): Promise<void>;
  function getCurrentState(): Promise<State>;
  function drag(opts: { from: { line: number; ch: number } }): Promise<void>;
  function move(opts: {
    to: { line: number; ch: number };
    offsetX: number;
    offsetY: number;
  }): Promise<void>;
  function drop(): Promise<void>;
  function clickGuide(options: {
    line: number;
    kind: "indent" | "outer";
    prefix?: string;
  }): Promise<void>;
  function assertNativeListBullet(options: { line: number }): Promise<void>;
}

export {};
