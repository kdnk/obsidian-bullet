import { EventEmitter } from "events";

import { startObsidianGlobalLifecycle } from "../../jest/obsidian-global-lifecycle";

const ORIGINAL_CONFIG = '{"vaults":{"personal":{"open":true}}}';

interface RelayController {
  close: jest.Mock<() => Promise<void>>;
  port: number;
  ready: Promise<void>;
  token: string;
}

interface GlobalLifecycle {
  close: () => Promise<void>;
}

interface LifecycleGlobals {
  KILL_CMD?: string[];
  OBSIDIAN_CONFIG_PATH?: string;
  obsidianRelay?: RelayController;
  obsidianTestCleanup?: () => Promise<void>;
  originalObsidianConfig?: string | null;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createHarness() {
  const globals: LifecycleGlobals = { originalObsidianConfig: null };
  const env: Record<string, string | undefined> = {
    TEST_PLATFORM_WS_PORT: "previous-port",
    TEST_PLATFORM_WS_TOKEN: "previous-token",
  };
  const relayReady = deferred();
  const closeRelay = jest.fn(async (): Promise<void> => undefined);
  const relay: RelayController = {
    close: closeRelay,
    port: 43123,
    ready: relayReady.promise,
    token: "session-token",
  };
  const child = new EventEmitter();
  const prepareObsidian = jest.fn(async () => {
    globals.originalObsidianConfig = ORIGINAL_CONFIG;
  });
  const prepareVault = jest.fn().mockResolvedValue(undefined);
  const startRelay = jest.fn().mockResolvedValue(relay);
  const launchObsidian = jest.fn(() => child);
  const killObsidian = jest.fn();
  const restoreObsidianConfig = jest.fn();

  const start = (): Promise<GlobalLifecycle> =>
    startObsidianGlobalLifecycle({
      env,
      globals,
      killObsidian,
      launchObsidian,
      prepareObsidian,
      prepareVault,
      restoreObsidianConfig,
      startRelay,
    });

  return {
    child,
    env,
    globals,
    killObsidian,
    launchObsidian,
    prepareObsidian,
    prepareVault,
    relay,
    relayReady,
    restoreObsidianConfig,
    start,
    startRelay,
  };
}

function expectRestored(harness: ReturnType<typeof createHarness>) {
  expect(harness.killObsidian).toHaveBeenCalledTimes(1);
  expect(harness.restoreObsidianConfig).toHaveBeenCalledWith(ORIGINAL_CONFIG);
  expect(harness.globals.obsidianRelay).toBeUndefined();
  expect(harness.globals.obsidianTestCleanup).toBeUndefined();
  expect(harness.globals.originalObsidianConfig).toBeNull();
  expect(harness.env.TEST_PLATFORM_WS_PORT).toBe("previous-port");
  expect(harness.env.TEST_PLATFORM_WS_TOKEN).toBe("previous-token");
  expect(harness.child.listenerCount("error")).toBe(0);
  expect(harness.child.listenerCount("exit")).toBe(0);
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Obsidian global setup lifecycle", () => {
  test("restores config when prepareObsidian fails after mutating it", async () => {
    const harness = createHarness();
    harness.prepareObsidian.mockImplementation(async () => {
      harness.globals.originalObsidianConfig = ORIGINAL_CONFIG;
      throw new Error("prepare Obsidian failed");
    });

    await expect(harness.start()).rejects.toThrow("prepare Obsidian failed");

    expect(harness.startRelay).not.toHaveBeenCalled();
    expect(harness.relay.close.mock.calls).toHaveLength(0);
    expectRestored(harness);
  });

  test("restores config when prepareVault fails", async () => {
    const harness = createHarness();
    harness.prepareVault.mockRejectedValue(new Error("prepare vault failed"));

    await expect(harness.start()).rejects.toThrow("prepare vault failed");

    expect(harness.startRelay).not.toHaveBeenCalled();
    expect(harness.relay.close.mock.calls).toHaveLength(0);
    expectRestored(harness);
  });

  test("cleans up when relay startup rejects before creating a controller", async () => {
    const harness = createHarness();
    harness.startRelay.mockRejectedValue(new Error("relay startup failed"));

    await expect(harness.start()).rejects.toThrow("relay startup failed");

    expect(harness.relay.close.mock.calls).toHaveLength(0);
    expect(harness.launchObsidian.mock.calls).toHaveLength(0);
    expectRestored(harness);
  });

  test("closes a created relay when publishing its configuration fails", async () => {
    const harness = createHarness();
    Object.defineProperty(harness.relay, "token", {
      configurable: true,
      get: () => {
        throw new Error("token publication failed");
      },
    });

    await expect(harness.start()).rejects.toThrow("token publication failed");

    expect(harness.relay.close.mock.calls).toHaveLength(1);
    expect(harness.launchObsidian.mock.calls).toHaveLength(0);
    expectRestored(harness);
  });

  test("cleans up when launching Obsidian throws synchronously", async () => {
    const harness = createHarness();
    harness.launchObsidian.mockImplementation(() => {
      throw new Error("launch threw");
    });

    await expect(harness.start()).rejects.toThrow("launch threw");

    expect(harness.relay.close.mock.calls).toHaveLength(1);
    expectRestored(harness);
  });

  test("observes relay ready rejection when synchronous launch cleanup closes it", async () => {
    const harness = createHarness();
    harness.relay.close.mockImplementation(async () => {
      harness.relayReady.reject(new Error("controller closed"));
    });
    harness.launchObsidian.mockImplementation(() => {
      throw new Error("launch threw");
    });

    await expect(harness.start()).rejects.toThrow("launch threw");
    await flushPromises();

    expect(harness.relay.close.mock.calls).toHaveLength(1);
    expectRestored(harness);
  });

  test("cleans up a child-process launch error before relay ready", async () => {
    const harness = createHarness();
    const starting = harness.start();
    const rejection = expect(starting).rejects.toThrow(
      "Obsidian test process launch error: spawn failed",
    );
    await flushPromises();

    harness.child.emit("error", new Error("spawn failed"));

    await rejection;
    expect(harness.relay.close.mock.calls).toHaveLength(1);
    expectRestored(harness);
  });

  test("cleans up an early child-process exit before relay ready", async () => {
    const harness = createHarness();
    const starting = harness.start();
    const rejection = expect(starting).rejects.toThrow(
      "Obsidian test process exited before relay ready: 7",
    );
    await flushPromises();

    harness.child.emit("exit", 7);

    await rejection;
    expect(harness.relay.close.mock.calls).toHaveLength(1);
    expectRestored(harness);
  });

  test("cleans up when relay ready rejects", async () => {
    const harness = createHarness();
    const starting = harness.start();
    const rejection = expect(starting).rejects.toThrow("relay ready failed");
    await flushPromises();

    harness.relayReady.reject(new Error("relay ready failed"));

    await rejection;
    expect(harness.relay.close.mock.calls).toHaveLength(1);
    expectRestored(harness);
  });

  test("completes all cleanup steps while preserving the startup error", async () => {
    const harness = createHarness();
    harness.relay.close.mockRejectedValue(new Error("relay close failed"));
    harness.killObsidian.mockImplementation(() => {
      throw new Error("kill failed");
    });
    const starting = harness.start();
    const rejection = expect(starting).rejects.toThrow("relay ready failed");
    await flushPromises();

    harness.relayReady.reject(new Error("relay ready failed"));

    await rejection;
    expect(harness.relay.close.mock.calls).toHaveLength(1);
    expectRestored(harness);
  });

  test("publishes authenticated configuration and cleans up idempotently", async () => {
    const harness = createHarness();
    const starting = harness.start();
    await flushPromises();
    expect(harness.env.TEST_PLATFORM_WS_PORT).toBe("43123");
    expect(harness.env.TEST_PLATFORM_WS_TOKEN).toBe("session-token");
    expect(harness.globals.obsidianRelay).toBe(harness.relay);

    harness.relayReady.resolve();
    const lifecycle = await starting;
    expect(harness.child.listenerCount("error")).toBe(0);
    expect(harness.child.listenerCount("exit")).toBe(0);
    expect(harness.globals.obsidianTestCleanup).toBe(lifecycle.close);

    const firstClose = lifecycle.close();
    const secondClose = lifecycle.close();
    expect(secondClose).toBe(firstClose);
    await firstClose;

    expect(harness.relay.close.mock.calls).toHaveLength(1);
    expectRestored(harness);
  });

  test("clears session environment values that were initially absent", async () => {
    const harness = createHarness();
    delete harness.env.TEST_PLATFORM_WS_PORT;
    delete harness.env.TEST_PLATFORM_WS_TOKEN;
    const starting = harness.start();
    await flushPromises();
    harness.relayReady.reject(new Error("relay failed"));

    await expect(starting).rejects.toThrow("relay failed");

    expect("TEST_PLATFORM_WS_PORT" in harness.env).toBe(false);
    expect("TEST_PLATFORM_WS_TOKEN" in harness.env).toBe(false);
  });
});
