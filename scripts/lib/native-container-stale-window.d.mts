export const ACTUAL_STALE_WINDOW_MS: 300000;
export const ACTUAL_STALE_WINDOW_WAIT_MAX_MS: 315000;
export const DEFAULT_CHILD_TIMEOUT_MS: 320000;
export const DEFAULT_OUTER_TIMEOUT_MS: 350000;
export const STALE_WINDOW_PHASE_MS: 45000;
export const COMPLETION_PHASE_MS: 90000;

export type NativeContainerProofBudgets = {
  mode: "actual-stale-window" | "fixture-aged-heartbeat";
  childTimeoutMs: number;
  outerTimeoutMs: number;
  admissionPhaseMs: number;
  oldToolAckLossPhaseMs: number;
  staleRecoveryPhaseMs: number;
  completionPhaseMs: number;
  actualStaleWindowMs: number;
  actualStaleWindowWaitMaxMs: number;
};

export function nativeContainerProofBudgets(actualStaleWindow: boolean): NativeContainerProofBudgets;
export function assertActualHeartbeatRecent(snapshot: unknown, now?: number): number;
export function assertRunSnapshotUnchanged(before: unknown, after: unknown): void;
export function assertNoEarlyRecovery(evidence: unknown, runId: string): void;
export function remainingActualStaleWindowMs(heartbeatAt: number, now?: number): number;
export function assertHeartbeatActuallyStale(heartbeatAt: number, now?: number): void;
export function assertMonotonicHeartbeatAge(heartbeatAgeAtSnapshotMs: number, monotonicElapsedMs: number, shouldBeStale: boolean): number;
export function actualStaleCheckpointBindingDiagnostics(baseline: unknown): Readonly<Record<string, unknown>>;
export function assertActualStaleCheckpointBinding(options: {
  baseline: unknown;
  runId: string;
  oldServiceId: string;
  oldContainerId: string;
}): true;
export function assertNativeStaleWindowQualification(options: {
  actualStaleWindow: boolean;
  budgets: NativeContainerProofBudgets;
  report: unknown;
  evidence?: unknown;
}): boolean;
