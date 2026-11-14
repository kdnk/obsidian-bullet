import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Removed external focus integration", () => {
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
  const legacyPatterns = legacyTerms.map(
    (term) => new RegExp(`(^|[^\\w$])${term}(?=$|[^\\w$])`, "i"),
  );

  test.each([
    ["zooming", false],
    ["zoom indicator", false],
    ["zoomInHandler", false],
    ["$zoomIn", false],
    ["_zoomIn", false],
    ["plugin.zoomIn()", true],
    ["plugin.zoomOut()", true],
    ["ObsidianZoomPlugin", true],
    ["Obsidian Zoom", true],
    ["tryRefreshZoom()", true],
    ["getZoomRange()", true],
    ["plugin.zoomRange", true],
  ])(
    "classifies %s as a legacy integration reference: %s",
    (content, legacy) => {
      expect(legacyPatterns.some((pattern) => pattern.test(content))).toBe(
        legacy,
      );
    },
  );

  test("should not expose legacy focus plugin integration", () => {
    const root = join(__dirname, "../..");
    const files = [
      "README.md",
      "src/editor/index.ts",
      "src/features/EnterBehaviourOverride.ts",
      "src/features/VimOBehaviourOverride.ts",
      "src/features/VerticalLines.ts",
      "src/operations/CreateNewItem.ts",
    ];

    for (const file of files) {
      const content = readFileSync(join(root, file), "utf8");
      for (const pattern of legacyPatterns) {
        expect(content).not.toMatch(pattern);
      }
    }
  });
});
