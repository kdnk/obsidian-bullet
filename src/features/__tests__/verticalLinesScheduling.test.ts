import { createAnimationFrameScheduler } from "../verticalLinesScheduling";

describe("createAnimationFrameScheduler", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("coalesces repeated schedules into one animation frame callback", () => {
    let frame: FrameRequestCallback | null = null;
    const requestAnimationFrame = jest
      .fn()
      .mockImplementation((callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      });
    const cancelAnimationFrame = jest.fn();
    Object.defineProperty(global, "window", {
      configurable: true,
      value: { requestAnimationFrame, cancelAnimationFrame },
    });

    const callback = jest.fn();
    const scheduler = createAnimationFrameScheduler(callback);
    scheduler.schedule();
    scheduler.schedule();

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    frame?.(0);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  test("cancels pending animation frame callbacks", () => {
    const requestAnimationFrame = jest.fn().mockReturnValue(7);
    const cancelAnimationFrame = jest.fn();
    Object.defineProperty(global, "window", {
      configurable: true,
      value: { requestAnimationFrame, cancelAnimationFrame },
    });

    const scheduler = createAnimationFrameScheduler(jest.fn());
    scheduler.schedule();
    scheduler.cancel();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
  });
});
