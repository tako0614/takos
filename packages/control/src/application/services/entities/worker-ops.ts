/**
 * Worker entity operations for the control plane.
 *
 * Deploys / deletes Cloudflare Workers via the CF Management API
 * (Workers Script API) and records state in group_entities.
 *
 * Runs inside Cloudflare Workers -- no subprocess / wrangler CLI available.
 * Worker upload uses the CF Workers API directly (PUT /workers/scripts/:name).
 */

import { eq, and } from 'drizzle-orm';
import { getDb } from '../../../infra/db/client.ts';
import { groupEntities } from '../../../infra/db/schema-groups.ts';
import {
  createCloudflareApiClient,
  type CloudflareApiClient,
} from '../cloudflare/api-client.ts';
import { generateId } from '../../../shared/utils/index.ts';
import type { Env } from '../../../shared/types/env.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WorkerEntityResult {
  name: string;
  scriptName: string;
  deployedAt: string;
  codeHash: string;
}

export interface WorkerEntityInfo {
  id: string;
  groupId: string;
  name: string;
  category: string;
  config: WorkerConfig;
  createdAt: string;
  updatedAt: string;
}

interface WorkerConfig {
  scriptName: string;
  deployedAt: string;
  codeHash: string;
  dispatchNamespace?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function workerScriptName(groupName: string, envName: string, workerName: string): string {
  return `${groupName}-${envName}-${workerName}`;
}

function requireCfClient(env: Env): CloudflareApiClient {
  const client = createCloudflareApiClient(env);
  if (!client) {
    throw new Error('CF_ACCOUNT_ID and CF_API_TOKEN are required for worker deployment');
  }
  return client;
}

// ---------------------------------------------------------------------------
// CF Worker deployment via API
// ---------------------------------------------------------------------------

/**
 * Deploy a worker script via the CF API.
 *
 * For now this creates a placeholder script. The real bundle upload
 * will be handled by the artifact-io / execute pipeline which already
 * knows how to build FormData with modules and metadata.
 */
async function uploadWorkerScript(
  client: CloudflareApiClient,
  scriptName: string,
  opts: {
    dispatchNamespace?: string;
  },
): Promise<void> {
  const subpath = opts.dispatchNamespace
    ? `/workers/dispatch/namespaces/${opts.dispatchNamespace}/scripts/${scriptName}`
    : `/workers/scripts/${scriptName}`;

  // PUT with multipart form data.
  // Actual bundle content will be supplied by the caller; for entity-ops
  // we record the intent. The real upload is done in execute.ts / provider.ts
  // which already handle the FormData construction.
  // Here we do a minimal metadata-only upload to claim the script name.
  const metadata = {
    main_module: 'index.js',
    compatibility_date: '2025-01-01',
    compatibility_flags: ['nodejs_compat'],
  };

  const formData = new FormData();
  formData.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
  );
  formData.append(
    'index.js',
    new Blob(['export default { fetch() { return new Response("ok"); } };'], {
      type: 'application/javascript+module',
    }),
  );

  await client.fetchRaw(
    `/accounts/${client.accountId}${subpath}`,
    {
      method: 'PUT',
      body: formData,
      // Do not set Content-Type -- let the browser/runtime set it with the boundary
      headers: {},
    },
  );
}

async function deleteWorkerScript(
  client: CloudflareApiClient,
  scriptName: string,
  dispatchNamespace?: string,
): Promise<void> {
  const subpath = dispatchNamespace
    ? `/workers/dispatch/namespaces/${dispatchNamespace}/scripts/${scriptName}`
    : `/workers/scripts/${scriptName}`;

  await client.accountDelete(subpath);
}

// ---------------------------------------------------------------------------
// deployWorker
// ---------------------------------------------------------------------------

export async function deployWorker(
  env: Env,
  groupId: string,
  name: string,
  opts: {
    groupName?: string;
    envName?: string;
    codeHash?: string;
    dispatchNamespace?: string;
    /** If true, skip the actual CF API call (for when the upload is done elsewhere). */
    skipUpload?: boolean;
  },
): Promise<WorkerEntityResult> {
  const scriptName = workerScriptName(opts.groupName ?? groupId, opts.envName ?? 'default', name);
  const now = new Date().toISOString();
  const codeHash = opts.codeHash ?? '';

  if (!opts.skipUpload) {
    const client = requireCfClient(env);
    await uploadWorkerScript(client, scriptName, {
      dispatchNamespace: opts.dispatchNamespace,
    });
  }

  const config: WorkerConfig = {
    scriptName,
    deployedAt: now,
    codeHash,
    ...(opts.dispatchNamespace ? { dispatchNamespace: opts.dispatchNamespace } : {}),
  };

  const db = getDb(env.DB);

  // Upsert: if entity already exists, update it
  const existing = await db
    .select()
    .from(groupEntities)
    .where(
      and(
        eq(groupEntities.groupId, groupId),
        eq(groupEntities.category, 'worker'),
        eq(groupEntities.name, name),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(groupEntities)
      .set({ config: JSON.stringify(config) })
      .where(eq(groupEntities.id, existing[0].id));
  } else {
    await db.insert(groupEntities).values({
      id: generateId(),
      groupId,
      category: 'worker',
      name,
      config: JSON.stringify(config),
    });
  }

  return { name, scriptName, deployedAt: now, codeHash };
}

// ---------------------------------------------------------------------------
// deleteWorker
// ---------------------------------------------------------------------------

export async function deleteWorker(
  env: Env,
  groupId: string,
  name: string,
): Promise<void> {
  const db = getDb(env.DB);

  const rows = await db
    .select()
    .from(groupEntities)
    .where(
      and(
        eq(groupEntities.groupId, groupId),
        eq(groupEntities.category, 'worker'),
        eq(groupEntities.name, name),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    throw new Error(`Worker entity "${name}" not found in group ${groupId}`);
  }

  const row = rows[0];
  const config = JSON.parse(row.config) as WorkerConfig;

  try {
    const client = createCloudflareApiClient(env);
    if (client) {
      await deleteWorkerScript(client, config.scriptName, config.dispatchNamespace);
    }
  } catch (error) {
    console.warn(`Failed to delete CF worker "${config.scriptName}":`, error);
  }

  await db.delete(groupEntities).where(eq(groupEntities.id, row.id));
}

// ---------------------------------------------------------------------------
// listWorkers
// ---------------------------------------------------------------------------

export async function listWorkers(
  env: Env,
  groupId: string,
): Promise<WorkerEntityInfo[]> {
  const db = getDb(env.DB);

  const rows = await db
    .select()
    .from(groupEntities)
    .where(
      and(
        eq(groupEntities.groupId, groupId),
        eq(groupEntities.category, 'worker'),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    groupId: row.groupId,
    name: row.name,
    category: row.category,
    config: JSON.parse(row.config) as WorkerConfig,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}
