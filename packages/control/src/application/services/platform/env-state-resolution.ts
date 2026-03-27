import type { WorkerBinding } from '../../../platform/providers/cloudflare/wfp.ts';
import { InternalError, ConflictError } from '@takos/common/errors';
import { decrypt, type EncryptedData } from '../../../shared/utils/crypto';
import type { ReconcileUpdate } from '../common-env/repository';
import { CommonEnvRepository } from '../common-env/repository';
import {
  createBindingFingerprint,
  decryptCommonEnvValue,
  normalizeEnvName,
} from '../common-env/crypto';
import {
  ensureManagedTakosTokenValue,
  resolveTakosApiUrl,
  TAKOS_ACCESS_TOKEN_ENV_NAME,
  TAKOS_API_URL_ENV_NAME,
} from '../common-env/takos-builtins';
import { getDb, serviceEnvVars } from '../../../infra/db';
import { eq, and, desc } from 'drizzle-orm';
import { sortBindings, getEffectiveLinks } from './resource-bindings';
import type {
  DesiredStateEnv,
  ServiceEnvRow,
  ServiceLocalEnvVarState,
  CommonEnvValue,
} from './desired-state-types';

export function requireEncryptionKey(env: DesiredStateEnv): string {
  const key = env.ENCRYPTION_KEY || '';
  if (!key) {
    throw new InternalError('ENCRYPTION_KEY must be set');
  }
  return key;
}

export function buildServiceEnvSalt(serviceId: string, envName: string): string {
  return `service-env:${serviceId}:${normalizeEnvName(envName)}`;
}

