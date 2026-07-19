import { ChangeSpec, Transaction } from "@codemirror/state";

import { Logger } from "./Logger";
import {
  MarkdownLineClassifier,
  MarkdownLineInspection,
} from "./MarkdownLineClassifier";

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
  value: string;
}

interface DeletedRange {
  fromBefore: number;
  toBefore: number;
}

interface AffectedPrefix {
  before: MarkdownLineInspection;
  ranges: DeletedRange[];
}

interface ConcreteChange {
  from: number;
  to?: number;
  insert?: string;
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

    if (
      isDeletionUserEvent(transaction) ||
      isPureDeletionTransaction(transaction)
    ) {
      return this.getDeletionDecision(transaction);
    }

    const bulletStart = this.getEmptyLineBulletStart(transaction);
    if (bulletStart) {
      return { kind: "correct", changes: [bulletStart] };
    }

    const promotion = this.getStructuralPromotion(transaction);
    if (promotion) {
      return { kind: "correct", changes: [promotion] };
    }

    const changes = this.getBodyCorrections(transaction);
    return changes.length > 0 ? { kind: "correct", changes } : { kind: "pass" };
  }

  private getDeletionDecision(transaction: Transaction): BulletTypingDecision {
    const affectedPrefixes = this.getAffectedPrefixes(transaction);
    const corrections: ConcreteChange[] = [];
    const correctedLineNumbers = new Set<number>();

    for (const affected of affectedPrefixes) {
      if (affected.ranges.length !== 1) {
        return { kind: "reject" };
      }

      if (isEntireLineDeleted(affected)) {
        continue;
      }

      const mappedLine = getMappedLine(transaction, affected.before);
      if (!mappedLine) {
        if (this.isValidForwardListJoin(transaction, affected)) {
          continue;
        }
        return { kind: "reject" };
      }

      if (correctedLineNumbers.has(mappedLine.number)) {
        return { kind: "reject" };
      }
      correctedLineNumbers.add(mappedLine.number);

      const listItem = affected.before.listItem!;
      if (
        transaction.isUserEvent("delete.backward") &&
        listItem.isPlainEmpty &&
        !listItem.hasOwnedFollowingLine
      ) {
        const removal = getEmptyLeafRemoval(transaction, mappedLine);
        if (!removal) {
          return { kind: "reject" };
        }
        corrections.push(removal);
        continue;
      }

      const existingPrefix = transaction.newDoc.sliceString(
        mappedLine.from,
        mappedLine.contentStart,
      );
      if (existingPrefix !== listItem.prefix) {
        corrections.push({
          from: mappedLine.from,
          to: mappedLine.contentStart,
          insert: listItem.prefix,
        });
      }
    }

    corrections.push(
      ...this.getBodyCorrections(
        transaction,
        getSameLineDeletionNumbers(transaction),
        correctedLineNumbers,
      ),
    );

    corrections.sort(
      (left, right) =>
        left.from - right.from ||
        (left.to ?? left.from) - (right.to ?? right.from),
    );
    for (let index = 1; index < corrections.length; index++) {
      const previous = corrections[index - 1];
      if (corrections[index].from < (previous.to ?? previous.from)) {
        return { kind: "reject" };
      }
    }

    return corrections.length > 0
      ? { kind: "correct", changes: corrections }
      : { kind: "pass" };
  }

  private isValidForwardListJoin(
    transaction: Transaction,
    affected: AffectedPrefix,
  ): boolean {
    const [range] = affected.ranges;
    if (
      !transaction.isUserEvent("delete.forward") ||
      range.fromBefore !== affected.before.from - 1 ||
      range.toBefore !== affected.before.from
    ) {
      return false;
    }

    const joinedPosition = transaction.changes.mapPos(affected.before.from, -1);
    const joinedLine = transaction.newDoc.lineAt(joinedPosition);
    return (
      this.classifier.classify(transaction.state, joinedLine.number) ===
      "list-item"
    );
  }

  private getAffectedPrefixes(transaction: Transaction): AffectedPrefix[] {
    const deletedRanges = getDeletedRanges(transaction);
    const affectedByLine = new Map<number, AffectedPrefix>();

    for (const range of deletedRanges) {
      const firstLine = transaction.startState.doc.lineAt(
        range.fromBefore,
      ).number;
      const lastLine = transaction.startState.doc.lineAt(range.toBefore).number;

      for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) {
        let affected = affectedByLine.get(lineNumber);
        if (!affected) {
          const before = this.classifier.inspect(
            transaction.startState,
            lineNumber,
          );
          const listItem = before.listItem;
          if (!listItem) {
            continue;
          }
          affected = { before, ranges: [] };
          affectedByLine.set(lineNumber, affected);
        }

        const prefixTo =
          affected.before.from + affected.before.listItem!.contentStart;
        if (
          (range.fromBefore < prefixTo &&
            range.toBefore > affected.before.from) ||
          range.toBefore === affected.before.from
        ) {
          affected.ranges.push(range);
        }
      }
    }

    return [...affectedByLine.values()]
      .filter(({ ranges }) => ranges.length > 0)
      .sort((left, right) => left.before.from - right.before.from);
  }

  private getEmptyLineBulletStart(transaction: Transaction): ChangeSpec | null {
    if (transaction.annotation(Transaction.userEvent) !== "input.type") {
      return null;
    }

    const trigger = getSingleTypedTrigger(transaction);
    if (!trigger || trigger.value !== " ") {
      return null;
    }

    const beforeLine = transaction.startState.doc.lineAt(trigger.fromBefore);
    if (beforeLine.text !== "" || trigger.fromBefore !== beforeLine.from) {
      return null;
    }

    return { from: trigger.fromAfter, insert: "-" };
  }

  private getStructuralPromotion(transaction: Transaction): ChangeSpec | null {
    const trigger = getSingleTypedTrigger(transaction);
    if (!trigger || !structuralTriggers.has(trigger.value)) {
      return null;
    }

    const beforeLine = transaction.startState.doc.lineAt(trigger.fromBefore);
    const before = this.classifier.inspect(
      transaction.startState,
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

  private getBodyCorrections(
    transaction: Transaction,
    lineNumbers = getChangedLineNumbers(transaction),
    excludedLineNumbers: ReadonlySet<number> = new Set(),
  ): ConcreteChange[] {
    const changes: ConcreteChange[] = [];
    for (const lineNumber of lineNumbers) {
      if (excludedLineNumbers.has(lineNumber)) {
        continue;
      }
      if (this.classifier.classify(transaction.state, lineNumber) === "body") {
        changes.push({
          from: transaction.newDoc.line(lineNumber).from,
          insert: "- ",
        });
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

function isDeletionUserEvent(transaction: Transaction): boolean {
  return deletionUserEvents.some((event) => transaction.isUserEvent(event));
}

function isPureDeletionTransaction(transaction: Transaction): boolean {
  let hasDeletion = false;
  let hasInsertion = false;

  transaction.changes.iterChanges(
    (fromBefore, toBefore, _fromAfter, _toAfter, inserted) => {
      hasDeletion ||= toBefore > fromBefore;
      hasInsertion ||= inserted.length > 0;
    },
    true,
  );

  return hasDeletion && !hasInsertion;
}

function getDeletedRanges(transaction: Transaction): DeletedRange[] {
  const ranges: DeletedRange[] = [];
  transaction.changes.iterChanges((fromBefore, toBefore) => {
    if (toBefore > fromBefore) {
      ranges.push({ fromBefore, toBefore });
    }
  }, true);
  return ranges;
}

function getSameLineDeletionNumbers(transaction: Transaction): number[] {
  const lineNumbers = new Set<number>();

  for (const range of getDeletedRanges(transaction)) {
    const beforeStartLine = transaction.startState.doc.lineAt(range.fromBefore);
    const beforeEndLine = transaction.startState.doc.lineAt(range.toBefore);
    if (beforeStartLine.number !== beforeEndLine.number) {
      continue;
    }

    const mappedLineStart = transaction.changes.mapPos(
      beforeStartLine.from,
      -1,
    );
    const mappedLine = transaction.newDoc.lineAt(mappedLineStart);
    if (mappedLine.from === mappedLineStart) {
      lineNumbers.add(mappedLine.number);
    }
  }

  return [...lineNumbers].sort((left, right) => left - right);
}

function isEntireLineDeleted(affected: AffectedPrefix): boolean {
  const [range] = affected.ranges;
  return (
    range.fromBefore <= affected.before.from &&
    range.toBefore >= affected.before.to
  );
}

interface MappedLine {
  number: number;
  from: number;
  to: number;
  contentStart: number;
}

function getMappedLine(
  transaction: Transaction,
  before: MarkdownLineInspection,
): MappedLine | null {
  const listItem = before.listItem!;
  const mappedLineStart = transaction.changes.mapPos(before.from, -1);
  const mappedContentStart = transaction.changes.mapPos(
    before.from + listItem.contentStart,
    1,
  );
  const startLine = transaction.newDoc.lineAt(mappedLineStart);
  const contentLine = transaction.newDoc.lineAt(mappedContentStart);

  if (
    startLine.number !== contentLine.number ||
    startLine.from !== mappedLineStart ||
    mappedContentStart < startLine.from ||
    mappedContentStart > startLine.to
  ) {
    return null;
  }

  return {
    number: startLine.number,
    from: startLine.from,
    to: startLine.to,
    contentStart: mappedContentStart,
  };
}

function getEmptyLeafRemoval(
  transaction: Transaction,
  line: MappedLine,
): ConcreteChange | null {
  if (line.contentStart !== line.to) {
    return null;
  }

  if (transaction.newDoc.lines === 1) {
    return { from: line.from, to: line.to };
  }

  if (line.number < transaction.newDoc.lines) {
    return {
      from: line.from,
      to: transaction.newDoc.line(line.number + 1).from,
    };
  }

  return {
    from: transaction.newDoc.line(line.number - 1).to,
    to: line.to,
  };
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
        value.length === 1
      ) {
        trigger = { fromBefore, fromAfter, value };
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
