import { and, eq, inArray, sql } from "drizzle-orm";

import {
  accounts,
  appUsageEvents,
  appUsageRollups,
  getDb,
  runs,
  runUsageProjectionOutbox,
} from "../../../infra/db/index.ts";
import type { Database } from "../../../infra/db/index.ts";
import { executeAtomicStatements } from "../../../infra/db/client.ts";
import type { Env } from "../../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { generateId } from "../../../shared/utils/index.ts";
import {
  APP_USAGE_METER_TYPES,
  type AppUsageMeterType,
  type AppUsageRecordInput,
  type AppUsageRecordResult,
} from "./usage-types.ts";
import { UsageProjectionBlockedError, type RunUsageProjectionWitness } from "./run-projection-outbox.ts";

type AppUsageDb = SqlDatabaseBinding | Database;
type UsageStatements = ReturnType<Parameters<typeof executeAtomicStatements>[1]>;

function isSqlBinding(value: unknown): value is SqlDatabaseBinding {
  return typeof value === "object" && value !== null &&
    "prepare" in value && typeof value.prepare === "function" &&
    "batch" in value && typeof value.batch === "function";
}

async function executeUsageStatements(
  binding: AppUsageDb,
  build: (db: Database) => UsageStatements,
): Promise<void> {
  if (isSqlBinding(binding)) {
    if (binding.withTransaction) {
      await executeAtomicStatements(binding, build);
    } else {
      // Drizzle D1's batch mapper does not expose a prepared `stmt` for
      // parameterized raw db.run(sql) items. The platform binding's batch is
      // atomic and accepts the same compiled queries directly.
      const statements = build(getDb(binding));
      const prepared = statements.map((statement) => {
        const query = (statement as unknown as {
          _prepare(): { getQuery(): { sql: string; params: unknown[] } };
        })._prepare().getQuery();
        return binding.prepare(query.sql).bind(...query.params);
      });
      await binding.batch(prepared);
    }
    return;
  }
  // A wrapped stateful binding's batch can be sequential. Preserve its
  // dedicated transaction instead of accidentally bypassing withTransaction.
  const client = "$client" in binding ? binding.$client : undefined;
  if (isSqlBinding(client)) {
    await executeUsageStatements(client, build);
    return;
  }
  // Already-wrapped libsql and edge.sql clients provide native atomic batches.
  const db = getDb(binding);
  const [first, ...rest] = build(db);
  if (!first) throw new TypeError("a usage statement group cannot be empty");
  await db.batch([first, ...rest]);
}

function getPeriodStart(timestamp: string): string {
  const now = new Date(timestamp);
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Run usage event has an invalid period anchor");
  }
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

function captureUsage(input: AppUsageRecordInput, timestamp: string) {
  return {
    id: generateId(),
    idempotencyKey: input.idempotencyKey || null,
    ownerAccountId: input.ownerAccountId,
    scopeType: input.spaceId ? "space" : "account",
    scopeId: input.spaceId ?? input.ownerAccountId,
    spaceId: input.spaceId ?? null,
    meterType: input.meterType,
    units: input.units,
    referenceId: input.referenceId ?? null,
    referenceType: input.referenceType ?? null,
    metadata: input.metadata ? JSON.stringify(input.metadata) : "{}",
    createdAt: timestamp,
    rollupId: generateId(),
    periodStart: getPeriodStart(timestamp),
  };
}

function usageUnitsLiteral(units: number) {
  if (!Number.isFinite(units) || units < 0) {
    throw new TypeError("usage units must be finite and nonnegative");
  }
  return sql.raw(String(units));
}

function rollupSpaceIdentityMatches(spaceId: string | null) {
  return spaceId === null
    ? sql`${appUsageRollups.spaceId} IS NULL`
    : sql`${appUsageRollups.spaceId} = ${spaceId}`;
}

