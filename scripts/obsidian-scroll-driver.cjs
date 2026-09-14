// Shared, vault-scoped transport for the standalone real-renderer scroll checks.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const vaultPath = path.resolve(__dirname, "../vault");

function cdp(method, params = {}) {
  let output;
  try {
    output = execFileSync(
      "obsidian-cli",
      [
        "vault=vault",
        "dev:cdp",
        `method=${method}`,
        `params=${JSON.stringify(params)}`,
      ],
      {
        encoding: "utf8",
        timeout: 20000,
        killSignal: "SIGKILL",
        maxBuffer: 16 * 1024 * 1024,
      },
    );
  } catch (error) {
    // The CLI can print a complete CDP reply and then hang during shutdown.
    // Consume that reply once; retrying could repeat an editing command.
    if (error.code === "ETIMEDOUT" && error.stdout) {
      try {
        const response = JSON.parse(error.stdout);
        if (
          response &&
          typeof response === "object" &&
          !Array.isArray(response)
        ) {
          console.warn(
            `CDP ${method}: reply received before CLI shutdown timeout`,
          );
          return response;
        }
      } catch {
        // Incomplete output is still a transport failure.
      }
    }
    throw error;
  }
  return JSON.parse(output);
}

function evaluate(fn, ...args) {
  const expression = `(async () => {
    if (app.vault.adapter.getBasePath() !== ${JSON.stringify(vaultPath)} ||
        app.vault.config.useTab !== true || app.vault.config.tabSize !== 4 ||
        document.body.classList.contains('is-mobile')) throw Error('Test vault guard');
    return (${fn.toString()})(...${JSON.stringify(args)});
  })()`;
  const response = cdp("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails)
    throw Error(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text,
    );
  return response.result.value;
}

module.exports = { cdp, evaluate };
