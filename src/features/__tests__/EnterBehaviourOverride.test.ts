import { Plugin } from "obsidian";

import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import { CreateNewItem } from "../../operations/CreateNewItem";
import { CreateNewRootItemAfterEmpty } from "../../operations/CreateNewRootItemAfterEmpty";
import { InsertNewLineWithoutBullet } from "../../operations/InsertNewLineWithoutBullet";
import { NO_OP_OUTCOME, Operation } from "../../operations/Operation";
import { OutdentListIfItsEmpty } from "../../operations/OutdentListIfItsEmpty";
import { Root } from "../../root";
import { OperationPerformer } from "../../services/OperationPerformer";
import { Settings } from "../../services/Settings";
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

type EnterSettings = Pick<
  Settings,
  "overrideEnterBehaviour" | "keepBodyTextInBullets"
>;

interface FeatureDependencies {
  imeOpened?: boolean;
  operationPerformer?: OperationPerformer;
  smartIndentListEnabled?: boolean;
}

function makeFeature(
  settingsOverrides: Partial<EnterSettings> = {},
  dependencies: FeatureDependencies = {},
) {
  const settings = Object.assign(makeSettings(), {
    overrideEnterBehaviour: true,
    keepBodyTextInBullets: false,
    ...settingsOverrides,
  });

  return new EnterBehaviourOverride(
    {
      addCommand: jest.fn(),
      registerEditorExtension: jest.fn(),
    } as unknown as Plugin,
    settings,
    {
      isOpened: () => dependencies.imeOpened ?? false,
    } as ConstructorParameters<typeof EnterBehaviourOverride>[2],
    {
      getDefaultIndentChars: () => "  ",
      isSmartIndentListEnabled: () =>
        dependencies.smartIndentListEnabled ?? true,
    } as ConstructorParameters<typeof EnterBehaviourOverride>[3],
    dependencies.operationPerformer ?? ({} as OperationPerformer),
  );
}

function selectOperation(options: {
  cursor: { line: number; ch: number };
  settings?: Partial<EnterSettings>;
  shift?: boolean;
  smartIndentListEnabled?: boolean;
  text: string;
}) {
  const editor = makeEditor({ text: options.text, cursor: options.cursor });
  const documentLines = options.text.split("\n");
  editor.getRange = (from, to) => {
    if (from.line === to.line) {
      return documentLines[from.line]?.slice(from.ch, to.ch) ?? "";
    }

    return [
      documentLines[from.line]?.slice(from.ch) ?? "",
      ...documentLines.slice(from.line + 1, to.line),
      documentLines[to.line]?.slice(0, to.ch) ?? "",
    ].join("\n");
  };
  const root = makeRoot({ editor, settings: makeSettings() });
  let selectedOperation: Operation | null = null;
  const operationPerformer = {
    perform: (createOperation: (candidate: Root) => Operation | null) => {
      selectedOperation = createOperation(root);
      return NO_OP_OUTCOME;
    },
  } as unknown as OperationPerformer;
  const feature = makeFeature(options.settings, {
    operationPerformer,
    smartIndentListEnabled: options.smartIndentListEnabled,
  });
  const run = (
    feature as unknown as {
      run: (currentEditor: typeof editor) => typeof NO_OP_OUTCOME;
      runShiftEnter: (currentEditor: typeof editor) => typeof NO_OP_OUTCOME;
    }
  )[options.shift ? "runShiftEnter" : "run"];

  run(editor);

  return selectedOperation;
}

