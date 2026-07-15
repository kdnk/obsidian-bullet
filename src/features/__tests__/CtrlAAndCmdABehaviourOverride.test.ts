import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import { MyEditor } from "../../editor";
import { Operation } from "../../operations/Operation";
import { Root } from "../../root";
import { OperationPerformer } from "../../services/OperationPerformer";
import { CtrlAAndCmdABehaviourOverride } from "../CtrlAAndCmdABehaviourOverride";

type OperationResult = {
  shouldUpdate: boolean;
  shouldStopPropagation: boolean;
};

type FeatureWithRun = {
  run(editor: MyEditor): OperationResult;
};

jest.mock(
  "obsidian",
  () => ({
    editorInfoField: {},
  }),
  { virtual: true },
);

test("should keep select-all cycle anchored across separate keypresses", async () => {
  const settings = makeSettings();
  const editor = makeEditor({
    text: "- item 1\n- item 2\n    - item 2.1\n    - item 2.2\n- item 3\n",
    cursor: { line: 1, ch: 2 },
  });
  const root = makeRoot({ editor, settings });
  const perform = jest.fn(
    (
      createOperation: (root: Root) => Operation,
      _editor: MyEditor,
      cursor: ReturnType<MyEditor["getCursor"]>,
    ) => {
      const operation = createOperation(root);
      const outcome = operation.perform();
      return {
        ...outcome,
        cursor,
      };
    },
  );
  const operationPerformer: Pick<OperationPerformer, "perform"> = {
    perform,
  };
  const plugin = {
    registerEditorExtension: jest.fn(),
    addCommand: jest.fn(),
  };
  const imeDetector = { isOpened: () => false };
  const feature = new CtrlAAndCmdABehaviourOverride(
    plugin as unknown as ConstructorParameters<
      typeof CtrlAAndCmdABehaviourOverride
    >[0],
    settings,
    imeDetector as unknown as ConstructorParameters<
      typeof CtrlAAndCmdABehaviourOverride
    >[2],
    operationPerformer as OperationPerformer,
  );
  const featureWithRun = feature as unknown as FeatureWithRun;

  await feature.load();

  expect(featureWithRun.run(editor).shouldStopPropagation).toBe(true);
  expect(root.getSelection().anchor).toEqual({ line: 1, ch: 2 });
  expect(root.getSelection().head).toEqual({ line: 1, ch: 8 });

  expect(featureWithRun.run(editor).shouldStopPropagation).toBe(true);
  expect(root.getSelection().anchor).toEqual({ line: 1, ch: 2 });
  expect(root.getSelection().head).toEqual({ line: 3, ch: 14 });

  expect(featureWithRun.run(editor).shouldStopPropagation).toBe(true);
  expect(root.getSelection().anchor).toEqual({ line: 0, ch: 0 });
  expect(root.getSelection().head).toEqual({ line: 4, ch: 8 });

  expect(featureWithRun.run(editor).shouldStopPropagation).toBe(true);
  expect(root.getSelection().anchor).toEqual({ line: 1, ch: 2 });
  expect(root.getSelection().head).toEqual({ line: 1, ch: 8 });
  expect(perform.mock.calls[3][2]).toBeUndefined();
});
