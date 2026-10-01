import { eq, sql } from "drizzle-orm";

import {
  appUsageEvents,
  appUsageRollups,
  getDb,
  runs,
} from "../../../infra/db/index.ts";
import type { Database } from "../../../infra/db/index.ts";
import { executeAtomicStatements } from "../../../infra/db/client.ts";
import type { Env } from "../../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import {
  generateId,
  safeJsonParseOrDefault,
} from "../../../shared/utils/index.ts";
import { getUsageEventsFromR2 } from "../offload/usage-events.ts";
import {
  APP_USAGE_METER_TYPES,
  type AppUsageMeterType,
  type AppUsageRecordInput,
  type AppUsageRecordResult,
} from "./usage-types.ts";

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
    await executeAtomicStatements(binding, build);
    return;
  }
  // A wrapped stateful binding's batch can be sequential. Preserve its
  // dedicated transaction instead of accidentally bypassing withTransaction.
  const client = "$client" in binding ? binding.$client : undefined;
  if (isSqlBinding(client)) {
    await executeAtomicStatements(client, build);
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

function usageStatements(
  db: Database,
  event: ReturnType<typeof captureUsage>,
): UsageStatements {
  const { scopeId, rollupId, periodStart, ...values } = event;
  return [
    db.insert(appUsageEvents).values(values).onConflictDoNothing({
      target: appUsageEvents.idempotencyKey,
    }),
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
          units: sql`case
            when ${appUsageRollups.units} + ${event.units}
              between 0 and 1.7976931348623157e308
            then ${appUsageRollups.units} + ${event.units}
            else null end`,
          updatedAt: event.createdAt,
        },
      }),
  ];
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
  const db = getDb(env.DB);
  const run = await db
    .select({ usage: runs.usage, accountId: runs.accountId })
    .from(runs)
    .where(eq(runs.id, runId))
    .get();

  if (!run?.accountId) throw new Error("Run usage owner is unavailable");

  const aggregated = new Map<AppUsageMeterType, number>();
  const usage = safeJsonParseOrDefault<
    { inputTokens?: number; outputTokens?: number }
  >(run.usage, {});
  const inputK = (usage.inputTokens ?? 0) / 1000;
  const outputK = (usage.outputTokens ?? 0) / 1000;
  if (inputK > 0) aggregated.set("llm_tokens_input", inputK);
  if (outputK > 0) aggregated.set("llm_tokens_output", outputK);

  if (env.TAKOS_OFFLOAD) {
    const raw = await getUsageEventsFromR2(env.TAKOS_OFFLOAD, runId, {
      maxEvents: 50_001,
      strict: true,
    });
    if (raw.length > 50_000) {
      throw new Error("Run usage exceeds the supported complete-recording limit");
    }
    for (const ev of raw) {
      if (!isAppUsageMeterType(ev.meter_type)) continue;
      aggregated.set(
        ev.meter_type,
        (aggregated.get(ev.meter_type) ?? 0) + ev.units,
      );
    }
  }

  const timestamp = new Date().toISOString();
  const events = Array.from(aggregated, ([meterType, units]) => {
    if (!Number.isFinite(units) || units <= 0) {
      throw new Error("Invalid aggregated Run usage");
    }
    return captureUsage({
      ownerAccountId: run.accountId,
      spaceId: run.accountId,
      meterType,
      units,
      referenceId: runId,
      referenceType: "run",
      idempotencyKey: `run:${runId}:${meterType}`,
    }, timestamp);
  });
  if (!events.length) return;
  await executeUsageStatements(env.DB, (db) =>
    events.flatMap((event) => usageStatements(db, event)));
}
