import { Plugin, TFile, editorInfoField } from "obsidian";

import { isolateHistory } from "@codemirror/commands";
import { foldedRanges, unfoldEffect } from "@codemirror/language";
import {
  ChangeSet,
  ChangeSpec,
  EditorSelection,
  EditorState,
  Extension,
  MapMode,
  Prec,
  StateEffect,
  StateField,
  Transaction,
  TransactionSpec,
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  Panel,
  ViewPlugin,
  ViewUpdate,
  keymap,
  showPanel,
} from "@codemirror/view";

import { Feature } from "./Feature";
import { stableFoldScrollSnapshot } from "./FoldScroll";
import { zoomIndentDecorations } from "./ListZoomIndent";
import { ListZoomInteraction } from "./ListZoomInteraction";

import { MyEditor, listItemInsertion } from "../editor";
import { getObsidianDomWindow } from "../obsidianDom";
import { CreateNewItem } from "../operations/CreateNewItem";
import { List, recalculateNumericBullets } from "../root";
import { Parser, Reader } from "../services/Parser";

export const setListZoom = StateEffect.define<number | null>();

const listBodyPrefixRe = /^[ \t]*(?:[-*+]|\d+\.)[ \t]/;
const emptyOrderedItemRe = /^([ \t]*)\d+\.(?:[ \t]+(?:\[ \][ \t]*)?)?$/;

interface ZoomRange {
  file: TFile | null;
  from: number;
  to: number;
  indent: string;
  ancestors: { from: number; label: string }[];
  indents: DecorationSet;
  decorations: DecorationSet;
  pendingMarkerRepair?: boolean;
}

function isWholeDocumentReplacement(tr: Transaction): boolean {
  let whole = false;
  tr.changes.iterChanges((from, to, _a, _b, inserted) => {
    if (from === 0 && to === tr.startState.doc.length && inserted.length > 0)
      whole = true;
  });
  return whole;
}

// A coarse replacement can include unchanged root/hidden text. Use its actual
// difference for identity tracking without rewriting the editor transaction.
function effectiveChanges(tr: Transaction, focusedFrom: number): ChangeSet {
  const changes: ChangeSpec[] = [];
  tr.changes.iterChanges((from, to, _a, _b, inserted) => {
    const before = tr.startState.doc.sliceString(from, to);
    const after = inserted.toString();
    let prefix = 0;
    while (
      prefix < Math.min(before.length, after.length) &&
      before[prefix] === after[prefix]
    )
      prefix++;
    // Match unchanged whole lines before resolving shared marker prefixes.
    // Otherwise inserting "\t- new\n" above "\t- project" makes the retained
    // "\t- " look like the new item's marker and changes the focused identity.
    prefix = prefix ? before.lastIndexOf("\n", prefix - 1) + 1 : 0;
    let suffix = 0;
    while (
      suffix < Math.min(before.length, after.length) - prefix &&
      before[before.length - suffix - 1] === after[after.length - suffix - 1]
    )
      suffix++;
    while (
      prefix < Math.min(before.length, after.length) - suffix &&
      before[prefix] === after[prefix]
    )
      prefix++;
    if (prefix !== before.length || prefix !== after.length) {
      let start = from + prefix;
      let end = to - suffix;
      let insert = after.slice(prefix, after.length - suffix);
      // A replacement can anchor before an unchanged separator or identical
      // empty siblings. Prefer the focused boundary only when moving the
      // insertion there produces exactly the same text and no other edit
      // changes the intervening context.
      if (from !== to && start === end && start < focusedFrom) {
        const context = tr.startState.doc.sliceString(start, focusedFrom);
        const combined = insert + context;
        let contextChanged = false;
        tr.changes.iterChanges((otherFrom, otherTo) => {
          if (otherFrom === from && otherTo === to) return;
          if (otherFrom < focusedFrom && otherTo >= start)
            contextChanged = true;
        }, true);
        if (!contextChanged && combined.startsWith(context)) {
          start = end = focusedFrom;
          insert = combined.slice(context.length);
        }
      }
      changes.push({ from: start, to: end, insert });
    }
  }, true);
  return ChangeSet.of(changes, tr.startState.doc.length);
}

