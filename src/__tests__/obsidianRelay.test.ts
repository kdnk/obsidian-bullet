import { EventEmitter } from "events";

import {
  RELAY_CLOSE_TIMEOUT_MS,
  RELAY_LISTEN_TIMEOUT_MS,
  RELAY_RENDERER_CONNECTION_TIMEOUT_MS,
  RELAY_RENDERER_READY_TIMEOUT_MS,
  RELAY_REQUEST_TIMEOUT_MS,
  startObsidianRelay,
} from "../../jest/obsidian-relay";

const RELAY_TOKEN = "0123456789abcdef0123456789abcdef";

class ControlledSocket extends EventEmitter {
  readonly sent: string[] = [];
  readyState = 1;
  closeCalls = 0;
  terminateCalls = 0;
  sendError: Error | undefined;
  terminateError: Error | undefined;

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
    this.readyState = 2;
  }

  terminate() {
    this.terminateCalls += 1;
    if (this.terminateError) {
      throw this.terminateError;
    }
    this.readyState = 3;
  }

  receive(data: unknown, isBinary = false) {
    this.emit("message", data, isBinary);
  }

  fail(message: string) {
    this.emit("error", new Error(message));
  }

  closeFromPeer() {
    this.readyState = 3;
    this.emit("close");
  }

  failNextSend(message: string) {
    this.sendError = new Error(message);
  }
}

class ControlledServer extends EventEmitter {
  closeCalls = 0;
  deferClose = false;
  closeCallback: (() => void) | undefined;
  addressValue:
    | { address: string; family: string; port: number }
    | string
    | null = {
    address: "127.0.0.1",
    family: "IPv4",
    port: 43123,
  };

  address() {
    return this.addressValue;
  }

  connect(
    socket = new ControlledSocket(),
    identity: { role?: string; token?: string } = {
      role: "renderer",
      token: RELAY_TOKEN,
    },
  ) {
    const params = new URLSearchParams();
    if (identity.role !== undefined) {
      params.set("role", identity.role);
    }
    if (identity.token !== undefined) {
      params.set("token", identity.token);
    }
    this.emit("connection", socket, { url: `/?${params.toString()}` });
    return socket;
  }

  close(callback?: (error?: Error) => void) {
    this.closeCalls += 1;
    if (this.deferClose) {
      this.closeCallback = callback;
    } else {
      callback?.();
    }
  }
}

interface RelayController {
  close(): Promise<void>;
  port: number;
  ready: Promise<void>;
  token: string;
}

interface LoopbackSocket {
  once(event: "open", listener: () => void): void;
  once(event: "error", listener: (error: Error) => void): void;
  once(event: "message", listener: (data: unknown) => void): void;
  send(data: string): void;
  terminate(): void;
}

interface LoopbackWebSocketConstructor {
  new (url: string): LoopbackSocket;
}

async function createRelay(server = new ControlledServer()) {
  const controller = (await startObsidianRelay({
    server,
    token: RELAY_TOKEN,
  })) as RelayController;
  return { controller, server };
}

async function startReadyRelay() {
  const { controller, server } = await createRelay();
  const renderer = server.connect();
  renderer.receive(Buffer.from("ready"), false);
  await controller.ready;
  return { controller, renderer, server };
}

function sendRequest(
  server: ControlledServer,
  request: { id: string; type: string; data?: unknown },
) {
  const testSocket = server.connect(new ControlledSocket(), {
    role: "test",
    token: RELAY_TOKEN,
  });
  testSocket.receive(JSON.stringify(request));
  return testSocket;
}

