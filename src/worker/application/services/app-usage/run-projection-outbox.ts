import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { accounts, getDb, runs, runUsageProjectionOutbox } from "../../../infra/db/index.ts";
import type {
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
  SqlTransactionSessionBinding,
} from "../../../shared/types/bindings.ts";
import type { RunnerEnv } from "../../../shared/types/index.ts";
import { affectedRowCount } from "../../../shared/utils/affected-row-count.ts";
import { configuredOwner, isActiveOwnerAccount } from "../identity/owner-admission.ts";

type StatementFactory = Pick<SqlDatabaseBinding, "prepare"> | Pick<SqlTransactionSessionBinding, "prepare">;

export interface RunUsageProjectionWitness {
  id: string;
  runId: string;
  completionKey: string;
  runStatus: string;
  workspaceId: string;
  ownerAccountId: string;
}

export function runUsageProjectionOutboxId(completionKey: string): string {
  return `run-usage-projection:${completionKey}`;
}

export function buildRunUsageProjectionOutboxStatements(
  factory: StatementFactory,
  input: {
    completionKey: string;
    runStatus: string;
    createdAt: string;
    runPredicateSql: string;
    runPredicateArgs: unknown[];
  },
): SqlPreparedStatementBinding[] {
  return [factory.prepare(`
    INSERT INTO "run_usage_projection_outbox"
      ("id", "run_id", "completion_key", "run_status", "workspace_id",
       "owner_account_id", "delivery_status", "attempts", "created_at", "updated_at")
    SELECT ?, r."id", ?, ?, r."account_id",
           CASE WHEN a."id" IS NULL THEN NULL
             ELSE COALESCE(NULLIF(a."owner_account_id", ''), a."id") END,
           'queued', 0, ?, ?
    FROM "runs" r
    LEFT JOIN "accounts" a ON a."id" = r."account_id"
    WHERE ${input.runPredicateSql}
    ON CONFLICT ("run_id") DO UPDATE SET
      "completion_key" = CASE WHEN
        "run_usage_projection_outbox"."id" = excluded."id"
        AND "run_usage_projection_outbox"."completion_key" = excluded."completion_key"
        AND "run_usage_projection_outbox"."run_status" = excluded."run_status"
        AND "run_usage_projection_outbox"."workspace_id" = excluded."workspace_id"
        AND "run_usage_projection_outbox"."owner_account_id" = excluded."owner_account_id"
      THEN "run_usage_projection_outbox"."completion_key" ELSE NULL END
  `).bind(
    runUsageProjectionOutboxId(input.completionKey), input.completionKey,
    input.runStatus, input.createdAt, input.createdAt, ...input.runPredicateArgs,
  )];
}

export type DispatchRunUsageProjectionOptions = {
  staleBefore?: string;
  limit?: number;
  now?: string;
};

type Row = RunUsageProjectionWitness & {
  deliveryStatus: string;
  claimedAt: string | null;
  nextAttemptAt: string | null;
  attempts: number;
};

export class UsageProjectionBlockedError extends Error {}

function requireRow(row: Row): asserts row is Row {
  if (!row.id || !row.runId || !row.completionKey ||
    !["completed", "failed", "cancelled"].includes(row.runStatus) ||
    !row.workspaceId || !row.ownerAccountId ||
    !Number.isSafeInteger(row.attempts) || row.attempts < 0) {
    throw new UsageProjectionBlockedError("Malformed terminal usage witness");
  }
}

async function assertOwner(env: RunnerEnv, row: Row): Promise<void> {
  const owner = configuredOwner({
    issuer: env.OIDC_ISSUER_URL,
    subject: env.OIDC_OWNER_SUBJECT,
  });
  if (!owner || !await isActiveOwnerAccount(env.DB, owner, row.ownerAccountId)) {
    throw new UsageProjectionBlockedError("Recorded owner is not the active configured Principal");
  }
  const db = getDb(env.DB);
  const run = await db.select({
    status: runs.status, completionKey: runs.completionKey, workspaceId: runs.accountId,
  }).from(runs).where(eq(runs.id, row.runId)).get();
  const space = await db.select({ ownerAccountId: accounts.ownerAccountId })
    .from(accounts).where(eq(accounts.id, row.workspaceId)).get();
  if (!run || !space || run.status !== row.runStatus ||
    run.completionKey !== row.completionKey || run.workspaceId !== row.workspaceId ||
    (space.ownerAccountId || row.workspaceId) !== row.ownerAccountId) {
    throw new UsageProjectionBlockedError("Recorded Run or Workspace owner has changed");
  }
}

