import type { Env } from "../../../shared/types/index.ts";
import type { RunTerminalPayload } from "./run-events-contract.ts";
import { buildRunNotifierEmitRequest, getRunNotifierStub } from "./client.ts";
import { buildRunNotifierEmitPayload } from "./run-notifier-payload.ts";

export interface PersistedRunFailedEvent {
  payload: RunTerminalPayload;
  eventId: number | null;
}

export async function notifyRunFailedEvent(
  env: Pick<Env, "RUN_NOTIFIER">,
  runId: string,
  event: PersistedRunFailedEvent,
): Promise<void> {
  const notifierStub = getRunNotifierStub(env, runId);
  const payload = buildRunNotifierEmitPayload(
    runId,
    "run.failed",
    event.payload,
    event.eventId,
  );
  const request = buildRunNotifierEmitRequest(payload);
  await notifierStub.fetch(request);
}
