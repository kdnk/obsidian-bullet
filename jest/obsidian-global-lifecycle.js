function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function captureEnvironmentValue(env, name) {
  return {
    exists: Object.prototype.hasOwnProperty.call(env, name),
    value: env[name],
  };
}

function restoreEnvironmentValue(env, name, captured) {
  if (captured.exists) {
    env[name] = captured.value;
  } else {
    delete env[name];
  }
}

async function startObsidianGlobalLifecycle({
  env,
  globals,
  killObsidian,
  launchObsidian,
  prepareObsidian,
  prepareVault,
  restoreObsidianConfig,
  startRelay,
}) {
  const previousPort = captureEnvironmentValue(env, "TEST_PLATFORM_WS_PORT");
  const previousToken = captureEnvironmentValue(env, "TEST_PLATFORM_WS_TOKEN");
  let child;
  let childErrorListener;
  let childExitListener;
  let cleanupPromise;
  let relay;

  const detachChildListeners = () => {
    if (!child) {
      return;
    }
    if (childErrorListener) {
      child.removeListener("error", childErrorListener);
    }
    if (childExitListener) {
      child.removeListener("exit", childExitListener);
    }
    childErrorListener = undefined;
    childExitListener = undefined;
  };

  const close = () => {
    if (cleanupPromise) {
      return cleanupPromise;
    }

    cleanupPromise = (async () => {
      let cleanupError;
      const runCleanupStep = async (step) => {
        try {
          await step();
        } catch (error) {
          cleanupError ??= error;
        }
      };

      detachChildListeners();
      if (relay) {
        await runCleanupStep(() => relay.close());
      }
      await runCleanupStep(killObsidian);

      const originalConfig = globals.originalObsidianConfig;
      if (originalConfig !== null && originalConfig !== undefined) {
        await runCleanupStep(() => restoreObsidianConfig(originalConfig));
      }

      globals.originalObsidianConfig = null;
      if (globals.obsidianRelay === relay) {
        delete globals.obsidianRelay;
      }
      if (globals.obsidianTestCleanup === close) {
        delete globals.obsidianTestCleanup;
      }
      restoreEnvironmentValue(env, "TEST_PLATFORM_WS_PORT", previousPort);
      restoreEnvironmentValue(env, "TEST_PLATFORM_WS_TOKEN", previousToken);

      if (cleanupError) {
        throw cleanupError;
      }
    })();
    return cleanupPromise;
  };

  try {
    await prepareObsidian();
    await prepareVault();

    relay = await startRelay();
    const relayReadyOutcome = Promise.resolve(relay.ready).then(
      () => ({ status: "ready" }),
      (error) => ({ error, status: "error" }),
    );
    globals.obsidianRelay = relay;
    env.TEST_PLATFORM_WS_PORT = String(relay.port);
    env.TEST_PLATFORM_WS_TOKEN = relay.token;

    child = launchObsidian();
    const childFailure = new Promise((_, reject) => {
      childErrorListener = (error) => {
        reject(
          new Error(
            `Obsidian test process launch error: ${getErrorMessage(error)}`,
          ),
        );
      };
      childExitListener = (code) => {
        reject(
          new Error(`Obsidian test process exited before relay ready: ${code}`),
        );
      };
      child.on("error", childErrorListener);
      child.on("exit", childExitListener);
    });

    const relayReadiness = relayReadyOutcome.then((outcome) => {
      if (outcome.status === "error") {
        throw outcome.error;
      }
    });
    await Promise.race([relayReadiness, childFailure]);
    detachChildListeners();
    globals.obsidianTestCleanup = close;
    return { close };
  } catch (error) {
    try {
      await close();
    } catch {
      // Preserve the startup failure after completing every cleanup step.
    }
    throw error;
  }
}

module.exports = { startObsidianGlobalLifecycle };
