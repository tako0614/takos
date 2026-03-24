import { eq, and, inArray, sql } from 'drizzle-orm';
import type { Env } from '../../../shared/types';
import { generateId, now } from '../../../shared/utils';
import { D1TransactionManager } from '../../../shared/utils/db-transaction';
import {
  decryptCommonEnvValue,
  encryptCommonEnvValue,
  normalizeEnvName,
  uniqueEnvNames,
} from './crypto';
import {
  CommonEnvReconcileJobStore,
  type CommonEnvReconcileTrigger,
} from './reconcile-jobs';
import { writeCommonEnvAuditLog, type CommonEnvAuditActor } from './audit';
import {
  CommonEnvRepository,
  type LinkSource,
  type ServiceLinkRow,
  type SyncState,
} from './repository';
import { CommonEnvReconciler } from './reconciler';
import { CommonEnvOrchestrator } from './orchestrator';
import { isReservedWorkspaceCommonEnvKey } from './crypto';
import {
  deleteManagedTakosTokenConfig,
  listTakosBuiltinStatuses,
  type TakosBuiltinStatus,
  TAKOS_ACCESS_TOKEN_ENV_NAME,
  upsertManagedTakosTokenConfig,
} from './takos-builtins';
import { getDb, accountEnvVars, serviceCommonEnvLinks } from '../../../infra/db';

interface EffectiveLink {
  envName: string;
  source: LinkSource;
  syncState: SyncState;
  syncReason: string | null;
}

/**
 * Group link rows by normalized env name, picking the effective row per key
 * (manual wins over required). Returns the grouped map of selected rows.
 */
function groupLinkRowsByEnvName(rows: ServiceLinkRow[]): Map<string, ServiceLinkRow> {
  const grouped = new Map<string, { manual?: ServiceLinkRow; required?: ServiceLinkRow }>();
  for (const row of rows) {
    const key = normalizeEnvName(row.env_name);
    const bucket = grouped.get(key) || {};
    if (row.source === 'manual') bucket.manual = row;
    if (row.source === 'required') bucket.required = row;
    grouped.set(key, bucket);
  }

  const out = new Map<string, ServiceLinkRow>();
  for (const [envName, bucket] of grouped.entries()) {
    const selected = bucket.manual || bucket.required;
    if (selected) out.set(envName, selected);
  }
  return out;
}

function buildLinkStateByName(rows: ServiceLinkRow[]): Map<string, { syncState: SyncState; syncReason: string | null }> {
  const grouped = groupLinkRowsByEnvName(rows);
  const out = new Map<string, { syncState: SyncState; syncReason: string | null }>();
  for (const [envName, row] of grouped.entries()) {
    out.set(envName, {
      syncState: row.sync_state,
      syncReason: row.sync_reason,
    });
  }
  return out;
}


function assertWorkspaceCommonEnvKeyAllowed(name: string): void {
  if (isReservedWorkspaceCommonEnvKey(name)) {
    throw new Error(`${name} is reserved as a managed Takos built-in env key`);
  }
}

/** Extract D1 meta.changes from a Drizzle run result */
function getChanges(result: unknown): number {
  return Number((result as { meta?: { changes?: number } }).meta?.changes || 0);
}

export class CommonEnvService {
  private readonly jobs: CommonEnvReconcileJobStore;
  private readonly repo: CommonEnvRepository;
  private readonly reconciler: CommonEnvReconciler;
  private readonly orchestrator: CommonEnvOrchestrator;
  private readonly txManager: D1TransactionManager;

  constructor(private env: Env) {
    this.jobs = new CommonEnvReconcileJobStore(env);
    this.repo = new CommonEnvRepository(env);
    this.reconciler = new CommonEnvReconciler(env, this.repo);
    this.orchestrator = new CommonEnvOrchestrator(this.repo, this.jobs, this.reconciler);
    this.txManager = new D1TransactionManager(env.DB);
  }

  private get db() {
    return getDb(this.env.DB);
  }

