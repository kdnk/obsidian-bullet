const DEFAULT_TEST_PLATFORM_WS_PORT = "8080";

export function getTestPlatformWsUrl() {
  const port =
    process.env.TEST_PLATFORM_WS_PORT ?? DEFAULT_TEST_PLATFORM_WS_PORT;
  const params = new URLSearchParams({
    role: "renderer",
    token: process.env.TEST_PLATFORM_WS_TOKEN ?? "",
  });

  return `ws://127.0.0.1:${port}/?${params}`;
}