export async function decryptServiceEnvRow(
  encryptionKey: string,
  row: ServiceEnvRow
): Promise<ServiceLocalEnvVarState> {
  let encrypted: EncryptedData;
  try {
    encrypted = JSON.parse(row.valueEncrypted) as EncryptedData;
  } catch (err) {
    throw new Error(`Failed to parse encrypted env var "${row.name}" for service ${row.serviceId}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const value = await decrypt(encrypted, encryptionKey, buildServiceEnvSalt(row.serviceId, row.name));
  return {
    name: normalizeEnvName(row.name),
    value,
    secret: row.isSecret,
    updated_at: row.updatedAt,
  };
}

async function loadSpaceCommonEnvMap(
  env: DesiredStateEnv,
  repo: CommonEnvRepository,
  spaceId: string
): Promise<Map<string, CommonEnvValue>> {
  const rows = await repo.listSpaceEnvRows(spaceId);
  const out = new Map<string, CommonEnvValue>();

  for (const row of rows) {
    const key = normalizeEnvName(row.name);
    if (out.has(key)) {
      throw new ConflictError(`Conflicting common env entries exist for key: ${key}`);
    }
    out.set(key, {
      value: await decryptCommonEnvValue(env, row),
      isSecret: row.is_secret,
    });
  }

  return out;
}

async function resolveManagedCommonEnvValue(
  env: DesiredStateEnv,
  spaceId: string,
  serviceId: string,
  envName: string,
): Promise<CommonEnvValue | null> {
  if (envName === TAKOS_API_URL_ENV_NAME) {
    const value = resolveTakosApiUrl(env);
    if (!value) return null;
    return { value, isSecret: false };
  }

  if (envName === TAKOS_ACCESS_TOKEN_ENV_NAME) {
    const resolved = await ensureManagedTakosTokenValue({
      env,
      spaceId,
      workerId: serviceId,
      envName,
    });
    if (!resolved) return null;
    return { value: resolved.value, isSecret: true };
  }

  return null;
}

export async function resolveServiceCommonEnvState(
  env: DesiredStateEnv,
  spaceId: string,
  serviceId: string
): Promise<{
  envBindings: WorkerBinding[];
  envVars: Record<string, string>;
  localEnvVars: ServiceLocalEnvVarState[];
  commonEnvUpdates: ReconcileUpdate[];
}> {
  const encryptionKey = requireEncryptionKey(env);
  const repo = new CommonEnvRepository(env);
  const db = getDb(env.DB);

  const envRows = await db.select({
    id: serviceEnvVars.id,
    serviceId: serviceEnvVars.serviceId,
    accountId: serviceEnvVars.accountId,
    name: serviceEnvVars.name,
    valueEncrypted: serviceEnvVars.valueEncrypted,
    isSecret: serviceEnvVars.isSecret,
    updatedAt: serviceEnvVars.updatedAt,
  })
    .from(serviceEnvVars)
    .where(and(
      eq(serviceEnvVars.accountId, spaceId),
      eq(serviceEnvVars.serviceId, serviceId),
    ))
    .orderBy(desc(serviceEnvVars.updatedAt), serviceEnvVars.name)
    .all();

  const localEnvVars = await Promise.all(
    envRows.map((row) => decryptServiceEnvRow(encryptionKey, row as ServiceEnvRow))
  );

  const localMap = new Map<string, ServiceLocalEnvVarState>();
  for (const row of localEnvVars) {
    localMap.set(row.name, row);
  }

  const envBindingMap = new Map<string, WorkerBinding>();
  for (const row of localEnvVars) {
    envBindingMap.set(row.name, {
      type: row.secret ? 'secret_text' : 'plain_text',
      name: row.name,
      text: row.value,
    });
  }

  const linkRows = await repo.listServiceLinks(spaceId, serviceId);
  const commonMap = await loadSpaceCommonEnvMap(env, repo, spaceId);
  const effectiveLinks = getEffectiveLinks(linkRows);
  const updates: ReconcileUpdate[] = [];

  for (const [key, link] of effectiveLinks.entries()) {
    const common = commonMap.get(key) || await resolveManagedCommonEnvValue(env, spaceId, serviceId, key);
    const local = localMap.get(key);

    if (!common) {
      updates.push({
        rowId: link.rowId,
        syncState: 'missing_builtin',
        syncReason: 'common_deleted',
        lastSyncError: null,
      });
      continue;
    }

    const desiredBinding: {
      type: 'plain_text' | 'secret_text';
      name: string;
      text: string;
    } = {
      type: common.isSecret ? 'secret_text' : 'plain_text',
      name: key,
      text: common.value,
    };
    const desiredFingerprint = await createBindingFingerprint({
      env,
      spaceId,
      envName: key,
      type: desiredBinding.type,
      text: desiredBinding.text,
    });

    if (link.source === 'manual') {
      envBindingMap.set(key, desiredBinding);
      updates.push({
        rowId: link.rowId,
        lastAppliedFingerprint: desiredFingerprint,
        lastObservedFingerprint: desiredFingerprint,
        syncState: 'managed',
        syncReason: 'link_created',
        lastSyncError: null,
      });
      continue;
    }

    if (local) {
      const localFingerprint = await createBindingFingerprint({
        env,
        spaceId,
        envName: key,
        type: local.secret ? 'secret_text' : 'plain_text',
        text: local.value,
      });
      updates.push({
        rowId: link.rowId,
        lastAppliedFingerprint: link.lastAppliedFingerprint ?? desiredFingerprint,
        lastObservedFingerprint: localFingerprint,
        syncState: 'overridden',
        syncReason: 'user_override',
        lastSyncError: null,
      });
      continue;
    }

    envBindingMap.set(key, desiredBinding);
    updates.push({
      rowId: link.rowId,
      lastAppliedFingerprint: desiredFingerprint,
      lastObservedFingerprint: desiredFingerprint,
      syncState: 'managed',
      syncReason: 'common_restored',
      lastSyncError: null,
    });
  }

  const envBindings = sortBindings(Array.from(envBindingMap.values()));
  const envVars: Record<string, string> = {};
  for (const binding of envBindings) {
    if (binding.type === 'plain_text' || binding.type === 'secret_text') {
      envVars[binding.name] = binding.text ?? '';
    }
  }

  return {
    envBindings,
    envVars,
    localEnvVars,
    commonEnvUpdates: updates,
  };
}
