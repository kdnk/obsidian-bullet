import { Notice } from "obsidian";

import type { Settings } from "src/services/Settings";
import { insertPlainLine } from "src/utils/insertPlainLine";

import { NO_OP_OUTCOME } from "../../operations/Operation";
import { VimOBehaviourOverride } from "../VimOBehaviourOverride";

jest.mock(
  "obsidian",
  () => ({
    MarkdownView: class MarkdownView {},
    Notice: jest.fn(),
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

const createSettings = (overrideVimOBehaviour: boolean) => ({
  onChange: jest.fn<void, Parameters<Settings["onChange"]>>(),
  overrideVimOBehaviour,
  removeCallback: jest.fn<void, Parameters<Settings["removeCallback"]>>(),
});

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
      };
      const operationPerformer = {
        perform: jest.fn().mockReturnValue(NO_OP_OUTCOME),
      };
      const feature = new VimOBehaviourOverride(
        plugin,
        settings as never,
        {} as never,
        operationPerformer as never,
      );

      await feature.load();

      expect(settings.onChange).toHaveBeenCalledWith(
        ["betterVimO"],
        expect.any(Function),
      );
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

  test("unload removes the registered settings callback after Vim mappings are initialized", async () => {
    const settings = createSettings(true);
    const feature = new VimOBehaviourOverride(
      {} as never,
      settings as never,
      {} as never,
      {} as never,
    );

    await feature.load();
    const settingsCallback = settings.onChange.mock.calls[0]?.[1];
    await feature.unload();

    expect(settingsCallback).toEqual(expect.any(Function));
    expect(settings.removeCallback).toHaveBeenCalledTimes(1);
    expect(settings.removeCallback).toHaveBeenCalledWith(settingsCallback);
    expect(Notice).toHaveBeenCalledTimes(1);
  });

  test("unload removes the registered settings callback when the setting stays disabled", async () => {
    const settings = createSettings(false);
    const feature = new VimOBehaviourOverride(
      {} as never,
      settings as never,
      {} as never,
      {} as never,
    );

    await feature.load();
    const settingsCallback = settings.onChange.mock.calls[0]?.[1];
    await feature.unload();

    expect(settingsCallback).toEqual(expect.any(Function));
    expect(settings.removeCallback).toHaveBeenCalledTimes(1);
    expect(settings.removeCallback).toHaveBeenCalledWith(settingsCallback);
    expect(Notice).not.toHaveBeenCalled();
  });

  test("unload removes the registered settings callback when the Vim adapter is unavailable", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    global.window = {} as Window & typeof globalThis;
    const settings = createSettings(true);
    const feature = new VimOBehaviourOverride(
      {} as never,
      settings as never,
      {} as never,
      {} as never,
    );

    await feature.load();
    const settingsCallback = settings.onChange.mock.calls[0]?.[1];
    await feature.unload();

    expect(settingsCallback).toEqual(expect.any(Function));
    expect(settings.removeCallback).toHaveBeenCalledTimes(1);
    expect(settings.removeCallback).toHaveBeenCalledWith(settingsCallback);
    expect(Notice).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
