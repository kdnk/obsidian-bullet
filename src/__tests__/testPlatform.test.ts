import {
  getTestPlatformEnvironment,
  getTestPlatformWsUrl,
} from "../testPlatform";

describe("getTestPlatformWsUrl", () => {
  test("uses the configured port and renderer session identity", () => {
    expect(
      getTestPlatformWsUrl({
        TEST_PLATFORM_WS_PORT: "49123",
        TEST_PLATFORM_WS_TOKEN: "secret value",
      }),
    ).toBe("ws://127.0.0.1:49123/?role=renderer&token=secret+value");
  });

  test("falls back to the legacy websocket port when unspecified", () => {
    expect(getTestPlatformWsUrl({})).toBe(
      "ws://127.0.0.1:8080/?role=renderer&token=",
    );
  });
});

describe("getTestPlatformEnvironment", () => {
  test("reads the environment exposed by the renderer window", () => {
    const environment = { TEST_PLATFORM: "1" };

    expect(
      getTestPlatformEnvironment({
        process: { env: environment },
      } as unknown as Window),
    ).toBe(environment);
  });

  test("returns an empty environment without Node integration", () => {
    expect(getTestPlatformEnvironment({} as Window)).toEqual({});
  });
});
