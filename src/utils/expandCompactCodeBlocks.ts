import { ChangeSpec, Text, countColumn } from "@codemirror/state";

import {
  FenceMarker,
  getFenceContent,
  getFenceOpening,
  isFenceClosing,
} from "./fencedCode";

interface ListPrefix {
  marker: string;
  spacing: string;
  markerOffset: number;
  contentOffset: number;
}

interface ListFence {
  from: number;
  text: string;
  prefixes: ListPrefix[];
  hasEmptyAncestor: boolean;
}

const markdownTabSize = 4;
const columns = (text: string) => countColumn(text, markdownTabSize);

function listPrefixes(text: string): ListPrefix[] {
  let offset = /^[ \t]*/.exec(text)![0].length;
  const result: ListPrefix[] = [];
  while (offset < text.length) {
    const match = /^([-*+]|\d+\.)([ \t]+|$)/.exec(text.slice(offset));
    if (!match) break;
    const [, marker, spacing] = match;
    const contentOffset = offset + match[0].length;
    // Five spaces after a marker start indented code, not another list.
    if (
      columns(text.slice(0, contentOffset)) -
        columns(text.slice(0, offset + marker.length)) >
      4
    ) {
      break;
    }
    result.push({ marker, spacing, markerOffset: offset, contentOffset });
    offset = contentOffset;
  }
  return result;
}

function htmlBlockEnd(text: string): RegExp | null {
  const content = text.replace(/^[ \t]{0,3}/, "");
  const raw = /^<(pre|script|style|textarea)(?:\s|>|$)/i.exec(content);
  if (raw) return new RegExp(`</${raw[1]}\\s*>`, "i");
  if (content.startsWith("<!--")) return /-->/;
  if (content.startsWith("<![CDATA[")) return /\]\]>/;
  if (content.startsWith("<?")) return /\?>/;
  if (/^<![A-Z]/.test(content)) return />/;
  // Block tags may carry inline content. Other tags must stand alone, so an
  // inline HTML paragraph cannot hide a following Markdown list from us.
  if (
    /^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/i.test(
      content,
    ) ||
    /^<\/?[a-z][\w-]*(?:[ \t]+(?:[^<>"']|"[^"]*"|'[^']*')*)?\/?>[ \t]*$/i.test(
      content,
    )
  )
    return /^\s*$/;
  return null;
}

function* listFences(doc: Text): Generator<ListFence> {
  const ancestors: { indent: string; width: number; empty: boolean }[] = [];
  let fence: { marker: FenceMarker; indent: string } | null = null;
  let html: { end: RegExp; indent: string } | null = null;
  let frontmatter = false;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text;
    if (n === 1 && text === "---") {
      frontmatter = true;
      continue;
    }
    if (frontmatter) {
      if (text === "---" || text === "...") frontmatter = false;
      continue;
    }
    if (html) {
      if (text.trim().length === 0) {
        if (html.end.test(text)) html = null;
        continue;
      }
      const content = getFenceContent(text, html.indent);
      if (content) {
        if (html.end.test(content.text)) html = null;
        continue;
      }
      html = null;
    }
    if (text.trim().length === 0) continue;
    if (fence) {
      const content = getFenceContent(text, fence.indent);
      if (content) {
        if (isFenceClosing(content.text, fence.marker)) fence = null;
        continue;
      }
      fence = null;
    }

    const indentWidth = columns(/^[ \t]*/.exec(text)![0]);
    while (
      ancestors.length &&
      ancestors[ancestors.length - 1].width > indentWidth
    )
      ancestors.pop();
    const parent = ancestors[ancestors.length - 1];
    // Preserve list-looking literal text in indented code as well as fences.
    const inListPosition = parent
      ? indentWidth < parent.width + 4
      : indentWidth < 4;
    const prefixes = inListPosition ? listPrefixes(text) : [];
    if (prefixes.length) {
      const last = prefixes[prefixes.length - 1];
      const content = text.slice(last.contentOffset);
      const hasEmptyAncestor =
        prefixes.length > 1 || ancestors.some((ancestor) => ancestor.empty);
      for (const prefix of prefixes) {
        const indent =
          text.slice(0, prefix.contentOffset).replace(/\S/g, " ") +
          (prefix.spacing ? "" : " ");
        ancestors.push({
          indent,
          width: columns(indent),
          empty: prefix !== last || content.length === 0,
        });
      }
      const end = htmlBlockEnd(content);
      if (end) {
        html = end.test(content)
          ? null
          : { end, indent: ancestors[ancestors.length - 1].indent };
        continue;
      }
      const marker = getFenceOpening(content);
      if (marker) {
        fence = { marker, indent: ancestors[ancestors.length - 1].indent };
        yield { from: line.from, text, prefixes, hasEmptyAncestor };
      }
      continue;
    }

    const continuation = parent ? getFenceContent(text, parent.indent) : null;
    const content = continuation?.text ?? text;
    const end = htmlBlockEnd(content);
    if (end) {
      html = end.test(content) ? null : { end, indent: parent?.indent ?? "" };
      continue;
    }
    const marker = getFenceOpening(content);
    if (marker) fence = { marker, indent: parent?.indent ?? "" };
  }
}

export function expandCompactCodeBlocks(doc: Text): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  for (const opening of listFences(doc)) {
    for (let index = 1; index < opening.prefixes.length; index++) {
      const parent = opening.prefixes[index - 1];
      const child = opening.prefixes[index];
      // Keep the formatter's whitespace: mixing a tab-indented opener with
      // its space-indented body makes Prettier deepen the body on every save.
      const indent = opening.text
        .slice(0, child.markerOffset)
        .replace(/\S/g, " ");
      // Preserve each marker and its first separator. A caret at the empty
      // parent's content boundary then stays on that row through composition.
      changes.push({
        from: opening.from + parent.markerOffset + parent.marker.length + 1,
        to: opening.from + child.markerOffset,
        insert: "\n" + indent,
      });
    }
  }
  return changes;
}

export function hasExpandableCodeBlockAncestor(source: string): boolean {
  for (const opening of listFences(Text.of(source.split("\n")))) {
    if (opening.hasEmptyAncestor) return true;
  }
  return false;
}
