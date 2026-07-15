export interface OperationOutcome {
  readonly shouldStopPropagation: boolean;
  readonly shouldUpdate: boolean;
}

export const NO_OP_OUTCOME: OperationOutcome = Object.freeze({
  shouldStopPropagation: false,
  shouldUpdate: false,
});

export const STOP_ONLY_OUTCOME: OperationOutcome = Object.freeze({
  shouldStopPropagation: true,
  shouldUpdate: false,
});

export const UPDATED_OUTCOME: OperationOutcome = Object.freeze({
  shouldStopPropagation: true,
  shouldUpdate: true,
});

export interface Operation {
  perform(): OperationOutcome;
}
