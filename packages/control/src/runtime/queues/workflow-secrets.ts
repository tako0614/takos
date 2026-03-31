import type { D1Database } from '../../shared/types/bindings.ts';
import { getDb, workflowSecrets } from '../../infra/db/index.ts';
import { eq, and, inArray } from 'drizzle-orm';
import { decrypt } from '../../shared/utils/index.ts';
import { logError } from '../../shared/utils/logger.ts';

// ---------------------------------------------------------------------------
// Secret resolution
// ---------------------------------------------------------------------------

const SECRET_REFERENCE_PATTERN = /\${{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*}}/g;

export async function resolveSecretValues(
  db: D1Database,
  repoId: string,
  secretIds: string[],
  encryptionKey?: string,
  requiredSecretNames: string[] = []
): Promise<Record<string, string>> {
  if (requiredSecretNames.length > 0 && !encryptionKey) {
    throw new Error('Encryption key is required to resolve referenced workflow secrets');
  }

  if (!encryptionKey) return {};
  if (!secretIds || secretIds.length === 0) {
    if (requiredSecretNames.length > 0) {
      throw new Error(`Missing referenced secrets: ${requiredSecretNames.join(', ')}`);
    }
    return {};
  }

  const drizzle = getDb(db);
  const secretRecords = await drizzle.select({ id: workflowSecrets.id, name: workflowSecrets.name, encryptedValue: workflowSecrets.encryptedValue })
    .from(workflowSecrets).where(and(eq(workflowSecrets.repoId, repoId), inArray(workflowSecrets.id, secretIds))).all();

  const secrets: Record<string, string> = {};
  for (const secret of secretRecords) {
    try {
      const encrypted = JSON.parse(secret.encryptedValue);
      const value = await decrypt(encrypted, encryptionKey, `secret:${repoId}:${secret.name}`);
      secrets[secret.name] = value;
    } catch (err) {
      logError(`Failed to decrypt secret ${secret.name}`, err, { module: 'queues/workflow-jobs' });
    }
  }

  if (requiredSecretNames.length > 0) {
    const missingSecrets = requiredSecretNames.filter((name) => secrets[name] === undefined);
    if (missingSecrets.length > 0) {
      throw new Error(`Missing referenced secrets: ${missingSecrets.join(', ')}`);
    }
  }

  return secrets;
}

export function collectReferencedSecretNamesFromEnv(jobEnv: Record<string, string>): string[] {
  const names = new Set<string>();

  collectSecretNamesFromEnv(jobEnv, names);

  return Array.from(names).sort();
}

function collectSecretNamesFromEnv(
  env: Record<string, string> | undefined,
  names: Set<string>
): void {
  if (!env) return;

  for (const value of Object.values(env)) {
    SECRET_REFERENCE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SECRET_REFERENCE_PATTERN.exec(value)) !== null) {
      names.add(match[1]);
    }
  }
}
