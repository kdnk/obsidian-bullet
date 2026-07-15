const COMMANDS = [
  "applyState",
  "simulateKeydown",
  "insertText",
  "executeCommandById",
  "setSetting",
  "resetSettings",
  "parseState",
  "getCurrentState",
  "drag",
  "move",
  "drop",
  "waitForIdle",
  "adjustSelection",
  "clickGuide",
];

function installObsidianDriver(target, runCommand) {
  for (const command of COMMANDS) {
    target[command] = (data) => runCommand(command, data);
  }
}

module.exports = { installObsidianDriver };
