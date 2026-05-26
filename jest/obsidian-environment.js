const { TestEnvironment } = require("jest-environment-node");
const WebSocket = require("ws");

let idSeq = 1;
const DEFAULT_TEST_PLATFORM_WS_PORT = "8080";

function getTestPlatformWsUrl() {
  const port =
    process.env.TEST_PLATFORM_WS_PORT || DEFAULT_TEST_PLATFORM_WS_PORT;

  return `ws://127.0.0.1:${port}/`;
}

module.exports = class CustomEnvironment extends TestEnvironment {
  async setup() {
    await super.setup();

    this.callbacks = new Map();

    this.createCommand("applyState");
    this.createCommand("simulateKeydown");
    this.createCommand("insertText");
    this.createCommand("executeCommandById");
    this.createCommand("setSetting");
    this.createCommand("resetSettings");
    this.createCommand("parseState");
    this.createCommand("getCurrentState");
    this.createCommand("drag");
    this.createCommand("move");
    this.createCommand("drop");
    this.createCommand("waitForIdle");
    this.createCommand("adjustSelection");
  }

  createCommand(type) {
    this.global[type] = (data) => this.runCommand(type, data);
  }

  async initWs() {
    this.ws = new WebSocket(getTestPlatformWsUrl());

    await new Promise((resolve) => this.ws.on("open", resolve));

    this.ws.on("message", (message) => {
      const { id, data, error } = JSON.parse(message);
      const cb = this.callbacks.get(id);
      if (cb) {
        this.callbacks.delete(id);
        cb(error, data);
      }
    });
  }

  async runCommand(type, data) {
    if (!this.ws) {
      await this.initWs();
    }

    return new Promise((resolve, reject) => {
      const id = String(idSeq++);

      this.callbacks.set(id, (error, data) => {
        if (error) {
          reject(new Error(error));
        } else {
          resolve(data);
        }
      });

      this.ws.send(JSON.stringify({ id, type, data }));
    });
  }

  async teardown() {
    if (this.ws) {
      this.ws.close();
    }
    await super.teardown();
  }
};
