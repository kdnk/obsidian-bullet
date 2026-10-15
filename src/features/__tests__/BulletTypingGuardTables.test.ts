import { Plugin } from "obsidian";

import { EditorState, Extension } from "@codemirror/state";

import { makeLogger } from "../../__mocks__";
import { Settings } from "../../services/Settings";
import { BulletTypingGuard } from "../BulletTypingGuard";

jest.mock(
  "obsidian",
  () => {
    const { StateField } =
      jest.requireActual<typeof import("@codemirror/state")>(
        "@codemirror/state",
      );
    return {
      editorEditorField: StateField.define({
        create: () => null,
        update: (value: null) => value,
      }),
    };
  },
  { virtual: true },
);

test("preserves native table synchronization and subsequent cell input", async () => {
  const registerEditorExtension = jest.fn<void, [Extension]>();
  const plugin = {
    app: { workspace: { updateOptions: jest.fn() } },
    registerEditorExtension,
  } as unknown as Plugin;
  const settings = {
    keepBodyTextInBullets: true,
    onChange: jest.fn(),
    removeCallback: jest.fn(),
  } as unknown as Settings;
  await new BulletTypingGuard(plugin, settings, makeLogger()).load();
  const guard = registerEditorExtension.mock.calls[0][0];
  let state = EditorState.create({
    doc: "| Name | Value |\n| --- | --- |\n| Sample | abc |\n\n",
    extensions: guard,
  });
  const updated =
    "| Name   | Value |\n| ------ | ----- |\n| Sample | abcX  |\n\n";
  const cursor = updated.indexOf("abcX") + 4;
  state = state.update({
    changes: { from: 0, to: state.doc.length, insert: updated },
    selection: { anchor: cursor },
    userEvent: "input.type",
  }).state;
  expect(state.doc.toString()).toBe(updated);
  expect(state.selection.main.head).toBe(cursor);
  state = state.update({
    ...state.replaceSelection("Y"),
    userEvent: "input.type",
  }).state;
  expect(state.doc.toString()).toBe(
    "| Name   | Value |\n| ------ | ----- |\n| Sample | abcXY  |\n\n",
  );
  expect(state.selection.main.head).toBe(cursor + 1);
});
