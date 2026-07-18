import {
  ChangeSpec,
  EditorSelection,
  EditorState,
  Transaction,
} from "@codemirror/state";

import { makeLogger } from "../../__mocks__";
import {
  BulletTypingDecision,
  BulletTypingPolicy,
} from "../BulletTypingPolicy";
import { MarkdownLineClassifier } from "../MarkdownLineClassifier";

function makeTransaction(doc: string, changes: ChangeSpec, userEvent?: string) {
  const state = EditorState.create({ doc });
  return state.update({ changes, userEvent });
}

function applyCorrection(
  transaction: Transaction,
  decision: BulletTypingDecision,
) {
  if (decision.kind !== "correct") {
    return transaction.newDoc.toString();
  }

  return EditorState.create({ doc: transaction.newDoc })
    .update({ changes: decision.changes })
    .newDoc.toString();
}

const policy = new BulletTypingPolicy(
  new MarkdownLineClassifier(),
  makeLogger(),
);

describe("BulletTypingPolicy", () => {
  test.each([
    "input.paste",
    "input.drop",
    "move.drop",
    "input.complete",
    "undo",
    "redo",
  ])("passes excluded user event %s", (userEvent) => {
    const transaction = makeTransaction(
      "",
      { from: 0, insert: "plain" },
      userEvent,
    );

    expect(policy.decide(transaction)).toEqual({ kind: "pass" });
  });

  test("passes a remote typed transaction", () => {
    const state = EditorState.create({ doc: "" });
    const transaction = state.update({
      changes: { from: 0, insert: "plain" },
      userEvent: "input.type",
      annotations: Transaction.remote.of(true),
    });

    expect(policy.decide(transaction)).toEqual({ kind: "pass" });
  });

  test("passes a transaction without a user event", () => {
    const transaction = makeTransaction("", { from: 0, insert: "plain" });

    expect(policy.decide(transaction)).toEqual({ kind: "pass" });
  });

  test("passes a selection-only typed transaction", () => {
    const state = EditorState.create({ doc: "plain" });
    const transaction = state.update({
      selection: { anchor: 1 },
      userEvent: "input.type",
    });

    expect(policy.decide(transaction)).toEqual({ kind: "pass" });
  });

  test.each([
    "delete.backward",
    "delete.forward",
    "delete.selection",
    "delete.cut",
  ])("passes reserved deletion event %s", (userEvent) => {
    const transaction = makeTransaction("plain", { from: 0, to: 1 }, userEvent);

    expect(policy.decide(transaction)).toEqual({ kind: "pass" });
  });

  test("handles composition subtypes as typed input", () => {
    const transaction = makeTransaction(
      "",
      { from: 0, insert: "a" },
      "input.type.compose",
    );

    expect(applyCorrection(transaction, policy.decide(transaction))).toBe(
      "- a",
    );
  });

  test("prefixes directly typed body text on a blank line", () => {
    const transaction = makeTransaction(
      "",
      { from: 0, insert: "a" },
      "input.type",
    );

    const decision = policy.decide(transaction);

    expect(applyCorrection(transaction, decision)).toBe("- a");
  });

  test("prefixes only an edited plain-text line", () => {
    const transaction = makeTransaction(
      "pasted\nuntouched",
      { from: 6, insert: "!" },
      "input.type",
    );

    expect(applyCorrection(transaction, policy.decide(transaction))).toBe(
      "- pasted!\nuntouched",
    );
  });

  test("does not correct unchanged lines reclassified by an edited delimiter", () => {
    const transaction = makeTransaction(
      "---\ntitle: Example\n---",
      { from: 3, insert: "x" },
      "input.type",
    );

    expect(applyCorrection(transaction, policy.decide(transaction))).toBe(
      "- ---x\ntitle: Example\n---",
    );
  });

  test("returns sorted, non-overlapping corrections for changed lines", () => {
    const transaction = makeTransaction(
      "one\ntwo",
      [
        { from: 3, insert: "!" },
        { from: 7, insert: "?" },
      ],
      "input.type",
    );

    const decision = policy.decide(transaction);

    expect(decision).toEqual({
      kind: "correct",
      changes: [
        { from: 0, insert: "- " },
        { from: 5, insert: "- " },
      ],
    });
    expect(applyCorrection(transaction, decision)).toBe("- one!\n- two?");
  });

  test("returns one correction for multiple changes on one physical line", () => {
    const transaction = makeTransaction(
      "one",
      [
        { from: 0, insert: "[" },
        { from: 3, insert: "]" },
      ],
      "input.type",
    );

    expect(policy.decide(transaction)).toEqual({
      kind: "correct",
      changes: [{ from: 0, insert: "- " }],
    });
  });

  test.each([
    { description: "ATX heading", doc: "#", from: 1, insert: " " },
    { description: "quote", doc: ">", from: 1, insert: " " },
    { description: "horizontal rule", doc: "--", from: 2, insert: "-" },
    { description: "fenced code", doc: "``", from: 2, insert: "`" },
    {
      description: "frontmatter",
      doc: "---\ntitle: Exampl\n---",
      from: 17,
      insert: "e",
    },
    {
      description: "list continuation",
      doc: "- item\n  continuatio",
      from: 19,
      insert: "n",
    },
    { description: "list item", doc: "- ite", from: 5, insert: "m" },
  ])(
    "passes typed input that remains in a $description",
    ({ doc, from, insert }) => {
      const transaction = makeTransaction(doc, { from, insert }, "input.type");

      expect(policy.decide(transaction)).toEqual({ kind: "pass" });
    },
  );

  test.each(["#", ">", "`", "-"])(
    "promotes %s from an empty root item",
    (insert) => {
      const transaction = makeTransaction(
        "- ",
        { from: 2, insert },
        "input.type",
      );

      expect(applyCorrection(transaction, policy.decide(transaction))).toBe(
        insert,
      );
    },
  );

  test("removes the full prefix when promoting an indented root item", () => {
    const transaction = makeTransaction(
      "  - ",
      { from: 4, insert: "#" },
      "input.type",
    );

    expect(applyCorrection(transaction, policy.decide(transaction))).toBe("#");
  });

  test("does not promote a nested empty item", () => {
    const transaction = makeTransaction(
      "- parent\n  - ",
      { from: 13, insert: "#" },
      "input.type",
    );

    expect(policy.decide(transaction)).toEqual({ kind: "pass" });
  });

  test("does not promote an empty task item", () => {
    const transaction = makeTransaction(
      "- [ ] ",
      { from: 6, insert: "#" },
      "input.type",
    );

    expect(policy.decide(transaction)).toEqual({ kind: "pass" });
  });

  test.each(["- \n  - child", "- \n  continuation"])(
    "does not promote an empty item with an owned following line in %p",
    (doc) => {
      const transaction = makeTransaction(
        doc,
        { from: 2, insert: "#" },
        "input.type",
      );

      expect(policy.decide(transaction)).toEqual({ kind: "pass" });
    },
  );

  test("does not promote from multiple selections", () => {
    const state = EditorState.create({
      doc: "- ",
      selection: EditorSelection.create([
        EditorSelection.cursor(0),
        EditorSelection.cursor(2),
      ]),
      extensions: EditorState.allowMultipleSelections.of(true),
    });
    const transaction = state.update({
      changes: { from: 2, insert: "#" },
      userEvent: "input.type",
    });

    expect(policy.decide(transaction)).toEqual({ kind: "pass" });
  });

  test("does not promote multiple typed characters", () => {
    const transaction = makeTransaction(
      "- ",
      { from: 2, insert: "# " },
      "input.type",
    );

    expect(policy.decide(transaction)).toEqual({ kind: "pass" });
  });

  test("does not promote a trigger typed outside the item content", () => {
    const transaction = makeTransaction(
      "- ",
      { from: 0, insert: "#" },
      "input.type",
    );

    expect(applyCorrection(transaction, policy.decide(transaction))).toBe(
      "- #- ",
    );
  });

  test("prefixes a provisional heading when it becomes body text", () => {
    const transaction = makeTransaction(
      "#",
      { from: 1, insert: "text" },
      "input.type",
    );

    expect(applyCorrection(transaction, policy.decide(transaction))).toBe(
      "- #text",
    );
  });

  test("passes a provisional heading when it becomes an ATX heading", () => {
    const transaction = makeTransaction(
      "#",
      { from: 1, insert: " heading" },
      "input.type",
    );

    expect(policy.decide(transaction)).toEqual({ kind: "pass" });
  });

  test("logs an unexpected analysis error and passes the transaction", () => {
    const error = new Error("inspection failed");
    class ThrowingClassifier extends MarkdownLineClassifier {
      inspect(): never {
        throw error;
      }
    }

    const sink = jest.fn<void, [string, ...unknown[]]>();
    const failingPolicy = new BulletTypingPolicy(
      new ThrowingClassifier(),
      makeLogger(sink),
    );
    const transaction = makeTransaction(
      "",
      { from: 0, insert: "plain" },
      "input.type",
    );

    expect(failingPolicy.decide(transaction)).toEqual({ kind: "pass" });
    expect(sink).toHaveBeenCalledWith("bulletTypingPolicy", error);
  });
});
