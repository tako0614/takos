/**
 * Entity — Resource (Layer 1).
 *
 * Independent resource operations (create / list / delete) that interact
 * with the provider layer and update local state. These functions are
 * designed to be called from CLI commands directly, without requiring a
 * full app.yml manifest.
 */
import type { ResourceState } from '../state/state-types.ts';
import type { ProvisionResult } from '../group-deploy/resource-provider.ts';
import { resolveProvider } from '../group-deploy/provisioner.ts';
import { readState, writeState, getStateDir } from '../state/state-file.ts';
import { createEmptyState } from '../empty-state.ts';

// ── Types ────────────────────────────────────────────────────────────────────

export type ResourceType =
  | 'sql'
  | 'object_store'
  | 'kv'
  | 'queue'
  | 'vector_index'
  | 'secret';

function resolveProvisioningType(type: ResourceType): 'd1' | 'r2' | 'kv' | 'queue' | 'vectorize' | 'secretRef' {
  switch (type) {
    case 'sql':
      return 'd1';
    case 'object_store':
      return 'r2';
    case 'vector_index':
      return 'vectorize';
    case 'secret':
      return 'secretRef';
    case 'kv':
    case 'queue':
      return type;
  }
}

export interface CreateResourceOpts {
  type: ResourceType;
  binding?: string;
  group: string;
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

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a single resource via the resolved provider and persist it to state.
 */
export async function createResource(name: string, opts: CreateResourceOpts): Promise<ProvisionResult> {
  const groupName = opts.groupName || 'takos';
  const group = opts.group;
  const provider = resolveProvider({
    accountId: opts.accountId,
    apiToken: opts.apiToken,
    groupName,
    env: opts.env,
  });

  const resourceName = `${group}-${opts.env}-${name}`;
  const resolvedType = resolveProvisioningType(opts.type);

  let result: ProvisionResult;
  switch (resolvedType) {
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
      result = provider.skipAutoConfigured(name, resolvedType);
      break;
  }

  // Persist to state
  const cwd = process.cwd();
  const stateDir = getStateDir(cwd);
  const state = (await readState(stateDir, group)) || createEmptyState(opts);
  state.resources[name] = {
    type: resolvedType,
    id: result.id || resourceName,
    binding: opts.binding || name,
    createdAt: new Date().toISOString(),
  };
  state.updatedAt = new Date().toISOString();
  await writeState(stateDir, group, state);

  return result;
}

/**
 * List all resources tracked in local state.
 */
export async function listResources(group: string): Promise<ResourceEntry[]> {
  const cwd = process.cwd();
  const stateDir = getStateDir(cwd);
  const state = await readState(stateDir, group);
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
 * Delete a resource from local state.
 *
 * Note: provider-specific cloud deletion (e.g. wrangler d1 delete) is not
 * yet implemented. Only the local state entry is removed.
 */
export async function deleteResource(
  name: string,
  opts: { group: string; accountId: string; apiToken: string },
): Promise<void> {
  const group = opts.group;
  const cwd = process.cwd();
  const stateDir = getStateDir(cwd);
  const state = await readState(stateDir, group);
  if (state) {
    delete state.resources[name];
    state.updatedAt = new Date().toISOString();
    await writeState(stateDir, group, state);
  }
}
