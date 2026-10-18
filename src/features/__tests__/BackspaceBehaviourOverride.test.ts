import { Plugin } from "obsidian";

import { indentUnit } from "@codemirror/language";
import { EditorState, Extension } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";

import { makeEditor, makeRoot, makeSettings } from "../../__mocks__";
import * as editorAdapter from "../../editor";
import { Operation } from "../../operations/Operation";
import { Root } from "../../root";
import { OperationPerformer } from "../../services/OperationPerformer";
import { Settings } from "../../services/Settings";
import { BackspaceBehaviourOverride } from "../BackspaceBehaviourOverride";

jest.mock("@codemirror/view", () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "platform");
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: "MacIntel",
  });
  try {
    return jest.requireActual<typeof import("@codemirror/view")>(
      "@codemirror/view",
    );
  } finally {
    if (descriptor) Object.defineProperty(navigator, "platform", descriptor);
    else Reflect.deleteProperty(navigator, "platform");
  }
});

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
    registerEditorExtension?: (extension: Extension) => void;
  } = {},
) {
  const settings = Object.assign(makeSettings(), {
    keepCursorWithinContent: "bullet-and-checkbox",
    keepBodyTextInBullets: false,
    ...settingsOverrides,
  });

  return new BackspaceBehaviourOverride(
    {
      registerEditorExtension:
        dependencies.registerEditorExtension ?? jest.fn(),
    } as unknown as Plugin,
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
  test.each(["Backspace", "h"])(
    "%s caps literal indentation and honors disabled inputs",
    async (key) => {
      const text = "- ```\n  before\n    hello\n  ```";
      for (const mode of [
        "enabled",
        "readOnly",
        "composing",
        "ime",
        "disabled",
        "shift",
        "alt",
        "meta",
      ] as const) {
        const editor = makeEditor({ text, cursor: { line: 2, ch: 4 } });
        const root = makeRoot({ editor });
        let extension: Extension = [];
        const feature = makeFeature(
          {
            keepCursorWithinContent:
              mode === "disabled" ? "never" : "bullet-and-checkbox",
          },
          {
            imeOpened: mode === "ime",
            registerEditorExtension: (registered) => {
              extension = registered;
            },
            operationPerformer: {
              perform: (createOperation: (candidate: Root) => Operation) =>
                createOperation(root).perform(),
            } as unknown as OperationPerformer,
          },
        );
        await feature.load();
        const state = EditorState.create({
          doc: text,
          extensions: [
            extension,
            indentUnit.of("\t"),
            EditorState.readOnly.of(mode === "readOnly"),
          ],
        });
        const view = {
          state,
          composing: mode === "composing",
          plugin: () => null,
        } as unknown as EditorView;
        const lookup = jest
          .spyOn(editorAdapter, "getEditorFromState")
          .mockReturnValue(editor);
        try {
          const event = {
            key: key === "h" && mode === "shift" ? "H" : key,
            keyCode: key === "h" ? 72 : 8,
            ctrlKey: key === "h",
            shiftKey: mode === "shift",
            altKey: mode === "alt",
            metaKey: mode === "meta",
          } as KeyboardEvent;
          expect({
            mode,
            handled: runScopeHandlers(view, event, "editor"),
          }).toEqual({ mode, handled: mode === "enabled" });
          expect(root.print()).toBe(
            mode === "enabled" ? "- ```\n  before\n  hello\n  ```" : text,
          );
          expect(root.getCursor()).toEqual({
            line: 2,
            ch: mode === "enabled" ? 2 : 4,
          });
        } finally {
          lookup.mockRestore();
        }
      }
    },
  );

  test.each([
    ["Backspace", false],
    ["h", true],
  ])("%s joins code rows at their container boundary", async (key, ctrlKey) => {
    const text = "- ```\n  hello\n  world\n  ```";
    const editor = makeEditor({ text, cursor: { line: 2, ch: 2 } });
    const root = makeRoot({ editor });
    let extension: Extension = [];
    const feature = makeFeature(
      {},
      {
        registerEditorExtension: (registered) => {
          extension = registered;
        },
        operationPerformer: {
          perform: (createOperation: (candidate: Root) => Operation) =>
            createOperation(root).perform(),
        } as unknown as OperationPerformer,
      },
    );
    await feature.load();
    const state = EditorState.create({ doc: text, extensions: [extension] });
    const view = {
      state,
      composing: false,
      plugin: () => null,
    } as unknown as EditorView;
    const lookup = jest
      .spyOn(editorAdapter, "getEditorFromState")
      .mockReturnValue(editor);
    try {
      const event = {
        key,
        ctrlKey,
        keyCode: key === "h" ? 72 : 8,
      } as KeyboardEvent;
      expect(runScopeHandlers(view, event, "editor")).toBe(true);
      expect(root.print()).toBe("- ```\n  helloworld\n  ```");
      expect(root.getCursor()).toEqual({ line: 1, ch: 7 });
    } finally {
      lookup.mockRestore();
    }
  });

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
