import { Editor, Plugin } from "obsidian";

import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import { NO_OP_OUTCOME, Operation } from "../../operations/Operation";
import { Root } from "../../root";
import { OperationPerformer } from "../../services/OperationPerformer";
import { ShiftTabBehaviourOverride } from "../ShiftTabBehaviourOverride";
import { TabBehaviourOverride } from "../TabBehaviourOverride";

jest.mock(
  "obsidian",
  () => ({
    Editor: class {
      cm = {};
      execCalls: string[] = [];
      exec(command: string) {
        this.execCalls.push(command);
      }
    },
    Plugin: class {},
    editorInfoField: {},
  }),
  { virtual: true },
);

type MockEditor = Editor & {
  cm: Record<string, never>;
  execCalls: string[];
  getCursor: () => { line: number; ch: number };
  getLine: (line: number) => string;
  lastLine: () => number;
  listSelections: () => Array<{
    anchor: { line: number; ch: number };
    head: { line: number; ch: number };
  }>;
  getAllFoldedLines: () => number[];
};

function makeRawEditor(
  text: string,
  cursor: { line: number; ch: number },
): MockEditor {
  const lines = text.split("\n");
  const editor = Object.create(Editor.prototype) as MockEditor;
  editor.cm = {};
  editor.execCalls = [];

  editor.getCursor = () => cursor;
  editor.getLine = (line: number) => lines[line];
  editor.lastLine = () => lines.length - 1;
  editor.listSelections = () => [{ anchor: cursor, head: cursor }];
  editor.getAllFoldedLines = () => [];

  return editor;
}

describe("TabBehaviourOverride", () => {
  const registerEditorExtension = jest.fn();
  const plugin = {
    registerEditorExtension,
  } as unknown as Plugin;
  const settings = {
    overrideTabBehaviour: true,
  } as ConstructorParameters<typeof TabBehaviourOverride>[3];
  const imeDetector = {
    isOpened: () => false,
  } as ConstructorParameters<typeof TabBehaviourOverride>[1];
  const obsidianSettings = {
    getDefaultIndentChars: () => "  ",
    isSmartIndentListEnabled: () => true,
  } as ConstructorParameters<typeof TabBehaviourOverride>[2];

  beforeEach(() => {
    registerEditorExtension.mockReset();
  });

  test("should handle editor indentMore commands from toolbar actions", async () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- one\n- two",
        cursor: { line: 1, ch: 5 },
      }),
      settings: makeSettings(),
    });
    const changesApplicator = {
      apply: jest.fn(),
    };
    const operationPerformer = new OperationPerformer(
      {
        parse: jest.fn().mockReturnValue(root),
      } as unknown as ConstructorParameters<typeof OperationPerformer>[0],
      changesApplicator as unknown as ConstructorParameters<
        typeof OperationPerformer
      >[1],
    );
    const feature = new TabBehaviourOverride(
      plugin,
      imeDetector,
      obsidianSettings,
      settings,
      operationPerformer,
    );
    const editor = makeRawEditor("- one\n- two", { line: 1, ch: 5 });

    await feature.load();
    editor.exec("indentMore");

    expect(changesApplicator.apply).toHaveBeenCalled();
    expect(editor.execCalls).toEqual([]);
    await feature.unload();
  });

  test("should handle editor indentLess commands from toolbar actions", async () => {
    const root = makeRoot({
      editor: makeEditor({
        text: "- one\n  - two",
        cursor: { line: 1, ch: 7 },
      }),
      settings: makeSettings(),
    });
    const changesApplicator = {
      apply: jest.fn(),
    };
    const operationPerformer = new OperationPerformer(
      {
        parse: jest.fn().mockReturnValue(root),
      } as unknown as ConstructorParameters<typeof OperationPerformer>[0],
      changesApplicator as unknown as ConstructorParameters<
        typeof OperationPerformer
      >[1],
    );
    const feature = new TabBehaviourOverride(
      plugin,
      imeDetector,
      obsidianSettings,
      settings,
      operationPerformer,
    );
    const editor = makeRawEditor("- one\n  - two", {
      line: 1,
      ch: 7,
    });

    await feature.load();
    editor.exec("indentLess");

    expect(changesApplicator.apply).toHaveBeenCalled();
    expect(editor.execCalls).toEqual([]);
    await feature.unload();
  });

  test("should return no-op through a null factory for unsupported ordered lists", () => {
    const editor = makeEditor({
      text: "1. one\n2. two",
      cursor: { line: 1, ch: 6 },
    });
    const root = makeRoot({
      editor,
      settings: makeSettings(),
    });
    const perform = jest.fn(
      (createOperation: (root: Root) => Operation | null) => {
        expect(createOperation(root)).toBeNull();
        return NO_OP_OUTCOME;
      },
    );
    const feature = new TabBehaviourOverride(
      plugin,
      imeDetector,
      {
        getDefaultIndentChars: () => "  ",
        isSmartIndentListEnabled: () => false,
      } as ConstructorParameters<typeof TabBehaviourOverride>[2],
      settings,
      { perform } as unknown as OperationPerformer,
    );

    const result = (
      feature as unknown as {
        run: (editor: ReturnType<typeof makeEditor>) => typeof NO_OP_OUTCOME;
      }
    ).run(editor);

    expect(result).toBe(NO_OP_OUTCOME);
    expect(perform).toHaveBeenCalledTimes(1);
  });
});

describe("ShiftTabBehaviourOverride", () => {
  test("should return no-op through a null factory for unsupported ordered lists", () => {
    const editor = makeEditor({
      text: "1. one\n  1. child",
      cursor: { line: 1, ch: 10 },
    });
    const root = makeRoot({
      editor,
      settings: makeSettings(),
    });
    const perform = jest.fn(
      (createOperation: (root: Root) => Operation | null) => {
        expect(createOperation(root)).toBeNull();
        return NO_OP_OUTCOME;
      },
    );
    const feature = new ShiftTabBehaviourOverride(
      {} as Plugin,
      { isOpened: () => false } as ConstructorParameters<
        typeof ShiftTabBehaviourOverride
      >[1],
      {
        isSmartIndentListEnabled: () => false,
      } as ConstructorParameters<typeof ShiftTabBehaviourOverride>[2],
      { overrideTabBehaviour: true } as ConstructorParameters<
        typeof ShiftTabBehaviourOverride
      >[3],
      { perform } as unknown as OperationPerformer,
    );

    const result = (
      feature as unknown as {
        run: (editor: ReturnType<typeof makeEditor>) => typeof NO_OP_OUTCOME;
      }
    ).run(editor);

    expect(result).toBe(NO_OP_OUTCOME);
    expect(perform).toHaveBeenCalledTimes(1);
  });
});
