import { MyEditor } from "../../editor";
import {
  NO_OP_OUTCOME,
  Operation,
  OperationOutcome,
  STOP_ONLY_OUTCOME,
  UPDATED_OUTCOME,
} from "../../operations/Operation";
import { Root } from "../../root";
import { ChangesApplicator } from "../ChangesApplicator";
import { OperationPerformer } from "../OperationPerformer";
import { Parser } from "../Parser";

function makeSubject(parseResult: Root | null = null) {
  const parse = jest.fn().mockReturnValue(parseResult);
  const apply = jest.fn();
  const editor = {
    getCursor: jest.fn().mockReturnValue({ line: 1, ch: 2 }),
  } as unknown as MyEditor;
  const performer = new OperationPerformer(
    { parse } as unknown as Parser,
    { apply } as unknown as ChangesApplicator,
  );

  return { apply, editor, parse, performer };
}

function makeRoot() {
  const previousRoot = {} as Root;
  const root = {
    clone: jest.fn().mockReturnValue(previousRoot),
  } as unknown as Root;

  return { previousRoot, root };
}

function makeOperation(outcome: OperationOutcome) {
  const perform = jest.fn().mockReturnValue(outcome);
  const operation = { perform } as Operation;

  return { operation, perform };
}

describe("OperationPerformer", () => {
  test("returns the no-op outcome without creating an operation when there is no root", () => {
    const { apply, editor, performer } = makeSubject();
    const createOperation = jest.fn();

    const result = performer.perform(createOperation, editor);

    expect(createOperation).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(result).toBe(NO_OP_OUTCOME);
  });

  test("returns the no-op outcome when the operation factory returns null", () => {
    const { root } = makeRoot();
    const { apply, editor, performer } = makeSubject(root);
    const createOperation = jest.fn().mockReturnValue(null);

    const result = performer.perform(createOperation, editor);

    expect(createOperation).toHaveBeenCalledWith(root);
    expect(apply).not.toHaveBeenCalled();
    expect(result).toBe(NO_OP_OUTCOME);
  });

  test("preserves a stop-only outcome without applying changes", () => {
    const { root } = makeRoot();
    const { apply, editor, performer } = makeSubject();
    const { operation } = makeOperation(STOP_ONLY_OUTCOME);

    const result = performer.eval(root, operation, editor);

    expect(apply).not.toHaveBeenCalled();
    expect(result).toBe(STOP_ONLY_OUTCOME);
  });

  test("applies changes for an updated outcome", () => {
    const { previousRoot, root } = makeRoot();
    const { apply, editor, performer } = makeSubject();
    const { operation } = makeOperation(UPDATED_OUTCOME);

    const result = performer.eval(root, operation, editor);

    expect(apply).toHaveBeenCalledWith(editor, previousRoot, root);
    expect(result).toBe(UPDATED_OUTCOME);
  });

  test("executes an operation once and returns its exact outcome", () => {
    const { root } = makeRoot();
    const { editor, performer } = makeSubject();
    const outcome: OperationOutcome = {
      shouldStopPropagation: true,
      shouldUpdate: true,
    };
    const { operation, perform } = makeOperation(outcome);

    const result = performer.eval(root, operation, editor);

    expect(perform).toHaveBeenCalledTimes(1);
    expect(result).toBe(outcome);
  });
});
