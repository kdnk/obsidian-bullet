import { ChangeSet, Text } from "@codemirror/state";

import {
  isIgnoredPath,
  lintMarkdown,
  repairClosingFences,
} from "./lintMarkdown";
import { formatMarkdown as prettierMarkdown } from "./prettier";
import type { FormatMarkdownRequest } from "./types";

import { expandCompactCodeBlocks } from "../utils/expandCompactCodeBlocks";

export { formatPastedText } from "./lintMarkdown";

export class FormattingStageError extends Error {
  constructor(
    readonly stage: string,
    cause: unknown,
  ) {
    super(
      `${stage}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "FormattingStageError";
  }
}

export async function formatMarkdown(
  request: FormatMarkdownRequest,
): Promise<string> {
  const { file, settings, signal } = request;
  if (isIgnoredPath(file.path, settings.ignoredFolders, settings.ignoredFiles))
    return request.text;
  let text = request.text;
  const stage = async (
    name: string,
    transform: (value: string) => string | Promise<string>,
  ) => {
    if (signal.aborted) throw new Error("Formatting cancelled");
    try {
      text = await transform(text);
      if (signal.aborted) throw new Error("Formatting cancelled");
    } catch (error) {
      throw new FormattingStageError(name, error);
    }
  };
  const linker = request.linker;
  if (linker)
    await stage("Automatic Linker", (value) => linker(value, { file, signal }));
  const script = request.script;
  if (script)
    await stage("Save script", (value) => script(value, { file, signal }));
  const lintIgnored = isIgnoredPath(
    file.path,
    settings.linterIgnoredFolders,
    settings.linterIgnoredFiles,
  );
  if (!lintIgnored)
    await stage("Code fences", (value) => repairClosingFences(value, settings));
  if (settings.markdown)
    await stage("Prettier", (value) => prettierMarkdown(value, request.indent));
  await stage("Linter", (value) =>
    lintMarkdown(value, file, settings, request.now),
  );
  await stage("Bullet", (value) => {
    const doc = Text.of(value.split("\n"));
    return ChangeSet.of(expandCompactCodeBlocks(doc), doc.length)
      .apply(doc)
      .toString();
  });
  return text;
}
