/**
 * Entity — Resource (Layer 1).
 *
 * Independent resource operations (create / list / delete) that interact
 * with the provider layer and update local state. These functions are
 * designed to be called from CLI commands directly, without requiring a
 * full app.yml manifest.
 */
import type { TakosState, ResourceState } from '../state/state-types.js';
import type { ProvisionResult } from '../group-deploy/resource-provider.js';
import { resolveProvider } from '../group-deploy/provisioner.js';
import { readState, writeState, getStateDir } from '../state/state-file.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type ResourceType = 'd1' | 'r2' | 'kv' | 'queue' | 'vectorize' | 'secretRef';

export interface CreateResourceOpts {
  type: ResourceType;
  binding?: string;
  env: string;
  groupName?: string;
  accountId: string;
  apiToken: string;
}

export interface ResourceEntry {
  name: string;
  type: string;
  id: string;
  binding: string;
  createdAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function createEmptyState(opts: { env: string; groupName?: string }): TakosState {
  return {
    version: 1,
    provider: 'cloudflare',
    env: opts.env,
    groupName: opts.groupName || 'takos',
    updatedAt: new Date().toISOString(),
    resources: {},
    workers: {},
    containers: {},
    services: {},
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a single resource via the resolved provider and persist it to state.
 */
export async function createResource(name: string, opts: CreateResourceOpts): Promise<ProvisionResult> {
  const groupName = opts.groupName || 'takos';
  const provider = resolveProvider({
    accountId: opts.accountId,
    apiToken: opts.apiToken,
    groupName,
    env: opts.env,
  });

  const resourceName = `${groupName}-${opts.env}-${name}`;

  let result: ProvisionResult;
  switch (opts.type) {
    case 'd1':
      result = await provider.createDatabase(resourceName);
      break;
    case 'r2':
      result = await provider.createObjectStorage(resourceName);
      break;
    case 'kv':
      result = await provider.createKeyValueStore(resourceName);
      break;
    case 'queue':
      result = await provider.createQueue(resourceName);
      break;
    case 'vectorize':
      result = await provider.createVectorIndex(resourceName, { dimensions: 1536, metric: 'cosine' });
      break;
    case 'secretRef':
      result = await provider.createSecret(resourceName, opts.binding || name);
      break;
    default:
      result = provider.skipAutoConfigured(name, opts.type);
      break;
  }

  // Persist to state
  const cwd = process.cwd();
  const stateDir = getStateDir(cwd);
  const state = (await readState(stateDir)) || createEmptyState(opts);
  state.resources[name] = {
    type: opts.type,
    id: result.id || resourceName,
    binding: opts.binding || name,
    createdAt: new Date().toISOString(),
  };
  state.updatedAt = new Date().toISOString();
  await writeState(stateDir, state);

  return result;
}

/**
 * List all resources tracked in local state.
 */
export async function listResources(): Promise<ResourceEntry[]> {
  const cwd = process.cwd();
  const stateDir = getStateDir(cwd);
  const state = await readState(stateDir);
  if (!state) return [];

  return Object.entries(state.resources).map(([name, r]: [string, ResourceState]) => ({
    name,
    type: r.type,
    id: r.id,
    binding: r.binding,
    createdAt: r.createdAt,
  }));
}

/**
 * Delete a resource from state. The actual cloud resource deletion is
 * provider-specific and marked as TODO for now (wrangler d1 delete, etc.).
 */
export async function deleteResource(
  name: string,
  _opts: { accountId: string; apiToken: string },
): Promise<void> {
  // TODO: provider-specific deletion (wrangler d1 delete, etc.)
  const cwd = process.cwd();
  const stateDir = getStateDir(cwd);
  const state = await readState(stateDir);
  if (state) {
    delete state.resources[name];
    state.updatedAt = new Date().toISOString();
    await writeState(stateDir, state);
  }
}
