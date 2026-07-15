import { EventEmitter } from "events";

import ObsidianEnvironment, {
  COMMAND_TIMEOUT_MS,
  CONNECTION_TIMEOUT_MS,
} from "../../jest/obsidian-environment";

jest.mock("jest-environment-node", () => ({
  TestEnvironment: class {
    global = {};
    baseTeardownCalls = 0;

    async setup() {}

    async teardown() {
      this.baseTeardownCalls += 1;
    }
  },
}));

jest.mock("ws", () => {
  const { EventEmitter: MockEventEmitter } =
    jest.requireActual<typeof import("events")>("events");

  return class MockWebSocket extends MockEventEmitter {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    static instances: MockWebSocket[] = [];

    readyState = MockWebSocket.CONNECTING;
    sent: string[] = [];
    closeCalls = 0;
    sendError: Error | undefined;
    url: string;

    constructor(mockUrl: string) {
      super();
      this.url = mockUrl;
      MockWebSocket.instances.push(this);
    }

    open() {
      this.readyState = MockWebSocket.OPEN;
      this.emit("open");
    }

    fail(message: string) {
      if (this.listenerCount("error") > 0) {
        this.emit("error", new Error(message));
      }
    }

    closeFromPeer(code = 1006, reason = "peer closed") {
      this.readyState = MockWebSocket.CLOSED;
      this.emit("close", code, Buffer.from(reason));
    }

    receive(data: unknown) {
      this.emit("message", JSON.stringify(data));
    }

    receiveRaw(data: string) {
      this.emit("message", data);
    }

    failNextSend(message: string) {
      this.sendError = new Error(message);
    }

    send(data: string) {
      if (this.sendError) {
        const error = this.sendError;
        this.sendError = undefined;
        throw error;
      }
      this.sent.push(data);
    }

    close() {
      this.closeCalls += 1;
      this.readyState = MockWebSocket.CLOSING;
    }
  };
});

interface ControlledSocket extends EventEmitter {
  closeCalls: number;
  closeFromPeer(code?: number, reason?: string): void;
  fail(message: string): void;
  failNextSend(message: string): void;
  open(): void;
  receive(data: unknown): void;
  receiveRaw(data: string): void;
  sent: string[];
  url: string;
}

interface ControlledEnvironment {
  baseTeardownCalls: number;
  callbacks: Map<string, unknown>;
  initWs(): Promise<void>;
  runCommand(type: string, data?: unknown): Promise<unknown>;
  setup(): Promise<void>;
  teardown(): Promise<void>;
}

const MockWebSocket = jest.requireMock<{
  instances: ControlledSocket[];
}>("ws");

function createEnvironment(): ControlledEnvironment {
  return new (ObsidianEnvironment as unknown as {
    new (): ControlledEnvironment;
  })();
}

