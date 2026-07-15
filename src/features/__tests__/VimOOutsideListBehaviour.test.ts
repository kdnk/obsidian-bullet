import { insertPlainLine } from "src/utils/insertPlainLine";

import { NO_OP_OUTCOME } from "../../operations/Operation";
import { VimOBehaviourOverride } from "../VimOBehaviourOverride";

jest.mock(
  "obsidian",
  () => ({
    MarkdownView: class MarkdownView {},
    Notice: class Notice {},
    Plugin: class Plugin {},
  }),
  { virtual: true },
);

jest.mock(
  "src/editor",
  () => ({
    MyEditor: class MyEditor {
      public editor: unknown;

      constructor(editor: unknown) {
        this.editor = editor;
      }
    },
  }),
  { virtual: true },
);

jest.mock(
  "src/operations/CreateNewItem",
  () => ({
    CreateNewItem: class CreateNewItem {},
  }),
  { virtual: true },
);

jest.mock(
  "src/services/ObsidianSettings",
  () => ({
    ObsidianSettings: class ObsidianSettings {},
  }),
  { virtual: true },
);

jest.mock(
  "src/services/OperationPerformer",
  () => ({
    OperationPerformer: class OperationPerformer {},
  }),
  { virtual: true },
);

jest.mock(
  "src/services/Settings",
  () => ({
    Settings: class Settings {},
  }),
  { virtual: true },
);

jest.mock(
  "src/utils/insertPlainLine",
  () => ({
    insertPlainLine: jest.fn(),
  }),
  { virtual: true },
);

interface VimActionArgs {
  after: boolean;
}

type VimAction = (cm: unknown, args: VimActionArgs) => void;

interface FakeVim {
  defineAction: jest.Mock<void, [string, VimAction]>;
  enterInsertMode: jest.Mock<void, [unknown]>;
  handleEx: jest.Mock<void, [unknown, string]>;
  mapCommand: jest.Mock<void, unknown[]>;
}

type WindowWithVim = Window &
  typeof globalThis & {
    CodeMirrorAdapter: {
      Vim: FakeVim;
    };
  };

describe("VimOBehaviourOverride outside lists", () => {
  const insertPlainLineMock = insertPlainLine as jest.MockedFunction<
    typeof insertPlainLine
  >;

  const originalWindow = global.window;

  beforeEach(() => {
    global.window = {
      CodeMirrorAdapter: {
        Vim: {
          defineAction: jest.fn(),
          enterInsertMode: jest.fn(),
          handleEx: jest.fn(),
          mapCommand: jest.fn(),
        },
      },
    } as WindowWithVim;
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  test.each([
    ["o", true],
    ["O", false],
  ])(
    "should insert a plain line for Vim %s when the cursor is outside any list",
    async (_key, after) => {
      const plugin = {
        app: {
          workspace: {
            getActiveViewOfType: jest.fn().mockReturnValue({
              editor: {},
            }),
          },
        },
      } as never;
      const settings = {
        onChange: jest.fn(),
        overrideVimOBehaviour: true,
      } as never;
      const operationPerformer = {
        perform: jest.fn().mockReturnValue(NO_OP_OUTCOME),
      };
      const feature = new VimOBehaviourOverride(
        plugin,
        settings,
        {} as never,
        operationPerformer as never,
      );

      await feature.load();

      const vim = (global.window as WindowWithVim).CodeMirrorAdapter.Vim;
      const action = vim.defineAction.mock.calls.find(
        ([name]) => name === "insertLineAfterBullet",
      )?.[1];

      if (!action) {
        throw new Error("Expected Vim action to be registered");
      }

      const cm = {};
      action(cm, { after });

      expect(vim.handleEx).toHaveBeenCalledWith(cm, "normal! A");
      expect(operationPerformer.perform).toHaveBeenCalledTimes(1);
      expect(insertPlainLineMock).toHaveBeenCalledTimes(1);
      expect(insertPlainLineMock.mock.calls[0]?.[1]).toBe(after);
      expect(vim.enterInsertMode).toHaveBeenCalledWith(cm);
    },
  );
});
