import type { Env } from '../../../shared/types';
import { now } from '../../../shared/utils';
import { getDb, accountEnvVars, serviceCommonEnvLinks } from '../../../infra/db';
import { eq, and, sql, desc } from 'drizzle-orm';
import { getServiceRouteRecord } from '../platform/workers';

export type LinkSource = 'manual' | 'required';
export type SyncState = 'pending' | 'managed' | 'overridden' | 'missing_common' | 'missing_builtin' | 'error';

export interface ReconcileUpdate {
  rowId: string;
  lastAppliedFingerprint?: string | null;
  syncState?: SyncState;
  syncReason?: string | null;
  lastObservedFingerprint?: string | null;
  lastSyncError?: string | null;
}

export interface WorkspaceEnvRow {
  id: string;
  space_id: string;
  name: string;
  value_encrypted: string;
  is_secret: boolean;
  created_at: string;
  updated_at: string;
}

export interface ServiceRow {
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

export type WorkerRow = ServiceRow;
export type WorkerLinkRow = ServiceLinkRow;

export class CommonEnvRepository {
  constructor(private readonly env: Pick<Env, 'DB'>) {}

  async listWorkspaceEnvRows(spaceId: string): Promise<WorkspaceEnvRow[]> {
    const db = getDb(this.env.DB);
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

  async listWorkspaceCommonEnvNames(spaceId: string): Promise<string[]> {
    const db = getDb(this.env.DB);
    const rows = await db
      .select({ name: accountEnvVars.name })
      .from(accountEnvVars)
      .where(eq(accountEnvVars.accountId, spaceId));

    return rows.map((row) => row.name);
  }

  async listServiceLinks(spaceId: string, serviceId: string): Promise<ServiceLinkRow[]> {
    const db = getDb(this.env.DB);
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

  async listServiceIdsLinkedToEnvKey(spaceId: string, envName: string): Promise<string[]> {
    const db = getDb(this.env.DB);
    const rows = await db
      .selectDistinct({ serviceId: serviceCommonEnvLinks.serviceId })
      .from(serviceCommonEnvLinks)
      .where(and(
        eq(serviceCommonEnvLinks.accountId, spaceId),
        eq(sql`UPPER(${serviceCommonEnvLinks.envName})`, envName),
      ));

    return rows.map((row) => row.serviceId);
  }

  async getService(spaceId: string, serviceId: string): Promise<ServiceRow | null> {
    const r = await getServiceRouteRecord(this.env.DB, serviceId);
    if (!r || r.accountId !== spaceId) return null;
    return {
      id: r.id,
      space_id: r.accountId,
      route_ref: r.routeRef,
    };
  }

  async listWorkerLinks(spaceId: string, workerId: string): Promise<WorkerLinkRow[]> {
    return this.listServiceLinks(spaceId, workerId);
  }

  async listWorkerIdsLinkedToEnvKey(spaceId: string, envName: string): Promise<string[]> {
    return this.listServiceIdsLinkedToEnvKey(spaceId, envName);
  }

  async getWorker(spaceId: string, workerId: string): Promise<WorkerRow | null> {
    return this.getService(spaceId, workerId);
  }

  async updateLinkRuntime(update: ReconcileUpdate): Promise<void> {
    const db = getDb(this.env.DB);
    const ts = now();

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
}

export { CommonEnvRepository as ServiceCommonEnvRepository };
