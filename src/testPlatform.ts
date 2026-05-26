const DEFAULT_TEST_PLATFORM_WS_PORT = "8080";

export function getTestPlatformWsUrl() {
  const port =
    process.env.TEST_PLATFORM_WS_PORT ?? DEFAULT_TEST_PLATFORM_WS_PORT;

  return `ws://127.0.0.1:${port}/`;
}
