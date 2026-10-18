import { history, redo, undo } from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  StateEffect,
  Transaction,
  TransactionSpec,
} from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  ViewUpdate,
  keymap,
  runScopeHandlers,
} from "@codemirror/view";

import { codeEnterBackspace } from "../CodeEnterBackspace";

const source =
  "- a- Threading test \n  - Parent \n    - Selected item\n    -  \n```\n     llo  \n\n```\n      -";

function editor(doc = source, offset = doc.indexOf("llo") + 3) {
  let enabled = true;
  const registration = jest.spyOn(ViewPlugin, "define");
  const extension = codeEnterBackspace(() => enabled);
  const [create, spec] = registration.mock.calls[0];
  registration.mockRestore();
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(offset),
    extensions: [extension, history()],
  });
  const view = {
    get state() {
      return state;
    },
    composing: false,
    plugin: () => value,
    dispatch(input: Transaction | TransactionSpec) {
      const transaction =
        input instanceof Transaction ? input : state.update(input);
      state = transaction.state;
      value.update?.({
        transactions: [transaction],
        state,
        view,
        startState: transaction.startState,
        changes: transaction.changes,
        viewportChanged: false,
        viewportMoved: false,
        heightChanged: false,
        geometryChanged: transaction.docChanged,
        focusChanged: false,
        docChanged: transaction.docChanged,
        selectionSet: transaction.selection !== undefined,
      } satisfies ViewUpdate);
    },
  } as unknown as EditorView;
  const value = create(view, undefined);
  function event(
    name: "keydown" | "pointerdown" | "compositionstart" | "blur" | "paste",
    key = "",
    extra: Partial<KeyboardEvent> = {},
  ) {
    const observer = spec?.eventObservers?.[name];
    const input = { key, ...extra } as KeyboardEvent;
    observer?.call(value, input, view);
    return input;
  }
  return {
    view,
    event,
    enable(value: boolean) {
      enabled = value;
    },
    enter(indent = "     ", replacement = false) {
      event("keydown", "Enter");
      const at = state.selection.main.head;
      view.dispatch({
        changes: {
          from: replacement ? at - 1 : at,
          to: at,
          insert:
            (replacement ? state.doc.sliceString(at - 1, at) : "") +
            "\n" +
            indent,
        },
        selection: EditorSelection.cursor(at + indent.length + 1),
      });
    },
    backspace() {
      event("keydown", "Backspace");
      return state
        .facet(keymap)
        .some((bindings) =>
          bindings.some(
            (binding) => binding.key === "Backspace" && binding.run?.(view),
          ),
        );
    },
    controlH(extra: Partial<KeyboardEvent> = {}) {
      const input = event("keydown", "h", {
        ctrlKey: true,
        keyCode: 72,
        ...extra,
      });
      return runScopeHandlers(view, input, "editor");
    },
    type(text: string) {
      event("keydown", text);
      const at = state.selection.main.head;
      view.dispatch({
        changes: { from: at, insert: text },
        selection: EditorSelection.cursor(at + text.length),
        userEvent: "input.type",
      });
    },
  };
}

