import { getTestPlatformWsUrl } from "../testPlatform";

describe("getTestPlatformWsUrl", () => {
  const originalPort = process.env.TEST_PLATFORM_WS_PORT;

  afterEach(() => {
    if (originalPort === undefined) {
      delete process.env.TEST_PLATFORM_WS_PORT;
      return;
    }

    process.env.TEST_PLATFORM_WS_PORT = originalPort;
  });

  test("uses the configured test platform websocket port", () => {
    process.env.TEST_PLATFORM_WS_PORT = "49123";

    expect(getTestPlatformWsUrl()).toBe("ws://127.0.0.1:49123/");
  });

  test("falls back to the legacy websocket port when unspecified", () => {
    delete process.env.TEST_PLATFORM_WS_PORT;

    expect(getTestPlatformWsUrl()).toBe("ws://127.0.0.1:8080/");
  });
});
