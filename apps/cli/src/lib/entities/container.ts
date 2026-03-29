/**
 * Entity — Container (Layer 1).
 *
 * Independent CF Container operations (deploy / list / delete) that
 * interact with the existing group-deploy container deployment logic
 * and update local state.
 */
import type { TakosState, ContainerState } from '../state/state-types.js';
import { readState, writeState, getStateDir } from '../state/state-file.js';
import { deployContainerWithWrangler } from '../group-deploy/container.js';
import type { ContainerServiceDef, GroupDeployOptions } from '../group-deploy/deploy-models.js';
import { createEmptyState } from '../empty-state.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DeployContainerOpts {
  dockerfile: string;
  port: number;
  workerHost?: string;
  group: string;
  env: string;
  groupName?: string;
  accountId: string;
  apiToken: string;
  instanceType?: string;
  maxInstances?: number;
  namespace?: string;
}

export interface ContainerEntry {
  name: string;
  deployedAt: string;
  imageHash: string;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Deploy a single CF Container and persist its state.
 */
export async function deployContainer(
  name: string,
  opts: DeployContainerOpts,
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

  // Build a minimal GroupDeployOptions for the underlying function
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

  state.containers[name] = {
    deployedAt: new Date().toISOString(),
    imageHash: 'unknown', // Image hash is resolved at build time
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
 * List all containers tracked in local state.
 */
export async function listContainers(group: string): Promise<ContainerEntry[]> {
  const cwd = process.cwd();
  const stateDir = getStateDir(cwd);
  const state = await readState(stateDir, group);
  if (!state) return [];

  return Object.entries(state.containers).map(([name, c]: [string, ContainerState]) => ({
    name,
    deployedAt: c.deployedAt,
    imageHash: c.imageHash,
  }));
}

/**
 * Delete a container from local state.
 *
 * Note: provider-specific cloud deletion (e.g. wrangler delete) is not
 * yet implemented. Only the local state entry is removed.
 */
export async function deleteContainer(
  name: string,
  _opts: { group: string; accountId: string; apiToken: string },
): Promise<void> {
  const group = _opts.group;
  const cwd = process.cwd();
  const stateDir = getStateDir(cwd);
  const state = await readState(stateDir, group);
  if (state) {
    delete state.containers[name];
    state.updatedAt = new Date().toISOString();
    await writeState(stateDir, group, state);
  }
}
