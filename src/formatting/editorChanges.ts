import * as DiffMatchPatch from "diff-match-patch";

export const formatChanges = (before: string, after: string) => {
  const diff = new DiffMatchPatch.diff_match_patch().diff_main(before, after);
  const changes: {
    from: number;
    to: number;
    insert: string;
  }[] = [];
  let offset = 0;
  let pending: (typeof changes)[number] | undefined;
  for (const [kind, value] of diff) {
    if (kind === DiffMatchPatch.DIFF_EQUAL) {
      if (pending) changes.push(pending);
      pending = undefined;
      offset += value.length;
    } else {
      pending ??= { from: offset, insert: "", to: offset };
      if (kind === DiffMatchPatch.DIFF_DELETE) {
        offset += value.length;
        pending.to = offset;
      } else {
        pending.insert += value;
      }
    }
  }
  if (pending) changes.push(pending);
  return changes;
};
