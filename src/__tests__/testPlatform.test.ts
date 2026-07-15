import { getTestPlatformWsUrl } from "../testPlatform";

describe("getTestPlatformWsUrl", () => {
  const originalPort = process.env.TEST_PLATFORM_WS_PORT;
  const originalToken = process.env.TEST_PLATFORM_WS_TOKEN;

  afterEach(() => {
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
  });

  test("uses the configured port and renderer session identity", () => {
    process.env.TEST_PLATFORM_WS_PORT = "49123";
    process.env.TEST_PLATFORM_WS_TOKEN = "secret value";

    expect(getTestPlatformWsUrl()).toBe(
      "ws://127.0.0.1:49123/?role=renderer&token=secret+value",
    );
  });

  test("falls back to the legacy websocket port when unspecified", () => {
    delete process.env.TEST_PLATFORM_WS_PORT;
    delete process.env.TEST_PLATFORM_WS_TOKEN;

    expect(getTestPlatformWsUrl()).toBe(
      "ws://127.0.0.1:8080/?role=renderer&token=",
    );
  });
});
