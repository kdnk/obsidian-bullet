import { MyEditor } from "./editor";
import { Root } from "./root";
import { LogSink, Logger } from "./services/Logger";
import { Parser } from "./services/Parser";
import { Settings } from "./services/Settings";

export interface EditorMockParams {
  text: string;
  cursor: { line: number; ch: number };
  getAllFoldedLines?: () => number[];
}

export function makeEditor(params: EditorMockParams): MyEditor {
  const text = params.text;
  const cursor = { ...params.cursor };

  const editor = {
    getCursor: () => cursor,
    listSelections: () => [{ anchor: cursor, head: cursor }],
    getLine: (l: number) => text.split("\n")[l],
    lastLine: () => text.split("\n").length - 1,
    lineCount: () => text.split("\n").length,
    getAllFoldedLines: params.getAllFoldedLines || (() => []),
  } as unknown as MyEditor;

  return editor;
}

export function makeLogger(sink: LogSink = () => undefined): Logger {
  return new Logger(makeSettings(), sink);
}

export function makeSettings(): Settings {
  const settings = {
    debug: true,
    stickCursor: "bullet-and-checkbox",
    keepCursorWithinContent: "bullet-and-checkbox",
  } as unknown as Settings;
  return settings;
}

export function makeRoot(options: {
  editor: MyEditor;
  settings?: Settings;
  logger?: Logger;
}): Root {
  const { logger, editor, settings } = {
    logger: makeLogger(),
    settings: makeSettings(),
    ...options,
  };

  const root = new Parser(logger, settings).parse(editor);
  if (!root) {
    throw new Error("Unable to parse test root");
  }
  return root;
}
