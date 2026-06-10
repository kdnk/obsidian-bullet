import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ReleaseNotesAnnouncement } from "../ReleaseNotesAnnouncement";

const mockRenderMarkdown = jest.fn<void, unknown[]>();
const mockOpen = jest.fn();
const mockClose = jest.fn();

interface RegisteredCommand {
  id: string;
  name: string;
  callback: () => void;
}

interface MockModal {
  onOpen?: (this: MockModal) => void | Promise<void>;
}

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
        const modal = this as MockModal;
        const onOpen = modal.onOpen;
        if (onOpen) {
          void onOpen.call(modal);
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
    const addCommand = jest.fn<void, [RegisteredCommand]>();
    const settings = {
      previousRelease: "5.2.2",
      save: jest.fn(),
    };
    const feature = new ReleaseNotesAnnouncement(
      { app: {}, addCommand } as never,
      settings as never,
    );

    await feature.load();

    const command = addCommand.mock.calls[0]?.[0];
    expect(command?.id).toBe("show-release-notes");
    expect(command?.name).toBe("Show Release Notes");
    expect(command?.callback).toEqual(expect.any(Function));
    expect(mockOpen).toHaveBeenCalledTimes(1);

    void (
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
