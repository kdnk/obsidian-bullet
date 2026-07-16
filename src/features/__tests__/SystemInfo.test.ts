import { getRuntimeProcessInfo } from "../SystemInfo";

jest.mock(
  "obsidian",
  () => ({
    Modal: class Modal {},
  }),
  { virtual: true },
);

describe("getRuntimeProcessInfo", () => {
  test("reads process information exposed by the current window", () => {
    expect(
      getRuntimeProcessInfo({
        process: {
          arch: "arm64",
          platform: "darwin",
        },
      } as unknown as Window),
    ).toEqual({
      arch: "arm64",
      platform: "darwin",
    });
  });

  test("returns null values when Node integration is unavailable", () => {
    expect(getRuntimeProcessInfo({} as Window)).toEqual({
      arch: null,
      platform: null,
    });
  });

  test("ignores non-string process information", () => {
    expect(
      getRuntimeProcessInfo({
        process: {
          arch: {},
          platform: 1,
        },
      } as unknown as Window),
    ).toEqual({
      arch: null,
      platform: null,
    });
  });
});
