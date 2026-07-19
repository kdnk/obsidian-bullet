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

function makeTransaction(
  doc: string,
  changes: ChangeSpec,
  userEvent?: string,
  selection?: number | EditorSelection,
) {
  const state = EditorState.create({
    doc,
    selection:
      typeof selection === "number"
        ? EditorSelection.cursor(selection)
        : selection,
  });
  return state.update({ changes, userEvent });
}

function makeMultiRangeDeletion(
  doc: string,
  ranges: readonly { from: number; to: number }[],
) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create(
      ranges.map(({ from, to }) => EditorSelection.range(from, to)),
    ),
    extensions: EditorState.allowMultipleSelections.of(true),
  });
  return state.update({ changes: ranges, userEvent: "delete.selection" });
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
  ])(
    "passes reserved deletion event %s when ownership remains valid",
    (userEvent) => {
      const transaction = makeTransaction(
        "- plain",
        { from: 2, to: 3 },
        userEvent,
      );

      expect(policy.decide(transaction)).toEqual({ kind: "pass" });
    },
  );

  test.each([
    {
      description: "marker",
      doc: "- item",
      from: 0,
      to: 1,
      selection: 1,
      userEvent: "delete.backward",
      expected: "- item",
    },
    {
      description: "marker through a Vim input transaction",
      doc: "- item",
      from: 0,
      to: 1,
      selection: EditorSelection.single(0, 1),
      userEvent: "input.type",
      expected: "- item",
    },
    {
      description: "spacing",
      doc: "* item",
      from: 1,
      to: 2,
      selection: 2,
      userEvent: "delete.backward",
      expected: "* item",
    },
    {
      description: "complete prefix",
      doc: "+ item",
      from: 0,
      to: 2,
      selection: EditorSelection.single(0, 2),
      userEvent: "delete.selection",
      expected: "+ item",
    },
    {
      description: "prefix through body text",
      doc: "- item",
      from: 0,
      to: 4,
      selection: EditorSelection.single(0, 4),
      userEvent: "delete.selection",
      expected: "- em",
    },
    {
      description: "ordered prefix through body text",
      doc: "10. item",
      from: 0,
      to: 6,
      selection: EditorSelection.single(0, 6),
      userEvent: "delete.cut",
      expected: "10. em",
    },
  ])(
    "preserves the original list prefix after deleting its $description",
    ({ doc, from, to, selection, userEvent, expected }) => {
      const transaction = makeTransaction(
        doc,
        { from, to },
        userEvent,
        selection,
      );

      expect(applyCorrection(transaction, policy.decide(transaction))).toBe(
        expected,
      );
    },
  );

  test("uses mapped new-document coordinates for a shifted prefix correction", () => {
    const transaction = makeMultiRangeDeletion("keep\n- item", [
      { from: 0, to: 1 },
      { from: 5, to: 6 },
    ]);

    expect(policy.decide(transaction)).toEqual({
      kind: "correct",
      changes: [
        { from: 0, insert: "- " },
        { from: 4, to: 5, insert: "- " },
      ],
    });
    expect(applyCorrection(transaction, policy.decide(transaction))).toBe(
      "- eep\n- item",
    );
  });

  test.each([
    {
      description: "a pasted body line",
      doc: "plain",
      from: 0,
      to: 1,
      userEvent: "input.type",
      expected: "- lain",
    },
    {
      description: "a heading marker",
      doc: "# heading",
      from: 0,
      to: 1,
      userEvent: "delete.backward",
      expected: "-  heading",
    },
    {
      description: "list-continuation indentation",
      doc: "- parent\n  continuation",
      from: 9,
      to: 11,
      userEvent: "delete.selection",
      expected: "- parent\n- continuation",
    },
  ])(
    "adopts body text created by deleting $description",
    ({ doc, from, to, userEvent, expected }) => {
      const transaction = makeTransaction(
        doc,
        { from, to },
        userEvent,
        EditorSelection.single(from, to),
      );

      expect(applyCorrection(transaction, policy.decide(transaction))).toBe(
        expected,
      );
    },
  );

  test("allows deleting an entire list line", () => {
    const transaction = makeTransaction(
      "- one\n- two",
      { from: 0, to: 6 },
      "delete.selection",
      EditorSelection.single(0, 6),
    );

    expect(policy.decide(transaction)).toEqual({ kind: "pass" });
  });

  test.each([
    {
      description: "isolated root",
      doc: "- ",
      from: 1,
      to: 2,
      expected: "",
    },
    {
      description: "root at the document start",
      doc: "- \n- next",
      from: 1,
      to: 2,
      expected: "- next",
    },
    {
      description: "root between siblings",
      doc: "- prev\n- \n- next",
      from: 8,
      to: 9,
      expected: "- prev\n- next",
    },
    {
      description: "root at the document end",
      doc: "- prev\n- ",
      from: 8,
      to: 9,
      expected: "- prev",
    },
    {
      description: "nested leaf",
      doc: "- parent\n  - \n- sibling",
      from: 12,
      to: 13,
      expected: "- parent\n- sibling",
    },
  ])(
    "removes an empty $description row on Backspace",
    ({ doc, from, to, expected }) => {
      const transaction = makeTransaction(
        doc,
        { from, to },
        "delete.backward",
        to,
      );

      expect(applyCorrection(transaction, policy.decide(transaction))).toBe(
        expected,
      );
    },
  );

  test("restores an empty item that still owns a child", () => {
    const transaction = makeTransaction(
      "- \n  - child",
      { from: 1, to: 2 },
      "delete.backward",
      2,
    );

    expect(applyCorrection(transaction, policy.decide(transaction))).toBe(
      "- \n  - child",
    );
  });

  test("passes a forward Delete that joins two items into a valid list item", () => {
    const transaction = makeTransaction(
      "- one\n- two",
      { from: 5, to: 6 },
      "delete.forward",
      5,
    );

    expect(transaction.newDoc.toString()).toBe("- one- two");
    expect(policy.decide(transaction)).toEqual({ kind: "pass" });
  });

  test("rejects a forward Delete that embeds the next item prefix in body text", () => {
    const transaction = makeTransaction(
      "plain\n- item",
      { from: 5, to: 6 },
      "delete.forward",
      5,
    );

    expect(transaction.newDoc.toString()).toBe("plain- item");
    expect(policy.decide(transaction)).toEqual({ kind: "reject" });
  });

  test("rejects prefix recovery after its physical line boundary is deleted", () => {
    const transaction = makeTransaction(
      "plain\n- item",
      { from: 5, to: 7 },
      "delete.selection",
      EditorSelection.single(5, 7),
    );

    expect(policy.decide(transaction)).toEqual({ kind: "reject" });
  });

  test("rejects multiple deletion ranges competing for one prefix", () => {
    const transaction = makeMultiRangeDeletion("10. item", [
      { from: 0, to: 1 },
      { from: 2, to: 3 },
    ]);

    expect(policy.decide(transaction)).toEqual({ kind: "reject" });
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

  test("starts a bullet when Space is typed on a completely empty line", () => {
    const transaction = makeTransaction(
      "",
      { from: 0, insert: " " },
      "input.type",
    );

    const decision = policy.decide(transaction);

    expect(decision).toEqual({
      kind: "correct",
      changes: [{ from: 0, insert: "-" }],
    });
    expect(applyCorrection(transaction, decision)).toBe("- ");
  });

  test.each([
    { description: "whitespace-only line", doc: "  ", from: 2 },
    {
      description: "empty list continuation",
      doc: "- parent\n  ",
      from: 11,
    },
  ])("does not start a bullet on a $description", ({ doc, from }) => {
    const transaction = makeTransaction(
      doc,
      { from, insert: " " },
      "input.type",
      from,
    );

    expect(policy.decide(transaction)).toEqual({ kind: "pass" });
  });

  test("does not start a bullet from composition Space input", () => {
    const transaction = makeTransaction(
      "",
      { from: 0, insert: " " },
      "input.type.compose",
    );

    expect(policy.decide(transaction)).toEqual({ kind: "pass" });
  });

  test("does not start a bullet when Space replaces a selection", () => {
    const transaction = makeTransaction(
      "x",
      { from: 0, to: 1, insert: " " },
      "input.type",
      EditorSelection.range(0, 1),
    );

    expect(policy.decide(transaction)).toEqual({ kind: "pass" });
  });

  test("does not start bullets from multiple Space insertions", () => {
    const state = EditorState.create({
      doc: "\n",
      selection: EditorSelection.create([
        EditorSelection.cursor(0),
        EditorSelection.cursor(1),
      ]),
      extensions: EditorState.allowMultipleSelections.of(true),
    });
    const transaction = state.update({
      changes: [
        { from: 0, insert: " " },
        { from: 1, insert: " " },
      ],
      userEvent: "input.type",
    });

    expect(policy.decide(transaction)).toEqual({ kind: "pass" });
  });

  test("keeps the existing body correction for Space before pasted text", () => {
    const transaction = makeTransaction(
      "plain",
      { from: 0, insert: " " },
      "input.type",
      0,
    );

    expect(policy.decide(transaction)).toEqual({
      kind: "correct",
      changes: [{ from: 0, insert: "- " }],
    });
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
        2,
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
      4,
    );

    expect(applyCorrection(transaction, policy.decide(transaction))).toBe("#");
  });

  test("does not promote when the sole cursor differs from the insertion", () => {
    const transaction = makeTransaction(
      "- ",
      { from: 2, insert: "#" },
      "input.type",
      0,
    );

    expect(policy.decide(transaction)).toEqual({ kind: "pass" });
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
    const error = new Error("classification failed");
    class ThrowingClassifier extends MarkdownLineClassifier {
      classify(): never {
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
