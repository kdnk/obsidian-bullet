const { randomBytes } = require("crypto");
const WebSocket = require("ws");
const debug = require("debug")("jest-obsidian");

const RELAY_RENDERER_CONNECTION_TIMEOUT_MS = 30_000;
const RELAY_RENDERER_READY_TIMEOUT_MS = 15_000;
const RELAY_REQUEST_TIMEOUT_MS = 8_000;
const RELAY_CLOSE_TIMEOUT_MS = 1_000;
const RELAY_LISTEN_TIMEOUT_MS = 5_000;
const OPEN_READY_STATE = 1;

function createRelayError(message) {
  return new Error(`Obsidian test relay ${message}`);
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonFrame(frame) {
  const value = JSON.parse(String(frame));
  if (!isRecord(value)) {
    throw new Error("Frame must be an object");
  }
  return value;
}

function parseTestRequest(frame) {
  const request = parseJsonFrame(frame);
  if (
    typeof request.id !== "string" ||
    request.id.length === 0 ||
    typeof request.type !== "string" ||
    request.type.length === 0
  ) {
    throw new Error("Invalid test request envelope");
  }
  return request;
}

function parseRendererResponse(frame) {
  const response = parseJsonFrame(frame);
  if (
    typeof response.id !== "string" ||
    response.id.length === 0 ||
    (response.error !== undefined && typeof response.error !== "string")
  ) {
    throw new Error("Invalid renderer response envelope");
  }
  return response;
}

function parseReadyFrame(frame, isBinary) {
  if (isBinary || !(typeof frame === "string" || Buffer.isBuffer(frame))) {
    throw createRelayError("malformed renderer ready frame");
  }
  if (String(frame) !== "ready") {
    throw createRelayError("unexpected renderer ready frame");
  }
}

function isSocketOpen(socket) {
  return socket?.readyState === OPEN_READY_STATE;
}

function safeClose(socket) {
  if (!socket || socket.readyState >= 2) {
    return;
  }
  try {
    socket.close();
  } catch {
    // Lifecycle cleanup is already in progress.
  }
}

function forceTerminate(socket) {
  if (!socket || socket.readyState === 3) {
    return;
  }
  if (typeof socket.terminate === "function") {
    try {
      socket.terminate();
      return;
    } catch {
      // Fall back to the normal close path below.
    }
  }
  safeClose(socket);
}

function readListeningAddress(server) {
  const address = server.address();
  if (
    address &&
    typeof address !== "string" &&
    Number.isInteger(address.port) &&
    address.port > 0
  ) {
    return address;
  }
  return undefined;
}

function waitForListeningAddress(server) {
  const immediateAddress = readListeningAddress(server);
  if (immediateAddress) {
    return Promise.resolve(immediateAddress);
  }
  if (typeof server.address() === "string") {
    return Promise.reject(
      createRelayError("server has invalid listening address"),
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (error, address) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      server.off("listening", handleListening);
      server.off("error", handleError);
      if (error) {
        reject(error);
      } else {
        resolve(address);
      }
    };
    const handleListening = () => {
      const address = readListeningAddress(server);
      if (!address) {
        settle(createRelayError("server has invalid listening address"));
      } else {
        settle(undefined, address);
      }
    };
    const handleError = (error) =>
      settle(createRelayError(`server bind error: ${getErrorMessage(error)}`));
    const timeout = setTimeout(
      () => settle(createRelayError("server listening timed out")),
      RELAY_LISTEN_TIMEOUT_MS,
    );
    server.on("listening", handleListening);
    server.on("error", handleError);

    const address = readListeningAddress(server);
    if (address) {
      settle(undefined, address);
    }
  });
}

function closeServerAfterStartFailure(server) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      if (server.clients) {
        for (const socket of server.clients) {
          forceTerminate(socket);
        }
      }
      finish();
    }, RELAY_CLOSE_TIMEOUT_MS);
    try {
      server.close(finish);
    } catch {
      finish();
    }
  });
}

function getConnectionRole(request, token) {
  if (!request || typeof request.url !== "string") {
    return undefined;
  }
  try {
    const url = new URL(request.url, "ws://127.0.0.1");
    if (url.searchParams.get("token") !== token) {
      return undefined;
    }
    const role = url.searchParams.get("role");
    return role === "renderer" || role === "test" ? role : undefined;
  } catch {
    return undefined;
  }
}

