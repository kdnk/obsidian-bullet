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
  const plugin = { registerEditorExtension } as unknown as Plugin;
  const settings = {
    keepBodyTextInBullets: true,
    keepCursorWithinContent: "bullet-and-checkbox",
    ...options,
  } as Settings;
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
});