function usageStatements(
  db: Database,
  event: ReturnType<typeof captureUsage>,
): UsageStatements {
  const { scopeId, rollupId, periodStart } = event;
  const increment = usageUnitsLiteral(event.units);
  const spaceIdentityMatches = rollupSpaceIdentityMatches(event.spaceId);
  const nextUnits = sql`${appUsageRollups.units} + ${increment}`;
  return [
    db.update(appUsageRollups).set({
      units: appUsageRollups.units,
      updatedAt: sql`${appUsageRollups.updatedAt}`,
    })
      .where(and(
        eq(appUsageRollups.ownerAccountId, event.ownerAccountId),
        eq(appUsageRollups.scopeType, event.scopeType),
        eq(appUsageRollups.scopeId, scopeId),
        eq(appUsageRollups.meterType, event.meterType),
        eq(appUsageRollups.periodStart, periodStart),
      )),
    db.run(sql`
      INSERT INTO app_usage_events (
        id, idempotency_key, owner_account_id, scope_type, space_id,
        meter_type, units, reference_id, reference_type, metadata, created_at
      ) VALUES (
        ${event.id}, ${event.idempotencyKey}, ${event.ownerAccountId},
        ${event.scopeType}, ${event.spaceId}, ${event.meterType}, ${increment},
        ${event.referenceId}, ${event.referenceType}, ${event.metadata}, ${event.createdAt}
      ) ON CONFLICT(idempotency_key) DO NOTHING
    `),
    // This SELECT contributes only the event inserted by this attempt. A
    // duplicate key has a different ID and cannot increment its rollup again.
    db.insert(appUsageRollups).select(db.select({
      id: sql<string>`${rollupId}`.as("id"),
      ownerAccountId: appUsageEvents.ownerAccountId,
      scopeType: appUsageEvents.scopeType,
      scopeId: sql<string>`${scopeId}`.as("scope_id"),
      spaceId: appUsageEvents.spaceId,
      meterType: appUsageEvents.meterType,
      periodStart: sql<string>`${periodStart}`.as("period_start"),
      units: appUsageEvents.units,
      updatedAt: sql<string>`${event.createdAt}`.as("updated_at"),
    }).from(appUsageEvents).where(eq(appUsageEvents.id, event.id)))
      .onConflictDoUpdate({
        target: [
          appUsageRollups.ownerAccountId,
          appUsageRollups.scopeType,
          appUsageRollups.scopeId,
          appUsageRollups.meterType,
          appUsageRollups.periodStart,
        ],
        set: {
          // The NOT NULL column aborts the whole group on numeric overflow;
          // never clamp a finite event into an infinite persisted aggregate.
          // Keep the finite bound literal: edge.sql parameters have a smaller
          // portable range, even when this conflict branch is not executed.
          units: sql`CASE WHEN ${spaceIdentityMatches} THEN
            CASE WHEN ${nextUnits} BETWEEN 0 AND 1.7976931348623157e308
              AND (${appUsageRollups.units} <= 0 OR
                (${nextUnits} > ${appUsageRollups.units} AND
                  ${nextUnits} > ${increment}))
            THEN ${nextUnits} ELSE NULL END
            ELSE NULL END`,
          updatedAt: event.createdAt,
        },
      }),
  ];
}

type RunUsageEvent = ReturnType<typeof captureUsage> & {
  existingIdAtPrefetch: string | null;
};

