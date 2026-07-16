import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const projectRoot = join(__dirname, "../..");

function getProductionTypeScriptPaths(directory: string): string[] {
  const paths: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") {
        paths.push(...getProductionTypeScriptPaths(path));
      }
    } else if (entry.name.endsWith(".ts")) {
      paths.push(path);
    }
  }

  return paths;
}

const productionTypeScriptPaths = getProductionTypeScriptPaths(
  join(projectRoot, "src"),
);

function findProductionSources(pattern: string | RegExp): string[] {
  return productionTypeScriptPaths.filter((path) => {
    const source = readFileSync(path, "utf8");
    return typeof pattern === "string"
      ? source.includes(pattern)
      : pattern.test(source);
  });
}

describe("Obsidian review source policies", () => {
  test("does not use important CSS declarations", () => {
    const styles = readFileSync(join(projectRoot, "styles.css"), "utf8");
    const importantDeclaration = ["!", "important"].join("");

    expect(styles).not.toContain(importantDeclaration);
  });

  test("does not access the system clipboard", () => {
    const clipboardMember = ["navigator", "clipboard"].join(".");

    expect(findProductionSources(clipboardMember)).toEqual([]);
  });

  test("does not expose dynamic-code execution signatures", () => {
    const evalIdentifier = ["ev", "al"].join("");
    const evalCall = new RegExp(`\\b${evalIdentifier}\\s*\\(`);
    const functionConstructor = new RegExp(
      ["new", "\\s+", "Function", "\\s*\\("].join(""),
    );

    expect(findProductionSources(evalCall)).toEqual([]);
    expect(findProductionSources(functionConstructor)).toEqual([]);
  });
});
