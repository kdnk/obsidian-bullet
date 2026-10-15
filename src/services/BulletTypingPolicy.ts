import {
  ChangeSet,
  ChangeSpec,
  EditorState,
  Transaction,
  countColumn,
} from "@codemirror/state";

import { Logger } from "./Logger";
import {
  MarkdownLineClassifier,
  MarkdownLineInspection,
} from "./MarkdownLineClassifier";

import { getFenceContent } from "../utils/fencedCode";

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
const completedStructureRe = /^(?:~{3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;

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

    const typedCorrections = new Map<number, ConcreteChange>();
    for (const trigger of getTypedTriggers(transaction)) {
      const correction =
        this.getEmptyLineBulletStart(transaction, trigger) ??
        this.getStructuralPromotion(transaction, trigger);
      if (correction) {
        typedCorrections.set(
          transaction.newDoc.lineAt(trigger.fromAfter).number,
          correction,
        );
      }
    }

    const prefixCorrections = [
      ...typedCorrections.values(),
      ...this.getBlankCodeCorrections(transaction),
    ];
    const classificationState =
      prefixCorrections.length === 0
        ? transaction.state
        : EditorState.create({
            doc: ChangeSet.of(
              prefixCorrections,
              transaction.newDoc.length,
            ).apply(transaction.newDoc),
            extensions: this.classifier.extension,
          });
    const correctedLines = new Set(
      prefixCorrections.map(
        (change) => transaction.newDoc.lineAt(change.from).number,
      ),
    );
    const changes = [
      ...prefixCorrections,
      ...this.getBodyCorrections(
        transaction,
        getChangedLineNumbers(transaction),
        correctedLines,
        classificationState,
      ),
    ];
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
        if (this.isValidListJoin(transaction, affected, correctedLineNumbers)) {
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
        isBackwardLikeDeletion(transaction) &&
        listItem.isPlainEmpty &&
        !listItem.hasOwnedFollowingLine &&
        mappedLine.contentStart === mappedLine.to
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
      // Only the marker and a separator are required. Surplus spacing must
      // remain editable even though the classifier includes it in the prefix.
      if (
        existingPrefix.trimEnd() === listItem.prefix.trimEnd() &&
        /[ \t]$/.test(existingPrefix)
      ) {
        continue;
      }

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

  private isValidListJoin(
    transaction: Transaction,
    affected: AffectedPrefix,
    correctedLineNumbers: ReadonlySet<number>,
  ): boolean {
    const [range] = affected.ranges;
    if (
      range.fromBefore >= affected.before.from ||
      range.toBefore < affected.before.from
    ) {
      return false;
    }

    const joinedPosition = transaction.changes.mapPos(affected.before.from, -1);
    const joinedLine = transaction.newDoc.lineAt(joinedPosition);
    return (
      correctedLineNumbers.has(joinedLine.number) ||
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

  private getEmptyLineBulletStart(
    transaction: Transaction,
    trigger: TypedTrigger,
  ): ConcreteChange | null {
    if (trigger.value !== " ") {
      return null;
    }

    const beforeLine = transaction.startState.doc.lineAt(trigger.fromBefore);
    if (
      beforeLine.text !== "" ||
      trigger.fromBefore !== beforeLine.from ||
      this.classifier.classify(transaction.startState, beforeLine.number) !==
        "blank"
    ) {
      return null;
    }

    return { from: trigger.fromAfter, insert: "-" };
  }

  private getStructuralPromotion(
    transaction: Transaction,
    trigger: TypedTrigger,
  ): ConcreteChange | null {
    const beforeLine = transaction.startState.doc.lineAt(trigger.fromBefore);
    const before = this.classifier.inspect(
      transaction.startState,
      beforeLine.number,
    );
    const listItem = before.listItem;
    if (
      !listItem?.isRoot ||
      listItem.hasOwnedFollowingLine ||
      !/[ \t]$/.test(listItem.prefix)
    ) {
      return null;
    }

    const afterLine = transaction.newDoc.lineAt(trigger.fromAfter);
    if (!afterLine.text.startsWith(listItem.prefix)) {
      return null;
    }

    const startsStructure =
      listItem.isPlainEmpty &&
      trigger.fromBefore === before.from + listItem.contentStart &&
      structuralTriggers.has(trigger.value);
    const completesStructure =
      trigger.fromBefore === before.to &&
      !completedStructureRe.test(before.text.slice(listItem.contentStart)) &&
      completedStructureRe.test(afterLine.text.slice(listItem.contentStart));
    if (!startsStructure && !completesStructure) {
      return null;
    }

    return {
      from: afterLine.from,
      to: afterLine.from + listItem.prefix.length,
    };
  }

  private getBlankCodeCorrections(transaction: Transaction): ConcreteChange[] {
    const corrections = new Map<number, ConcreteChange>();
    transaction.changes.iterChanges(
      (fromBefore, toBefore, fromAfter, toAfter) => {
        const before = transaction.startState.doc.lineAt(fromBefore);
        if (before.text.trim().length !== 0 || toBefore > before.to) return;
        const fence = this.classifier.getCodeFence(
          transaction.startState,
          before.number,
        );
        if (!fence || fence.containerIndent === "") return;
        const firstLine = transaction.newDoc.lineAt(fromAfter).number;
        const lastLine = transaction.newDoc.lineAt(toAfter).number;
        for (let number = firstLine; number <= lastLine; number++) {
          const after = transaction.newDoc.line(number);
          if (
            after.text.trim().length === 0 ||
            getFenceContent(after.text, fence.containerIndent)
          )
            continue;
          const indent = after.text.match(/^[ \t]*/)?.[0] ?? "";
          const missingColumns =
            countColumn(fence.containerIndent, 4) - countColumn(indent, 4);
          corrections.set(number, {
            from: after.from + indent.length,
            insert:
              indent.length === 0
                ? fence.containerIndent
                : " ".repeat(missingColumns),
          });
        }
      },
      true,
    );
    return [...corrections.values()];
  }

  private getBodyCorrections(
    transaction: Transaction,
    lineNumbers = getChangedLineNumbers(transaction),
    excludedLineNumbers: ReadonlySet<number> = new Set(),
    classificationState = transaction.state,
  ): ConcreteChange[] {
    const changes: ConcreteChange[] = [];
    for (const lineNumber of lineNumbers) {
      if (excludedLineNumbers.has(lineNumber)) {
        continue;
      }
      if (
        this.classifier.classify(classificationState, lineNumber) === "body"
      ) {
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
    isNewlineInput(transaction) ||
    deletionUserEvents.some((event) => transaction.isUserEvent(event))
  );
}

function isNewlineInput(transaction: Transaction): boolean {
  if (transaction.annotation(Transaction.userEvent) !== "input") {
    return false;
  }

  let onlyNewlines = true;
  transaction.changes.iterChanges(
    (_fromBefore, _toBefore, _fromAfter, _toAfter, inserted) => {
      onlyNewlines &&= /^\n[ \t]*$/.test(inserted.toString());
    },
    true,
  );
  return onlyNewlines;
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

function isBackwardLikeDeletion(transaction: Transaction): boolean {
  return (
    transaction.isUserEvent("delete.backward") ||
    (transaction.annotation(Transaction.userEvent) === "input.type" &&
      isPureDeletionTransaction(transaction))
  );
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

function getTypedTriggers(transaction: Transaction): TypedTrigger[] {
  if (transaction.annotation(Transaction.userEvent) !== "input.type") {
    return [];
  }

  const carets = new Set(
    transaction.startState.selection.ranges
      .filter((range) => range.empty)
      .map((range) => range.head),
  );
  const triggers: TypedTrigger[] = [];
  transaction.changes.iterChanges(
    (fromBefore, toBefore, fromAfter, _toAfter, inserted) => {
      const value = inserted.toString();
      if (
        fromBefore === toBefore &&
        carets.has(fromBefore) &&
        value.length === 1
      ) {
        triggers.push({ fromBefore, fromAfter, value });
      }
    },
    true,
  );

  return triggers;
}

function getChangedLineNumbers(transaction: Transaction): number[] {
  const lineNumbers = new Set<number>();
  transaction.changes.iterChangedRanges(
    (_fromBefore, _toBefore, fromAfter, toAfter) => {
      const firstLine = transaction.newDoc.lineAt(fromAfter).number;
      const lastLine = transaction.newDoc.lineAt(toAfter).number;

      for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) {
        lineNumbers.add(lineNumber);
      }
    },
    true,
  );

  return [...lineNumbers].sort((left, right) => left - right);
}
