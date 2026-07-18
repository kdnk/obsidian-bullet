import { Plugin } from "obsidian";

import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import { Operation } from "../../operations/Operation";
import { Root } from "../../root";
import { OperationPerformer } from "../../services/OperationPerformer";
import { Settings } from "../../services/Settings";
import { BackspaceBehaviourOverride } from "../BackspaceBehaviourOverride";

jest.mock(
  "obsidian",
  () => ({
    Plugin: class {},
    editorInfoField: {},
  }),
  { virtual: true },
);

type BackspaceSettings = Pick<
  Settings,
  "keepCursorWithinContent" | "keepBodyTextInBullets"
>;

function makeFeature(
  settingsOverrides: Partial<BackspaceSettings> = {},
  dependencies: {
    imeOpened?: boolean;
    operationPerformer?: OperationPerformer;
  } = {},
) {
  const settings = Object.assign(makeSettings(), {
    keepCursorWithinContent: "bullet-and-checkbox",
    keepBodyTextInBullets: false,
    ...settingsOverrides,
  });

  return new BackspaceBehaviourOverride(
    { registerEditorExtension: jest.fn() } as unknown as Plugin,
    settings,
    {
      isOpened: () => dependencies.imeOpened ?? false,
    } as ConstructorParameters<typeof BackspaceBehaviourOverride>[2],
    {
      isSmartIndentListEnabled: () => true,
    } as ConstructorParameters<typeof BackspaceBehaviourOverride>[3],
    dependencies.operationPerformer ?? ({} as OperationPerformer),
  );
}

describe("BackspaceBehaviourOverride", () => {
  test.each([
    ["never", false, false],
    ["bullet-only", false, true],
    ["never", true, true],
    ["bullet-and-checkbox", true, true],
  ] as const)(
    "runs when cursor behavior=%s and keepBodyTextInBullets=%s",
    (keepCursorWithinContent, keepBodyTextInBullets, expected) => {
      const feature = makeFeature({
        keepCursorWithinContent,
        keepBodyTextInBullets,
      });
      const check = (feature as unknown as { check: () => boolean }).check;

      expect(check()).toBe(expected);
    },
  );

  test("does not run while IME is open", () => {
    const feature = makeFeature(
      { keepCursorWithinContent: "never", keepBodyTextInBullets: true },
      { imeOpened: true },
    );
    const check = (feature as unknown as { check: () => boolean }).check;

    expect(check()).toBe(false);
  });

  test("removes an empty leaf when body ownership alone enables Backspace", () => {
    const editor = makeEditor({ text: "- ", cursor: { line: 0, ch: 2 } });
    const root = makeRoot({ editor });
    const operationPerformer = {
      perform: (createOperation: (candidate: Root) => Operation | null) => {
        const operation = createOperation(root);
        if (!operation) {
          throw new Error("Expected a Backspace operation");
        }
        return operation.perform();
      },
    } as unknown as OperationPerformer;
    const feature = makeFeature(
      { keepCursorWithinContent: "never", keepBodyTextInBullets: true },
      { operationPerformer },
    );
    const run = (
      feature as unknown as {
        run: (currentEditor: typeof editor) => ReturnType<Operation["perform"]>;
      }
    ).run;

    const outcome = run(editor);

    expect(outcome.shouldUpdate).toBe(true);
    expect(root.print()).toBe("");
    expect(root.getCursor()).toEqual({ line: 0, ch: 0 });
  });
});