function usageProjectionStatements(
  db: Database,
  events: readonly RunUsageEvent[],
): UsageStatements {
  const statements: UsageStatements[number][] = [];

  // Acquire every affected rollup row in one deterministic order before any
  // event key can be changed. New rows are temporary zero-valued locks within
  // this same transaction and are reconciled from events below.
  const ordered = [...events].sort((a, b) =>
    compareLockKey(a, b)
  );
  for (const event of ordered) {
    const { scopeId, rollupId, periodStart } = event;
    statements.push(db.insert(appUsageRollups).values({
      id: rollupId,
      ownerAccountId: event.ownerAccountId,
      scopeType: event.scopeType,
      scopeId,
      spaceId: event.spaceId,
      meterType: event.meterType,
      periodStart,
      units: 0,
      updatedAt: event.createdAt,
    }).onConflictDoUpdate({
      target: [
        appUsageRollups.ownerAccountId,
        appUsageRollups.scopeType,
        appUsageRollups.scopeId,
        appUsageRollups.meterType,
        appUsageRollups.periodStart,
      ],
      set: {
        units: sql`CASE WHEN ${rollupSpaceIdentityMatches(event.spaceId)}
          THEN ${appUsageRollups.units} ELSE NULL END`,
        updatedAt: sql`${appUsageRollups.updatedAt}`,
      },
    }));
  }

  for (const event of ordered) {
    const month = event.periodStart.slice(0, 7);
    const existingAtPrefetch = event.existingIdAtPrefetch;
    const unitsLiteral = usageUnitsLiteral(event.units);
    const priorSpaceMatches = event.spaceId === null
      ? sql`prior.space_id IS NULL`
      : sql`prior.space_id = ${event.spaceId}`;
    const currentSpaceMatches = event.spaceId === null
      ? sql`app_usage_events.space_id IS NULL AND excluded.space_id IS NULL`
      : sql`app_usage_events.space_id = excluded.space_id`;
    const prefetchedIdentityIsCurrent = existingAtPrefetch === null
      ? sql`1`
      : sql`EXISTS (
          SELECT 1 FROM app_usage_events AS prior
          WHERE prior.idempotency_key = ${event.idempotencyKey}
            AND prior.id = ${existingAtPrefetch}
            AND prior.owner_account_id = ${event.ownerAccountId}
            AND prior.scope_type = ${event.scopeType}
            AND ${priorSpaceMatches}
            AND prior.meter_type = ${event.meterType}
            AND prior.reference_id = ${event.referenceId}
            AND prior.reference_type = ${event.referenceType}
            AND substr(prior.created_at, 1, 7) = ${month}
        )`;
    // An invalid identity deliberately writes NULL to the NOT NULL units
    // column. That makes the complete atomic group fail before ON
    // CONFLICT can silently redirect a fixed key to another identity.
    statements.push(db.run(sql`
      INSERT INTO app_usage_events (
        id, idempotency_key, owner_account_id, scope_type, space_id,
        meter_type, units, reference_id, reference_type, metadata, created_at
      ) VALUES (
        ${event.id},
        ${event.idempotencyKey}, ${event.ownerAccountId},
        ${event.scopeType}, ${event.spaceId}, ${event.meterType},
        CASE WHEN ${prefetchedIdentityIsCurrent} THEN ${unitsLiteral} ELSE NULL END,
        ${event.referenceId}, ${event.referenceType}, ${event.metadata}, ${event.createdAt}
      )
      ON CONFLICT(idempotency_key) DO UPDATE SET
        units = CASE WHEN
          app_usage_events.owner_account_id = excluded.owner_account_id
          AND app_usage_events.scope_type = excluded.scope_type
          AND ${currentSpaceMatches}
          AND app_usage_events.meter_type = excluded.meter_type
          AND app_usage_events.reference_id = excluded.reference_id
          AND app_usage_events.reference_type = excluded.reference_type
          AND (${existingAtPrefetch ? sql`1` : sql`substr(app_usage_events.created_at, 1, 7) = ${month}`})
          AND (${existingAtPrefetch ? sql`app_usage_events.id = ${existingAtPrefetch}` : sql`1`})
        THEN CASE WHEN app_usage_events.units >= excluded.units
          THEN app_usage_events.units ELSE excluded.units END ELSE NULL END
    `));
  }

  for (const event of ordered) {
    const month = event.periodStart.slice(0, 7);
    statements.push(db.run(sql`
      UPDATE app_usage_rollups
      SET units = CASE
        WHEN (
          SELECT SUM(units) FROM app_usage_events
          WHERE owner_account_id = ${event.ownerAccountId}
            AND scope_type = ${event.scopeType}
            AND space_id = ${event.spaceId}
            AND meter_type = ${event.meterType}
            AND substr(created_at, 1, 7) = ${month}
        ) BETWEEN 0 AND 1.7976931348623157e308
        THEN (
          SELECT SUM(units) FROM app_usage_events
          WHERE owner_account_id = ${event.ownerAccountId}
            AND scope_type = ${event.scopeType}
            AND space_id = ${event.spaceId}
            AND meter_type = ${event.meterType}
            AND substr(created_at, 1, 7) = ${month}
        ) ELSE NULL END,
        updated_at = ${event.createdAt}
      WHERE owner_account_id = ${event.ownerAccountId}
        AND scope_type = ${event.scopeType}
        AND scope_id = ${event.scopeId}
        AND meter_type = ${event.meterType}
        AND period_start = ${event.periodStart}
    `));
  }
  return statements;
}

