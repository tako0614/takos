import type {
  DurableNamespaceBinding,
  ObjectStoreBinding,
  RunStatus,
  SqlDatabaseBinding,
} from "takos-api-contract/shared/types";
import { readRunAccess } from "./read-model.ts";

export type RunMutationEnv = {
  DB: SqlDatabaseBinding;
  TAKOS_OFFLOAD?: ObjectStoreBinding;
  RUN_NOTIFIER?: DurableNamespaceBinding;
};

const RUN_TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export class RunAlreadyFinishedError extends Error {
  constructor() {
    super("Run is already finished");
  }
}

export async function cancelRun(
  env: RunMutationEnv,
  runId: string,
  actorAccountId: string,
): Promise<boolean> {
  const access = await readRunAccess(env.DB, runId, actorAccountId, [
    "owner",
    "admin",
    "editor",
  ]);
  if (!access) return false;
  if (RUN_TERMINAL_STATUSES.has(access.run.status)) {
    throw new RunAlreadyFinishedError();
  }

  const completedAt = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE runs
    SET status = ?, completed_at = ?
    WHERE id = ?
  `).bind("cancelled", completedAt, runId).run();

  const payload = buildTerminalPayload(runId, access.run.session_id ?? null);
  const eventId = env.TAKOS_OFFLOAD
    ? null
    : await persistRunEvent(env.DB, runId, "cancelled", payload);
  await emitRunEvent(env.RUN_NOTIFIER, runId, "cancelled", payload, eventId);
  return true;
}

async function persistRunEvent(
  db: SqlDatabaseBinding,
  runId: string,
  type: string,
  data: unknown,
): Promise<number> {
  const row = await db.prepare(`
    INSERT INTO run_events (
      run_id,
      type,
      data,
      created_at
    )
    VALUES (?, ?, ?, ?)
    RETURNING id
  `).bind(
    runId,
    type,
    JSON.stringify(data),
    new Date().toISOString(),
  ).first<Record<string, unknown>>();
  const eventId = row?.id;
  return typeof eventId === "number" ? eventId : 0;
}

async function emitRunEvent(
  namespace: DurableNamespaceBinding | undefined,
  runId: string,
  type: string,
  data: unknown,
  eventId: number | null,
): Promise<void> {
  if (!namespace) return;
  const payload = {
    runId,
    type,
    data,
    ...(eventId ? { event_id: eventId } : {}),
  };
  try {
    const id = namespace.idFromName(runId);
    const stub = namespace.get(id);
    await stub.fetch(
      new Request("https://internal.do/emit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Takos-Internal-Marker": "1",
        },
        body: JSON.stringify(payload),
      }),
    );
  } catch {
    // Event persistence is durable; notifier delivery is best effort.
  }
}

function buildTerminalPayload(runId: string, sessionId: string | null) {
  return {
    status: "cancelled",
    run: {
      id: runId,
      session_id: sessionId,
    },
  };
}
