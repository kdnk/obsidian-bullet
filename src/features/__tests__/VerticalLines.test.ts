import { VerticalLinesPluginValue } from "../VerticalLines";

const mockGetEditorFromState = jest.fn();

jest.mock(
  "../../editor",
  () => ({
    getEditorFromState: (...args: unknown[]) => mockGetEditorFromState(...args),
  }),
  { virtual: true },
);

describe("VerticalLinesPluginValue", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockGetEditorFromState.mockReturnValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function makeElement() {
    return {
      classList: { add: jest.fn() },
      appendChild: jest.fn(),
      removeChild: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };
  }

  test("cancels pending editor lookup when destroyed", () => {
    const scroller = makeElement();
    const contentContainer = makeElement();
    const viewDom = makeElement();
    const scrollDOM = makeElement();
    const setTimeoutSpy = jest.spyOn(global, "setTimeout");
    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

    Object.defineProperty(global, "document", {
      configurable: true,
      value: {
        createElement: jest
          .fn()
          .mockReturnValueOnce(contentContainer)
          .mockReturnValueOnce(scroller),
      },
    });

    const pluginValue = new VerticalLinesPluginValue(
      {
        onChange: jest.fn(),
        removeCallback: jest.fn(),
      } as never,
      {} as never,
      {
        state: {},
        scrollDOM,
        dom: viewDom,
        contentDOM: makeElement(),
      } as never,
    );

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

    pluginValue.destroy();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(
      setTimeoutSpy.mock.results[0].value,
    );
  });
});
