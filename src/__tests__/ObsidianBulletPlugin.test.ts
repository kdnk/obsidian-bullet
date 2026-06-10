import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("ObsidianBulletPlugin wiring", () => {
  test("loads the release notes announcement feature", () => {
    const source = readFileSync(
      join(__dirname, "../ObsidianBulletPlugin.ts"),
      "utf-8",
    );

    expect(source).toMatch(
      /^import \{ ReleaseNotesAnnouncement \} from "\.\/features\/ReleaseNotesAnnouncement";$/m,
    );
    expect(source).toMatch(
      /^\s*new ReleaseNotesAnnouncement\(this, this\.settings\),$/m,
    );
  });
});
