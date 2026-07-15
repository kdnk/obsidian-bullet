import globalTeardown from "../../jest/global-teardown";

jest.mock("child_process", () => ({ spawnSync: jest.fn() }));
jest.mock("debug", () => () => jest.fn());
jest.mock("fs", () => ({ writeFileSync: jest.fn() }));

interface TeardownGlobals {
  KILL_CMD?: string[];
  OBSIDIAN_CONFIG_PATH?: string;
  obsidianRelay?: { close: jest.Mock<() => Promise<void>> };
  obsidianTestCleanup?: jest.Mock<() => Promise<void>>;
  originalObsidianConfig?: string | null;
}

const teardownGlobals = global as typeof global & TeardownGlobals;
const runGlobalTeardown = globalTeardown as unknown as () => Promise<void>;
const childProcess = jest.requireMock<{
  spawnSync: jest.Mock;
}>("child_process");
const fs = jest.requireMock<{
  writeFileSync: jest.Mock;
}>("fs");

const originalSkipObsidian = process.env.SKIP_OBSIDIAN;
const originalPort = process.env.TEST_PLATFORM_WS_PORT;
const originalToken = process.env.TEST_PLATFORM_WS_TOKEN;
const originalGlobals = {
  KILL_CMD: teardownGlobals.KILL_CMD,
  OBSIDIAN_CONFIG_PATH: teardownGlobals.OBSIDIAN_CONFIG_PATH,
  obsidianRelay: teardownGlobals.obsidianRelay,
  obsidianTestCleanup: teardownGlobals.obsidianTestCleanup,
  originalObsidianConfig: teardownGlobals.originalObsidianConfig,
};

function restoreEnvironment(
  name: "SKIP_OBSIDIAN" | "TEST_PLATFORM_WS_PORT" | "TEST_PLATFORM_WS_TOKEN",
  value: string | undefined,
) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("Obsidian global teardown", () => {
  beforeEach(() => {
    delete teardownGlobals.obsidianRelay;
    delete teardownGlobals.obsidianTestCleanup;
    teardownGlobals.originalObsidianConfig = null;
    teardownGlobals.KILL_CMD = ["killall", "Obsidian"];
    teardownGlobals.OBSIDIAN_CONFIG_PATH = "/tmp/obsidian.json";
  });

  afterEach(() => {
    restoreEnvironment("SKIP_OBSIDIAN", originalSkipObsidian);
    restoreEnvironment("TEST_PLATFORM_WS_PORT", originalPort);
    restoreEnvironment("TEST_PLATFORM_WS_TOKEN", originalToken);
    Object.assign(teardownGlobals, originalGlobals);
  });

  test("is a complete no-op when Obsidian tests are skipped", async () => {
    process.env.SKIP_OBSIDIAN = "1";
    const cleanup = jest.fn(async (): Promise<void> => undefined);
    const closeRelay = jest.fn(async (): Promise<void> => undefined);
    teardownGlobals.obsidianTestCleanup = cleanup;
    teardownGlobals.obsidianRelay = { close: closeRelay };
    teardownGlobals.originalObsidianConfig = "original config";

    await runGlobalTeardown();

    expect(cleanup.mock.calls).toHaveLength(0);
    expect(closeRelay.mock.calls).toHaveLength(0);
    expect(childProcess.spawnSync.mock.calls).toHaveLength(0);
    expect(fs.writeFileSync.mock.calls).toHaveLength(0);
  });

  test("uses the published lifecycle cleanup for ordinary teardown", async () => {
    delete process.env.SKIP_OBSIDIAN;
    const cleanup = jest.fn(async (): Promise<void> => undefined);
    teardownGlobals.obsidianTestCleanup = cleanup;

    await runGlobalTeardown();

    expect(cleanup.mock.calls).toHaveLength(1);
    expect(childProcess.spawnSync.mock.calls).toHaveLength(0);
  });

  test("retains the ordinary fallback cleanup", async () => {
    delete process.env.SKIP_OBSIDIAN;
    process.env.TEST_PLATFORM_WS_PORT = "43123";
    process.env.TEST_PLATFORM_WS_TOKEN = "token";
    const closeRelay = jest.fn(async (): Promise<void> => undefined);
    teardownGlobals.obsidianRelay = { close: closeRelay };
    teardownGlobals.originalObsidianConfig = "original config";

    await runGlobalTeardown();

    expect(closeRelay.mock.calls).toHaveLength(1);
    expect(childProcess.spawnSync.mock.calls).toEqual([
      ["killall", ["Obsidian"]],
    ]);
    expect(fs.writeFileSync.mock.calls).toEqual([
      ["/tmp/obsidian.json", "original config"],
    ]);
    expect(teardownGlobals.obsidianRelay).toBeUndefined();
    expect(teardownGlobals.originalObsidianConfig).toBeNull();
    expect(process.env.TEST_PLATFORM_WS_PORT).toBeUndefined();
    expect(process.env.TEST_PLATFORM_WS_TOKEN).toBeUndefined();
  });
});