function textChange(before: string, after: string, from: number): ChangeSpec {
  let prefix = 0;
  while (
    prefix < Math.min(before.length, after.length) &&
    before[prefix] === after[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < Math.min(before.length, after.length) - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  )
    suffix++;
  return {
    from: from + prefix,
    to: from + before.length - suffix,
    insert: after.slice(prefix, after.length - suffix),
  };
}

function zoomDecorations(
  indents: DecorationSet,
  from: number,
  to: number,
  length: number,
): DecorationSet {
  const hidden = [];
  if (from > 0) hidden.push(Decoration.replace({ block: true }).range(0, from));
  if (to < length)
    hidden.push(Decoration.replace({ block: true }).range(to, length));
  return indents.update({ add: hidden, sort: true });
}

function reader(state: EditorState, cursor?: number): Reader {
  const position = (offset: number) => {
    const line = state.doc.lineAt(offset);
    return { line: line.number - 1, ch: offset - line.from };
  };
  const pos = position(cursor ?? state.selection.main.head);
  return {
    getCursor: () => pos,
    getLine: (n) => state.doc.line(n + 1).text,
    lastLine: () => state.doc.lines - 1,
    listSelections: () =>
      cursor === undefined
        ? state.selection.ranges.map(({ anchor, head }) => ({
            anchor: position(anchor),
            head: position(head),
          }))
        : [{ anchor: pos, head: pos }],
    getAllFoldedLines: () => {
      const lines: number[] = [];
      foldedRanges(state).between(0, state.doc.length, (from) => {
        lines.push(state.doc.lineAt(from).number - 1);
      });
      return lines;
    },
  };
}

export class ListZoomState {
  readonly field: StateField<ZoomRange | null>;
  readonly extension: Extension;

  constructor(private parser: Parser) {
    this.field = StateField.define<ZoomRange | null>({
      create: () => null,
      update: (value, tr) => {
        const effect = tr.effects.find((e) => e.is(setListZoom));
        if (effect?.is(setListZoom)) {
          return effect.value === null
            ? null
            : this.resolve(tr.state, effect.value);
        }
        if (!value) return null;
        if (
          (tr.state.field(editorInfoField, false)?.file ?? null) !== value.file
        )
          return null;
        if (!tr.docChanged)
          return tr.startState.tabSize === tr.state.tabSize
            ? value
            : this.resolve(tr.state, value.from);
        const orderedInsertion = this.orderedInsertionChanges(tr, value);
        const localInsertion = tr.annotation(listItemInsertion) === true;
        const changes = orderedInsertion ?? effectiveChanges(tr, value.from);
        let mapped = changes.mapPos(value.from, 1, MapMode.TrackDel);
        if (mapped === null) return null;
        const rootLine = tr.startState.doc.lineAt(value.from);
        // Enter before an ordered body moves it to the following item while
        // renumbering its marker. The unchanged character prefix belongs to
        // the new empty sibling, so track the retained body in this case.
        const ordered = /^([ \t]*)(\d+\.[ \t]+)(\S.*)$/.exec(rootLine.text);
        if (ordered) {
          const body = changes.mapPos(
            rootLine.from + ordered[1].length + ordered[2].length,
            1,
            MapMode.TrackDel,
          );
          if (body !== null) {
            const bodyLine = tr.newDoc.lineAt(body);
            const nextOrdered = /^([ \t]*)(\d+\.[ \t]+)(.*)$/.exec(
              bodyLine.text,
            );
            const previous = tr.newDoc.lineAt(mapped);
            if (
              bodyLine.from > mapped &&
              emptyOrderedItemRe.test(previous.text) &&
              nextOrdered?.[1] === ordered[1] &&
              nextOrdered[3] === ordered[3] &&
              body ===
                bodyLine.from + nextOrdered[1].length + nextOrdered[2].length
            )
              mapped = bodyLine.from;
          }
        }
        if (value.pendingMarkerRepair) {
          const repaired = this.resolve(tr.state, mapped);
          return repaired?.from === tr.state.doc.lineAt(mapped).from
            ? repaired
            : null;
        }
        let changedOutside = false;
        let removedRootLine = false;
        changes.iterChangedRanges((from, to) => {
          if (from < value.from || to > value.to) changedOutside = true;
          // Removing the marker through the line break can move the next
          // sibling to the old root's boundary. Marker-only changes are safe.
          if (from <= value.from + value.indent.length && to > rootLine.to)
            removedRootLine = true;
        });
        // Native history and synchronization carry a userEvent. Linter applies
        // unannotated, filter:false diffs, including frontmatter and EOF fixes.
        // Track the focused item through those programmatic changes instead.
        if (
          removedRootLine ||
          (changedOutside &&
            (!orderedInsertion || !localInsertion) &&
            (localInsertion ||
              tr.annotation(Transaction.userEvent) !== undefined ||
              isWholeDocumentReplacement(tr)))
        )
          return null;
        const bodyEdit = changedOutside ? null : this.mapBodyEdits(value, tr);
        if (bodyEdit) return bodyEdit;
        const next = this.resolve(tr.state, mapped);
        // Plugin and native Enter can split the focused root into a following
        // sibling. Reveal that sibling instead of redirecting continued typing
        // to the old root. The edit filter still rejects hidden document edits.
        const nativeInsertion =
          tr.isUserEvent("input") && tr.newDoc.lines > tr.startState.doc.lines;
        if (
          next &&
          (localInsertion || nativeInsertion) &&
          !orderedInsertion &&
          tr.newSelection.ranges.some((selection) => selection.to > next.to)
        )
          return null;
        // Prefix formatting may map the old start into the new indentation.
        // Mapping into body text means the original line merged into another
        // item; it must not silently become that item's focus.
        if (
          !next ||
          next.from > mapped ||
          mapped > next.from + next.indent.length
        ) {
          return this.isUnannotatedMarkerDeletion(value, tr)
            ? this.mapPendingMarkerRepair(value, tr, mapped)
            : null;
        }
        return next;
      },
      provide: (field) =>
        EditorView.decorations.from(
          field,
          (value) => value?.decorations ?? Decoration.none,
        ),
    });
    this.extension = [
      this.field,
      EditorState.transactionFilter.of((tr) => {
        const range = tr.startState.field(this.field, false);
        if (!range || tr.effects.some((e) => e.is(setListZoom))) return tr;
        // Allow file synchronization and programmatic setValue, then correct
        // the selection too if the same focused item survives the update.
        const whole = isWholeDocumentReplacement(tr);
        const external =
          tr.isUserEvent("set") ||
          (tr.annotation(Transaction.userEvent) === undefined && whole);
        let outside = false;
        const orderedInsertion = this.orderedInsertionChanges(tr, range);
        const localInsertion = tr.annotation(listItemInsertion) === true;
        const changes = orderedInsertion ?? effectiveChanges(tr, range.from);
        changes.iterChangedRanges((from, to) => {
          if (from < range.from || to > range.to) outside = true;
        });
        if (outside && !external) return [];
        const next = tr.state.field(this.field, false);
        // Local edits must leave the entire edited interval under the same
        // root. Character-range checks alone allow a child to become a hidden
        // sibling, or a paste at either boundary to escape the focused tree.
        if (
          tr.docChanged &&
          !external &&
          (!next ||
            next.indent !== range.indent ||
            next.from !== changes.mapPos(range.from, -1) ||
            (next.to < changes.mapPos(range.to, 1) &&
              /\S/.test(
                tr.newDoc.sliceString(next.to, changes.mapPos(range.to, 1)),
              )))
        )
          return [];
        if (!next) return tr;
        const low = next.from + next.indent.length;
        const clamp = (pos: number) => Math.max(low, Math.min(next.to, pos));
        // An empty sibling inserted before the focused body remains hidden.
        // Follow the original body instead of clamping the operation's empty
        // sibling selection to the marker of the retained item.
        const insertedBefore =
          localInsertion &&
          next.from > range.from &&
          tr.newSelection.main.to < low;
        const mappedSelection =
          (!tr.selection && external) || insertedBefore
            ? tr.startState.selection.map(changes)
            : tr.newSelection;
        const ranges = mappedSelection.ranges.map((r) =>
          EditorSelection.range(clamp(r.anchor), clamp(r.head)),
        );
        const selection = EditorSelection.create(
          ranges,
          mappedSelection.mainIndex,
        );
        return selection.eq(tr.newSelection)
          ? tr
          : [tr, { selection, sequential: true }];
      }),
      // Extenders also run for filter:false. Respect caller-owned selection,
      // but never leave it hidden after a coarse replacement bypasses clamping.
      EditorState.transactionExtender.of((tr) => {
        if (!isWholeDocumentReplacement(tr)) return null;
        const next = tr.state.field(this.field, false);
        if (!next) return null;
        const low = next.from + next.indent.length;
        return tr.newSelection.ranges.some(
          (range) => range.from < low || range.to > next.to,
        )
          ? { effects: setListZoom.of(null) }
          : null;
      }),
    ];
  }

  range(state: EditorState) {
    return state.field(this.field, false) ?? null;
  }

  childInsertion(
    state: EditorState,
    from: number,
    defaultIndentChars: string,
    atEnd = false,
    numericBullets = true,
    overrideDescendants = true,
  ): TransactionSpec | null {
    const focused = this.resolve(state, from);
    if (!focused) return null;
    if (
      !atEnd &&
      state.selection.ranges.some(
        (selection) =>
          selection.from < focused.from || selection.to > focused.to,
      )
    )
      return null;
    const source = reader(state, atEnd ? focused.to : undefined);
    const root = this.parser.parse(source);
    const list = root?.getListUnderLine(state.doc.lineAt(from).number - 1);
    if (!root || !list || (atEnd && !list.isEmpty())) return null;
    const current = root.getListUnderCursor();
    if (
      current !== list &&
      (!overrideDescendants ||
        (!numericBullets && /^\d+\.$/.test(current.getBullet())))
    )
      return null;
    if (
      current.getFirstLineContentStart().line <
      state.doc.lineAt(from).number - 1
    )
      return null;
    const start = root.getContentStart();
    const rootFrom = state.doc.line(start.line + 1).from + start.ch;
    const outcome = new CreateNewItem(
      root,
      defaultIndentChars,
      false,
      true,
      state.doc.sliceString(0, rootFrom),
      list,
    ).perform();
    if (!outcome.shouldUpdate) return null;
    const before = state.doc.sliceString(focused.from, focused.to);
    const inserted = list.print().slice(0, -1);
    const insertion = state.changes(textChange(before, inserted, focused.from));
    const insertedDoc = insertion.apply(state.doc);
    const cursor = root.getCursor();
    const cursorOffset = insertedDoc.line(cursor.line + 1).from + cursor.ch;

    // Numbering can touch distant siblings. Keep those marker edits separate
    // from the insertion so native list/code folds and viewport positions map
    // through unchanged content without reconstructing their boundaries.
    recalculateNumericBullets(list, numericBullets);
    const numberedLines = list.print().slice(0, -1).split("\n");
    const numbering: ChangeSpec[] = [];
    let offset = focused.from;
    inserted.split("\n").forEach((line, index) => {
      if (line !== numberedLines[index])
        numbering.push(textChange(line, numberedLines[index], offset));
      offset += line.length + 1;
    });
    const renumbering = ChangeSet.of(numbering, insertedDoc.length);
    return {
      changes: insertion.compose(renumbering),
      selection: { anchor: renumbering.mapPos(cursorOffset, 1) },
      userEvent: "input",
      annotations: isolateHistory.of("full"),
    };
  }

  private orderedInsertionChanges(
    tr: Transaction,
    focused: ZoomRange,
  ): ChangeSet | null {
    if (
      tr.isUserEvent("set") ||
      tr.isUserEvent("undo") ||
      tr.isUserEvent("redo")
    )
      return null;
    const added = tr.newDoc.lines - tr.startState.doc.lines;
    if (added <= 0) return null;
    const rootLine = tr.startState.doc.lineAt(focused.from);
    if (!/^[ \t]*\d+\.[ \t]+\S/.test(rootLine.text)) return null;
    for (let n = rootLine.number; n < rootLine.number + added; n++) {
      const empty = emptyOrderedItemRe.exec(tr.newDoc.line(n).text);
      if (empty?.[1] !== focused.indent) return null;
    }
    const parsed = this.parser.parse(reader(tr.startState), {
      line: rootLine.number - 1,
      ch: 0,
    });
    if (!parsed?.getListUnderLine(rootLine.number - 1)) return null;
    const orderedLines = new Set<number>();
    let line = parsed.getContentStart().line + 1;
    const collectOrderedLines = (lists: List[]) => {
      for (const list of lists) {
        if (/^\d+\.$/.test(list.getBullet())) orderedLines.add(line);
        line += list.getLineCount();
        collectOrderedLines(list.getChildren());
      }
    };
    collectOrderedLines(parsed.getChildren());
    const changes: ChangeSpec[] = [
      {
        from: rootLine.from,
        insert: tr.newDoc.sliceString(
          tr.newDoc.line(rootLine.number).from,
          tr.newDoc.line(rootLine.number + added).from,
        ),
      },
    ];
    // Recognize only empty siblings inserted before this root, with every
    // retained body unchanged. CreateNewItem renumbers the entire parsed tree;
    // hidden number-only edits must be real markers in that tree, never code
    // content or another list chunk.
    for (let n = 1; n <= tr.startState.doc.lines; n++) {
      const before = tr.startState.doc.line(n);
      const after = tr.newDoc.line(n < rootLine.number ? n : n + added);
      if (before.text === after.text) continue;
      const oldMarker = /^([ \t]*)(\d+)(\.(?:[ \t]+.*)?)$/.exec(before.text);
      const newMarker = /^([ \t]*)(\d+)(\.(?:[ \t]+.*)?)$/.exec(after.text);
      if (
        !oldMarker ||
        !newMarker ||
        oldMarker[1] !== newMarker[1] ||
        oldMarker[3] !== newMarker[3] ||
        ((before.from < focused.from || before.to > focused.to) &&
          !orderedLines.has(n))
      )
        return null;
      const from = before.from + oldMarker[1].length;
      changes.push({
        from,
        to: from + oldMarker[2].length,
        insert: newMarker[2],
      });
    }
    return ChangeSet.of(changes, tr.startState.doc.length);
  }

  private mapBodyEdits(value: ZoomRange, tr: Transaction): ZoomRange | null {
    let onlyBodyEdits = true;
    let focusedLabel: string | undefined;
    tr.changes.iterChanges((from, to, fromAfter, _toAfter, inserted) => {
      if (!onlyBodyEdits) return;
      const line = tr.startState.doc.lineAt(from);
      const prefix = listBodyPrefixRe.exec(line.text)?.[0];
      // Keep markers, indentation and line breaks on the full parser path.
      // A bare marker also needs parsing when its first separator is added.
      if (
        !prefix ||
        from < line.from + prefix.length ||
        to > line.to ||
        inserted.lines !== 1
      ) {
        onlyBodyEdits = false;
        return;
      }
      if (line.from === value.from)
        focusedLabel =
          tr.newDoc.lineAt(fromAfter).text.slice(prefix.length) || "Empty item";
    }, true);
    if (!onlyBodyEdits) return null;
    const to = tr.changes.mapPos(value.to, 1);
    const indents = value.indents.map(tr.changes);
    const label = focusedLabel;
    const ancestors =
      label === undefined ||
      label === value.ancestors[value.ancestors.length - 1]?.label
        ? value.ancestors
        : value.ancestors.map((ancestor) =>
            ancestor.from === value.from ? { ...ancestor, label } : ancestor,
          );
    return {
      ...value,
      to,
      ancestors,
      indents,
      // Rebuild the two boundaries so text inserted at the visible end stays
      // visible; mapping an inclusive block replacement would hide it.
      decorations: zoomDecorations(indents, value.from, to, tr.newDoc.length),
    };
  }

  private isUnannotatedMarkerDeletion(
    value: ZoomRange,
    tr: Transaction,
  ): boolean {
    if (tr.annotation(Transaction.userEvent) !== undefined) return false;
    const deletions: { from: number; to: number }[] = [];
    let invalid = false;
    tr.changes.iterChanges((from, to, _fromAfter, _toAfter, inserted) => {
      if (inserted.length !== 0 || from === to) {
        invalid = true;
        return;
      }
      deletions.push({ from, to });
    });
    if (invalid || deletions.length !== 1) return false;
    const deletion = deletions[0];
    const line = tr.startState.doc.lineAt(deletion.from);
    const match = /^([ \t]*)(?:[-*+]|\d+\.)/.exec(line.text);
    if (
      match === null ||
      deletion.from !== line.from + match[1].length ||
      deletion.to !== line.from + match[0].length
    ) {
      return false;
    }
    const root = this.parser.parse(reader(tr.startState), {
      line: line.number - 1,
      ch: 0,
    });
    if (!root) return false;
    const focusedLine = tr.startState.doc.lineAt(value.from).number - 1;
    return (
      root.getContentStart().line <= focusedLine &&
      root.getContentEnd().line >= focusedLine
    );
  }

  private mapPendingMarkerRepair(
    value: ZoomRange,
    tr: Transaction,
    from: number,
  ): ZoomRange {
    const to = tr.changes.mapPos(value.to, 1);
    const indents = value.indents.map(tr.changes);
    return {
      ...value,
      from,
      to,
      ancestors: value.ancestors.map((ancestor) => ({
        ...ancestor,
        from: tr.changes.mapPos(ancestor.from, 1),
      })),
      indents,
      decorations: zoomDecorations(indents, from, to, tr.newDoc.length),
      pendingMarkerRepair: true,
    };
  }

  resolve(state: EditorState, offset: number): ZoomRange | null {
    if (offset < 0 || offset > state.doc.length) return null;
    const line = state.doc.lineAt(offset).number - 1;
    const root = this.parser.parse(reader(state), { line, ch: 0 });
    const list = root?.getListUnderLine(line);
    if (!list) return null;
    const from = state.doc.line(list.getFirstLineContentStart().line + 1).from;
    const to = state.doc.line(
      list.getContentEndIncludingChildren().line + 1,
    ).to;
    const indent = list.getFirstLineIndent();
    const ancestors: ZoomRange["ancestors"] = [];
    let ancestor: List | null = list;
    while (ancestor && ancestor.getParent()) {
      const start = state.doc.line(
        ancestor.getFirstLineContentStart().line + 1,
      );
      ancestors.unshift({
        from: start.from,
        label: ancestor.getLines()[0] || "Empty item",
      });
      ancestor = ancestor.getParent();
    }
    const indents = zoomIndentDecorations(state, from, to, indent);
    return {
      file: state.field(editorInfoField, false)?.file ?? null,
      from,
      to,
      indent,
      ancestors,
      indents,
      decorations: zoomDecorations(indents, from, to, state.doc.length),
    };
  }
}

export class ListZoom implements Feature {
  private zoom: ListZoomState;
  private snapshots = new WeakMap<EditorView, StateEffect<unknown>>();

  constructor(
    private plugin: Plugin,
    parser: Parser,
    private defaultIndentChars = () => "\t",
    private imeIsOpened = () => false,
    private numericBullets = () => true,
    private overrideDescendants = () => true,
  ) {
    this.zoom = new ListZoomState(parser);
  }

  range(state: EditorState) {
    return this.zoom.range(state);
  }

  async load() {
    this.plugin.registerEditorExtension([
      this.zoom.extension,
      Prec.highest(
        keymap.of([
          {
            key: "Enter",
            run: (view) => {
              const range = this.zoom.range(view.state);
              if (!range || view.composing || this.imeIsOpened()) return false;
              const insertion = this.zoom.childInsertion(
                view.state,
                range.from,
                this.defaultIndentChars(),
                false,
                this.numericBullets(),
                this.overrideDescendants(),
              );
              if (!insertion) return false;
              view.dispatch(insertion);
              // Record the accepted destination for Obsidian's native redo.
              view.dispatch({ selection: view.state.selection });
              return true;
            },
          },
        ]),
      ),
      ViewPlugin.define(
        (view) =>
          new ListZoomInteraction(
            view,
            () => this.zoom.range(view.state) !== null,
            (from) => this.navigate(view, from),
          ),
      ),
      showPanel.from(this.zoom.field, (range) => (range ? this.panel : null)),
    ]);
    this.plugin.addCommand({
      id: "zoom-in",
      name: "Zoom into list",
      icon: "focus",
      editorCheckCallback: (checking, editor) => {
        const view = new MyEditor(editor).getCodeMirrorView();
        const target = this.zoom.resolve(
          view.state,
          view.state.selection.main.head,
        );
        if (!target) return false;
        if (!checking) this.navigate(view, target.from);
        return true;
      },
    });
    this.plugin.addCommand({
      id: "zoom-out",
      name: "Zoom out one level",
      icon: "arrow-up-left",
      editorCheckCallback: (checking, editor) => {
        const view = new MyEditor(editor).getCodeMirrorView();
        const range = this.zoom.range(view.state);
        if (!range) return false;
        if (!checking)
          this.navigate(
            view,
            range.ancestors[range.ancestors.length - 2]?.from ?? null,
          );
        return true;
      },
    });
    this.plugin.addCommand({
      id: "zoom-reset",
      name: "Show whole note",
      icon: "maximize",
      editorCheckCallback: (checking, editor) => {
        const view = new MyEditor(editor).getCodeMirrorView();
        if (!this.zoom.range(view.state)) return false;
        if (!checking) this.navigate(view, null);
        return true;
      },
    });
  }

  async unload() {}

  private navigate(view: EditorView, from: number | null) {
    const effects: StateEffect<unknown>[] = [setListZoom.of(from)];
    if (from !== null) {
      const entering = !this.zoom.range(view.state);
      if (entering) this.snapshots.set(view, stableFoldScrollSnapshot(view));
      const range = this.zoom.resolve(view.state, from);
      if (!range) return;
      const insertion = this.zoom.childInsertion(
        view.state,
        range.from,
        this.defaultIndentChars(),
        true,
        this.numericBullets(),
      );
      // The breadcrumb panel does not exist on initial entry, so it cannot
      // map the return position through the newly created child yet.
      if (entering && insertion?.changes) {
        const snapshot = this.snapshots
          .get(view)
          ?.map(view.state.changes(insertion.changes));
        if (snapshot) this.snapshots.set(view, snapshot);
      }
      // Reveal ancestors as well as a folded focused root before narrowing.
      foldedRanges(view.state).between(0, range.to, (a, b) => {
        if (a <= from && b > from)
          effects.push(unfoldEffect.of({ from: a, to: b }));
        else if (view.state.doc.lineAt(a).from === from)
          effects.push(unfoldEffect.of({ from: a, to: b }));
      });
      effects.push(
        EditorView.scrollIntoView(from + range.indent.length, { y: "start" }),
      );
      view.dispatch({
        ...insertion,
        effects,
        selection: insertion?.selection ?? {
          anchor: Math.min(range.to, from + range.indent.length + 2),
        },
      });
      if (insertion) view.dispatch({ selection: view.state.selection });
    } else {
      const snapshot = this.snapshots.get(view);
      if (snapshot) effects.push(snapshot);
      this.snapshots.delete(view);
      view.dispatch({ effects });
    }
    view.focus();
  }

  private panel = (view: EditorView): Panel => {
    const dom = getObsidianDomWindow(view.dom.ownerDocument).createDiv();
    dom.classList.add("bullet-zoom-breadcrumbs");
    dom.setAttribute("role", "navigation");
    dom.setAttribute("aria-label", "List zoom");
    const noteName = () =>
      view.state.field(editorInfoField, false)?.file?.basename ?? "Note";
    let renderedNoteName = "";
    const render = () => {
      dom.replaceChildren();
      const range = this.zoom.range(view.state);
      renderedNoteName = noteName();
      const items = range
        ? [{ from: null, label: renderedNoteName }, ...range.ancestors]
        : [];
      for (const [index, item] of items.entries()) {
        if (index) dom.createSpan({ text: "›", cls: "bullet-zoom-separator" });
        const button = dom.createEl("button", { text: item.label });
        button.title = item.label;
        if (index === items.length - 1)
          button.setAttribute("aria-current", "location");
        button.addEventListener("click", () => this.navigate(view, item.from));
      }
    };
    render();
    const vault = this.plugin.app.vault;
    const rename = vault.on("rename", (file) => {
      if (file === view.state.field(editorInfoField, false)?.file) render();
    });
    return {
      dom,
      top: true,
      destroy: () => vault.offref(rename),
      update: (update: ViewUpdate) => {
        const snapshot = this.snapshots.get(view);
        if (snapshot && update.docChanged) {
          const mapped = snapshot.map(update.changes);
          if (mapped) this.snapshots.set(view, mapped);
        }
        const before = this.zoom.range(update.startState)?.ancestors ?? [];
        const after = this.zoom.range(update.state)?.ancestors ?? [];
        if (
          renderedNoteName !== noteName() ||
          before.length !== after.length ||
          before.some(
            (ancestor, index) =>
              ancestor.from !== after[index].from ||
              ancestor.label !== after[index].label,
          )
        )
          render();
      },
    };
  };
}
