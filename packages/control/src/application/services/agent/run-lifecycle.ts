import type { RunStatus } from "../../../shared/types/index.ts";
import type { RunTerminalPayload } from "../run-notifier/index.ts";
import type { AgentEvent } from "./agent-models.ts";
import { logError } from "../../../shared/utils/logger.ts";

// --- RunCancelledError (formerly services/agent/errors.ts) ---

export class RunCancelledError extends Error {
  constructor(message = "Run cancelled") {
    super(message);
    this.name = "RunCancelledError";
  }
}

// --- Run reset policy (formerly services/agent/run-reset-policy.ts) ---

export function shouldResetRunToQueuedOnContainerError(
  status: RunStatus | null | undefined,
): boolean {
  return status === "running";
}

export interface RunLifecycleDeps {
  updateRunStatus: (
    status: RunStatus,
    output?: string,
    error?: string,
  ) => Promise<void>;
  emitEvent: (
    type: AgentEvent["type"],
    data: Record<string, unknown>,
  ) => Promise<void>;
  buildTerminalEventPayload: (
    status: "completed" | "failed" | "cancelled",
    details?: Record<string, unknown>,
  ) => RunTerminalPayload;
  autoCloseSession: (status: "completed" | "failed") => Promise<void>;
  enqueuePostRunJobs: () => Promise<void>;
  sanitizeErrorMessage: (error: string) => string;
}

export async function handleSuccessfulRunCompletion(
  deps: RunLifecycleDeps,
): Promise<void> {
  await deps.enqueuePostRunJobs();
  // Auto-close session if still open after successful completion
  // Agent can still explicitly call container_commit/container_stop for control
  await deps.autoCloseSession("completed");
}

export async function handleCancelledRun(
  deps: RunLifecycleDeps,
): Promise<void> {
  await deps.updateRunStatus("cancelled", undefined, "Run cancelled");
  await deps.emitEvent(
    "cancelled",
    deps.buildTerminalEventPayload("cancelled"),
  );
  await deps.autoCloseSession("failed");
  await deps.enqueuePostRunJobs();
}

export async function handleFailedRun(
  deps: RunLifecycleDeps,
  error: unknown,
): Promise<void> {
  const rawErrorMessage = String(error);
  const errorMessage = deps.sanitizeErrorMessage(rawErrorMessage);
  logError("Agent error", rawErrorMessage, {
    module: "services/agent/run-lifecycle",
  }); // Full error for internal logs

  await deps.updateRunStatus("failed", undefined, errorMessage);
  await deps.emitEvent(
    "error",
    deps.buildTerminalEventPayload("failed", { error: errorMessage }),
  );
  await deps.autoCloseSession("failed");
  await deps.enqueuePostRunJobs();
}
