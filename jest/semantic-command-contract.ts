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
  "pasteText",
  "resetSettings",
  "setSetting",
  "simulateKeydown",
  "typeText",
  "waitForIdle",
] as const;

export type SemanticDriverCommandName =
  (typeof semanticDriverCommandNames)[number];