function compareLockKey(a: RunUsageEvent, b: RunUsageEvent): number {
  const left = [
    a.ownerAccountId,
    a.scopeType,
    a.scopeId,
    a.periodStart,
    a.meterType,
  ];
  const right = [
    b.ownerAccountId,
    b.scopeType,
    b.scopeId,
    b.periodStart,
    b.meterType,
  ];
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) continue;
    return left[index]! < right[index]! ? -1 : 1;
  }
  return 0;
}

function isAppUsageMeterType(value: string): value is AppUsageMeterType {
  return (APP_USAGE_METER_TYPES as readonly string[]).includes(value);
}

export async function recordAppUsage(
  d1: AppUsageDb,
  input: AppUsageRecordInput,
): Promise<AppUsageRecordResult> {
  if (!Number.isFinite(input.units) || input.units <= 0) {
    return { success: true, applied: false, eventId: "" };
  }

  const event = captureUsage(input, new Date().toISOString());
  await executeUsageStatements(d1, (db) => usageStatements(db, event));
  // Without a key, a successful group proves this unique event was inserted.
  // A separate read failure must not turn that known commit into a new retry.
  if (event.idempotencyKey === null) {
    return { success: true, applied: true, eventId: event.id };
  }
  const inserted = await getDb(d1).select({ id: appUsageEvents.id })
    .from(appUsageEvents).where(eq(appUsageEvents.id, event.id)).get();
  return { success: true, applied: !!inserted, eventId: inserted?.id ?? "" };
}

export async function recordRunUsageBatch(
  env: Env,
  runId: string,
): Promise<void> {
  const notifier = env.RUN_NOTIFIER;
  if (!notifier) throw new Error("RUN_NOTIFIER is required to project Run usage");
  const stub = notifier.get(notifier.idFromName(runId));
  const response = await stub.fetch(new Request(
    `http://internal/usage-project?runId=${encodeURIComponent(runId)}`,
    { method: "POST" },
  ));
  if (!response.ok) {
    throw new Error(`Run usage projection rejected (${response.status})`);
  }
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" ||
    (result as Record<string, unknown>).success !== true) {
    throw new Error("Run usage projection was not accepted");
  }
}