describe("EnterBehaviourOverride", () => {
  test.each([
    [false, false, false],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ])(
    "runs Enter override when betterEnter=%s and keepBodyTextInBullets=%s",
    (betterEnter, keepBodyTextInBullets, expected) => {
      const feature = makeFeature({
        overrideEnterBehaviour: betterEnter,
        keepBodyTextInBullets,
      });
      const check = (feature as unknown as { check: () => boolean }).check;

      expect(check()).toBe(expected);
    },
  );

  test.each([
    [true, false],
    [false, true],
  ])(
    "does not run Enter override while IME is open for settings %s/%s",
    (overrideEnterBehaviour, keepBodyTextInBullets) => {
      const feature = makeFeature(
        { overrideEnterBehaviour, keepBodyTextInBullets },
        { imeOpened: true },
      );
      const check = (feature as unknown as { check: () => boolean }).check;

      expect(check()).toBe(false);
    },
  );

  test("selects the root sibling operation for an empty root item when body ownership is enabled", () => {
    const operation = selectOperation({
      text: "- \n  - child\n- after",
      cursor: { line: 0, ch: 2 },
      settings: {
        overrideEnterBehaviour: false,
        keepBodyTextInBullets: true,
      },
    });

    expect(operation).toBeInstanceOf(CreateNewRootItemAfterEmpty);
  });

  test("keeps the legacy operation for an empty root item when body ownership is disabled", () => {
    const operation = selectOperation({
      text: "- \n- after",
      cursor: { line: 0, ch: 2 },
      settings: {
        overrideEnterBehaviour: true,
        keepBodyTextInBullets: false,
      },
    });

    expect(operation).toBeInstanceOf(CreateNewItem);
  });

  test("selects the existing outdent operation for a nested empty item", () => {
    const operation = selectOperation({
      text: "- parent\n  - \n    - child",
      cursor: { line: 1, ch: 4 },
      settings: {
        overrideEnterBehaviour: false,
        keepBodyTextInBullets: true,
      },
    });

    expect(operation).toBeInstanceOf(OutdentListIfItsEmpty);
  });

  test("selects the root sibling operation for an empty ordered root item when smart lists are disabled", () => {
    const operation = selectOperation({
      text: "1. \n  1. child\n2. after",
      cursor: { line: 0, ch: 3 },
      settings: {
        overrideEnterBehaviour: false,
        keepBodyTextInBullets: true,
      },
      smartIndentListEnabled: false,
    });

    expect(operation).toBeInstanceOf(CreateNewRootItemAfterEmpty);
  });

  test("selects the outdent operation for an empty ordered nested item when smart lists are disabled", () => {
    const operation = selectOperation({
      text: "1. parent\n  1. \n    1. child",
      cursor: { line: 1, ch: 5 },
      settings: {
        overrideEnterBehaviour: false,
        keepBodyTextInBullets: true,
      },
      smartIndentListEnabled: false,
    });

    expect(operation).toBeInstanceOf(OutdentListIfItsEmpty);
  });

  test("keeps legacy delegation for an empty ordered item when body ownership is disabled", () => {
    const operation = selectOperation({
      text: "1. ",
      cursor: { line: 0, ch: 3 },
      settings: {
        overrideEnterBehaviour: true,
        keepBodyTextInBullets: false,
      },
      smartIndentListEnabled: false,
    });

    expect(operation).toBeNull();
  });

  test("selects the existing new-item operation for a non-empty item", () => {
    const operation = selectOperation({
      text: "- item",
      cursor: { line: 0, ch: 6 },
      settings: {
        overrideEnterBehaviour: false,
        keepBodyTextInBullets: true,
      },
    });

    expect(operation).toBeInstanceOf(CreateNewItem);
  });

  test("keeps Shift-Enter as a same-item continuation operation", () => {
    const operation = selectOperation({
      text: "- item",
      cursor: { line: 0, ch: 6 },
      settings: {
        overrideEnterBehaviour: false,
        keepBodyTextInBullets: true,
      },
      shift: true,
    });

    expect(operation).toBeInstanceOf(InsertNewLineWithoutBullet);
  });

  test("lets Obsidian handle ordered lists when smart lists are disabled", () => {
    const operation = selectOperation({
      text: "9. item",
      cursor: { line: 0, ch: 7 },
      smartIndentListEnabled: false,
    });

    expect(operation).toBeNull();
  });
});
