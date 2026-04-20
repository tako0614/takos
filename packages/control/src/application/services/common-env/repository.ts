import type { Env } from "../../../shared/types/index.ts";

import {
  accountEnvVars,
  getDb,
  serviceCommonEnvLinks,
} from "../../../infra/db/index.ts";
import { and, desc, eq, sql } from "drizzle-orm";
import { getServiceRouteRecord } from "../platform/workers.ts";

export type LinkSource = "manual" | "required";
export type SyncState =
  | "pending"
  | "managed"
  | "overridden"
  | "missing_common"
  | "missing_included"
  | "error";

export interface ReconcileUpdate {
  rowId: string;
  lastAppliedFingerprint?: string | null;
  syncState?: SyncState;
  syncReason?: string | null;
  lastObservedFingerprint?: string | null;
  lastSyncError?: string | null;
}

export interface SpaceEnvRow {
  id: string;
  space_id: string;
  name: string;
  value_encrypted: string;
  is_secret: boolean;
  created_at: string;
  updated_at: string;
}

export interface CommonEnvServiceRow {
  id: string;
  space_id: string;
  route_ref: string | null;
}

export interface ServiceLinkRow {
  id: string;
  space_id: string;
  service_id: string;
  env_name: string;
  source: LinkSource;
  last_applied_fingerprint: string | null;
  sync_state: SyncState;
  sync_reason: string | null;
  last_observed_fingerprint: string | null;
  last_reconciled_at: string | null;
  last_sync_error: string | null;
  created_at: string;
  updated_at: string;
}

export type WorkerRow = CommonEnvServiceRow;
export type WorkerLinkRow = ServiceLinkRow;

export async function listSpaceEnvRows(
  env: Pick<Env, "DB">,
  spaceId: string,
): Promise<SpaceEnvRow[]> {
  const db = getDb(env.DB);
  const rows = await db
    .select({
      id: accountEnvVars.id,
      accountId: accountEnvVars.accountId,
      name: accountEnvVars.name,
      valueEncrypted: accountEnvVars.valueEncrypted,
      isSecret: accountEnvVars.isSecret,
      createdAt: accountEnvVars.createdAt,
      updatedAt: accountEnvVars.updatedAt,
    })
    .from(accountEnvVars)
    .where(eq(accountEnvVars.accountId, spaceId))
    .orderBy(desc(accountEnvVars.updatedAt));

  return rows.map((r) => ({
    id: r.id,
    space_id: r.accountId,
    name: r.name,
    value_encrypted: r.valueEncrypted,
    is_secret: r.isSecret,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }));
}

export async function listSpaceCommonEnvNames(
  env: Pick<Env, "DB">,
  spaceId: string,
): Promise<string[]> {
  const db = getDb(env.DB);
  const rows = await db
    .select({ name: accountEnvVars.name })
    .from(accountEnvVars)
    .where(eq(accountEnvVars.accountId, spaceId));

  return rows.map((row) => row.name);
}

export async function listServiceLinks(
  env: Pick<Env, "DB">,
  spaceId: string,
  serviceId: string,
): Promise<ServiceLinkRow[]> {
  const db = getDb(env.DB);
  const rows = await db
    .select({
      id: serviceCommonEnvLinks.id,
      accountId: serviceCommonEnvLinks.accountId,
      serviceId: serviceCommonEnvLinks.serviceId,
      envName: serviceCommonEnvLinks.envName,
      source: serviceCommonEnvLinks.source,
      lastAppliedFingerprint: serviceCommonEnvLinks.lastAppliedFingerprint,
      syncState: serviceCommonEnvLinks.syncState,
      syncReason: serviceCommonEnvLinks.syncReason,
      lastObservedFingerprint: serviceCommonEnvLinks.lastObservedFingerprint,
      lastReconciledAt: serviceCommonEnvLinks.lastReconciledAt,
      lastSyncError: serviceCommonEnvLinks.lastSyncError,
      createdAt: serviceCommonEnvLinks.createdAt,
      updatedAt: serviceCommonEnvLinks.updatedAt,
    })
    .from(serviceCommonEnvLinks)
    .where(and(
      eq(serviceCommonEnvLinks.accountId, spaceId),
      eq(serviceCommonEnvLinks.serviceId, serviceId),
    ));

  return rows.map((r) => ({
    id: r.id,
    space_id: r.accountId,
    service_id: r.serviceId,
    env_name: r.envName,
    source: r.source as LinkSource,
    last_applied_fingerprint: r.lastAppliedFingerprint,
    sync_state: r.syncState as SyncState,
    sync_reason: r.syncReason,
    last_observed_fingerprint: r.lastObservedFingerprint,
    last_reconciled_at: r.lastReconciledAt,
    last_sync_error: r.lastSyncError,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }));
}

export async function listServiceIdsLinkedToEnvKey(
  env: Pick<Env, "DB">,
  spaceId: string,
  envName: string,
): Promise<string[]> {
  const db = getDb(env.DB);
  const rows = await db
    .selectDistinct({ serviceId: serviceCommonEnvLinks.serviceId })
    .from(serviceCommonEnvLinks)
    .where(and(
      eq(serviceCommonEnvLinks.accountId, spaceId),
      eq(sql`UPPER(${serviceCommonEnvLinks.envName})`, envName),
    ));

  return rows.map((row) => row.serviceId);
}

export async function getService(
  env: Pick<Env, "DB">,
  spaceId: string,
  serviceId: string,
): Promise<CommonEnvServiceRow | null> {
  const r = await getServiceRouteRecord(env.DB, serviceId);
  if (!r || r.accountId !== spaceId) return null;
  return {
    id: r.id,
    space_id: r.accountId,
    route_ref: r.routeRef,
  };
}

export async function updateLinkRuntime(
  env: Pick<Env, "DB">,
  update: ReconcileUpdate,
): Promise<void> {
  const db = getDb(env.DB);
  const ts = new Date().toISOString();

  const setFields: Record<string, unknown> = {
    lastReconciledAt: ts,
    stateUpdatedAt: ts,
    updatedAt: ts,
  };

  if (update.lastAppliedFingerprint !== undefined) {
    setFields.lastAppliedFingerprint = update.lastAppliedFingerprint;
  }
  if (update.syncState !== undefined) {
    setFields.syncState = update.syncState;
  }
  if (update.syncReason !== undefined) {
    setFields.syncReason = update.syncReason;
  }
  if (update.lastObservedFingerprint !== undefined) {
    setFields.lastObservedFingerprint = update.lastObservedFingerprint;
  }
  if (update.lastSyncError !== undefined) {
    setFields.lastSyncError = update.lastSyncError;
  }

  await db
    .update(serviceCommonEnvLinks)
    .set(setFields)
    .where(eq(serviceCommonEnvLinks.id, update.rowId));
}
