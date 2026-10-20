import { App, TFile, normalizePath } from "obsidian";

interface ScriptContext {
  readonly app: App;
  readonly file: TFile;
  readonly signal: AbortSignal;
}

type ScriptModule = {
  default(text: string, context: ScriptContext): unknown;
};

export function validateScriptPath(path: string): string {
  const trimmed = path.trim();
  if (
    !trimmed ||
    trimmed.startsWith("/") ||
    trimmed.includes("\\") ||
    trimmed.split("/").some((part) => part === ".." || part === ".") ||
    !/\.(?:mjs|js)$/i.test(trimmed)
  ) {
    throw new Error("Choose a vault-relative .js or .mjs module path.");
  }
  return normalizePath(trimmed);
}

export async function runUserScript(
  input: ScriptContext & {
    path: string;
    text: string;
  },
): Promise<string> {
  const path = validateScriptPath(input.path);
  if (input.signal.aborted) throw new Error("Save script cancelled.");
  const stat = await input.app.vault.adapter.stat(path);
  if (stat?.type !== "file")
    throw new Error(`Save script does not exist. ${path}`);
  const url = new URL(input.app.vault.adapter.getResourcePath(path));
  url.searchParams.set("bullet-mtime", String(stat.mtime));
  const module: unknown = await import(url.href);
  if (!isScriptModule(module))
    throw new TypeError("Save script must export a default function.");
  if (input.signal.aborted) throw new Error("Save script cancelled.");
  const result: unknown = await module.default(input.text, {
    file: input.file,
    app: input.app,
    signal: input.signal,
  });
  if (typeof result !== "string")
    throw new TypeError("Save script must return Markdown text.");
  return result;
}

function isScriptModule(value: unknown): value is ScriptModule {
  return (
    !!value &&
    typeof value === "object" &&
    "default" in value &&
    typeof value.default === "function"
  );
}
