/**
 * Startup gate that converges the D1 schema before requests reach the app.
 *
 * The Worker owns its own schema convergence (see `runtime-migrations.ts`), so
 * the first request into a fresh isolate drives the migration runner and every
 * later request costs nothing. Requests that arrive while migration is still
 * pending — or after it failed — get an explicit 503 with a retry hint instead
 * of a confusing "no such table" error from deep inside a query.
 */

import type { SqlDatabaseBinding } from "../../shared/types/bindings.ts";
import { logError, logInfo } from "../../shared/utils/logger.ts";
import {
  type RunMigrationsOptions,
  type SchemaStatus,
  runPendingMigrations,
} from "./runtime-migrations.ts";

/**
 * Paths that must answer while the schema is still converging: the liveness
 * probe, and the two endpoints an operator needs in order to see why and to
 * drive the migration to completion.
 */
export const SCHEMA_GATE_EXEMPT_PATHS: readonly string[] = [
  "/health",
  "/internal/runtime/status",
  "/internal/runtime/migrate",
];

export function isSchemaGateExemptPath(pathname: string): boolean {
  return SCHEMA_GATE_EXEMPT_PATHS.includes(pathname);
}

/**
 * Resolved-ready statuses, keyed by the database binding itself.
 *
 * The binding object is the one thing that is stable across a request: platform
 * adapters rebuild the bindings record per request (`platform/adapters/shared.ts`)
 * but spread the same `DB` reference into it, so keying on the binding memoizes
 * correctly whether the caller holds the raw env or the platform bindings. A
 * ready schema never becomes unready under one binding, so this is the whole
 * steady-state cost of the gate.
 */
const readyStatuses = new WeakMap<SqlDatabaseBinding, SchemaStatus>();
/** In-flight runs, so a burst of first requests drives one migration, not many. */
const inFlight = new WeakMap<SqlDatabaseBinding, Promise<SchemaStatus>>();

/**
 * Converge the schema, at most once per env object while a run is in flight.
 *
 * Never throws: an unexpected error is turned into a `failed` status so the
 * caller can answer with the same explicit 503 as an ordinary failure.
 */
export function ensureSchemaReady(
  db: SqlDatabaseBinding,
  options: RunMigrationsOptions = {},
): Promise<SchemaStatus> {
  const cached = readyStatuses.get(db);
  if (cached) return Promise.resolve(cached);

  const existing = inFlight.get(db);
  if (existing) return existing;

  const run = runPendingMigrations(db, options)
    .catch((error): SchemaStatus => {
      logError("Runtime schema migration raised", error, {
        module: "runtime_migrations",
      });
      return {
        state: "failed",
        total: 0,
        applied: 0,
        pending: [],
        ledgerTable: "unknown",
        error: error instanceof Error ? error.message : String(error),
      };
    })
    .then((status) => {
      inFlight.delete(db);
      if (status.state === "ready") {
        readyStatuses.set(db, status);
      } else {
        logError(
          `Runtime schema is not ready (${status.state})`,
          status.error,
          { module: "runtime_migrations" },
        );
      }
      return status;
    });

  inFlight.set(db, run);
  return run;
}

/**
 * Forget the cached status for a database — used by the explicit operator
 * trigger so a repaired database is re-read rather than answered from cache.
 */
export function resetSchemaGate(db: SqlDatabaseBinding): void {
  readyStatuses.delete(db);
  inFlight.delete(db);
}

export const SCHEMA_PENDING_ERROR_CODE = "SCHEMA_MIGRATION_PENDING";
export const SCHEMA_FAILED_ERROR_CODE = "SCHEMA_MIGRATION_FAILED";

/**
 * The 503 a request gets when it needs a schema that is not there yet.
 *
 * Built as a raw Response rather than thrown, because the gate runs ahead of
 * the Hono app that owns the error serializer.
 */
export function schemaUnavailableResponse(status: SchemaStatus): Response {
  const failed = status.state === "failed";
  const retryAfter = failed ? undefined : (status.retryAfterSeconds ?? 5);
  const body = {
    error: {
      code: failed ? SCHEMA_FAILED_ERROR_CODE : SCHEMA_PENDING_ERROR_CODE,
      message: failed
        ? "Database schema migration failed. The deployment cannot serve requests until it is resolved."
        : "Database schema migration is in progress. Retry shortly.",
      details: {
        state: status.state,
        applied: status.applied,
        total: status.total,
        ...(status.failedMigration
          ? { failedMigration: status.failedMigration }
          : {}),
        ...(status.error ? { reason: status.error } : {}),
      },
    },
  };
  return new Response(JSON.stringify(body), {
    status: 503,
    headers: {
      "Content-Type": "application/json",
      ...(retryAfter === undefined
        ? {}
        : { "Retry-After": String(retryAfter) }),
    },
  });
}

/**
 * Gate one request. Returns a 503 to send back, or `null` when the request may
 * proceed.
 */
export async function guardRequestSchema(
  db: SqlDatabaseBinding,
  pathname: string,
  options: RunMigrationsOptions = {},
): Promise<Response | null> {
  if (isSchemaGateExemptPath(pathname)) return null;
  const status = await ensureSchemaReady(db, options);
  if (status.state === "ready") return null;
  return schemaUnavailableResponse(status);
}

/** Converge the schema from a scheduled invocation, without failing the cron. */
export async function convergeSchemaInBackground(
  db: SqlDatabaseBinding,
  options: RunMigrationsOptions = {},
): Promise<SchemaStatus> {
  const status = await ensureSchemaReady(db, options);
  if (status.state !== "ready") return status;
  if (status.adoptedFrom) {
    logInfo(
      `Adopted ${status.applied} migration records from the ${status.adoptedFrom} ledger`,
      { module: "runtime_migrations" },
    );
  }
  return status;
}
