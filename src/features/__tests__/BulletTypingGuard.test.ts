import { Plugin } from "obsidian";

import {
  Annotation,
  EditorSelection,
  EditorState,
  Extension,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";

import { makeLogger } from "../../__mocks__";
import { KeepCursorWithinContent, Settings } from "../../services/Settings";
import { BulletTypingGuard } from "../BulletTypingGuard";

interface GuardOptions {
  keepBodyTextInBullets?: boolean;
  keepCursorWithinContent?: KeepCursorWithinContent;
}

async function loadGuard(options: GuardOptions = {}) {
  const registerEditorExtension = jest.fn<void, [Extension]>();
  const plugin = {
    app: { workspace: { updateOptions: jest.fn() } },
    registerEditorExtension,
  } as unknown as Plugin;
  const settings = {
    keepBodyTextInBullets: true,
    keepCursorWithinContent: "bullet-and-checkbox",
    onChange: jest.fn(),
    removeCallback: jest.fn(),
    ...options,
  } as unknown as Settings;
  const feature = new BulletTypingGuard(plugin, settings, makeLogger());

  await feature.load();

  expect(registerEditorExtension).toHaveBeenCalledTimes(1);
  const extension = registerEditorExtension.mock.calls[0]?.[0];
  if (!extension) {
    throw new Error("BulletTypingGuard did not register an editor extension");
  }

  return extension;
}

function captureInputTransaction() {
  let transaction: Transaction | null = null;
  const extension = EditorState.transactionFilter.of((candidate) => {
    transaction = candidate;
    return candidate;
  });

  return {
    extension,
    get transaction() {
      return transaction;
    },
  };
}

describe("BulletTypingGuard", () => {
  test("returns the original typed transaction while disabled", async () => {
    const guard = await loadGuard({ keepBodyTextInBullets: false });
    const capture = captureInputTransaction();
    const state = EditorState.create({
      extensions: [guard, capture.extension],
    });

    const transaction = state.update({
      changes: { from: 0, insert: "a" },
      userEvent: "input.type",
    });

    expect(transaction).toBe(capture.transaction);
    expect(transaction.newDoc.toString()).toBe("a");
  });

  test("leaves Space unchanged while body ownership is disabled", async () => {
    const guard = await loadGuard({ keepBodyTextInBullets: false });
    const state = EditorState.create({ extensions: guard });

    const transaction = state.update({
      changes: { from: 0, insert: " " },
      userEvent: "input.type",
    });

    expect(transaction.newDoc.toString()).toBe(" ");
  });

  test("returns the original transaction when the policy passes", async () => {
    const guard = await loadGuard();
    const capture = captureInputTransaction();
    const state = EditorState.create({
      extensions: [guard, capture.extension],
    });

    const transaction = state.update({
      changes: { from: 0, insert: "a" },
      userEvent: "input.paste",
    });

    expect(transaction).toBe(capture.transaction);
    expect(transaction.newDoc.toString()).toBe("a");
  });

  test("prefixes directly typed body text", async () => {
    const guard = await loadGuard();
    const state = EditorState.create({ extensions: guard });

    const transaction = state.update({
      changes: { from: 0, insert: "a" },
      userEvent: "input.type",
    });

    expect(transaction.newDoc.toString()).toBe("- a");
  });

  test("maps the typed cursor through the correction", async () => {
    const guard = await loadGuard();
    const state = EditorState.create({ extensions: guard });

    const transaction = state.update({
      changes: { from: 0, insert: "a" },
      selection: { anchor: 1 },
      userEvent: "input.type",
    });

    expect(transaction.newSelection.main).toEqual(EditorSelection.cursor(3));
  });

  test("maps Space past the empty bullet correction", async () => {
    const guard = await loadGuard();
    const state = EditorState.create({ extensions: guard });

    const transaction = state.update({
      changes: { from: 0, insert: " " },
      selection: { anchor: 1 },
      userEvent: "input.type",
    });

    expect(transaction.newDoc.toString()).toBe("- ");
    expect(transaction.newSelection.main).toEqual(EditorSelection.cursor(2));
  });

  test("preserves reverse ranges and the main selection", async () => {
    const guard = await loadGuard();
    const state = EditorState.create({
      doc: "one\ntwo",
      extensions: [EditorState.allowMultipleSelections.of(true), guard],
    });

    const transaction = state.update({
      changes: { from: 3, insert: "!" },
      selection: EditorSelection.create(
        [EditorSelection.range(3, 1), EditorSelection.range(8, 5)],
        1,
      ),
      userEvent: "input.type",
    });

    expect(transaction.newSelection.mainIndex).toBe(1);
    expect(transaction.newSelection.ranges).toEqual([
      EditorSelection.range(5, 3),
      EditorSelection.range(10, 7),
    ]);
  });

  test("maps effects and preserves annotations", async () => {
    const guard = await loadGuard();
    const positionEffect = StateEffect.define<number>({
      map: (position, changes) => changes.mapPos(position),
    });
    const sourceAnnotation = Annotation.define<string>();
    const state = EditorState.create({
      doc: "one",
      extensions: guard,
    });

    const transaction = state.update({
      annotations: sourceAnnotation.of("original"),
      changes: { from: 3, insert: "!" },
      effects: positionEffect.of(4),
      userEvent: "input.type",
    });

    expect(transaction.effects).toHaveLength(1);
    expect(transaction.effects[0]?.value).toBe(6);
    expect(transaction.annotation(sourceAnnotation)).toBe("original");
    expect(transaction.isUserEvent("input.type")).toBe(true);
  });

  test("exposes the correction as one history-bearing transaction", async () => {
    const guard = await loadGuard();
    const historyEventCount = StateField.define<number>({
      create: () => 0,
      update: (count, transaction) =>
        transaction.docChanged &&
        transaction.annotation(Transaction.addToHistory) !== false
          ? count + 1
          : count,
    });
    const state = EditorState.create({
      extensions: [historyEventCount, guard],
    });

    const transaction = state.update({
      annotations: Transaction.addToHistory.of(true),
      changes: { from: 0, insert: "a" },
      userEvent: "input.type",
    });

    expect(transaction).toBeInstanceOf(Transaction);
    expect(transaction.newDoc.toString()).toBe("- a");
    expect(transaction.annotation(Transaction.addToHistory)).toBe(true);
    expect(transaction.state.field(historyEventCount)).toBe(1);
  });

  test("keeps Space and its empty bullet in one history event", async () => {
    const guard = await loadGuard();
    const historyEventCount = StateField.define<number>({
      create: () => 0,
      update: (count, transaction) =>
        transaction.docChanged &&
        transaction.annotation(Transaction.addToHistory) !== false
          ? count + 1
          : count,
    });
    const state = EditorState.create({
      extensions: [historyEventCount, guard],
    });

    const transaction = state.update({
      annotations: Transaction.addToHistory.of(true),
      changes: { from: 0, insert: " " },
      userEvent: "input.type",
    });

    expect(transaction.newDoc.toString()).toBe("- ");
    expect(transaction.state.field(historyEventCount)).toBe(1);
  });

  test("rejects an unsafe document change without changing selection", async () => {
    const guard = await loadGuard();
    const selection = EditorSelection.single(7, 5);
    const state = EditorState.create({
      doc: "plain\n- item",
      selection,
      extensions: guard,
    });

    const transaction = state.update({
      changes: { from: 5, to: 7 },
      userEvent: "delete.selection",
    });

    expect(transaction.docChanged).toBe(false);
    expect(transaction.newDoc.toString()).toBe("plain\n- item");
    expect(transaction.selection).toBeUndefined();
    expect(transaction.newSelection.eq(selection)).toBe(true);
  });

  test("keeps document correction independent of cursor settings", async () => {
    const documents = await Promise.all(
      (["never", "bullet-and-checkbox"] as const).map(async (setting) => {
        const guard = await loadGuard({ keepCursorWithinContent: setting });
        const state = EditorState.create({ extensions: guard });

        return state
          .update({
            changes: { from: 0, insert: "a" },
            userEvent: "input.type",
          })
          .newDoc.toString();
      }),
    );

    expect(documents).toEqual(["- a", "- a"]);
  });

  test("installs analysis only while body ownership is enabled", async () => {
    const registerEditorExtension = jest.fn<void, [Extension]>();
    const updateOptions = jest.fn();
    let settingsCallback: (() => void) | undefined;
    const onChange = jest.fn((_keys, callback: () => void) => {
      settingsCallback = callback;
    });
    const removeCallback = jest.fn();
    const plugin = {
      app: { workspace: { updateOptions } },
      registerEditorExtension,
    } as unknown as Plugin;
    const settings = {
      keepBodyTextInBullets: false,
      onChange,
      removeCallback,
    } as unknown as Settings;
    const feature = new BulletTypingGuard(plugin, settings, makeLogger());

    await feature.load();

    const extensions = registerEditorExtension.mock.calls[0]?.[0];
    if (!extensions) {
      throw new Error("BulletTypingGuard did not register extensions");
    }
    expect(onChange).toHaveBeenCalledWith(
      ["keepBodyTextInBullets"],
      expect.any(Function),
    );
    expect(
      EditorState.create({ extensions })
        .update({
          changes: { from: 0, insert: "a" },
          userEvent: "input.type",
        })
        .newDoc.toString(),
    ).toBe("a");

    settings.keepBodyTextInBullets = true;
    settingsCallback?.();

    expect(updateOptions).toHaveBeenCalledTimes(1);
    expect(
      EditorState.create({ extensions })
        .update({
          changes: { from: 0, insert: "a" },
          userEvent: "input.type",
        })
        .newDoc.toString(),
    ).toBe("- a");

    settings.keepBodyTextInBullets = false;
    settingsCallback?.();

    expect(updateOptions).toHaveBeenCalledTimes(2);
    expect(
      EditorState.create({ extensions })
        .update({
          changes: { from: 0, insert: "a" },
          userEvent: "input.type",
        })
        .newDoc.toString(),
    ).toBe("a");

    await feature.unload();
    expect(removeCallback).toHaveBeenCalledWith(settingsCallback);
  });
});
