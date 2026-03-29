/**
 * Entity — Service (Layer 1).
 *
 * Independent service (persistent container) operations (deploy / list / delete).
 * Services are long-running containers that may have dedicated IPv4 addresses,
 * distinct from CF Containers which are ephemeral/on-demand.
 */
import type { TakosState, ServiceState } from '../state/state-types.js';
import { readState, writeState, getStateDir } from '../state/state-file.js';
import { deployContainerWithWrangler } from '../group-deploy/container.js';
import type { ContainerServiceDef, GroupDeployOptions } from '../group-deploy/deploy-models.js';
import { createEmptyState } from '../empty-state.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DeployServiceOpts {
  dockerfile: string;
  port: number;
  ipv4?: boolean;
  group: string;
  env: string;
  groupName?: string;
  accountId: string;
  apiToken: string;
  instanceType?: string;
  maxInstances?: number;
  namespace?: string;
}

export interface ServiceEntry {
  name: string;
  deployedAt: string;
  imageHash: string;
  ipv4?: string;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Deploy a persistent service container and persist its state.
 */
export async function deployService(
  name: string,
  opts: DeployServiceOpts,
): Promise<{ success: boolean; scriptName?: string; error?: string }> {
  const groupName = opts.groupName || 'takos';

  const serviceDef: ContainerServiceDef = {
    type: 'container',
    container: {
      dockerfile: opts.dockerfile,
      port: opts.port,
      instanceType: opts.instanceType,
      maxInstances: opts.maxInstances,
    },
  };

  const deployOptions: GroupDeployOptions = {
    manifest: {
      apiVersion: 'takos/v1',
      kind: 'Application',
      metadata: { name: groupName },
      spec: { version: '0.0.0' },
    },
    env: opts.env,
    namespace: opts.namespace,
    groupName,
    accountId: opts.accountId,
    apiToken: opts.apiToken,
    manifestDir: process.cwd(),
  };

  const resources = new Map<string, { name: string; type: string; id: string; binding: string }>();

  const result = await deployContainerWithWrangler(
    name,
    serviceDef,
    deployOptions,
    resources,
  );

  // Persist to state
  const group = opts.group;
  const cwd = process.cwd();
  const stateDir = getStateDir(cwd);
  const state = (await readState(stateDir, group)) || createEmptyState(opts);

  state.services[name] = {
    deployedAt: new Date().toISOString(),
    imageHash: 'unknown',
    ...(opts.ipv4 ? { ipv4: 'pending' } : {}),
  };
  state.updatedAt = new Date().toISOString();
  await writeState(stateDir, group, state);

  return {
    success: result.status === 'deployed',
    scriptName: result.scriptName,
    error: result.error,
  };
}

/**
 * List all services tracked in local state.
 */
export async function listServices(group: string): Promise<ServiceEntry[]> {
  const cwd = process.cwd();
  const stateDir = getStateDir(cwd);
  const state = await readState(stateDir, group);
  if (!state) return [];

  return Object.entries(state.services).map(([name, s]: [string, ServiceState]) => ({
    name,
    deployedAt: s.deployedAt,
    imageHash: s.imageHash,
    ...(s.ipv4 ? { ipv4: s.ipv4 } : {}),
  }));
}

/**
 * Delete a service from local state.
 *
 * Note: provider-specific cloud deletion is not yet implemented.
 * Only the local state entry is removed.
 */
export async function deleteService(
  name: string,
  _opts: { group: string; accountId: string; apiToken: string },
): Promise<void> {
  const group = _opts.group;
  const cwd = process.cwd();
  const stateDir = getStateDir(cwd);
  const state = await readState(stateDir, group);
  if (state) {
    delete state.services[name];
    state.updatedAt = new Date().toISOString();
    await writeState(stateDir, group, state);
  }
}
