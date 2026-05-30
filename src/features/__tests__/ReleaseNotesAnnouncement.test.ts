import { ReleaseNotesAnnouncement } from "../ReleaseNotesAnnouncement";

const mockRenderMarkdown = jest.fn();
const mockOpen = jest.fn();
const mockClose = jest.fn();

jest.mock(
  "obsidian",
  () => ({
    MarkdownRenderer: {
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
});