function parseSent(socket: ControlledSocket, index = 0) {
  return JSON.parse(socket.sent[index] || "null") as Record<string, unknown>;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Obsidian test relay", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("waits for a valid listening address and cleans up late bind errors", async () => {
    const server = new ControlledServer();
    server.addressValue = null;
    const starting = Promise.resolve().then(
      async () =>
        await startObsidianRelay({
          server,
          token: RELAY_TOKEN,
        }),
    );
    const rejection = expect(starting).rejects.toThrow(
      "Obsidian test relay server has invalid listening address",
    );

    await flushPromises();
    server.emit("listening");

    await rejection;
    expect(server.closeCalls).toBe(1);
    expect(() =>
      server.emit("error", new Error("late bind error")),
    ).not.toThrow();
    expect(jest.getTimerCount()).toBe(0);
  });

  test("rejects and closes a server with a string listening address", async () => {
    const server = new ControlledServer();
    server.addressValue = "relay.sock";

    await expect(
      startObsidianRelay({ server, token: RELAY_TOKEN }),
    ).rejects.toThrow(
      "Obsidian test relay server has invalid listening address",
    );

    expect(server.closeCalls).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("closes the server after a bind error", async () => {
    const server = new ControlledServer();
    server.addressValue = null;
    const starting = Promise.resolve().then(
      async () => await startObsidianRelay({ server, token: RELAY_TOKEN }),
    );
    const rejection = expect(starting).rejects.toThrow(
      "Obsidian test relay server bind error: address in use",
    );
    await flushPromises();

    server.emit("error", new Error("address in use"));

    await rejection;
    expect(server.closeCalls).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("bounds the wait for the relay server to listen", async () => {
    const server = new ControlledServer();
    server.addressValue = null;
    const starting = Promise.resolve().then(
      async () =>
        await startObsidianRelay({
          server,
          token: RELAY_TOKEN,
        }),
    );
    const rejection = expect(starting).rejects.toThrow(
      "Obsidian test relay server listening timed out",
    );
    await flushPromises();

    await jest.advanceTimersByTimeAsync(RELAY_LISTEN_TIMEOUT_MS);

    await rejection;
    expect(server.closeCalls).toBe(1);
  });

  test("bounds the wait for the renderer connection", async () => {
    const { controller } = await createRelay();
    const rejection = expect(controller.ready).rejects.toThrow(
      "Obsidian test relay renderer connection timed out",
    );

    await jest.advanceTimersByTimeAsync(RELAY_RENDERER_CONNECTION_TIMEOUT_MS);

    await rejection;
  });

  test("bounds the wait for the renderer ready frame", async () => {
    const { controller, server } = await createRelay();
    server.connect();
    const rejection = expect(controller.ready).rejects.toThrow(
      "Obsidian test relay renderer ready timed out",
    );

    await jest.advanceTimersByTimeAsync(RELAY_RENDERER_READY_TIMEOUT_MS);

    await rejection;
  });

  test("rejects an unexpected renderer ready frame", async () => {
    const { controller, server } = await createRelay();
    server.connect().receive("not-ready");

    await expect(controller.ready).rejects.toThrow(
      "Obsidian test relay unexpected renderer ready frame",
    );
  });

  test("rejects a malformed renderer ready frame", async () => {
    const { controller, server } = await createRelay();
    server.connect().receive({ ready: true });

    await expect(controller.ready).rejects.toThrow(
      "Obsidian test relay malformed renderer ready frame",
    );
  });

  test("keeps failed startup cleanup bounded after renderer ownership detaches", async () => {
    const { controller, server } = await createRelay();
    const renderer = server.connect();
    renderer.receive("not-ready");
    await expect(controller.ready).rejects.toThrow(
      "Obsidian test relay unexpected renderer ready frame",
    );
    server.deferClose = true;

    const closed = controller.close();
    await jest.advanceTimersByTimeAsync(RELAY_CLOSE_TIMEOUT_MS);
    await closed;

    expect(renderer.terminateCalls).toBe(1);
    expect(renderer.eventNames()).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });

  test.each([
    ["close", "closed before ready"],
    ["error", "error before ready: refused"],
  ])("rejects a renderer %s before ready", async (event, expected) => {
    const { controller, server } = await createRelay();
    const renderer = server.connect();
    const rejection = expect(controller.ready).rejects.toThrow(
      `Obsidian test relay renderer ${expected}`,
    );

    if (event === "close") {
      renderer.closeFromPeer();
    } else {
      renderer.fail("refused");
    }

    await rejection;
  });

  test.each([
    ["missing token", { role: "renderer" }],
    ["wrong token", { role: "renderer", token: "wrong" }],
    ["wrong role", { role: "test", token: RELAY_TOKEN }],
    ["missing role", { token: RELAY_TOKEN }],
  ])(
    "does not let a %s connection claim the renderer role",
    async (_description, identity) => {
      const { controller, server } = await createRelay();
      const readySettlement = controller.ready.catch(() => undefined);
      try {
        const unrelated = server.connect(new ControlledSocket(), identity);

        expect(unrelated.closeCalls).toBe(1);
        expect(() => unrelated.fail("late protocol error")).not.toThrow();
        const renderer = server.connect();
        renderer.receive("ready");
        await expect(controller.ready).resolves.toBeUndefined();
      } finally {
        await controller.close();
        await readySettlement;
      }
    },
  );

  test.each([
    ["missing token", { role: "test" }],
    ["wrong token", { role: "test", token: "wrong" }],
    ["renderer role", { role: "renderer", token: RELAY_TOKEN }],
    ["missing role", { token: RELAY_TOKEN }],
  ])(
    "does not accept a post-ready client with %s",
    async (_description, identity) => {
      const { controller, renderer, server } = await startReadyRelay();
      try {
        const unrelated = server.connect(new ControlledSocket(), identity);
        unrelated.receive(
          JSON.stringify({ id: "intruder", type: "getCurrentState" }),
        );

        expect(unrelated.closeCalls).toBe(1);
        expect(renderer.sent).toEqual([]);
      } finally {
        await controller.close();
      }
    },
  );

  test("relays a validated request and renderer response", async () => {
    const { controller, renderer, server } = await startReadyRelay();
    expect(controller.port).toBe(43123);
    const testSocket = sendRequest(server, {
      id: "request-1",
      type: "getCurrentState",
    });

    expect(parseSent(renderer)).toEqual({
      id: "request-1",
      type: "getCurrentState",
    });

    renderer.receive(
      JSON.stringify({ id: "request-1", data: { value: "- one" } }),
    );

    expect(parseSent(testSocket)).toEqual({
      id: "request-1",
      data: { value: "- one" },
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  test.each([
    ["malformed JSON", "{malformed"],
    ["invalid envelope", JSON.stringify({ id: 1, type: "waitForIdle" })],
  ])("closes only the test socket for a %s request", async (_name, frame) => {
    const { renderer, server } = await startReadyRelay();
    const validSocket = sendRequest(server, {
      id: "valid",
      type: "waitForIdle",
    });
    const invalidSocket = server.connect(new ControlledSocket(), {
      role: "test",
      token: RELAY_TOKEN,
    });

    expect(() => invalidSocket.receive(frame)).not.toThrow();

    expect(invalidSocket.closeCalls).toBe(1);
    expect(validSocket.closeCalls).toBe(0);
    renderer.receive(JSON.stringify({ id: "valid", data: "ok" }));
    expect(parseSent(validSocket)).toEqual({ id: "valid", data: "ok" });
  });

  test.each([
    ["malformed JSON", "{malformed"],
    ["invalid envelope", JSON.stringify({ id: 1, data: "wrong" })],
  ])(
    "fails all renderer-owned requests for a %s response",
    async (_name, frame) => {
      const { renderer, server } = await startReadyRelay();
      const first = sendRequest(server, {
        id: "first",
        type: "getCurrentState",
      });
      const second = sendRequest(server, {
        id: "second",
        type: "waitForIdle",
      });

      expect(() => renderer.receive(frame)).not.toThrow();

      expect(parseSent(first).error).toBe(
        "Obsidian test relay malformed renderer response",
      );
      expect(parseSent(second).error).toBe(
        "Obsidian test relay malformed renderer response",
      );
      expect(renderer.closeCalls).toBe(1);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  test("rejects a binary test request on only that test socket", async () => {
    const { controller, renderer, server } = await startReadyRelay();
    const activeSocket = sendRequest(server, {
      id: "active-after-binary",
      type: "waitForIdle",
    });
    const binarySocket = server.connect(new ControlledSocket(), {
      role: "test",
      token: RELAY_TOKEN,
    });

    binarySocket.receive(
      Buffer.from(JSON.stringify({ id: "binary", type: "waitForIdle" })),
      true,
    );

    expect(binarySocket.closeCalls).toBe(1);
    expect(() => binarySocket.fail("late protocol error")).not.toThrow();
    expect(activeSocket.closeCalls).toBe(0);
    renderer.receive(
      JSON.stringify({ id: "active-after-binary", data: "still active" }),
    );
    expect(parseSent(activeSocket).data).toBe("still active");
    await controller.close();
  });

  test("rejects a binary renderer response on only the renderer socket", async () => {
    const { renderer, server } = await startReadyRelay();
    const first = sendRequest(server, {
      id: "binary-first",
      type: "getCurrentState",
    });
    const second = sendRequest(server, {
      id: "binary-second",
      type: "waitForIdle",
    });

    renderer.receive(
      Buffer.from(JSON.stringify({ id: "binary-first", data: "wrong" })),
      true,
    );

    expect(parseSent(first).error).toBe(
      "Obsidian test relay binary renderer response",
    );
    expect(parseSent(second).error).toBe(
      "Obsidian test relay binary renderer response",
    );
    expect(renderer.closeCalls).toBe(1);
    expect(() => renderer.fail("late protocol error")).not.toThrow();
  });

  test("expires a silent renderer request before the environment deadline", async () => {
    expect(RELAY_REQUEST_TIMEOUT_MS).toBeLessThan(10_000);
    const { server } = await startReadyRelay();
    const testSocket = sendRequest(server, {
      id: "silent",
      type: "getCurrentState",
    });

    await jest.advanceTimersByTimeAsync(RELAY_REQUEST_TIMEOUT_MS);

    expect(parseSent(testSocket)).toEqual({
      id: "silent",
      error: "Obsidian test relay request timed out: getCurrentState (8000ms)",
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  test.each(["close", "error"])(
    "clears only requests owned by a test socket on %s",
    async (event) => {
      const { renderer, server } = await startReadyRelay();
      const failedSocket = sendRequest(server, {
        id: "failed",
        type: "getCurrentState",
      });
      const activeSocket = sendRequest(server, {
        id: "active",
        type: "waitForIdle",
      });
      expect(jest.getTimerCount()).toBe(2);

      if (event === "close") {
        failedSocket.closeFromPeer();
      } else {
        failedSocket.fail("reset");
      }

      expect(jest.getTimerCount()).toBe(1);
      renderer.receive(JSON.stringify({ id: "failed", data: "late" }));
      renderer.receive(JSON.stringify({ id: "active", data: "current" }));

      expect(failedSocket.sent).toEqual([]);
      expect(parseSent(activeSocket)).toEqual({
        id: "active",
        data: "current",
      });
    },
  );

  test.each([
    ["close", "Obsidian test relay renderer connection closed"],
    ["error", "Obsidian test relay renderer connection error: reset"],
  ])("settles all renderer-owned requests on %s", async (event, expected) => {
    const { renderer, server } = await startReadyRelay();
    const first = sendRequest(server, {
      id: "first",
      type: "getCurrentState",
    });
    const second = sendRequest(server, {
      id: "second",
      type: "waitForIdle",
    });

    if (event === "close") {
      renderer.closeFromPeer();
    } else {
      renderer.fail("reset");
    }

    expect(parseSent(first).error).toBe(expected);
    expect(parseSent(second).error).toBe(expected);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("ignores stale and duplicate renderer responses", async () => {
    const { renderer, server } = await startReadyRelay();
    const testSocket = sendRequest(server, {
      id: "once",
      type: "getCurrentState",
    });

    renderer.receive(JSON.stringify({ id: "once", data: "first" }));
    expect(() =>
      renderer.receive(JSON.stringify({ id: "once", data: "duplicate" })),
    ).not.toThrow();
    renderer.receive(JSON.stringify({ id: "stale", data: "late" }));

    expect(testSocket.sent).toHaveLength(1);
    expect(parseSent(testSocket).data).toBe("first");
  });

  test("does not send a late request to a non-open renderer", async () => {
    const { renderer, server } = await startReadyRelay();
    renderer.readyState = 2;
    const testSocket = sendRequest(server, {
      id: "late",
      type: "waitForIdle",
    });

    expect(renderer.sent).toEqual([]);
    expect(parseSent(testSocket)).toEqual({
      id: "late",
      error: "Obsidian test relay renderer connection is not open",
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  test("turns a synchronous renderer send failure into a response", async () => {
    const { renderer, server } = await startReadyRelay();
    renderer.failNextSend("write failed");
    const testSocket = sendRequest(server, {
      id: "send-failure",
      type: "waitForIdle",
    });

    expect(parseSent(testSocket)).toEqual({
      id: "send-failure",
      error: "Obsidian test relay renderer send error: write failed",
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  test("clears a request when sending its response throws synchronously", async () => {
    const { renderer, server } = await startReadyRelay();
    const testSocket = server.connect(new ControlledSocket(), {
      role: "test",
      token: RELAY_TOKEN,
    });
    testSocket.failNextSend("test write failed");
    testSocket.receive(
      JSON.stringify({ id: "response-failure", type: "waitForIdle" }),
    );

    expect(() =>
      renderer.receive(
        JSON.stringify({ id: "response-failure", data: "done" }),
      ),
    ).not.toThrow();
    expect(testSocket.closeCalls).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("closes idempotently and removes owned listeners and timers", async () => {
    const { controller, renderer, server } = await startReadyRelay();
    const testSocket = sendRequest(server, {
      id: "pending",
      type: "getCurrentState",
    });

    const firstClose = controller.close();
    const secondClose = controller.close();

    expect(secondClose).toBe(firstClose);
    await firstClose;
    await flushPromises();
    expect(parseSent(testSocket).error).toBe(
      "Obsidian test relay controller closed",
    );
    expect(renderer.closeCalls).toBe(1);
    expect(testSocket.closeCalls).toBe(1);
    expect(server.closeCalls).toBe(1);
    expect(server.listenerCount("connection")).toBe(0);
    expect(server.listenerCount("error")).toBe(0);
    expect(renderer.eventNames()).toEqual([]);
    expect(testSocket.eventNames()).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("bounds controller close when WebSocket handshakes never finish", async () => {
    const { controller, renderer, server } = await startReadyRelay();
    server.deferClose = true;

    const closed = controller.close();
    const settled = jest.fn();
    void closed.then(settled);
    await flushPromises();
    expect(settled).not.toHaveBeenCalled();
    expect(() =>
      server.emit("error", new Error("late server close error")),
    ).not.toThrow();

    await jest.advanceTimersByTimeAsync(RELAY_CLOSE_TIMEOUT_MS);
    await closed;

    expect(settled).toHaveBeenCalledTimes(1);
    expect(renderer.terminateCalls).toBe(1);
    expect(server.closeCalls).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("keeps late socket errors consumed until forced close is terminal", async () => {
    const { controller, renderer, server } = await startReadyRelay();
    server.deferClose = true;
    renderer.terminateError = new Error("terminate failed");

    const closed = controller.close();
    await jest.advanceTimersByTimeAsync(RELAY_CLOSE_TIMEOUT_MS);
    await closed;

    expect(renderer.terminateCalls).toBe(1);
    expect(() => renderer.fail("late close error")).not.toThrow();
    expect(renderer.listenerCount("error")).toBe(1);
    renderer.closeFromPeer();
    expect(renderer.eventNames()).toEqual([]);
  });
});

describe("Obsidian test relay loopback", () => {
  const ActualWebSocket = jest.requireActual<unknown>(
    "ws",
  ) as LoopbackWebSocketConstructor;

  test("listens on loopback and relays authenticated real WebSockets", async () => {
    jest.useRealTimers();
    const controller = (await startObsidianRelay()) as RelayController;
    const readySettlement = controller.ready.catch(() => undefined);
    let renderer: LoopbackSocket | undefined;
    let testSocket: LoopbackSocket | undefined;

    try {
      expect(controller.token).toMatch(/^[0-9a-f]{64}$/);
      const baseUrl = `ws://127.0.0.1:${controller.port}/`;
      renderer = new ActualWebSocket(
        `${baseUrl}?role=renderer&token=${controller.token}`,
      );
      await waitForOpen(renderer);
      renderer.send("ready");
      await controller.ready;
      testSocket = new ActualWebSocket(
        `${baseUrl}?role=test&token=${controller.token}`,
      );
      await waitForOpen(testSocket);

      const rendererRequest = waitForMessage(renderer);
      testSocket.send(
        JSON.stringify({ id: "loopback", type: "getCurrentState" }),
      );
      expect(JSON.parse(await rendererRequest)).toEqual({
        id: "loopback",
        type: "getCurrentState",
      });

      const testResponse = waitForMessage(testSocket);
      renderer.send(JSON.stringify({ id: "loopback", data: "ok" }));
      expect(JSON.parse(await testResponse)).toEqual({
        id: "loopback",
        data: "ok",
      });
    } finally {
      await controller.close();
      await readySettlement;
      renderer?.terminate();
      testSocket?.terminate();
    }
  });
});

function waitForOpen(socket: LoopbackSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForMessage(socket: LoopbackSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => resolve(String(data)));
    socket.once("error", reject);
  });
}
