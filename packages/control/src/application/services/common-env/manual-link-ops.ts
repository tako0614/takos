import { eq, and, inArray, sql } from 'drizzle-orm';
import type { Env } from '../../../shared/types/index.ts';
import { BadRequestError } from 'takos-common/errors';
import { generateId } from '../../../shared/utils/index.ts';
import type { D1TransactionManager } from '../../../shared/utils/db-transaction.ts';
import { normalizeEnvName, uniqueEnvNames } from './crypto.ts';
import { writeCommonEnvAuditLog, type CommonEnvAuditActor } from './audit.ts';
import { listServiceLinks, type SyncState } from './repository.ts';
import type { CommonEnvOrchestrator } from './orchestrator.ts';
import type { CommonEnvReconcileTrigger } from './reconcile-jobs.ts';
import { getChanges } from './link-state.ts';
import {
  deleteManagedTakosTokenConfig,
  upsertManagedTakosTokenConfig,
  TAKOS_ACCESS_TOKEN_ENV_NAME,
} from './takos-builtins.ts';
import { getDb, serviceCommonEnvLinks } from '../../../infra/db/index.ts';


export interface ManualLinkDeps {
  env: Env;
  txManager: D1TransactionManager;
  orchestrator: CommonEnvOrchestrator;
}

async function enqueueServiceReconcile(deps: ManualLinkDeps, params: {
  spaceId: string;
  serviceId: string;
  targetKeys?: string[];
  trigger: CommonEnvReconcileTrigger;
}): Promise<void> {
  await deps.orchestrator.enqueueServiceReconcile({
    spaceId: params.spaceId,
    serviceId: params.serviceId,
    targetKeys: params.targetKeys,
    trigger: params.trigger,
  });
}

// --- Takos builtin config operations ---

export async function upsertServiceTakosAccessTokenConfig(deps: ManualLinkDeps, params: {
  spaceId: string;
  serviceId: string;
  scopes: string[];
}): Promise<void> {
  await upsertManagedTakosTokenConfig({
    env: deps.env,
    spaceId: params.spaceId,
    serviceId: params.serviceId,
    scopes: params.scopes,
  });
  await enqueueServiceReconcile(deps, {
    spaceId: params.spaceId,
    serviceId: params.serviceId,
    targetKeys: [TAKOS_ACCESS_TOKEN_ENV_NAME],
    trigger: 'manual_links_patch',
  });
}

export async function deleteServiceTakosAccessTokenConfig(deps: ManualLinkDeps, params: {
  spaceId: string;
  serviceId: string;
}): Promise<void> {
  await deleteManagedTakosTokenConfig({
    env: deps.env,
    spaceId: params.spaceId,
    serviceId: params.serviceId,
    envName: TAKOS_ACCESS_TOKEN_ENV_NAME,
  });
  await enqueueServiceReconcile(deps, {
    spaceId: params.spaceId,
    serviceId: params.serviceId,
    targetKeys: [TAKOS_ACCESS_TOKEN_ENV_NAME],
    trigger: 'manual_links_patch',
  });
}

export async function deleteServiceTakosAccessTokenConfigs(deps: ManualLinkDeps, params: {
  spaceId: string;
  serviceIds: string[];
}): Promise<void> {
  await Promise.all(params.serviceIds.map((serviceId) =>
    deleteManagedTakosTokenConfig({
      env: deps.env,
      spaceId: params.spaceId,
      serviceId,
      envName: TAKOS_ACCESS_TOKEN_ENV_NAME,
    })
  ));
}

async function cleanupManagedBuiltinConfigsIfNeeded(deps: ManualLinkDeps, params: {
  spaceId: string;
  serviceId: string;
  removedKeys: string[];
}): Promise<void> {
  if (!params.removedKeys.includes(TAKOS_ACCESS_TOKEN_ENV_NAME)) {
    return;
  }

  const remaining = await listServiceLinks(deps.env, params.spaceId, params.serviceId);
  const stillLinked = remaining.some((row) => normalizeEnvName(row.env_name) === TAKOS_ACCESS_TOKEN_ENV_NAME);
  if (!stillLinked) {
    await deleteManagedTakosTokenConfig({
      env: deps.env,
      spaceId: params.spaceId,
      serviceId: params.serviceId,
      envName: TAKOS_ACCESS_TOKEN_ENV_NAME,
    });
  }
}

// --- Manual link key helpers ---

