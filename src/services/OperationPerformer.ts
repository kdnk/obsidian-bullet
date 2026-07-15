import { ChangesApplicator } from "./ChangesApplicator";
import { Parser } from "./Parser";

import { MyEditor } from "../editor";
import {
  NO_OP_OUTCOME,
  Operation,
  OperationOutcome,
} from "../operations/Operation";
import { Root } from "../root";

export class OperationPerformer {
  constructor(
    private parser: Parser,
    private changesApplicator: ChangesApplicator,
  ) {}

  eval(root: Root, op: Operation, editor: MyEditor): OperationOutcome {
    const prevRoot = root.clone();
    const outcome = op.perform();

    if (outcome.shouldUpdate) {
      this.changesApplicator.apply(editor, prevRoot, root);
    }

    return outcome;
  }

  perform(
    createOperation: (root: Root) => Operation | null,
    editor: MyEditor,
    cursor = editor.getCursor(),
  ): OperationOutcome {
    const root = this.parser.parse(editor, cursor);

    if (!root) {
      return NO_OP_OUTCOME;
    }

    const op = createOperation(root);
    if (!op) {
      return NO_OP_OUTCOME;
    }

    return this.eval(root, op, editor);
  }
}
