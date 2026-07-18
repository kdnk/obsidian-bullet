import { ChangeSpec, Transaction } from "@codemirror/state";

import { Logger } from "./Logger";
import { MarkdownLineClassifier } from "./MarkdownLineClassifier";

export type BulletTypingDecision =
  | { kind: "pass" }
  | { kind: "correct"; changes: readonly ChangeSpec[] }
  | { kind: "reject" };

const deletionUserEvents = [
  "delete.backward",
  "delete.forward",
  "delete.selection",
  "delete.cut",
] as const;

const structuralTriggers = new Set(["#", ">", "`", "-"]);

interface TypedTrigger {
  fromBefore: number;
  fromAfter: number;
}

export class BulletTypingPolicy {
  constructor(
    private classifier: MarkdownLineClassifier,
    private logger: Logger,
  ) {}

  decide(transaction: Transaction): BulletTypingDecision {
    try {
      return this.decideSafely(transaction);
    } catch (error) {
      this.logger.log("bulletTypingPolicy", error);
      return { kind: "pass" };
    }
  }

  private decideSafely(transaction: Transaction): BulletTypingDecision {
    if (
      !transaction.docChanged ||
      transaction.annotation(Transaction.remote) === true ||
      !isSupportedUserEvent(transaction)
    ) {
      return { kind: "pass" };
    }

    if (!transaction.isUserEvent("input.type")) {
      return { kind: "pass" };
    }

    const promotion = this.getStructuralPromotion(transaction);
    if (promotion) {
      return { kind: "correct", changes: [promotion] };
    }

    const changes = this.getBodyCorrections(transaction);
    return changes.length > 0 ? { kind: "correct", changes } : { kind: "pass" };
  }

  private getStructuralPromotion(transaction: Transaction): ChangeSpec | null {
    const trigger = getSingleTypedTrigger(transaction);
    if (!trigger) {
      return null;
    }

    const beforeLine = transaction.startState.doc.lineAt(trigger.fromBefore);
    const before = this.classifier.inspect(
      transaction.startState.doc,
      beforeLine.number,
    );
    const listItem = before.listItem;
    if (
      !listItem?.isRoot ||
      !listItem.isPlainEmpty ||
      listItem.hasOwnedFollowingLine ||
      trigger.fromBefore !== before.from + listItem.contentStart
    ) {
      return null;
    }

    const afterLine = transaction.newDoc.lineAt(trigger.fromAfter);
    if (!afterLine.text.startsWith(listItem.prefix)) {
      return null;
    }

    return {
      from: afterLine.from,
      to: afterLine.from + listItem.prefix.length,
    };
  }

  private getBodyCorrections(transaction: Transaction): ChangeSpec[] {
    const changes: ChangeSpec[] = [];
    for (const lineNumber of getChangedLineNumbers(transaction)) {
      const inspection = this.classifier.inspect(
        transaction.newDoc,
        lineNumber,
      );
      if (inspection.kind === "body") {
        changes.push({ from: inspection.from, insert: "- " });
      }
    }
    return changes;
  }
}

function isSupportedUserEvent(transaction: Transaction): boolean {
  return (
    transaction.isUserEvent("input.type") ||
    deletionUserEvents.some((event) => transaction.isUserEvent(event))
  );
}

function getSingleTypedTrigger(transaction: Transaction): TypedTrigger | null {
  const selection = transaction.startState.selection;
  if (selection.ranges.length !== 1 || !selection.main.empty) {
    return null;
  }

  let changeCount = 0;
  let trigger: TypedTrigger | null = null;
  transaction.changes.iterChanges(
    (fromBefore, toBefore, fromAfter, _toAfter, inserted) => {
      changeCount += 1;
      const value = inserted.toString();
      if (
        fromBefore === toBefore &&
        selection.main.anchor === fromBefore &&
        selection.main.head === fromBefore &&
        structuralTriggers.has(value) &&
        value.length === 1
      ) {
        trigger = { fromBefore, fromAfter };
      }
    },
    true,
  );

  return changeCount === 1 ? trigger : null;
}

function getChangedLineNumbers(transaction: Transaction): number[] {
  const lineNumbers = new Set<number>();
  transaction.changes.iterChangedRanges(
    (_fromBefore, _toBefore, fromAfter, toAfter) => {
      const firstLine = transaction.newDoc.lineAt(fromAfter).number;
      const lastChangedPosition = toAfter > fromAfter ? toAfter - 1 : fromAfter;
      const lastLine = transaction.newDoc.lineAt(lastChangedPosition).number;

      for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) {
        lineNumbers.add(lineNumber);
      }
    },
    true,
  );

  return [...lineNumbers].sort((left, right) => left - right);
}
