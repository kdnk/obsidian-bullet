export function createAnimationFrameScheduler(callback: () => void) {
  let frame: number | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const run = () => {
    frame = null;
    timeout = null;
    callback();
  };

  return {
    schedule() {
      if (frame !== null || timeout !== null) {
        return;
      }

      if (
        typeof window !== "undefined" &&
        typeof window.requestAnimationFrame === "function"
      ) {
        frame = window.requestAnimationFrame(run);
        return;
      }

      timeout = setTimeout(run, 0);
    },

    cancel() {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }

      if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
      }
    },
  };
}