function currentSocket(): ControlledSocket {
  const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  if (!socket) {
    throw new Error("Expected the environment to create a WebSocket");
  }
  return socket;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

async function startCommand(environment: ControlledEnvironment) {
  const command = environment.runCommand("getCurrentState");
  const socket = currentSocket();
  socket.open();
  await flushPromises();
  return { command, socket };
}

function getSentRequestId(socket: ControlledSocket): string {
  const request = JSON.parse(socket.sent[0]) as { id: string };
  return request.id;
}

describe("Obsidian test WebSocket transport", () => {
  beforeEach(() => {
    MockWebSocket.instances.length = 0;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("connects with the authenticated test-client role", async () => {
    const originalPort = process.env.TEST_PLATFORM_WS_PORT;
    const originalToken = process.env.TEST_PLATFORM_WS_TOKEN;
    process.env.TEST_PLATFORM_WS_PORT = "43123";
    process.env.TEST_PLATFORM_WS_TOKEN = "test token";
    const environment = createEnvironment();
    await environment.setup();
    let initializationSettlement: Promise<unknown> | undefined;

    try {
      const initialization = environment.initWs();
      initializationSettlement = initialization.catch(() => undefined);
      const socket = currentSocket();
      expect(socket.url).toBe(
        "ws://127.0.0.1:43123/?role=test&token=test+token",
      );
      socket.open();
      await initialization;
    } finally {
      await environment.teardown();
      await initializationSettlement;
      if (originalPort === undefined) {
        delete process.env.TEST_PLATFORM_WS_PORT;
      } else {
        process.env.TEST_PLATFORM_WS_PORT = originalPort;
      }
      if (originalToken === undefined) {
        delete process.env.TEST_PLATFORM_WS_TOKEN;
      } else {
        process.env.TEST_PLATFORM_WS_TOKEN = originalToken;
      }
    }
  });

  test("rejects initialization when the connection errors before opening", async () => {
    const environment = createEnvironment();
    await environment.setup();
    const initialization = environment.initWs();
    const rejected = jest.fn();
    void initialization.catch(rejected);

    currentSocket().fail("refused");
    await flushPromises();

    expect(rejected).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Obsidian test transport connection error: refused",
      }),
    );
  });

  test("rejects a command when the connection closes before opening", async () => {
    const environment = createEnvironment();
    await environment.setup();
    const command = environment.runCommand("getCurrentState");
    const rejected = jest.fn();
    void command.catch(rejected);

    currentSocket().closeFromPeer();
    await flushPromises();

    expect(rejected).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Obsidian test transport connection closed before opening",
      }),
    );
  });

  test("bounds initialization when the connection never opens", async () => {
    expect(CONNECTION_TIMEOUT_MS).toBeLessThan(15_000);
    const environment = createEnvironment();
    await environment.setup();
    const initialization = environment.initWs();
    const rejection = expect(initialization).rejects.toThrow(
      "Obsidian test transport connection timed out",
    );

    await jest.advanceTimersByTimeAsync(CONNECTION_TIMEOUT_MS);

    await rejection;
  });

  test("rejects and clears a pending request on a connection error", async () => {
    const environment = createEnvironment();
    await environment.setup();
    const { command, socket } = await startCommand(environment);
    const rejected = jest.fn();
    void command.catch(rejected);

    socket.fail("reset");
    await flushPromises();

    expect(rejected).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Obsidian test transport connection error: reset",
      }),
    );
    expect(environment.callbacks.size).toBe(0);
  });

  test("rejects and clears a pending request when the connection closes", async () => {
    const environment = createEnvironment();
    await environment.setup();
    const { command, socket } = await startCommand(environment);
    const rejected = jest.fn();
    void command.catch(rejected);

    socket.closeFromPeer();
    await flushPromises();

    expect(rejected).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Obsidian test transport connection closed",
      }),
    );
    expect(environment.callbacks.size).toBe(0);
  });

  test("rejects and clears a request after the command timeout", async () => {
    expect(COMMAND_TIMEOUT_MS).toBeLessThan(15_000);
    const environment = createEnvironment();
    await environment.setup();
    const { command } = await startCommand(environment);
    const rejection = expect(command).rejects.toThrow(
      "Obsidian test transport command timed out: getCurrentState",
    );

    await jest.advanceTimersByTimeAsync(COMMAND_TIMEOUT_MS);

    await rejection;
    expect(environment.callbacks.size).toBe(0);
  });

  test("uses one command deadline across connection and renderer waits", async () => {
    expect(COMMAND_TIMEOUT_MS).toBeLessThan(15_000);
    const environment = createEnvironment();
    await environment.setup();
    const command = environment.runCommand("getCurrentState");
    const rejected = jest.fn();
    void command.catch(rejected);
    const socket = currentSocket();

    await jest.advanceTimersByTimeAsync(CONNECTION_TIMEOUT_MS - 1);
    socket.open();
    await flushPromises();
    expect(socket.sent).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(
      COMMAND_TIMEOUT_MS - CONNECTION_TIMEOUT_MS + 1,
    );
    await flushPromises();

    expect(rejected).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Obsidian test transport command timed out: getCurrentState",
      }),
    );
    expect(environment.callbacks.size).toBe(0);
    socket.receive({
      id: getSentRequestId(socket),
      data: { value: "late" },
    });
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  test("does not let a stale socket close reject a reconnected request", async () => {
    const environment = createEnvironment();
    await environment.setup();
    const { command: firstCommand, socket: firstSocket } =
      await startCommand(environment);
    const firstRejection = expect(firstCommand).rejects.toThrow(
      "Obsidian test transport connection error: reset",
    );

    firstSocket.fail("reset");
    await firstRejection;

    const secondCommand = environment.runCommand("getCurrentState");
    const secondRejected = jest.fn();
    void secondCommand.catch(secondRejected);
    const secondSocket = currentSocket();
    expect(secondSocket).not.toBe(firstSocket);
    secondSocket.open();
    await flushPromises();

    const secondId = getSentRequestId(secondSocket);
    firstSocket.receive({ id: secondId, error: "stale renderer error" });
    firstSocket.closeFromPeer();
    await flushPromises();

    expect(secondRejected).not.toHaveBeenCalled();
    expect(environment.callbacks.size).toBe(1);
    secondSocket.receive({
      id: secondId,
      data: { value: "reconnected" },
    });
    await expect(secondCommand).resolves.toEqual({ value: "reconnected" });
  });

  test("turns a malformed frame into an active-socket protocol failure", async () => {
    const environment = createEnvironment();
    await environment.setup();
    const firstCommand = environment.runCommand("getCurrentState");
    const secondCommand = environment.runCommand("waitForIdle");
    const firstRejected = jest.fn();
    const secondRejected = jest.fn();
    void firstCommand.catch(firstRejected);
    void secondCommand.catch(secondRejected);
    const socket = currentSocket();
    socket.open();
    await flushPromises();
    expect(socket.sent).toHaveLength(2);

    expect(() => socket.receiveRaw("{malformed")).not.toThrow();
    await flushPromises();

    expect(firstRejected).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Obsidian test transport protocol error",
      }),
    );
    expect(secondRejected).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Obsidian test transport protocol error",
      }),
    );
    expect(environment.callbacks.size).toBe(0);
    expect(socket.closeCalls).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("turns an invalid response envelope into a protocol failure", async () => {
    const environment = createEnvironment();
    await environment.setup();
    const { command, socket } = await startCommand(environment);
    const rejected = jest.fn();
    void command.catch(rejected);

    expect(() => socket.receiveRaw('{"data":"missing id"}')).not.toThrow();
    await flushPromises();

    expect(rejected).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Obsidian test transport protocol error",
      }),
    );
    expect(environment.callbacks.size).toBe(0);
    expect(socket.closeCalls).toBe(1);
  });

  test("preserves renderer errors without a transport prefix", async () => {
    const environment = createEnvironment();
    await environment.setup();
    const { command, socket } = await startCommand(environment);
    const rejection = expect(command).rejects.toThrow(
      "renderer rejected payload",
    );

    socket.receive({
      id: getSentRequestId(socket),
      error: "renderer rejected payload",
    });

    await rejection;
    await expect(command).rejects.not.toThrow("Obsidian test transport");
    expect(environment.callbacks.size).toBe(0);
  });

  test("teardown rejects requests, clears timers, and closes only once", async () => {
    const environment = createEnvironment();
    await environment.setup();
    const { command, socket } = await startCommand(environment);
    const rejected = jest.fn();
    void command.catch(rejected);

    await environment.teardown();
    await environment.teardown();
    await flushPromises();

    expect(rejected).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Obsidian test transport teardown",
      }),
    );
    expect(environment.callbacks.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    expect(socket.closeCalls).toBe(1);
    expect(environment.baseTeardownCalls).toBe(1);
  });

  test("teardown rejects a command during initialization and clears lifecycle state", async () => {
    const environment = createEnvironment();
    await environment.setup();
    const command = environment.runCommand("getCurrentState");
    const rejection = expect(command).rejects.toThrow(
      "Obsidian test transport teardown",
    );
    const socket = currentSocket();
    expect(environment.callbacks.size).toBe(1);

    await environment.teardown();

    await rejection;
    expect(environment.callbacks.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    expect(socket.closeCalls).toBe(1);
    expect(environment.baseTeardownCalls).toBe(1);
  });

  test("rejects and clears a request when send throws synchronously", async () => {
    const environment = createEnvironment();
    await environment.setup();
    const command = environment.runCommand("getCurrentState");
    const socket = currentSocket();
    socket.failNextSend("cannot send");
    socket.open();

    await expect(command).rejects.toThrow(
      "Obsidian test transport send error: cannot send",
    );
    expect(environment.callbacks.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("resolves a successful response once and clears its request state", async () => {
    const environment = createEnvironment();
    await environment.setup();
    const { command, socket } = await startCommand(environment);
    const id = getSentRequestId(socket);

    socket.receive({ id, data: { value: "ok" } });
    socket.receive({ id, data: { value: "duplicate" } });

    await expect(command).resolves.toEqual({ value: "ok" });
    expect(environment.callbacks.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("shares one connection initialization across concurrent commands", async () => {
    const environment = createEnvironment();
    await environment.setup();
    const first = environment.runCommand("getCurrentState");
    const second = environment.runCommand("waitForIdle");

    expect(MockWebSocket.instances).toHaveLength(1);
    const socket = currentSocket();
    socket.open();
    await flushPromises();
    expect(socket.sent).toHaveLength(2);

    for (const request of socket.sent) {
      const { id } = JSON.parse(request) as { id: string };
      socket.receive({ id, data: undefined });
    }

    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });
});
