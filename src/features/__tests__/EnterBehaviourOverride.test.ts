import { Plugin } from "obsidian";

import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import { NO_OP_OUTCOME } from "../../operations/Operation";
import { OperationPerformer } from "../../services/OperationPerformer";
import { EnterBehaviourOverride } from "../EnterBehaviourOverride";

jest.mock(
  "obsidian",
  () => ({
    Editor: class {},
    Plugin: class {},
    editorInfoField: {},
  }),
  { virtual: true },
);

describe("EnterBehaviourOverride", () => {
  test("should let Obsidian handle ordered lists when smart lists are disabled", () => {
    const editor = makeEditor({
      text: "9. item\n",
      cursor: { line: 0, ch: 7 },
    });
    const settings = makeSettings();
    const root = makeRoot({ editor, settings });
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
    const feature = new EnterBehaviourOverride(
      { registerEditorExtension: jest.fn() } as unknown as Plugin,
      { overrideEnterBehaviour: true } as ConstructorParameters<
        typeof EnterBehaviourOverride
      >[1],
      { isOpened: () => false } as ConstructorParameters<
        typeof EnterBehaviourOverride
      >[2],
      {
        getDefaultIndentChars: () => "  ",
        isSmartIndentListEnabled: () => false,
      } as ConstructorParameters<typeof EnterBehaviourOverride>[3],
      operationPerformer,
    );

    const result = (
      feature as unknown as {
        run: (currentEditor: typeof editor) => {
          shouldStopPropagation: boolean;
          shouldUpdate: boolean;
        };
      }
    ).run(editor);

    expect(result).toBe(NO_OP_OUTCOME);
    expect(changesApplicator.apply).not.toHaveBeenCalled();
  });
});