async function withProjectionDeadline<T>(
  work: Promise<T>, remainingMs: number, label: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<T>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`Run usage projection ${label} deadline exceeded`)),
        Math.max(1, Math.min(5_000, remainingMs)));
    })]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** A bounded independent replay of terminal SQL usage into the existing Run DO. */
export async function dispatchRunUsageProjectionOutbox(
  env: RunnerEnv,
  options: DispatchRunUsageProjectionOptions = {},
): Promise<number> {
  const db = getDb(env.DB);
  const now = options.now ?? new Date().toISOString();
  const deadline = Date.now() + 30_000;
  const withinBudget = <T>(operation: () => Promise<T>, label: string): Promise<T> => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Run usage projection dispatch deadline exceeded");
    return withProjectionDeadline(operation(), remaining, label);
  };
  const stale = options.staleBefore
    ? and(eq(runUsageProjectionOutbox.deliveryStatus, "dispatching"),
      or(isNull(runUsageProjectionOutbox.claimedAt),
        lt(runUsageProjectionOutbox.claimedAt, options.staleBefore)))
    : undefined;
  const due = or(
    and(eq(runUsageProjectionOutbox.deliveryStatus, "queued"),
      or(isNull(runUsageProjectionOutbox.nextAttemptAt),
        lte(runUsageProjectionOutbox.nextAttemptAt, now))),
    stale,
  );
  const rows = await withinBudget(async () => await db.select().from(runUsageProjectionOutbox)
    .where(due).limit(Math.max(1, Math.min(options.limit ?? 10, 50))).all() as Row[],
  "due-row SQL read");
  let completed = 0;
  for (const row of rows) {
    if (Date.now() >= deadline - 100) break;
    const claimedAt = new Date().toISOString();
    const claimToken = crypto.randomUUID();
    const expected = row.deliveryStatus === "queued"
      ? and(eq(runUsageProjectionOutbox.deliveryStatus, "queued"),
        or(isNull(runUsageProjectionOutbox.nextAttemptAt),
          lte(runUsageProjectionOutbox.nextAttemptAt, now)))
      : options.staleBefore
        ? and(eq(runUsageProjectionOutbox.deliveryStatus, "dispatching"),
          or(isNull(runUsageProjectionOutbox.claimedAt),
            lt(runUsageProjectionOutbox.claimedAt, options.staleBefore)))
        : undefined;
    if (!expected) continue;
    const claim = await withinBudget(async () => await db.update(runUsageProjectionOutbox).set({
      deliveryStatus: "dispatching", claimToken, claimedAt,
      attempts: sql`${runUsageProjectionOutbox.attempts} + 1`,
      lastError: null, updatedAt: claimedAt,
    }).where(and(eq(runUsageProjectionOutbox.id, row.id), expected)), "claim SQL write");
    if (!affectedRowCount(claim)) continue;
    const exact = and(eq(runUsageProjectionOutbox.id, row.id),
      eq(runUsageProjectionOutbox.deliveryStatus, "dispatching"),
      eq(runUsageProjectionOutbox.claimToken, claimToken),
      eq(runUsageProjectionOutbox.claimedAt, claimedAt));
    let acknowledgedRevision: number | undefined;
    const doneReadback = async (revision: number): Promise<boolean> => {
      const persisted = await withinBudget(async () => await db.select()
        .from(runUsageProjectionOutbox)
        .where(eq(runUsageProjectionOutbox.id, row.id)).get(), "done SQL readback");
      return persisted?.deliveryStatus === "done" &&
        persisted.runId === row.runId &&
        persisted.completionKey === row.completionKey &&
        persisted.runStatus === row.runStatus &&
        persisted.workspaceId === row.workspaceId &&
        persisted.ownerAccountId === row.ownerAccountId &&
        persisted.projectedRevision === revision;
    };
    try {
      requireRow(row);
      await withinBudget(() => assertOwner(env, row), "owner SQL admission");
      const stub = env.RUN_NOTIFIER.get(env.RUN_NOTIFIER.idFromName(row.runId));
      const response = await withinBudget(() => stub.fetch(new Request(
        `http://internal/usage-project?runId=${encodeURIComponent(row.runId)}`,
        { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ witness: {
            id: row.id, runId: row.runId, completionKey: row.completionKey,
            runStatus: row.runStatus, workspaceId: row.workspaceId,
            ownerAccountId: row.ownerAccountId,
          } }) },
      )), "notifier fetch");
      if (!response.ok) {
        let detail = "";
        let code = "";
        try {
          const rejection: unknown = await withinBudget(() => response.json(), "notifier error body");
          if (rejection && typeof rejection === "object" && !Array.isArray(rejection)) {
            const body = rejection as Record<string, unknown>;
            if (typeof body.error === "string") {
              detail = Array.from(body.error.slice(0, 512), (character) => {
                const code = character.charCodeAt(0);
                return code < 32 || code === 127 ? " " : character;
              }).join("");
            }
            if (typeof body.code === "string") code = body.code;
          }
        } catch { /* Keep the HTTP status when a diagnostic body is unreadable. */ }
        const message = `Run usage projection rejected (${response.status})${detail ? `: ${detail}` : ""}`;
        if (code === "usage_authority_blocked") throw new UsageProjectionBlockedError(message);
        throw new Error(message);
      }
      const result: unknown = await withinBudget(() => response.json(), "notifier body");
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error("Run usage projection acknowledgement is malformed");
      }
      const ack = result as Record<string, unknown>;
      if (ack.success !== true || ack.runId !== row.runId ||
        !Number.isSafeInteger(ack.revision) || (ack.revision as number) < 1) {
        throw new Error("Run usage projection acknowledgement lacks a durable revision");
      }
      acknowledgedRevision = ack.revision as number;
      await withinBudget(() => assertOwner(env, row), "owner SQL readback");
      // A lost SQL acknowledgement remains dispatching for stale recovery.
      const done = await withinBudget(async () => await db.update(runUsageProjectionOutbox).set({
        deliveryStatus: "done", claimToken: null, claimedAt: null,
        nextAttemptAt: null, lastError: null,
        projectedRevision: ack.revision as number, updatedAt: new Date().toISOString(),
      }).where(exact), "done SQL write");
      if (affectedRowCount(done) && await doneReadback(acknowledgedRevision)) completed++;
    } catch (error) {
      let failure = error;
      if (acknowledgedRevision !== undefined && Date.now() < deadline) {
        try {
          if (await doneReadback(acknowledgedRevision)) {
            completed++;
            continue;
          }
        } catch { /* The claim remains stale-replayable. */ }
      }
      let blocked = failure instanceof UsageProjectionBlockedError;
      if (!blocked && Date.now() < deadline) {
        try { await withinBudget(() => assertOwner(env, row), "failure owner SQL readback"); }
        catch (authorityError) {
          if (authorityError instanceof UsageProjectionBlockedError) {
            failure = authorityError;
            blocked = true;
          }
        }
      }
      const attempts = Math.min(Math.max(row.attempts + 1, 1), 20);
      const delayMs = Math.min(60_000 * 2 ** (attempts - 1), 24 * 60 * 60 * 1000);
      const failedAt = new Date().toISOString();
      if (Date.now() >= deadline) break;
      try {
        await withinBudget(async () => await db.update(runUsageProjectionOutbox).set({
          deliveryStatus: blocked ? "blocked" : "queued",
          claimToken: null, claimedAt: null,
          nextAttemptAt: blocked ? null : new Date(Date.now() + delayMs).toISOString(),
          lastError: String(failure).slice(0, 2048), updatedAt: failedAt,
        }).where(exact), "failure SQL write");
      } catch (ackError) {
        console.error("Terminal usage outbox failed to record projection error", row.id, ackError);
      }
    }
  }
  return completed;
}
