const { TestEnvironment } = require("jest-environment-node");
const WebSocket = require("ws");
const { installObsidianDriver } = require("./obsidian-driver");

let idSeq = 1;
const DEFAULT_TEST_PLATFORM_WS_PORT = "8080";
const CONNECTION_TIMEOUT_MS = 10_000;
const COMMAND_TIMEOUT_MS = 10_000;

function createTransportError(message) {
  return new Error(`Obsidian test transport ${message}`);
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function parseResponse(message) {
  const response = JSON.parse(String(message));
  if (
    typeof response !== "object" ||
    response === null ||
    Array.isArray(response) ||
    typeof response.id !== "string" ||
    (response.error !== undefined && typeof response.error !== "string")
  ) {
    throw new Error("Invalid response envelope");
  }
  return response;
}

function getTestPlatformWsUrl() {
  const port =
    process.env.TEST_PLATFORM_WS_PORT || DEFAULT_TEST_PLATFORM_WS_PORT;
  const params = new URLSearchParams({
    role: "test",
    token: process.env.TEST_PLATFORM_WS_TOKEN || "",
  });

  return `ws://127.0.0.1:${port}/?${params}`;
}

module.exports = class CustomEnvironment extends TestEnvironment {
  async setup() {
    await super.setup();

    this.callbacks = new Map();
    this.ws = undefined;
    this.wsInitialization = undefined;
    this.rejectWsInitialization = undefined;
    this.teardownPromise = undefined;
    this.isTornDown = false;
    installObsidianDriver(this.global, this.runCommand.bind(this));
  }

  async initWs() {
    if (this.isTornDown) {
      throw createTransportError("teardown");
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.wsInitialization) {
      return this.wsInitialization;
    }

    const socket = new WebSocket(getTestPlatformWsUrl());
    this.ws = socket;

    const initialization = new Promise((resolve, reject) => {
      let settled = false;

      const settle = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(connectionTimeout);
        this.rejectWsInitialization = undefined;
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      const fail = (error) => {
        settle(error);
        this.failTransport(socket, error);
      };

      const connectionTimeout = setTimeout(() => {
        fail(createTransportError("connection timed out"));
        socket.close();
      }, CONNECTION_TIMEOUT_MS);

      this.rejectWsInitialization = (error) => settle(error);

      socket.on("open", () => settle());
      socket.on("message", (message) =>
        this.handleMessage(socket, message, fail),
      );
      socket.on("error", (error) => {
        fail(
          createTransportError(`connection error: ${getErrorMessage(error)}`),
        );
      });
      socket.on("close", () => {
        fail(
          createTransportError(
            settled ? "connection closed" : "connection closed before opening",
          ),
        );
      });
    });

    this.wsInitialization = initialization;
    try {
      await initialization;
    } finally {
      if (this.wsInitialization === initialization) {
        this.wsInitialization = undefined;
      }
    }
  }

  handleMessage(socket, message, fail) {
    let response;
    try {
      response = parseResponse(message);
    } catch {
      fail(createTransportError("protocol error"));
      try {
        socket.close();
      } catch {
        // The protocol failure has already settled the transport lifecycle.
      }
      return;
    }

    const { id, data, error } = response;
    if (error !== undefined) {
      this.settleRequest(id, new Error(error), undefined, socket);
    } else {
      this.settleRequest(id, undefined, data, socket);
    }
  }

  failTransport(socket, error) {
    if (this.ws === socket) {
      this.ws = undefined;
    }
    this.rejectPendingRequests(error, socket);
  }

  rejectPendingRequests(error, socket) {
    for (const [id, request] of [...this.callbacks.entries()]) {
      if (!socket || request.socket === socket) {
        this.settleRequest(id, error);
      }
    }
  }

  settleRequest(id, error, data, socket) {
    const request = this.callbacks.get(id);
    if (!request || (socket && request.socket !== socket)) {
      return;
    }

    this.callbacks.delete(id);
    clearTimeout(request.timeout);
    if (error) {
      request.reject(error);
    } else {
      request.resolve(data);
    }
  }

  runCommand(type, data) {
    return new Promise((resolve, reject) => {
      const id = String(idSeq++);
      const timeout = setTimeout(() => {
        this.settleRequest(
          id,
          createTransportError(`command timed out: ${type}`),
        );
      }, COMMAND_TIMEOUT_MS);

      this.callbacks.set(id, {
        reject,
        resolve,
        socket: undefined,
        timeout,
      });
      void this.sendCommandWhenReady(id, type, data);
    });
  }

  async sendCommandWhenReady(id, type, data) {
    try {
      await this.initWs();

      const request = this.callbacks.get(id);
      if (!request) {
        return;
      }

      const socket = this.ws;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        this.settleRequest(id, createTransportError("connection is not open"));
        return;
      }

      request.socket = socket;
      try {
        socket.send(JSON.stringify({ id, type, data }));
      } catch (error) {
        this.settleRequest(
          id,
          createTransportError(`send error: ${getErrorMessage(error)}`),
        );
      }
    } catch (error) {
      this.settleRequest(id, error);
    }
  }

  teardown() {
    if (this.teardownPromise) {
      return this.teardownPromise;
    }

    this.isTornDown = true;
    const error = createTransportError("teardown");
    this.rejectWsInitialization?.(error);
    this.rejectPendingRequests(error);

    const socket = this.ws;
    this.ws = undefined;
    if (socket) {
      socket.close();
    }

    this.teardownPromise = super.teardown();
    return this.teardownPromise;
  }
};

module.exports.CONNECTION_TIMEOUT_MS = CONNECTION_TIMEOUT_MS;
module.exports.COMMAND_TIMEOUT_MS = COMMAND_TIMEOUT_MS;
