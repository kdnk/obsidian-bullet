export const semanticDriverCommandNames = [
  "adjustSelection",
  "applyState",
  "assertNativeListBullet",
  "clickGuide",
  "drag",
  "drop",
  "executeCommandById",
  "getCurrentState",
  "insertText",
  "move",
  "parseState",
  "resetSettings",
  "setSetting",
  "simulateKeydown",
  "waitForIdle",
] as const;

export type SemanticDriverCommandName =
  (typeof semanticDriverCommandNames)[number];
