import fs from "fs";
import path from "path";

describe("Removed external focus integration", () => {
  test("should not expose legacy focus plugin integration", () => {
    const root = path.join(__dirname, "../..");
    const files = [
      "README.md",
      "src/editor/index.ts",
      "src/features/EnterBehaviourOverride.ts",
      "src/features/VimOBehaviourOverride.ts",
      "src/features/VerticalLines.ts",
      "src/operations/CreateNewItem.ts",
    ];

    for (const file of files) {
      const content = fs.readFileSync(path.join(root, file), "utf8");
      const oldFocusName = String.fromCharCode(90, 111, 111, 109);
      const oldFocusMethod = oldFocusName.toLowerCase();

      const legacyTerms = [
        ["Obsidian", oldFocusName, "Plugin"].join(""),
        ["Obsidian", " ", oldFocusName].join(""),
        [oldFocusMethod, "In"].join(""),
        [oldFocusMethod, "Out"].join(""),
        ["try", "Refresh", oldFocusName].join(""),
        ["get", oldFocusName, "Range"].join(""),
        [oldFocusMethod, "Range"].join(""),
      ];

      for (const term of legacyTerms) {
        expect(content).not.toMatch(new RegExp(term, "i"));
      }
    }
  });
});
