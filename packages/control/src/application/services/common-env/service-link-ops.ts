import { eq, and, sql } from 'drizzle-orm';
import type { Env } from '../../../shared/types';
import { generateId } from '../../../shared/utils';
import type { D1TransactionManager } from '../../../shared/utils/db-transaction';
import { normalizeEnvName, uniqueEnvNames } from './crypto';
import { writeCommonEnvAuditLog, type CommonEnvAuditActor } from './audit';
import {
  listServiceLinks,
  listSpaceCommonEnvNames,
  type LinkSource,
  type ServiceLinkRow,
  type SyncState,
} from './repository';
import {
  buildLinkStateByName,
  getChanges,
  getEffectiveLinks,
} from './link-state';
import {
  listTakosBuiltinStatuses,
  type TakosBuiltinStatus,
  TAKOS_ACCESS_TOKEN_ENV_NAME,
} from './takos-builtins';
import { getDb, serviceCommonEnvLinks } from '../../../infra/db';
import { runInTransaction } from './db-utils';

export interface ServiceLinkDeps {
  env: Env;
  txManager: D1TransactionManager;
}

export async function ensureRequiredServiceLinks(deps: ServiceLinkDeps, params: {
  spaceId: string;
  serviceIds: string[];
  keys: string[];
  actor?: CommonEnvAuditActor;
}): Promise<void> {
  const spaceId = params.spaceId;
  const keys = uniqueEnvNames(params.keys || []);
  if (keys.length === 0 || params.serviceIds.length === 0) return;

  const timestamp = new Date().toISOString();
  await runInTransaction(deps, async () => {
    for (const serviceId of params.serviceIds) {
      for (const key of keys) {
        const result = await getDb(deps.env.DB).insert(serviceCommonEnvLinks)
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
          db: deps.env.DB,
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

export async function listServiceCommonEnvLinks(deps: ServiceLinkDeps, spaceId: string, serviceId: string): Promise<Array<{
  name: string;
  source: LinkSource;
  hasCommonValue: boolean;
  syncState: SyncState;
  syncReason: string | null;
}>> {
  const rows = await listServiceLinks(deps.env, spaceId, serviceId);
  const effective = getEffectiveLinks(rows);
  const commonNameSet = new Set(
    (await listSpaceCommonEnvNames(deps.env, spaceId)).map((name) => normalizeEnvName(name))
  );
  const builtinStatuses = await listTakosBuiltinStatuses({
    env: deps.env,
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

export async function listServiceManualLinkNames(deps: ServiceLinkDeps, spaceId: string, serviceId: string): Promise<string[]> {
  const rows = await getDb(deps.env.DB).select({ envName: serviceCommonEnvLinks.envName })
    .from(serviceCommonEnvLinks)
    .where(and(
      eq(serviceCommonEnvLinks.accountId, spaceId),
      eq(serviceCommonEnvLinks.serviceId, serviceId),
      eq(serviceCommonEnvLinks.source, 'manual'),
    ))
  .all();
  return uniqueEnvNames(rows.map((row) => row.envName));
}

export async function listServiceBuiltins(
  deps: ServiceLinkDeps,
  spaceId: string,
  serviceId: string,
): Promise<Record<string, TakosBuiltinStatus>> {
  const rows = await listServiceLinks(deps.env, spaceId, serviceId);
  return listTakosBuiltinStatuses({
    env: deps.env,
    spaceId,
    serviceId,
    linkStateByName: buildLinkStateByName(rows),
  });
}
