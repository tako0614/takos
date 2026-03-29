/**
 * Worker entity operations for the control plane.
 *
 * Deploys / deletes Cloudflare Workers via the CF Management API
 * (Workers Script API) and records state in the canonical services table.
 *
 * Runs inside Cloudflare Workers -- no subprocess / wrangler CLI available.
 * Worker upload uses the CF Workers API directly (PUT /workers/scripts/:name).
 */

import {
  createCloudflareApiClient,
  type CloudflareApiClient,
} from '../cloudflare/api-client.ts';
import type { Env } from '../../../shared/types/env.ts';
import {
  buildManagedRouteRef,
  deleteGroupManagedService,
  findGroupManagedService,
  listGroupManagedServices,
  parseManagedServiceConfig,
  upsertGroupManagedService,
} from './group-managed-services.ts';
import { recordGroupManagedDeployment } from './group-managed-deployments.ts';

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
  specFingerprint?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    spaceId: string;
    groupName?: string;
    envName?: string;
    codeHash?: string;
    dispatchNamespace?: string;
    specFingerprint?: string;
    desiredSpec?: Record<string, unknown>;
    routeNames?: string[];
    dependsOn?: string[];
    /** If true, skip the actual CF API call (for when the upload is done elsewhere). */
    skipUpload?: boolean;
  },
): Promise<WorkerEntityResult> {
  const envName = opts.envName ?? 'default';
  const existing = await findGroupManagedService(env, groupId, name, 'worker');
  const scriptName = existing?.row.routeRef
    ?? buildManagedRouteRef(groupId, envName, 'worker', name);
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
    ...(opts.specFingerprint ? { specFingerprint: opts.specFingerprint } : {}),
    ...(opts.dispatchNamespace ? { dispatchNamespace: opts.dispatchNamespace } : {}),
  };
  const record = await upsertGroupManagedService(env, {
    groupId,
    spaceId: opts.spaceId,
    envName,
    componentKind: 'worker',
    manifestName: name,
    status: 'deployed',
    serviceType: 'app',
    workloadKind: 'worker-bundle',
    specFingerprint: opts.specFingerprint ?? '',
    desiredSpec: opts.desiredSpec ?? {},
    routeNames: opts.routeNames,
    dependsOn: opts.dependsOn,
    deployedAt: now,
    codeHash,
    dispatchNamespace: opts.dispatchNamespace,
  });

  await recordGroupManagedDeployment(env, {
    serviceId: record.row.id,
    spaceId: opts.spaceId,
    providerName: 'workers-dispatch',
    artifactKind: 'worker-bundle',
    routeRef: record.row.routeRef,
    specFingerprint: opts.specFingerprint,
    codeHash,
  });

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
  const record = await findGroupManagedService(env, groupId, name, 'worker');
  if (!record) {
    throw new Error(`Worker entity "${name}" not found in group ${groupId}`);
  }

  const config = parseManagedServiceConfig(record.row.config) as WorkerConfig;

  try {
    const client = createCloudflareApiClient(env);
    if (client) {
      await deleteWorkerScript(client, record.row.routeRef ?? config.scriptName, config.dispatchNamespace);
    }
  } catch (error) {
    console.warn(`Failed to delete CF worker "${record.row.routeRef ?? config.scriptName}":`, error);
  }

  await deleteGroupManagedService(env, groupId, name, 'worker');
}

// ---------------------------------------------------------------------------
// listWorkers
// ---------------------------------------------------------------------------

export async function listWorkers(
  env: Env,
  groupId: string,
): Promise<WorkerEntityInfo[]> {
  const records = await listGroupManagedServices(env, groupId);
  return records
    .filter((record) => record.config.componentKind === 'worker')
    .map((record) => ({
      id: record.row.id,
      groupId: record.row.groupId ?? groupId,
      name: record.config.manifestName ?? record.row.slug ?? record.row.id,
      category: 'worker',
      config: {
        scriptName: record.row.routeRef ?? '',
        deployedAt: record.config.deployedAt ?? record.row.updatedAt,
        codeHash: record.config.codeHash ?? '',
        ...(record.config.dispatchNamespace ? { dispatchNamespace: record.config.dispatchNamespace } : {}),
        ...(record.config.specFingerprint ? { specFingerprint: record.config.specFingerprint } : {}),
      },
      createdAt: record.row.createdAt,
      updatedAt: record.row.updatedAt,
    }));
}
