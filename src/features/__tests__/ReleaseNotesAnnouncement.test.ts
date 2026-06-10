import { readFileSync } from "fs";
import { join } from "path";

import { ReleaseNotesAnnouncement } from "../ReleaseNotesAnnouncement";

const mockRenderMarkdown = jest.fn();
const mockOpen = jest.fn();
const mockClose = jest.fn();

jest.mock(
  "obsidian",
  () => ({
    MarkdownRenderer: {
      render: (...args: unknown[]) => mockRenderMarkdown(...args),
      renderMarkdown: (...args: unknown[]) => mockRenderMarkdown(...args),
    },
    Modal: class Modal {
      public titleEl = { setText: jest.fn() };
      public contentEl = {};
      public app: unknown;

      constructor(mockApp: unknown) {
        this.app = mockApp;
      }

      open() {
        mockOpen();
        if ("onOpen" in this && typeof this.onOpen === "function") {
          this.onOpen();
        }
      }

      close() {
        mockClose();
      }
    },
    Plugin: class Plugin {},
  }),
  { virtual: true },
);

describe("ReleaseNotesAnnouncement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(global, "PLUGIN_VERSION", {
      configurable: true,
      value: "5.2.3",
    });
    Object.defineProperty(global, "CHANGELOG_MD", {
      configurable: true,
      value: [
        "# Changelog",
        "",
        "## 5.2.3",
        "- Current release",
        "",
        "## 5.2.2",
        "- Previous release",
      ].join("\n"),
    });
  });

  test("registers a command and opens release notes newer than the previous release", async () => {
    const addCommand = jest.fn();
    const settings = {
      previousRelease: "5.2.2",
      save: jest.fn(),
    };
    const feature = new ReleaseNotesAnnouncement(
      { app: {}, addCommand } as never,
      settings as never,
    );

    await feature.load();

    expect(addCommand).toHaveBeenCalledWith({
      id: "show-release-notes",
      name: "Show Release Notes",
      callback: expect.any(Function),
    });
    expect(mockOpen).toHaveBeenCalledTimes(1);

    (
      feature as unknown as {
        handleClose: () => Promise<void>;
      }
    ).handleClose();

    expect(settings.previousRelease).toBe("5.2.3");
    expect(settings.save).toHaveBeenCalled();
  });

  test("shows the consolidated v5 release notes for the current patch release", async () => {
    Object.defineProperty(global, "PLUGIN_VERSION", {
      configurable: true,
      value: "5.3.4",
    });
    Object.defineProperty(global, "CHANGELOG_MD", {
      configurable: true,
      value: readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8"),
    });

    const feature = new ReleaseNotesAnnouncement(
      { app: {}, addCommand: jest.fn() } as never,
      {
        previousRelease: "5.3.3",
        save: jest.fn(),
      } as never,
    );

    await feature.load();

    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockRenderMarkdown).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("consolidated v5 release notes"),
      expect.anything(),
      "",
      expect.anything(),
    );
  });
});
