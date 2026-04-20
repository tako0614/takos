import {
  buildRunNotifierEmitPayload,
  buildRunNotifierEmitRequest,
  getRunNotifierStub,
} from "../../application/services/run-notifier/index.ts";
import { logWarn } from "../../shared/utils/logger.ts";
import type {
  WorkflowEventData,
  WorkflowEventType,
  WorkflowQueueEnv,
} from "./workflow-types.ts";
import { asDurableObjectFetcher } from "./workflow-types.ts";

const EVENT_FETCH_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Event emission
// ---------------------------------------------------------------------------

export async function emitWorkflowEvent(
  env: WorkflowQueueEnv,
  runId: string,
  type: WorkflowEventType,
  data: WorkflowEventData,
): Promise<void> {
  try {
    const notifierStub = getRunNotifierStub(env, runId);
    const notifierFetcher = asDurableObjectFetcher(notifierStub);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      EVENT_FETCH_TIMEOUT_MS,
    );
    try {
      const payload = buildRunNotifierEmitPayload(runId, type, data);
      const request = buildRunNotifierEmitRequest(payload, controller.signal);
      await notifierFetcher.fetch(request);
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    logWarn(`Failed to emit event (${type}) for run ${runId}`, {
      module: "workflow_ws",
      detail: err,
    });
  }
}
