function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function createBootstrapError(message) {
  return new Error(`Obsidian bootstrap process ${message}`);
}

function runObsidianBootstrap({
  args,
  command,
  fileExists,
  fileToCheck,
  killProcess,
  pollIntervalMs = 1_000,
  spawnProcess,
  stabilizationDelayMs = 1_000,
  timeoutMs,
}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let child;
    let pollTimer;
    let stabilizationTimer;
    let settled = false;

    const cleanup = () => {
      clearInterval(pollTimer);
      clearTimeout(stabilizationTimer);
      pollTimer = undefined;
      stabilizationTimer = undefined;
      if (child) {
        child.removeListener("error", handleError);
        child.removeListener("exit", handleExit);
      }
    };

    const settle = (error, shouldKill) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();

      let settlementError = error;
      if (shouldKill) {
        try {
          killProcess();
        } catch (killError) {
          settlementError ??= createBootstrapError(
            `kill error: ${getErrorMessage(killError)}`,
          );
        }
      }

      if (settlementError) {
        reject(settlementError);
      } else {
        resolve();
      }
    };

    const handleError = (error) => {
      settle(
        createBootstrapError(`launch error: ${getErrorMessage(error)}`),
        false,
      );
    };
    const handleExit = (code) => {
      settle(
        createBootstrapError(`exited before setup completed: ${String(code)}`),
        false,
      );
    };

    try {
      child = spawnProcess(command, args);
    } catch (error) {
      settle(
        createBootstrapError(`launch error: ${getErrorMessage(error)}`),
        false,
      );
      return;
    }

    child.on("error", handleError);
    child.on("exit", handleExit);
    pollTimer = setInterval(() => {
      let isReady;
      try {
        isReady = fileExists(fileToCheck);
      } catch (error) {
        settle(
          createBootstrapError(
            `readiness check error: ${getErrorMessage(error)}`,
          ),
          true,
        );
        return;
      }

      if (isReady) {
        clearInterval(pollTimer);
        pollTimer = undefined;
        stabilizationTimer = setTimeout(
          () => settle(undefined, true),
          stabilizationDelayMs,
        );
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        settle(createBootstrapError(`timed out after ${timeoutMs}ms`), true);
      }
    }, pollIntervalMs);
  });
}

module.exports = { runObsidianBootstrap };