async function startObsidianRelay(options = {}) {
  const token = options.token || randomBytes(32).toString("hex");
  const connectionTimeoutMs =
    options.connectionTimeoutMs || RELAY_RENDERER_CONNECTION_TIMEOUT_MS;
  const readyTimeoutMs =
    options.readyTimeoutMs || RELAY_RENDERER_READY_TIMEOUT_MS;
  const requestTimeoutMs = options.requestTimeoutMs || RELAY_REQUEST_TIMEOUT_MS;
  const server =
    options.server || new WebSocket.Server({ host: "127.0.0.1", port: 0 });
  const consumeServerError = () => {};
  server.on("error", consumeServerError);
  let address;
  try {
    address = await waitForListeningAddress(server);
  } catch (error) {
    await closeServerAfterStartFailure(server);
    throw error;
  }
  const testSockets = new Map();
  const pendingRequests = new Map();
  const ownedSockets = new Set();
  const socketLifetimes = new Map();

  let phase = "waiting-for-renderer";
  let rendererSocket;
  let rendererListeners;
  let connectionTimer;
  let readyTimer;
  let readySettled = false;
  let closePromise;
  let resolveReady;
  let rejectReady;

  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  function clearStartupTimers() {
    clearTimeout(connectionTimer);
    clearTimeout(readyTimer);
    connectionTimer = undefined;
    readyTimer = undefined;
  }

  function releaseOwnedSocket(socket, lifetime = socketLifetimes.get(socket)) {
    if (!lifetime) {
      return;
    }
    if (socketLifetimes.get(socket) === lifetime) {
      socketLifetimes.delete(socket);
    }
    ownedSockets.delete(socket);
    socket.off("error", lifetime.error);
    socket.off("close", lifetime.close);
  }

  function preserveSocketSafetyUntilClose(socket) {
    if (!socketLifetimes.has(socket)) {
      return;
    }
    socketLifetimes.delete(socket);
    ownedSockets.delete(socket);
  }

  function ownSocket(socket) {
    if (socketLifetimes.has(socket)) {
      return;
    }
    const lifetime = { error: () => {}, close: undefined };
    lifetime.close = () => releaseOwnedSocket(socket, lifetime);
    socketLifetimes.set(socket, lifetime);
    ownedSockets.add(socket);
    socket.on("error", lifetime.error);
    socket.on("close", lifetime.close);
  }

  function detachRendererListeners(socket = rendererSocket) {
    if (!socket || !rendererListeners) {
      return;
    }
    socket.off("message", rendererListeners.message);
    socket.off("error", rendererListeners.error);
    socket.off("close", rendererListeners.close);
    rendererListeners = undefined;
  }

  function detachTestSocket(state) {
    if (testSockets.get(state.socket) !== state) {
      return;
    }
    testSockets.delete(state.socket);
    state.socket.off("message", state.message);
    state.socket.off("error", state.error);
    state.socket.off("close", state.close);
  }

  function sendToSocket(socket, message) {
    if (!isSocketOpen(socket)) {
      return {
        error: createRelayError("test connection is not open"),
        sent: false,
      };
    }
    try {
      socket.send(JSON.stringify(message));
      return { sent: true };
    } catch (error) {
      return {
        error: createRelayError(`test send error: ${getErrorMessage(error)}`),
        sent: false,
      };
    }
  }

  function clearRequest(request) {
    if (pendingRequests.get(request.id) !== request) {
      return false;
    }
    pendingRequests.delete(request.id);
    clearTimeout(request.timeout);
    return true;
  }

  function failTestSocket(state, closeSocket) {
    if (testSockets.get(state.socket) !== state) {
      return;
    }
    detachTestSocket(state);
    for (const request of [...pendingRequests.values()]) {
      if (request.testSocket === state.socket) {
        clearRequest(request);
      }
    }
    if (closeSocket) {
      safeClose(state.socket);
    }
  }

  function settleRequest(request, error, data) {
    if (!clearRequest(request)) {
      return;
    }
    const state = testSockets.get(request.testSocket);
    if (!state || !isSocketOpen(request.testSocket)) {
      return;
    }
    const response = error
      ? { id: request.id, error: error.message }
      : { id: request.id, data };
    const result = sendToSocket(request.testSocket, response);
    if (!result.sent) {
      failTestSocket(state, true);
    }
  }

  function settleRendererRequests(socket, error) {
    for (const request of [...pendingRequests.values()]) {
      if (request.rendererSocket === socket) {
        settleRequest(request, error);
      }
    }
  }

  function rejectRendererStartup(error, closeSocket) {
    if (readySettled) {
      return;
    }
    readySettled = true;
    phase = "failed";
    clearStartupTimers();
    const socket = rendererSocket;
    detachRendererListeners(socket);
    rendererSocket = undefined;
    if (closeSocket) {
      safeClose(socket);
    }
    rejectReady(error);
  }

  function failRenderer(socket, error, closeSocket) {
    if (rendererSocket !== socket) {
      return;
    }
    rendererSocket = undefined;
    phase = "failed";
    detachRendererListeners(socket);
    settleRendererRequests(socket, error);
    if (closeSocket) {
      safeClose(socket);
    }
  }

  function handleRendererMessage(socket, frame, isBinary) {
    if (rendererSocket !== socket) {
      return;
    }

    if (phase === "waiting-for-ready") {
      try {
        parseReadyFrame(frame, isBinary);
      } catch (error) {
        rejectRendererStartup(error, true);
        return;
      }
      clearTimeout(readyTimer);
      readyTimer = undefined;
      phase = "ready";
      readySettled = true;
      debug("Obsidian WebSocket ready");
      resolveReady();
      return;
    }

    if (phase !== "ready") {
      return;
    }

    if (isBinary) {
      failRenderer(socket, createRelayError("binary renderer response"), true);
      return;
    }

    let response;
    try {
      response = parseRendererResponse(frame);
    } catch {
      failRenderer(
        socket,
        createRelayError("malformed renderer response"),
        true,
      );
      return;
    }

    const request = pendingRequests.get(response.id);
    if (!request || request.rendererSocket !== socket) {
      debug(`Ignoring stale renderer response ${response.id}`);
      return;
    }

    if (response.error !== undefined) {
      settleRequest(request, new Error(response.error));
    } else {
      settleRequest(request, undefined, response.data);
    }
  }

  function attachRenderer(socket) {
    rendererSocket = socket;
    phase = "waiting-for-ready";
    clearTimeout(connectionTimer);
    connectionTimer = undefined;
    readyTimer = setTimeout(() => {
      rejectRendererStartup(createRelayError("renderer ready timed out"), true);
    }, readyTimeoutMs);

    rendererListeners = {
      message: (frame, isBinary) =>
        handleRendererMessage(socket, frame, isBinary),
      error: (error) => {
        if (phase === "waiting-for-ready") {
          rejectRendererStartup(
            createRelayError(
              `renderer error before ready: ${getErrorMessage(error)}`,
            ),
            true,
          );
        } else {
          failRenderer(
            socket,
            createRelayError(
              `renderer connection error: ${getErrorMessage(error)}`,
            ),
            true,
          );
        }
      },
      close: () => {
        if (phase === "waiting-for-ready") {
          rejectRendererStartup(
            createRelayError("renderer closed before ready"),
            false,
          );
        } else {
          failRenderer(
            socket,
            createRelayError("renderer connection closed"),
            false,
          );
        }
      },
    };
    socket.on("message", rendererListeners.message);
    socket.on("error", rendererListeners.error);
    socket.on("close", rendererListeners.close);
  }

  function handleTestRequest(state, frame, isBinary) {
    if (isBinary) {
      failTestSocket(state, true);
      return;
    }
    let requestEnvelope;
    try {
      requestEnvelope = parseTestRequest(frame);
    } catch {
      failTestSocket(state, true);
      return;
    }

    if (pendingRequests.has(requestEnvelope.id)) {
      failTestSocket(state, true);
      return;
    }

    const socket = rendererSocket;
    const request = {
      id: requestEnvelope.id,
      rendererSocket: socket,
      testSocket: state.socket,
      timeout: undefined,
      type: requestEnvelope.type,
    };
    request.timeout = setTimeout(() => {
      settleRequest(
        request,
        createRelayError(
          `request timed out: ${request.type} (${requestTimeoutMs}ms)`,
        ),
      );
    }, requestTimeoutMs);
    pendingRequests.set(request.id, request);

    if (!socket || phase !== "ready" || !isSocketOpen(socket)) {
      settleRequest(
        request,
        createRelayError("renderer connection is not open"),
      );
      return;
    }

    try {
      socket.send(JSON.stringify(requestEnvelope));
    } catch (error) {
      settleRequest(
        request,
        createRelayError(`renderer send error: ${getErrorMessage(error)}`),
      );
    }
  }

  function attachTestSocket(socket) {
    const state = {
      socket,
      message: undefined,
      error: undefined,
      close: undefined,
    };
    state.message = (frame, isBinary) =>
      handleTestRequest(state, frame, isBinary);
    state.error = () => failTestSocket(state, true);
    state.close = () => failTestSocket(state, false);
    testSockets.set(socket, state);
    socket.on("message", state.message);
    socket.on("error", state.error);
    socket.on("close", state.close);
  }

  function handleConnection(socket, request) {
    ownSocket(socket);
    const role = getConnectionRole(request, token);
    if (phase === "waiting-for-renderer" && role === "renderer") {
      debug("Waiting for Obsidian ready message");
      attachRenderer(socket);
    } else if (phase === "ready" && role === "test") {
      attachTestSocket(socket);
    } else {
      safeClose(socket);
    }
  }

  function handleServerError(error) {
    const relayError = createRelayError(
      `server error: ${getErrorMessage(error)}`,
    );
    if (!readySettled) {
      rejectRendererStartup(relayError, true);
    } else if (rendererSocket) {
      failRenderer(rendererSocket, relayError, true);
    }
  }

  server.on("connection", handleConnection);
  server.on("error", handleServerError);
  connectionTimer = setTimeout(() => {
    rejectRendererStartup(
      createRelayError("renderer connection timed out"),
      false,
    );
  }, connectionTimeoutMs);

  function close() {
    if (closePromise) {
      return closePromise;
    }

    closePromise = new Promise((resolve) => {
      phase = "closed";
      clearStartupTimers();
      server.off("connection", handleConnection);
      server.off("error", handleServerError);

      const controllerError = createRelayError("controller closed");
      if (!readySettled) {
        readySettled = true;
        rejectReady(controllerError);
      }
      for (const request of [...pendingRequests.values()]) {
        settleRequest(request, controllerError);
      }
      for (const state of [...testSockets.values()]) {
        detachTestSocket(state);
        safeClose(state.socket);
      }
      const socket = rendererSocket;
      detachRendererListeners(socket);
      rendererSocket = undefined;
      safeClose(socket);

      let finished = false;
      const finish = (preserveErrorConsumers) => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(closeTimeout);
        for (const ownedSocket of [...ownedSockets]) {
          if (preserveErrorConsumers && ownedSocket.readyState !== 3) {
            preserveSocketSafetyUntilClose(ownedSocket);
          } else {
            releaseOwnedSocket(ownedSocket);
          }
        }
        if (!preserveErrorConsumers) {
          server.off("error", consumeServerError);
        }
        resolve();
      };
      const closeTimeout = setTimeout(() => {
        for (const ownedSocket of ownedSockets) {
          forceTerminate(ownedSocket);
        }
        finish(true);
      }, RELAY_CLOSE_TIMEOUT_MS);

      try {
        server.close(() => finish(false));
      } catch {
        finish(false);
      }
    });
    return closePromise;
  }

  return {
    close,
    port: address.port,
    ready,
    token,
  };
}

module.exports = {
  RELAY_CLOSE_TIMEOUT_MS,
  RELAY_LISTEN_TIMEOUT_MS,
  RELAY_RENDERER_CONNECTION_TIMEOUT_MS,
  RELAY_RENDERER_READY_TIMEOUT_MS,
  RELAY_REQUEST_TIMEOUT_MS,
  startObsidianRelay,
};