export async function listManualLinkKeys(deps: ManualLinkDeps, spaceId: string, serviceId: string): Promise<Set<string>> {
  const rows = await getDb(deps.env.DB).select({ envName: serviceCommonEnvLinks.envName })
    .from(serviceCommonEnvLinks)
    .where(and(
      eq(serviceCommonEnvLinks.accountId, spaceId),
      eq(serviceCommonEnvLinks.serviceId, serviceId),
      eq(serviceCommonEnvLinks.source, 'manual'),
    ))
    .all();
  return new Set(rows.map((row) => normalizeEnvName(row.envName)));
}

// --- Manual link mutations ---

export async function mutateManualLinks(deps: ManualLinkDeps, params: {
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

  const timestamp = new Date().toISOString();
  let addedOut: string[] = [];
  let removedOut: string[] = [];

  await deps.txManager.runInTransaction(async () => {
    const actuallyAdded: string[] = [];
    const actuallyRemoved: string[] = [];

    for (const key of params.toAdd) {
      const result = await getDb(deps.env.DB).insert(serviceCommonEnvLinks)
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
        db: deps.env.DB,
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
      const removableRows = await getDb(deps.env.DB).select({
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
        await getDb(deps.env.DB).delete(serviceCommonEnvLinks)
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
              env: deps.env,
              spaceId: params.spaceId,
              serviceId: params.serviceId,
              envName: key,
            });
          }
          await writeCommonEnvAuditLog({
            db: deps.env.DB,
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
      await enqueueServiceReconcile(deps, {
        spaceId: params.spaceId,
        serviceId: params.serviceId,
        targetKeys: changedKeys,
        trigger: params.trigger,
      });
    }

    addedOut = uniqueEnvNames(actuallyAdded);
    removedOut = uniqueEnvNames(actuallyRemoved);
  });

  await cleanupManagedBuiltinConfigsIfNeeded(deps, {
    spaceId: params.spaceId,
    serviceId: params.serviceId,
    removedKeys: removedOut,
  });

  return { added: addedOut, removed: removedOut };
}

export async function setServiceManualLinks(deps: ManualLinkDeps, params: {
  spaceId: string;
  serviceId: string;
  keys: string[];
  actor?: CommonEnvAuditActor;
}): Promise<void> {
  const manualKeys = uniqueEnvNames(params.keys || []);
  const currentSet = await listManualLinkKeys(deps, params.spaceId, params.serviceId);
  const incomingSet = new Set(manualKeys);

  const toAdd = manualKeys.filter((key) => !currentSet.has(key));
  const toRemove = Array.from(currentSet.values()).filter((key) => !incomingSet.has(key));
  await mutateManualLinks(deps, {
    spaceId: params.spaceId,
    serviceId: params.serviceId,
    toAdd,
    toRemove,
    actor: params.actor,
    trigger: 'manual_links_set',
  });
}

export async function patchServiceManualLinks(deps: ManualLinkDeps, params: {
  spaceId: string;
  serviceId: string;
  add?: string[];
  remove?: string[];
  set?: string[];
  actor?: CommonEnvAuditActor;
}): Promise<{ added: string[]; removed: string[] }> {
  if (params.set && ((params.add && params.add.length > 0) || (params.remove && params.remove.length > 0))) {
    throw new BadRequestError('set cannot be combined with add/remove');
  }
  if (params.set) {
    await setServiceManualLinks(deps, {
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
    throw new BadRequestError(`Cannot add and remove the same key: ${overlap.join(', ')}`);
  }

  const currentSet = await listManualLinkKeys(deps, params.spaceId, params.serviceId);

  const toAdd = add.filter((k) => !currentSet.has(k));
  const toRemove = remove.filter((k) => currentSet.has(k));
  return mutateManualLinks(deps, {
    spaceId: params.spaceId,
    serviceId: params.serviceId,
    toAdd,
    toRemove,
    actor: params.actor,
    trigger: 'manual_links_patch',
  });
}

export async function markRequiredKeysLocallyOverriddenForService(deps: ManualLinkDeps, params: {
  spaceId: string;
  serviceId: string;
  keys: string[];
  actor?: CommonEnvAuditActor;
}): Promise<void> {
  const keys = uniqueEnvNames(params.keys || []);
  if (keys.length === 0) return;

  const targetRows = await getDb(deps.env.DB).select({
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
  const timestamp = new Date().toISOString();

  await deps.txManager.runInTransaction(async () => {
    await getDb(deps.env.DB).update(serviceCommonEnvLinks)
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
        db: deps.env.DB,
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

    await enqueueServiceReconcile(deps, {
      spaceId: params.spaceId,
      serviceId: params.serviceId,
      targetKeys: changedKeys,
      trigger: 'worker_env_patch',
    });
  });
}
