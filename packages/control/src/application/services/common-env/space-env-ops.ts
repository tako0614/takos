import { eq, and, sql } from 'drizzle-orm';
import type { Env } from '../../../shared/types/index.ts';
import { ConflictError } from 'takos-common/errors';
import { generateId } from '../../../shared/utils/index.ts';
import type { D1TransactionManager } from '../../../shared/utils/db-transaction.ts';
import {
  decryptCommonEnvValue,
  encryptCommonEnvValue,
  normalizeEnvName,
} from './crypto.ts';
import { writeCommonEnvAuditLog, type CommonEnvAuditActor } from './audit.ts';
import { listSpaceEnvRows } from './repository.ts';
import { assertSpaceCommonEnvKeyAllowed, getChanges } from './link-state.ts';
import { getDb, accountEnvVars } from '../../../infra/db/index.ts';

export interface SpaceEnvDeps {
  env: Env;
  txManager: D1TransactionManager;
}

export async function listSpaceCommonEnv(deps: SpaceEnvDeps, spaceId: string): Promise<Array<{
  name: string;
  secret: boolean;
  value: string;
  updatedAt: string;
}>> {
  const rows = await listSpaceEnvRows(deps.env, spaceId);
  const out: Array<{ name: string; secret: boolean; value: string; updatedAt: string }> = [];
  const dedupe = new Set<string>();

  for (const row of rows) {
    const canonicalName = normalizeEnvName(row.name);
    if (dedupe.has(canonicalName)) {
      throw new ConflictError(`Conflicting common env entries exist for key: ${canonicalName}`);
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
    const value = await decryptCommonEnvValue(deps.env, row);
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

export async function upsertSpaceCommonEnv(deps: SpaceEnvDeps, params: {
  spaceId: string;
  name: string;
  value: string;
  secret?: boolean;
  actor?: CommonEnvAuditActor;
}): Promise<void> {
  const spaceId = params.spaceId;
  const name = normalizeEnvName(params.name);
  assertSpaceCommonEnvKeyAllowed(name);
  const nextValue = String(params.value ?? '');
  const timestamp = new Date().toISOString();
  const encrypted = await encryptCommonEnvValue(deps.env, spaceId, name, nextValue);

  const existing = await getDb(deps.env.DB).select({
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
    throw new ConflictError(`Conflicting common env entries exist for key: ${name}`);
  }

  if (existing.length === 1) {
    const row = existing[0];
    const existingValue = await decryptCommonEnvValue(deps.env, {
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

    await deps.txManager.runInTransaction(async () => {
      await getDb(deps.env.DB).update(accountEnvVars)
        .set({
          name,
          valueEncrypted: encrypted,
          isSecret: nextSecret,
          updatedAt: timestamp,
        })
        .where(eq(accountEnvVars.id, row.id));

      await writeCommonEnvAuditLog({
        db: deps.env.DB,
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
    await deps.txManager.runInTransaction(async () => {
      await getDb(deps.env.DB).insert(accountEnvVars)
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
        db: deps.env.DB,
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

export async function ensureSystemCommonEnv(deps: SpaceEnvDeps, spaceId: string, entries: Array<{
  name: string;
  value: string;
  secret?: boolean;
}>): Promise<void> {
  for (const entry of entries) {
    const name = normalizeEnvName(entry.name);
    const value = String(entry.value ?? '');
    const isSecret = entry.secret === true;
    const encrypted = await encryptCommonEnvValue(deps.env, spaceId, name, value);
    const timestamp = new Date().toISOString();

    await deps.txManager.runInTransaction(async () => {
      const result = await getDb(deps.env.DB).insert(accountEnvVars)
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
        db: deps.env.DB,
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

export async function deleteSpaceCommonEnv(deps: SpaceEnvDeps, spaceId: string, nameRaw: string, actor?: CommonEnvAuditActor): Promise<boolean> {
  const name = normalizeEnvName(nameRaw);
  assertSpaceCommonEnvKeyAllowed(name);
  const existing = await getDb(deps.env.DB).select({
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
  await deps.txManager.runInTransaction(async () => {
    const result = await getDb(deps.env.DB).delete(accountEnvVars)
      .where(eq(accountEnvVars.id, existing.id));
    const changes = getChanges(result);
    if (changes <= 0) return;
    deleted = true;
    await writeCommonEnvAuditLog({
      db: deps.env.DB,
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
