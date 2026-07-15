import { EventEmitter } from "events";

import { runObsidianBootstrap } from "../../jest/obsidian-bootstrap-lifecycle";

class ControlledChild extends EventEmitter {}

function createHarness() {
  const child = new ControlledChild();
  let fileExists = false;
  const killProcess = jest.fn();
  const spawnProcess = jest.fn(() => child);
  const run = () =>
    runObsidianBootstrap({
      args: ["--test"],
      command: "obsidian",
      fileExists: () => fileExists,
      fileToCheck: "/tmp/obsidian-ready",
      killProcess,
      pollIntervalMs: 1_000,
      spawnProcess,
      stabilizationDelayMs: 1_000,
      timeoutMs: 3_000,
    });

  return {
    child,
    killProcess,
    run,
    setFileExists(value: boolean) {
      fileExists = value;
    },
    spawnProcess,
  };
}

function expectReleased(harness: ReturnType<typeof createHarness>) {
  expect(harness.child.listenerCount("error")).toBe(0);
  expect(harness.child.listenerCount("exit")).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
}

describe("Obsidian bootstrap process lifecycle", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("kills the bootstrap process after the readiness stabilization delay", async () => {
    const harness = createHarness();
    harness.setFileExists(true);
    const running = harness.run();
    const settled = jest.fn();
    void running.then(settled, settled);

    await jest.advanceTimersByTimeAsync(1_000);
    expect(harness.killProcess.mock.calls).toHaveLength(0);
    expect(settled.mock.calls).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(1_000);
    await expect(running).resolves.toBeUndefined();

    expect(harness.spawnProcess.mock.calls).toEqual([["obsidian", ["--test"]]]);
    expect(harness.killProcess.mock.calls).toHaveLength(1);
    expectReleased(harness);
  });

  test("rejects a spawn error immediately without retaining polling", async () => {
    const harness = createHarness();
    const running = harness.run();
    const rejection = expect(running).rejects.toThrow(
      "Obsidian bootstrap process launch error: spawn failed",
    );

    harness.child.emit("error", new Error("spawn failed"));

    await rejection;
    expect(harness.killProcess.mock.calls).toHaveLength(0);
    expectReleased(harness);
  });

  test("rejects a premature child exit immediately", async () => {
    const harness = createHarness();
    const running = harness.run();
    const rejection = expect(running).rejects.toThrow(
      "Obsidian bootstrap process exited before setup completed: 7",
    );

    harness.child.emit("exit", 7);

    await rejection;
    expect(harness.killProcess.mock.calls).toHaveLength(0);
    expectReleased(harness);
  });

  test("clears the delayed success timer when the child exits", async () => {
    const harness = createHarness();
    harness.setFileExists(true);
    const running = harness.run();
    const rejection = expect(running).rejects.toThrow(
      "Obsidian bootstrap process exited before setup completed: 2",
    );
    await jest.advanceTimersByTimeAsync(1_000);

    harness.child.emit("exit", 2);

    await rejection;
    expect(harness.killProcess.mock.calls).toHaveLength(0);
    expectReleased(harness);
  });

  test("kills the bootstrap process and rejects at the deadline", async () => {
    const harness = createHarness();
    const running = harness.run();
    const rejection = expect(running).rejects.toThrow(
      "Obsidian bootstrap process timed out after 3000ms",
    );

    await jest.advanceTimersByTimeAsync(3_000);

    await rejection;
    expect(harness.killProcess.mock.calls).toHaveLength(1);
    expectReleased(harness);
  });
});