describe("immediate native code Enter reversal", () => {
  test.each([false, true])(
    "Ctrl+h restores exact Markdown and cursor before continued typing, replacement=%s",
    (replacement) => {
      const current = editor();
      current.enter("     ", replacement);
      expect(current.controlH()).toBe(true);
      expect(current.view.state.doc.toString()).toBe(source);
      expect(current.view.state.selection.main.head).toBe(
        source.indexOf("llo") + 3,
      );
      current.type("X");
      expect(current.view.state.doc.toString()).toBe(
        "- a- Threading test \n  - Parent \n    - Selected item\n    -  \n```\n     lloX  \n\n```\n      -",
      );
    },
  );

  test.each([{ altKey: true }, { metaKey: true }, { shiftKey: true }])(
    "unrelated modified Ctrl+h cancels the receipt %j",
    (extra) => {
      const current = editor();
      current.enter();
      expect(current.controlH(extra)).toBe(false);
      expect(current.backspace()).toBe(false);
      expect(current.view.state.doc.toString()).toBe(
        "- a- Threading test \n  - Parent \n    - Selected item\n    -  \n```\n     llo\n       \n\n```\n      -",
      );
    },
  );

  test("does not reverse Enter after the editor becomes read-only", () => {
    const current = editor();
    current.enter();
    const split = current.view.state.doc.toString();
    const selection = current.view.state.selection;
    current.view.dispatch({
      effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)),
    });
    expect(current.backspace()).toBe(false);
    expect(current.view.state.doc.toString()).toBe(split);
    expect(current.view.state.selection.eq(selection)).toBe(true);
  });

  test.each([false, true])(
    "restores exact supplied Markdown and original trailing spaces, replacement=%s",
    (replacement) => {
      const current = editor();
      current.enter("     ", replacement);
      expect(current.view.state.doc.toString()).toBe(
        "- a- Threading test \n  - Parent \n    - Selected item\n    -  \n```\n     llo\n       \n\n```\n      -",
      );
      expect(current.backspace()).toBe(true);
      expect(current.view.state.doc.toString()).toBe(source);
      expect(current.view.state.selection.main.head).toBe(
        source.indexOf("llo") + 3,
      );
      current.type("X");
      expect(current.view.state.doc.toString()).toBe(
        source.replace("llo  ", "lloX  "),
      );
    },
  );

  test("also reverses Enter after trailing spaces", () => {
    const current = editor(source, source.indexOf("llo") + 5);
    current.enter("     ", true);
    expect(current.backspace()).toBe(true);
    expect(current.view.state.doc.toString()).toBe(source);
    expect(current.view.state.selection.main.head).toBe(
      source.indexOf("llo") + 5,
    );
  });

  test.each(["\t", "  \t  ", "       "])(
    "preserves intentional code indentation %j",
    (indent) => {
      const original = "- ```\n  " + indent + "code  \n  ```";
      const current = editor(original, original.indexOf("code") + 4);
      current.enter("  " + indent);
      expect(current.backspace()).toBe(true);
      expect(current.view.state.doc.toString()).toBe(original);
    },
  );

  test.each(["Tab", "ArrowLeft", "Home", "Escape", "a"])(
    "cancels on %s even without a transaction",
    (key) => {
      const current = editor();
      current.enter();
      current.event("keydown", key);
      expect(current.backspace()).toBe(false);
    },
  );

  test.each(["pointerdown", "compositionstart", "blur", "paste"] as const)(
    "cancels on %s even without selection movement",
    (name) => {
      const current = editor();
      current.enter();
      current.event(name);
      expect(current.backspace()).toBe(false);
    },
  );

  test("navigation away and back cannot restore a receipt", () => {
    const current = editor();
    current.enter();
    const at = current.view.state.selection.main.head;
    current.view.dispatch({ selection: EditorSelection.cursor(at - 1) });
    current.view.dispatch({ selection: EditorSelection.cursor(at) });
    expect(current.backspace()).toBe(false);
  });

  test("typing and subsequent removal cannot restore a receipt", () => {
    const current = editor();
    current.enter();
    const at = current.view.state.selection.main.head;
    current.type("x");
    current.view.dispatch({
      changes: { from: at, to: at + 1 },
      selection: EditorSelection.cursor(at),
    });
    expect(current.backspace()).toBe(false);
  });

  test("does not intercept manually indented whitespace or programmatic newline insertion", () => {
    const current = editor();
    const at = current.view.state.selection.main.head;
    current.view.dispatch({
      changes: { from: at, insert: "\n     " },
      selection: EditorSelection.cursor(at + 6),
    });
    expect(current.backspace()).toBe(false);
  });

  test.each([
    "input.paste",
    "input.drop",
    "input.type.compose",
    "undo",
    "redo",
    "set",
  ])("rejects %s while Enter is armed", (userEvent) => {
    const current = editor();
    current.event("keydown", "Enter");
    const at = current.view.state.selection.main.head;
    current.view.dispatch({
      changes: { from: at, insert: "\n     " },
      selection: EditorSelection.cursor(at + 6),
      userEvent,
    });
    expect(current.backspace()).toBe(false);
  });

  test("rejects remote edits while Enter is armed", () => {
    const current = editor();
    current.event("keydown", "Enter");
    const at = current.view.state.selection.main.head;
    current.view.dispatch({
      changes: { from: at, insert: "\n     " },
      selection: EditorSelection.cursor(at + 6),
      annotations: Transaction.remote.of(true),
    });
    expect(current.backspace()).toBe(false);
  });

  test("expires an unused Enter capture", async () => {
    const current = editor();
    current.event("keydown", "Enter");
    await Promise.resolve();
    const at = current.view.state.selection.main.head;
    current.view.dispatch({
      changes: { from: at, insert: "\n     " },
      selection: EditorSelection.cursor(at + 6),
    });
    expect(current.backspace()).toBe(false);
  });

  test.each([
    { shiftKey: true },
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { isComposing: true },
  ])("rejects modified or composing Enter %j", (extra) => {
    const current = editor();
    current.event("keydown", "Enter", extra);
    const at = current.view.state.selection.main.head;
    current.view.dispatch({
      changes: { from: at, insert: "\n     " },
      selection: EditorSelection.cursor(at + 6),
    });
    expect(current.backspace()).toBe(false);
  });

  test("rejects native Enter that removes existing code text", () => {
    const current = editor();
    current.event("keydown", "Enter");
    const at = current.view.state.selection.main.head;
    current.view.dispatch({
      changes: { from: at - 1, to: at, insert: "\n     " },
      selection: EditorSelection.cursor(at + 5),
    });
    expect(current.backspace()).toBe(false);
  });

  test("rejects additional edits in the Enter transaction", () => {
    const current = editor();
    current.event("keydown", "Enter");
    const at = current.view.state.selection.main.head;
    current.view.dispatch({
      changes: [
        { from: 0, insert: "x" },
        { from: at, insert: "\n     " },
      ],
      selection: EditorSelection.cursor(at + 7),
    });
    expect(current.backspace()).toBe(false);
  });

  test("rejects Enter whose new row has code text", () => {
    const current = editor(source, source.indexOf("llo") + 1);
    current.enter();
    expect(current.backspace()).toBe(false);
  });

  test("does not capture Enter while feature settings are disabled", () => {
    const current = editor();
    current.enable(false);
    current.enter();
    current.enable(true);
    expect(current.backspace()).toBe(false);
  });

  test("measurement updates and modifier keys retain the immediate receipt", () => {
    const current = editor();
    current.enter();
    current.view.dispatch({});
    current.event("keydown", "Shift");
    expect(current.backspace()).toBe(true);
  });

  test("receipts belong to their editor", () => {
    const first = editor();
    const second = editor();
    first.enter();
    expect(second.backspace()).toBe(false);
    expect(first.backspace()).toBe(true);
  });

  test.each(["disabled", "composing"])("obeys the %s gate", (gate) => {
    const current = editor();
    current.enter();
    if (gate === "disabled") current.enable(false);
    else Object.defineProperty(current.view, "composing", { value: true });
    expect(current.backspace()).toBe(false);
  });

  test("Undo and Redo restore the split and joined documents without reviving a receipt", () => {
    const current = editor();
    current.enter();
    const split = current.view.state.doc.toString();
    expect(current.backspace()).toBe(true);
    expect(undo(current.view)).toBe(true);
    expect(current.view.state.doc.toString()).toBe(split);
    expect(current.backspace()).toBe(false);
    expect(redo(current.view)).toBe(true);
    expect(current.view.state.doc.toString()).toBe(source);
    current.type("X");
    expect(current.view.state.doc.toString()).toBe(
      source.replace("llo  ", "lloX  "),
    );
  });

  test("supports repeated Enter and Backspace cycles", () => {
    const current = editor();
    for (let count = 0; count < 3; count++) {
      current.enter("     ", true);
      expect(current.backspace()).toBe(true);
      expect(current.view.state.doc.toString()).toBe(source);
    }
  });

  test.each(["plain text", "```\ncode\n```"])(
    "ignores Enter outside a code body in %j",
    (doc) => {
      const current = editor(doc, doc.length);
      current.enter();
      expect(current.backspace()).toBe(false);
    },
  );
});
