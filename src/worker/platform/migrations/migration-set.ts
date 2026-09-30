/**
 * The D1 migration set the Worker carries in its own module graph.
 *
 * `db/migrations-control/migrations` stays the SQL source of truth. A Worker
 * has no filesystem, so runtime self-migration needs the same bytes inside the
 * bundle; `scripts/generate-runtime-migration-set.ts` derives them and
 * `bun run check:migration-set` fails when the generated copy drifts.
 */

import generated from "./migration-set.generated.json";

export type EmbeddedMigration = {
  /** File name inside `db/migrations-control/migrations`, e.g. `0001_baseline.sql`. */
  readonly name: string;
  /** `sha256:<hex>` over the raw file bytes — the exact ledger checksum the OpenTofu bridge writes. */
  readonly sha256: string;
  readonly sql: string;
};

export const EMBEDDED_MIGRATIONS: readonly EmbeddedMigration[] =
  generated.entries;

export const EMBEDDED_MIGRATION_SET_API_VERSION = generated.apiVersion;
export const EMBEDDED_MIGRATION_SET_ENGINE = generated.engine;
