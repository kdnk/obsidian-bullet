import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("ObsidianBulletPlugin wiring", () => {
  test("does not load the removed release notes announcement feature", () => {
    const source = readFileSync(
      join(__dirname, "../ObsidianBulletPlugin.ts"),
      "utf-8",
    );

    expect(source).not.toContain("ReleaseNotesAnnouncement");
  });
});
