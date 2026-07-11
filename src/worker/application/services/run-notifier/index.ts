// run-events-contract
export {
  buildRunFailedPayload,
  buildTerminalPayload,
  deriveTerminalStatusFromRunEvent,
  RUN_TERMINAL_EVENT_TYPES,
  RUN_TERMINAL_STATUSES,
} from "./run-events-contract.ts";
export type {
  AutoCloseStatus,
  RunTerminalEventType,
  RunTerminalPayload,
  RunTerminalStatus,
} from "./run-events-contract.ts";

// client
export { buildRunNotifierEmitRequest, getRunNotifierStub } from "./client.ts";

// run-notifier-payload
export { buildRunNotifierEmitPayload } from "./run-notifier-payload.ts";
export type { RunNotifierEmitPayload } from "./run-notifier-payload.ts";

// run-failure-events
export { notifyRunFailedEvent } from "./run-failure-events.ts";

export { transitionRunTerminalAtomically } from "./terminal-transition.ts";
export type {
  ActiveRunStatus,
  ControlTerminalStatus,
  ControlTerminalTransitionInput,
  ControlTerminalTransitionResult,
} from "./terminal-transition.ts";
export type { PersistedRunFailedEvent } from "./run-failure-events.ts";
