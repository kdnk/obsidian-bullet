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

  test("loads mobile right fold controls as an independent feature", () => {
    const source = readFileSync(
      join(__dirname, "../ObsidianBulletPlugin.ts"),
      "utf-8",
    );

    expect(source).toContain(
      "new MobileRightFoldControls(this, this.settings)",
    );
  });
});