  private async runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.txManager.runInTransaction(fn);
  }

  private getEffectiveLinks(rows: ServiceLinkRow[]): Map<string, EffectiveLink> {
    const grouped = groupLinkRowsByEnvName(rows);
    const out = new Map<string, EffectiveLink>();
    for (const [envName, row] of grouped.entries()) {
      out.set(envName, {
        envName,
        source: row.source,
        syncState: row.sync_state,
        syncReason: row.sync_reason,
      });
    }
    return out;
  }

  private async listServiceLinks(spaceId: string, serviceId: string): Promise<ServiceLinkRow[]> {
    const repo = this.repo as CommonEnvRepository & {
      listServiceLinks?: (spaceId: string, serviceId: string) => Promise<ServiceLinkRow[]>;
      listWorkerLinks?: (spaceId: string, workerId: string) => Promise<ServiceLinkRow[]>;
    };
    return repo.listServiceLinks?.(spaceId, serviceId)
      ?? repo.listWorkerLinks?.(spaceId, serviceId)
      ?? [];
  }

  async listWorkspaceCommonEnv(spaceId: string): Promise<Array<{
    name: string;
    secret: boolean;
    value: string;
    updatedAt: string;
  }>> {
    const rows = await this.repo.listWorkspaceEnvRows(spaceId);
    const out: Array<{ name: string; secret: boolean; value: string; updatedAt: string }> = [];
    const dedupe = new Set<string>();

    for (const row of rows) {
      const canonicalName = normalizeEnvName(row.name);
      if (dedupe.has(canonicalName)) {
        throw new Error(`Conflicting common env entries exist for key: ${canonicalName}`);
      }
      dedupe.add(canonicalName);
      if (row.is_secret) {
        out.push({
          name: canonicalName,
          secret: true,
          value: '********',
          updatedAt: row.updated_at,
        });
        continue;
      }
      const value = await decryptCommonEnvValue(this.env, row);
      out.push({
        name: canonicalName,
        secret: false,
        value,
        updatedAt: row.updated_at,
      });
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  async upsertWorkspaceCommonEnv(params: {
    spaceId: string;
    name: string;
    value: string;
    secret?: boolean;
    actor?: CommonEnvAuditActor;
  }): Promise<void> {
    const spaceId = params.spaceId;
    const name = normalizeEnvName(params.name);
    assertWorkspaceCommonEnvKeyAllowed(name);
    const nextValue = String(params.value ?? '');
    const timestamp = now();
    const encrypted = await encryptCommonEnvValue(this.env, spaceId, name, nextValue);

    const existing = await this.db.select({
      id: accountEnvVars.id,
      accountId: accountEnvVars.accountId,
      name: accountEnvVars.name,
      valueEncrypted: accountEnvVars.valueEncrypted,
      isSecret: accountEnvVars.isSecret,
    })
      .from(accountEnvVars)
      .where(and(
        eq(accountEnvVars.accountId, spaceId),
        eq(sql`UPPER(${accountEnvVars.name})`, name),
      ))
      .all();

    if (existing.length > 1) {
      throw new Error(`Conflicting common env entries exist for key: ${name}`);
    }

    if (existing.length === 1) {
      const row = existing[0];
      const existingValue = await decryptCommonEnvValue(this.env, {
        space_id: row.accountId,
        name: row.name,
        value_encrypted: row.valueEncrypted,
      });
      const existingSecret = row.isSecret;
      const nextSecret = params.secret === true;
      const isNoop = existingValue === nextValue && existingSecret === nextSecret;
      if (isNoop) {
        return;
      }

      await this.runInTransaction(async () => {
        await this.db.update(accountEnvVars)
          .set({
            name,
            valueEncrypted: encrypted,
            isSecret: nextSecret,
            updatedAt: timestamp,
          })
          .where(eq(accountEnvVars.id, row.id));

        await writeCommonEnvAuditLog({
          db: this.env.DB,
          spaceId,
          eventType: 'workspace_env_updated',
          envName: name,
          changeBefore: {
            exists: true,
            is_secret: existingSecret,
          },
          changeAfter: {
            exists: true,
            is_secret: nextSecret,
            value_changed: existingValue !== nextValue,
          },
          actor: params.actor,
        });
      });
    } else {
      await this.runInTransaction(async () => {
        await this.db.insert(accountEnvVars)
          .values({
            id: generateId(),
            accountId: spaceId,
            name,
            valueEncrypted: encrypted,
            isSecret: !!params.secret,
            createdAt: timestamp,
            updatedAt: timestamp,
          });

        await writeCommonEnvAuditLog({
          db: this.env.DB,
          spaceId,
          eventType: 'workspace_env_created',
          envName: name,
          changeBefore: { exists: false },
          changeAfter: {
            exists: true,
            is_secret: params.secret === true,
          },
          actor: params.actor,
        });
      });
    }
  }

  async ensureSystemCommonEnv(spaceId: string, entries: Array<{
    name: string;
    value: string;
    secret?: boolean;
  }>): Promise<void> {
    for (const entry of entries) {
      const name = normalizeEnvName(entry.name);
      const value = String(entry.value ?? '');
      const isSecret = entry.secret === true;
      const encrypted = await encryptCommonEnvValue(this.env, spaceId, name, value);
      const timestamp = now();

      await this.runInTransaction(async () => {
        const result = await this.db.insert(accountEnvVars)
          .values({
            id: generateId(),
            accountId: spaceId,
            name,
            valueEncrypted: encrypted,
            isSecret: !!isSecret,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .onConflictDoNothing({
            target: [accountEnvVars.accountId, accountEnvVars.name],
          });
        const changes = getChanges(result);
        if (changes <= 0) return;

        await writeCommonEnvAuditLog({
          db: this.env.DB,
          spaceId,
          eventType: 'workspace_env_created',
          envName: name,
          changeBefore: { exists: false },
          changeAfter: {
            exists: true,
            is_secret: isSecret,
          },
          actor: { type: 'system' },
        });
      });
    }
  }

  async deleteWorkspaceCommonEnv(spaceId: string, nameRaw: string, actor?: CommonEnvAuditActor): Promise<boolean> {
    const name = normalizeEnvName(nameRaw);
    assertWorkspaceCommonEnvKeyAllowed(name);
    const existing = await this.db.select({
      id: accountEnvVars.id,
      isSecret: accountEnvVars.isSecret,
    })
      .from(accountEnvVars)
      .where(and(
        eq(accountEnvVars.accountId, spaceId),
        eq(sql`UPPER(${accountEnvVars.name})`, name),
      ))
      .limit(1)
      .get();

    if (!existing) return false;

    let deleted = false;
    await this.runInTransaction(async () => {
      const result = await this.db.delete(accountEnvVars)
        .where(eq(accountEnvVars.id, existing.id));
      const changes = getChanges(result);
      if (changes <= 0) return;
      deleted = true;
      await writeCommonEnvAuditLog({
        db: this.env.DB,
        spaceId,
        eventType: 'workspace_env_deleted',
        envName: name,
        changeBefore: {
          exists: true,
          is_secret: existing.isSecret,
        },
        changeAfter: { exists: false },
        actor,
      });
    });
    return deleted;
  }

  async ensureRequiredServiceLinks(params: {
    spaceId: string;
    serviceIds: string[];
    keys: string[];
    actor?: CommonEnvAuditActor;
  }): Promise<void> {
    const spaceId = params.spaceId;
    const keys = uniqueEnvNames(params.keys || []);
    if (keys.length === 0 || params.serviceIds.length === 0) return;

    const timestamp = now();
    await this.runInTransaction(async () => {
      for (const serviceId of params.serviceIds) {
        for (const key of keys) {
          const result = await this.db.insert(serviceCommonEnvLinks)
            .values({
              id: generateId(),
              accountId: spaceId,
              serviceId,
              envName: key,
              source: 'required',
              lastAppliedFingerprint: null,
              syncState: 'pending',
              syncReason: 'link_created',
              createdAt: timestamp,
              updatedAt: timestamp,
              stateUpdatedAt: timestamp,
            })
            .onConflictDoNothing({
              target: [serviceCommonEnvLinks.serviceId, serviceCommonEnvLinks.envName, serviceCommonEnvLinks.source],
            });
          const changes = getChanges(result);
          if (changes <= 0) continue;

          await writeCommonEnvAuditLog({
            db: this.env.DB,
            spaceId,
            eventType: 'worker_link_added',
            envName: key,
            serviceId,
            linkSource: 'required',
            changeBefore: { linked: false },
            changeAfter: { linked: true },
            actor: params.actor || { type: 'system' },
          });
        }
      }
    });
  }

  async ensureRequiredLinks(params: {
    spaceId: string;
    workerIds: string[];
    keys: string[];
    actor?: CommonEnvAuditActor;
  }): Promise<void> {
    await this.ensureRequiredServiceLinks({
      spaceId: params.spaceId,
      serviceIds: params.workerIds,
      keys: params.keys,
      actor: params.actor,
    });
  }

  async listServiceCommonEnvLinks(spaceId: string, serviceId: string): Promise<Array<{
    name: string;
    source: LinkSource;
    hasCommonValue: boolean;
    syncState: SyncState;
    syncReason: string | null;
  }>> {
    const rows = await this.listServiceLinks(spaceId, serviceId);
    const effective = this.getEffectiveLinks(rows);
    const commonNameSet = new Set(
      (await this.repo.listWorkspaceCommonEnvNames(spaceId)).map((name) => normalizeEnvName(name))
    );
    const builtinStatuses = await listTakosBuiltinStatuses({
      env: this.env,
      spaceId,
      serviceId,
      linkStateByName: buildLinkStateByName(rows),
    });

    return Array.from(effective.values())
      .sort((a, b) => a.envName.localeCompare(b.envName))
      .map((link) => ({
        name: link.envName,
        source: link.source,
        hasCommonValue: commonNameSet.has(link.envName)
          || Boolean(builtinStatuses[link.envName]?.available && (
            link.envName !== TAKOS_ACCESS_TOKEN_ENV_NAME
          || builtinStatuses[link.envName]?.configured
          )),
        syncState: link.syncState,
        syncReason: link.syncReason,
      }));
  }

  async listWorkerCommonEnvLinks(spaceId: string, workerId: string): Promise<Array<{
    name: string;
    source: LinkSource;
    hasCommonValue: boolean;
    syncState: SyncState;
    syncReason: string | null;
  }>> {
    return this.listServiceCommonEnvLinks(spaceId, workerId);
  }

  async listServiceManualLinkNames(spaceId: string, serviceId: string): Promise<string[]> {
    const rows = await this.db.select({ envName: serviceCommonEnvLinks.envName })
      .from(serviceCommonEnvLinks)
      .where(and(
        eq(serviceCommonEnvLinks.accountId, spaceId),
        eq(serviceCommonEnvLinks.serviceId, serviceId),
        eq(serviceCommonEnvLinks.source, 'manual'),
      ))
    .all();
    return uniqueEnvNames(rows.map((row) => row.envName));
  }

  async listWorkerManualLinkNames(spaceId: string, workerId: string): Promise<string[]> {
    return this.listServiceManualLinkNames(spaceId, workerId);
  }

  async listServiceBuiltins(
    spaceId: string,
    serviceId: string,
  ): Promise<Record<string, TakosBuiltinStatus>> {
    const rows = await this.listServiceLinks(spaceId, serviceId);
    return listTakosBuiltinStatuses({
      env: this.env,
      spaceId,
      serviceId,
      linkStateByName: buildLinkStateByName(rows),
    });
  }

  async listWorkerBuiltins(
    spaceId: string,
    workerId: string,
  ): Promise<Record<string, TakosBuiltinStatus>> {
    return this.listServiceBuiltins(spaceId, workerId);
  }

  async upsertServiceTakosAccessTokenConfig(params: {
    spaceId: string;
    serviceId: string;
    scopes: string[];
  }): Promise<void> {
    await upsertManagedTakosTokenConfig({
      env: this.env,
      spaceId: params.spaceId,
      serviceId: params.serviceId,
      scopes: params.scopes,
    });
    await this.enqueueServiceReconcile({
      spaceId: params.spaceId,
      serviceId: params.serviceId,
      targetKeys: [TAKOS_ACCESS_TOKEN_ENV_NAME],
      trigger: 'manual_links_patch',
    });
  }

  async upsertWorkerTakosAccessTokenConfig(params: {
    spaceId: string;
    workerId: string;
    scopes: string[];
  }): Promise<void> {
    await this.upsertServiceTakosAccessTokenConfig({
      spaceId: params.spaceId,
      serviceId: params.workerId,
      scopes: params.scopes,
    });
  }

  async deleteServiceTakosAccessTokenConfig(params: {
    spaceId: string;
    serviceId: string;
  }): Promise<void> {
    await deleteManagedTakosTokenConfig({
      env: this.env,
      spaceId: params.spaceId,
      serviceId: params.serviceId,
      envName: TAKOS_ACCESS_TOKEN_ENV_NAME,
    });
    await this.enqueueServiceReconcile({
      spaceId: params.spaceId,
      serviceId: params.serviceId,
      targetKeys: [TAKOS_ACCESS_TOKEN_ENV_NAME],
      trigger: 'manual_links_patch',
    });
  }

  async deleteWorkerTakosAccessTokenConfig(params: {
    spaceId: string;
    workerId: string;
  }): Promise<void> {
    await this.deleteServiceTakosAccessTokenConfig({
      spaceId: params.spaceId,
      serviceId: params.workerId,
    });
  }

  async deleteServiceTakosAccessTokenConfigs(params: {
    spaceId: string;
    serviceIds: string[];
  }): Promise<void> {
    await Promise.all(params.serviceIds.map((serviceId) =>
      deleteManagedTakosTokenConfig({
        env: this.env,
        spaceId: params.spaceId,
        serviceId,
        envName: TAKOS_ACCESS_TOKEN_ENV_NAME,
      })
    ));
  }

  async deleteWorkerTakosAccessTokenConfigs(params: {
    spaceId: string;
    workerIds: string[];
  }): Promise<void> {
    await this.deleteServiceTakosAccessTokenConfigs({
      spaceId: params.spaceId,
      serviceIds: params.workerIds,
    });
  }

  private async cleanupManagedBuiltinConfigsIfNeeded(params: {
    spaceId: string;
    serviceId: string;
    removedKeys: string[];
  }): Promise<void> {
    if (!params.removedKeys.includes(TAKOS_ACCESS_TOKEN_ENV_NAME)) {
      return;
    }

    const remaining = await this.listServiceLinks(params.spaceId, params.serviceId);
    const stillLinked = remaining.some((row) => normalizeEnvName(row.env_name) === TAKOS_ACCESS_TOKEN_ENV_NAME);
    if (!stillLinked) {
      await deleteManagedTakosTokenConfig({
        env: this.env,
        spaceId: params.spaceId,
        serviceId: params.serviceId,
        envName: TAKOS_ACCESS_TOKEN_ENV_NAME,
      });
    }
  }

  private async listManualLinkKeys(spaceId: string, serviceId: string): Promise<Set<string>> {
    const rows = await this.db.select({ envName: serviceCommonEnvLinks.envName })
      .from(serviceCommonEnvLinks)
      .where(and(
        eq(serviceCommonEnvLinks.accountId, spaceId),
        eq(serviceCommonEnvLinks.serviceId, serviceId),
        eq(serviceCommonEnvLinks.source, 'manual'),
      ))
      .all();
    return new Set(rows.map((row) => normalizeEnvName(row.envName)));
  }

  private async mutateManualLinks(params: {
    spaceId: string;
    serviceId: string;
    toAdd: string[];
    toRemove: string[];
    actor?: CommonEnvAuditActor;
    trigger: 'manual_links_set' | 'manual_links_patch';
  }): Promise<{ added: string[]; removed: string[] }> {
    if (params.toAdd.length === 0 && params.toRemove.length === 0) {
      return { added: [], removed: [] };
    }

    const timestamp = now();
    let addedOut: string[] = [];
    let removedOut: string[] = [];

    await this.runInTransaction(async () => {
      const actuallyAdded: string[] = [];
      const actuallyRemoved: string[] = [];

      for (const key of params.toAdd) {
        const result = await this.db.insert(serviceCommonEnvLinks)
          .values({
            id: generateId(),
            accountId: params.spaceId,
            serviceId: params.serviceId,
            envName: key,
            source: 'manual',
            lastAppliedFingerprint: null,
            syncState: 'pending',
            syncReason: 'link_created',
            createdAt: timestamp,
            updatedAt: timestamp,
            stateUpdatedAt: timestamp,
          })
          .onConflictDoNothing({
            target: [serviceCommonEnvLinks.serviceId, serviceCommonEnvLinks.envName, serviceCommonEnvLinks.source],
          });
        const changes = getChanges(result);
        if (changes <= 0) continue;
        actuallyAdded.push(key);
        await writeCommonEnvAuditLog({
          db: this.env.DB,
          spaceId: params.spaceId,
          eventType: 'worker_link_added',
          envName: key,
          serviceId: params.serviceId,
          linkSource: 'manual',
          changeBefore: { linked: false },
          changeAfter: { linked: true },
          actor: params.actor,
        });
      }

      if (params.toRemove.length > 0) {
        const removableRows = await this.db.select({
          id: serviceCommonEnvLinks.id,
          envName: serviceCommonEnvLinks.envName,
        })
          .from(serviceCommonEnvLinks)
          .where(and(
            eq(serviceCommonEnvLinks.accountId, params.spaceId),
            eq(serviceCommonEnvLinks.serviceId, params.serviceId),
            eq(serviceCommonEnvLinks.source, 'manual'),
            inArray(sql`UPPER(${serviceCommonEnvLinks.envName})`, params.toRemove),
          ))
          .all();

        if (removableRows.length > 0) {
          const removableIds = removableRows.map((row) => row.id);
          await this.db.delete(serviceCommonEnvLinks)
            .where(and(
              eq(serviceCommonEnvLinks.accountId, params.spaceId),
              eq(serviceCommonEnvLinks.serviceId, params.serviceId),
              eq(serviceCommonEnvLinks.source, 'manual'),
              inArray(serviceCommonEnvLinks.id, removableIds),
            ));

          for (const row of removableRows) {
            const key = normalizeEnvName(row.envName);
            actuallyRemoved.push(key);
            if (key === TAKOS_ACCESS_TOKEN_ENV_NAME) {
              await deleteManagedTakosTokenConfig({
                env: this.env,
                spaceId: params.spaceId,
                serviceId: params.serviceId,
                envName: key,
              });
            }
            await writeCommonEnvAuditLog({
              db: this.env.DB,
              spaceId: params.spaceId,
              eventType: 'worker_link_removed',
              envName: key,
              serviceId: params.serviceId,
              linkSource: 'manual',
              changeBefore: { linked: true },
              changeAfter: { linked: false },
              actor: params.actor,
            });
          }
        }
      }

      const changedKeys = uniqueEnvNames([...actuallyAdded, ...actuallyRemoved]);
      if (changedKeys.length > 0) {
        await this.enqueueServiceReconcile({
          spaceId: params.spaceId,
          serviceId: params.serviceId,
          targetKeys: changedKeys,
          trigger: params.trigger,
        });
      }

      addedOut = uniqueEnvNames(actuallyAdded);
      removedOut = uniqueEnvNames(actuallyRemoved);
    });

    await this.cleanupManagedBuiltinConfigsIfNeeded({
      spaceId: params.spaceId,
      serviceId: params.serviceId,
      removedKeys: removedOut,
    });

    return { added: addedOut, removed: removedOut };
  }

  async setWorkerManualLinks(params: {
    spaceId: string;
    workerId: string;
    keys: string[];
    actor?: CommonEnvAuditActor;
  }): Promise<void> {
    await this.setServiceManualLinks({
      spaceId: params.spaceId,
      serviceId: params.workerId,
      keys: params.keys,
      actor: params.actor,
    });
  }

  async setServiceManualLinks(params: {
    spaceId: string;
    serviceId: string;
    keys: string[];
    actor?: CommonEnvAuditActor;
  }): Promise<void> {
    const manualKeys = uniqueEnvNames(params.keys || []);
    const currentSet = await this.listManualLinkKeys(params.spaceId, params.serviceId);
    const incomingSet = new Set(manualKeys);

    const toAdd = manualKeys.filter((key) => !currentSet.has(key));
    const toRemove = Array.from(currentSet.values()).filter((key) => !incomingSet.has(key));
    await this.mutateManualLinks({
      spaceId: params.spaceId,
      serviceId: params.serviceId,
      toAdd,
      toRemove,
      actor: params.actor,
      trigger: 'manual_links_set',
    });
  }

  async patchWorkerManualLinks(params: {
    spaceId: string;
    workerId: string;
    add?: string[];
    remove?: string[];
    set?: string[];
    actor?: CommonEnvAuditActor;
  }): Promise<{ added: string[]; removed: string[] }> {
    return this.patchServiceManualLinks({
      spaceId: params.spaceId,
      serviceId: params.workerId,
      add: params.add,
      remove: params.remove,
      set: params.set,
      actor: params.actor,
    });
  }

  async patchServiceManualLinks(params: {
    spaceId: string;
    serviceId: string;
    add?: string[];
    remove?: string[];
    set?: string[];
    actor?: CommonEnvAuditActor;
  }): Promise<{ added: string[]; removed: string[] }> {
    if (params.set && ((params.add && params.add.length > 0) || (params.remove && params.remove.length > 0))) {
      throw new Error('set cannot be combined with add/remove');
    }
    if (params.set) {
      await this.setServiceManualLinks({
        spaceId: params.spaceId,
        serviceId: params.serviceId,
        keys: params.set,
        actor: params.actor,
      });
      return { added: [], removed: [] };
    }

    const add = uniqueEnvNames(params.add || []);
    const remove = uniqueEnvNames(params.remove || []);
    const overlap = add.filter((k) => remove.includes(k));
    if (overlap.length > 0) {
      throw new Error(`Cannot add and remove the same key: ${overlap.join(', ')}`);
    }

    const currentSet = await this.listManualLinkKeys(params.spaceId, params.serviceId);

    const toAdd = add.filter((k) => !currentSet.has(k));
    const toRemove = remove.filter((k) => currentSet.has(k));
    return this.mutateManualLinks({
      spaceId: params.spaceId,
      serviceId: params.serviceId,
      toAdd,
      toRemove,
      actor: params.actor,
      trigger: 'manual_links_patch',
    });
  }

  async markRequiredKeysLocallyOverridden(params: {
    spaceId: string;
    workerId: string;
    keys: string[];
    actor?: CommonEnvAuditActor;
  }): Promise<void> {
    await this.markRequiredKeysLocallyOverriddenForService({
      spaceId: params.spaceId,
      serviceId: params.workerId,
      keys: params.keys,
      actor: params.actor,
    });
  }

  async markRequiredKeysLocallyOverriddenForService(params: {
    spaceId: string;
    serviceId: string;
    keys: string[];
    actor?: CommonEnvAuditActor;
  }): Promise<void> {
    const keys = uniqueEnvNames(params.keys || []);
    if (keys.length === 0) return;

    const targetRows = await this.db.select({
      id: serviceCommonEnvLinks.id,
      envName: serviceCommonEnvLinks.envName,
      syncState: serviceCommonEnvLinks.syncState,
    })
      .from(serviceCommonEnvLinks)
      .where(and(
        eq(serviceCommonEnvLinks.accountId, params.spaceId),
        eq(serviceCommonEnvLinks.serviceId, params.serviceId),
        eq(serviceCommonEnvLinks.source, 'required'),
        inArray(sql`UPPER(${serviceCommonEnvLinks.envName})`, keys),
      ))
      .all();
    const rows = targetRows.filter((row) => row.syncState !== 'overridden');
    if (rows.length === 0) {
      return;
    }

    const rowIds = rows.map((row) => row.id);
    const changedKeys = rows.map((row) => normalizeEnvName(row.envName));
    const timestamp = now();

    await this.runInTransaction(async () => {
      await this.db.update(serviceCommonEnvLinks)
        .set({
          syncState: 'overridden',
          syncReason: 'user_override',
          stateUpdatedAt: timestamp,
          updatedAt: timestamp,
        })
        .where(inArray(serviceCommonEnvLinks.id, rowIds));

      for (const row of rows) {
        const canonicalKey = normalizeEnvName(row.envName);
        await writeCommonEnvAuditLog({
          db: this.env.DB,
          spaceId: params.spaceId,
          eventType: 'required_link_overridden',
          envName: canonicalKey,
          serviceId: params.serviceId,
          linkSource: 'required',
          changeBefore: { sync_state: row.syncState as SyncState },
          changeAfter: { sync_state: 'overridden' },
          actor: params.actor,
        });
      }

      await this.enqueueServiceReconcile({
        spaceId: params.spaceId,
        serviceId: params.serviceId,
        targetKeys: changedKeys,
        trigger: 'worker_env_patch',
      });
    });
  }

  async enqueueServiceReconcile(params: {
    spaceId: string;
    serviceId: string;
    targetKeys?: string[];
    trigger: CommonEnvReconcileTrigger;
  }): Promise<void> {
    await this.orchestrator.enqueueServiceReconcile({
      spaceId: params.spaceId,
      serviceId: params.serviceId,
      targetKeys: params.targetKeys,
      trigger: params.trigger,
    });
  }

  async enqueueWorkerReconcile(params: {
    spaceId: string;
    workerId: string;
    targetKeys?: string[];
    trigger: CommonEnvReconcileTrigger;
  }): Promise<void> {
    await this.enqueueServiceReconcile({
      spaceId: params.spaceId,
      serviceId: params.workerId,
      targetKeys: params.targetKeys,
      trigger: params.trigger,
    });
  }

  async reconcileWorkersForEnvKey(
    spaceId: string,
    envNameRaw: string,
    trigger: CommonEnvReconcileTrigger = 'workspace_env_put'
  ): Promise<void> {
    await this.orchestrator.reconcileServicesForEnvKey(spaceId, envNameRaw, trigger);
  }

  async reconcileServicesForEnvKey(
    spaceId: string,
    envNameRaw: string,
    trigger: CommonEnvReconcileTrigger = 'workspace_env_put'
  ): Promise<void> {
    await this.orchestrator.reconcileServicesForEnvKey(spaceId, envNameRaw, trigger);
  }

  async reconcileWorkers(params: {
    spaceId: string;
    workerIds: string[];
    keys?: string[];
    trigger?: CommonEnvReconcileTrigger;
  }): Promise<void> {
    await this.orchestrator.reconcileServices({
      spaceId: params.spaceId,
      serviceIds: params.workerIds,
      keys: params.keys,
      trigger: params.trigger,
    });
  }

  async reconcileServices(params: {
    spaceId: string;
    serviceIds: string[];
    keys?: string[];
    trigger?: CommonEnvReconcileTrigger;
  }): Promise<void> {
    await this.orchestrator.reconcileServices({
      spaceId: params.spaceId,
      serviceIds: params.serviceIds,
      keys: params.keys,
      trigger: params.trigger,
    });
  }

  async processReconcileJobs(limit = 50): Promise<{ processed: number; completed: number; retried: number }> {
    return this.orchestrator.processReconcileJobs(limit);
  }

  async enqueuePeriodicDriftSweep(limit = 100): Promise<number> {
    return this.orchestrator.enqueuePeriodicDriftSweep(limit);
  }

  async reconcileWorkerCommonEnv(
    spaceId: string,
    workerId: string,
    options?: {
      targetKeys?: Set<string>;
      trigger?: CommonEnvReconcileTrigger;
    }
  ): Promise<void> {
    await this.reconcileServiceCommonEnv(spaceId, workerId, options);
  }

  async reconcileServiceCommonEnv(
    spaceId: string,
    serviceId: string,
    options?: {
      targetKeys?: Set<string>;
      trigger?: CommonEnvReconcileTrigger;
    }
  ): Promise<void> {
    await this.reconciler.reconcileServiceCommonEnv(spaceId, serviceId, options);
  }
}

export function createCommonEnvService(env: Env): CommonEnvService {
  return new CommonEnvService(env);
}

export { CommonEnvService as ServiceCommonEnvService };
