import { and, eq } from "drizzle-orm";

import { getDb, runs } from "../../../infra/db/index.ts";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import {
  createNotification,
  type CreateNotificationResult,
  type NotificationServiceEnv,
} from "./service.ts";

export type RunTerminalNotificationStatus = "completed" | "failed";

export interface CreateRunTerminalNotificationInput {
  readonly runId: string;
  readonly status: RunTerminalNotificationStatus;
  /** Stable key returned by the lease-fenced terminal transition. */
  readonly completionKey?: string;
}

/**
 * Materialize the user-facing consequence of a committed Agent Run outcome.
 *
 * The Run ledger remains the outcome authority. The notification id is derived
 * from that ledger's stable completion key, so an ambiguous caller retry cannot
 * create a second inbox row. Delivery deliberately re-enqueues the same id on
 * replay: this closes the insert-commit/Queue-send crash window. Queue delivery
 * remains at-least-once and is collapsed by the event-id-only notification id
 * at the gateway/client boundary.
 */
export async function createRunTerminalNotification(
  env: NotificationServiceEnv,
  input: CreateRunTerminalNotificationInput,
): Promise<CreateNotificationResult> {
  const run = await getDb(env.DB)
    .select({
      requesterAccountId: runs.requesterAccountId,
      accountId: runs.accountId,
      threadId: runs.threadId,
      status: runs.status,
      completionKey: runs.completionKey,
      completedAt: runs.completedAt,
    })
    .from(runs)
    .where(and(eq(runs.id, input.runId), eq(runs.status, input.status)))
    .get();
  if (!run?.requesterAccountId) {
    return { notification_id: null, push_handoff: "not_requested" };
  }
  if (input.completionKey && run.completionKey !== input.completionKey) {
    return { notification_id: null, push_handoff: "not_requested" };
  }

  const stableOutcomeKey =
    input.completionKey ?? run.completionKey ?? run.completedAt;
  if (!stableOutcomeKey) {
    return { notification_id: null, push_handoff: "not_requested" };
  }
  const digest = await computeSHA256(
    JSON.stringify({
      runId: input.runId,
      status: input.status,
      completionKey: stableOutcomeKey,
    }),
  );
  const route = `/chat/${encodeURIComponent(run.accountId)}/${encodeURIComponent(run.threadId)}`;
  const completed = input.status === "completed";

  return createNotification(
    env,
    {
      userId: run.requesterAccountId,
      spaceId: run.accountId,
      type: completed ? "run.completed" : "run.failed",
      title: completed ? "Agent response is ready" : "Agent run failed",
      body: completed
        ? "Open the conversation to review the response."
        : "Open the conversation to review the error.",
      data: {
        run_id: input.runId,
        thread_id: run.threadId,
        route,
      },
    },
    { notificationId: `run_terminal_${digest}` },
  );
}
