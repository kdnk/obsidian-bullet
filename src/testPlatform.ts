const DEFAULT_TEST_PLATFORM_WS_PORT = "8080";

export interface TestPlatformEnvironment {
  TEST_PLATFORM?: string;
  TEST_PLATFORM_WS_PORT?: string;
  TEST_PLATFORM_WS_TOKEN?: string;
}

interface TestPlatformWindow extends Window {
  process?: {
    env?: TestPlatformEnvironment;
  };
}

export function getTestPlatformEnvironment(
  win: Window = window,
): TestPlatformEnvironment {
  return (win as TestPlatformWindow).process?.env ?? {};
}

export function getTestPlatformWsUrl(
  environment: TestPlatformEnvironment = getTestPlatformEnvironment(),
) {
  const port =
    environment.TEST_PLATFORM_WS_PORT ?? DEFAULT_TEST_PLATFORM_WS_PORT;
  const params = new URLSearchParams({
    role: "renderer",
    token: environment.TEST_PLATFORM_WS_TOKEN ?? "",
  });

  return `ws://127.0.0.1:${port}/?${params}`;
}