export async function projectRunUsageSnapshot(
  binding: AppUsageDb,
  runId: string,
  totals: Readonly<Partial<Record<AppUsageMeterType, number>>>,
  authority: { providerSub?: string; witness?: RunUsageProjectionWitness } = {},
): Promise<void> {
  // Snapshot all caller-owned values and the month anchor before the first
  // await so a suspended SQL transaction cannot observe later mutations.
  const suppliedTotals = { ...totals };
  const timestamp = new Date().toISOString();
  const db = getDb(binding);
  const run = await db
    .select({ usage: runs.usage, accountId: runs.accountId,
      status: runs.status, completionKey: runs.completionKey })
    .from(runs)
    .where(eq(runs.id, runId))
    .get();

  if (!run?.accountId) throw new Error("Run usage workspace is unavailable");
  const workspace = await db.select({ ownerAccountId: accounts.ownerAccountId })
    .from(accounts).where(eq(accounts.id, run.accountId)).get();
  if (!workspace) throw new Error("Run usage workspace is unavailable");
  const ownerAccountId = workspace.ownerAccountId || run.accountId;
  const terminal = ["completed", "failed", "cancelled"].includes(run.status);
  let witness: RunUsageProjectionWitness | undefined;
  if (terminal) {
    const stored = await db.select().from(runUsageProjectionOutbox)
      .where(eq(runUsageProjectionOutbox.runId, runId)).get();
    if (!stored || !run.completionKey || !authority.providerSub ||
      stored.completionKey !== run.completionKey ||
      stored.runStatus !== run.status ||
      stored.workspaceId !== run.accountId ||
      stored.ownerAccountId !== ownerAccountId ||
      (authority.witness && (
        authority.witness.id !== stored.id ||
        authority.witness.runId !== stored.runId ||
        authority.witness.completionKey !== stored.completionKey ||
        authority.witness.runStatus !== stored.runStatus ||
        authority.witness.workspaceId !== stored.workspaceId ||
        authority.witness.ownerAccountId !== stored.ownerAccountId
      ))) {
      throw new UsageProjectionBlockedError("Terminal Run usage authority witness is unavailable or changed");
    }
    witness = stored;
  } else if (authority.witness) {
    throw new UsageProjectionBlockedError("Terminal Run usage witness no longer matches the Run");
  }

  const aggregated = new Map<AppUsageMeterType, number>();
  let usage: { inputTokens?: number; outputTokens?: number };
  try {
    const parsed: unknown = JSON.parse(run.usage);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Run usage must be a JSON object");
    }
    usage = parsed as { inputTokens?: number; outputTokens?: number };
  } catch {
    throw new Error("Run usage JSON is invalid");
  }
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  if (!Number.isFinite(inputTokens) || inputTokens < 0 ||
    !Number.isFinite(outputTokens) || outputTokens < 0) {
    throw new Error("Invalid SQL Run token usage");
  }
  const inputK = inputTokens / 1000;
  const outputK = outputTokens / 1000;
  if (inputK > 0) aggregated.set("llm_tokens_input", inputK);
  if (outputK > 0) aggregated.set("llm_tokens_output", outputK);

  for (const [meterType, units] of Object.entries(suppliedTotals)) {
    if (!isAppUsageMeterType(meterType)) {
      throw new Error(`Unknown Run usage meter: ${meterType}`);
    }
    if (!Number.isFinite(units) || (units ?? 0) < 0) {
      throw new Error("Invalid aggregated Run usage");
    }
    if (units === 0) continue;
    const current = aggregated.get(meterType) ?? 0;
    const combined = current + units!;
    if (current > 0 && units > 0 &&
      (!Number.isFinite(combined) || combined <= current || combined <= units)) {
      throw new Error("Invalid aggregated Run usage");
    }
    aggregated.set(meterType, combined);
  }

  const meters = APP_USAGE_METER_TYPES;
  const keys = meters.map((meterType) => `run:${runId}:${meterType}`);
  const existingRows = await db.select({
    id: appUsageEvents.id,
    idempotencyKey: appUsageEvents.idempotencyKey,
    createdAt: appUsageEvents.createdAt,
    ownerAccountId: appUsageEvents.ownerAccountId,
    scopeType: appUsageEvents.scopeType,
    spaceId: appUsageEvents.spaceId,
    meterType: appUsageEvents.meterType,
    referenceId: appUsageEvents.referenceId,
    referenceType: appUsageEvents.referenceType,
  }).from(appUsageEvents).where(inArray(appUsageEvents.idempotencyKey, keys)).all();
  const existingByKey = new Map(existingRows.map((row) => [row.idempotencyKey, row]));
  for (const row of existingRows) {
    if (row.ownerAccountId !== ownerAccountId || row.scopeType !== "space" ||
      row.spaceId !== run.accountId || row.referenceId !== runId ||
      row.referenceType !== "run" ||
      row.idempotencyKey !== `run:${runId}:${row.meterType}`) {
      throw new UsageProjectionBlockedError(
        `Canonical Run usage meter identity conflicts with recorded owner: ${row.meterType}`,
      );
    }
  }
  const events = meters.flatMap((meterType) => {
    const units = aggregated.get(meterType) ?? 0;
    const existing = existingByKey.get(`run:${runId}:${meterType}`);
    if (!Number.isFinite(units) || units < 0) {
      throw new Error("Invalid aggregated Run usage");
    }
    if (units === 0 && !existing) return [];
    const event = captureUsage({
      ownerAccountId,
      spaceId: run.accountId!,
      meterType,
      units,
      referenceId: runId,
      referenceType: "run",
      idempotencyKey: `run:${runId}:${meterType}`,
    }, timestamp);
    return [{
      ...event,
      // Existing rows retain their original month even if a later projection
      // crosses a month boundary. A concurrent first writer crossing months
      // is rejected in the atomic upsert and can be retried against its anchor.
      periodStart: existing ? getPeriodStart(existing.createdAt) : event.periodStart,
      existingIdAtPrefetch: existing?.id ?? null,
    }];
  });
  for (const event of events) {
    const rollup = await db.select({ spaceId: appUsageRollups.spaceId })
      .from(appUsageRollups).where(and(
        eq(appUsageRollups.ownerAccountId, event.ownerAccountId),
        eq(appUsageRollups.scopeType, event.scopeType),
        eq(appUsageRollups.scopeId, event.scopeId),
        eq(appUsageRollups.meterType, event.meterType),
        eq(appUsageRollups.periodStart, event.periodStart),
      )).get();
    if (rollup && rollup.spaceId !== event.spaceId) {
      throw new UsageProjectionBlockedError(
        `Canonical Run usage rollup space identity conflicts: ${event.meterType}`,
      );
    }
  }
  if (!authority.providerSub) {
    throw new UsageProjectionBlockedError("Configured owner identity is unavailable");
  }
  const assertionId = crypto.randomUUID();
  const expectedStatus = run.status;
  const expectedCompletionKey = run.completionKey;
  const workspaceId = run.accountId;
  await executeUsageStatements(binding, (transactionDb) => {
    // These no-op writes lock the rows whose identity authorizes the meter
    // group. A concurrent owner transfer, pin change, or terminal CAS must
    // serialize before or after this group, including on READ COMMITTED SQL.
    const locks = [
      transactionDb.run(sql`UPDATE runs SET usage = usage WHERE id = ${runId}`),
      transactionDb.run(sql`UPDATE accounts SET owner_account_id = owner_account_id
        WHERE id = ${workspaceId}`),
      transactionDb.run(sql`UPDATE accounts SET status = status
        WHERE id = ${ownerAccountId}`),
      transactionDb.run(sql`UPDATE auth_identities SET provider_sub = provider_sub
        WHERE user_id = ${ownerAccountId} AND provider = 'oidc'
          AND provider_sub = ${authority.providerSub!}`),
    ];
    // Missing or changed authority writes NULL into a NOT NULL column. The
    // transient row and every meter write roll back together; it is deleted
    // before a successful commit. This also fences zero-meter projections.
    const valid = sql`EXISTS (
      SELECT 1 FROM runs AS r
      JOIN accounts AS space ON space.id = r.account_id
      JOIN accounts AS principal ON principal.id = ${ownerAccountId}
      JOIN auth_identities AS identity ON identity.user_id = principal.id
      WHERE r.id = ${runId}
        AND r.status = ${expectedStatus}
        AND r.account_id = ${workspaceId}
        AND r.completion_key IS NOT DISTINCT FROM ${expectedCompletionKey}
        AND COALESCE(NULLIF(space.owner_account_id, ''), space.id) = ${ownerAccountId}
        AND principal.status = 'active'
        AND identity.provider = 'oidc'
        AND identity.provider_sub = ${authority.providerSub!}
        AND (${terminal ? sql`EXISTS (
          SELECT 1 FROM run_usage_projection_outbox AS witness
          WHERE witness.id = ${witness!.id}
            AND witness.run_id = r.id
            AND witness.completion_key = r.completion_key
            AND witness.run_status = r.status
            AND witness.workspace_id = r.account_id
            AND witness.owner_account_id = ${ownerAccountId}
        )` : sql`r.status NOT IN ('completed', 'failed', 'cancelled')`})
    )`;
    return [
      ...locks,
      transactionDb.run(sql`INSERT INTO run_usage_projection_assertions (id, valid)
        VALUES (${assertionId}, CASE WHEN ${valid} THEN 1 ELSE NULL END)`),
      ...usageProjectionStatements(transactionDb, events),
      transactionDb.run(sql`DELETE FROM run_usage_projection_assertions
        WHERE id = ${assertionId}`),
    ];
  });
}
