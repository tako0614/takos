/**
 * Entity — Worker (Layer 1).
 *
 * Independent worker operations (deploy / list / delete) that interact
 * with the existing group-deploy worker deployment logic and update
 * local state.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

import type { TakosState, WorkerState } from '../state/state-types.js';
import { readState, writeState, getStateDir } from '../state/state-file.js';
import { deployWorkerWithWrangler } from '../group-deploy/deploy-worker.js';
import { generateWranglerConfig, serializeWranglerToml } from '../group-deploy/wrangler-config.js';
import { serializeContainerWranglerToml } from '../group-deploy/container.js';
import type { ContainerWranglerConfig, WranglerConfig } from '../group-deploy/deploy-models.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DeployWorkerOpts {
  artifact?: string;
  env: string;
  groupName?: string;
  accountId: string;
  apiToken: string;
  bindings?: Record<string, string>;
  containers?: string[];
  namespace?: string;
}

export interface WorkerEntry {
  name: string;
  scriptName: string;
  deployedAt: string;
  codeHash: string;
  containers?: string[];
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

async function computeCodeHash(artifactPath: string): Promise<string> {
  try {
    const content = await fs.readFile(artifactPath);
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  } catch {
    return 'unknown';
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Deploy a single worker and persist its state.
 */
export async function deployWorker(
  name: string,
  opts: DeployWorkerOpts,
): Promise<{ success: boolean; scriptName: string; error?: string }> {
  const groupName = opts.groupName || 'takos';
  const scriptName = opts.namespace
    ? `${groupName}-${name}`
    : name;

  // Build a WorkerServiceDef for wrangler config generation
  const artifactPath = opts.artifact || 'index.js';
  const workerService = {
    type: 'worker' as const,
    build: {
      fromWorkflow: {
        path: '',
        job: '',
        artifact: '',
        artifactPath,
      },
    },
    env: opts.bindings ? Object.fromEntries(
      Object.entries(opts.bindings).map(([k, v]) => [k, v]),
    ) : undefined,
    bindings: undefined,
    containers: undefined,
  };

  const resources = new Map<string, { name: string; type: string; id: string; binding: string }>();

  const wranglerConfig = generateWranglerConfig(
    workerService,
    name,
    {
      groupName,
      env: opts.env,
      namespace: opts.namespace,
      resources,
      compatibilityDate: '2025-01-01',
    },
  );

  const isContainerConfig = 'containers' in wranglerConfig
    && Array.isArray((wranglerConfig as ContainerWranglerConfig).containers);
  const toml = isContainerConfig
    ? serializeContainerWranglerToml(wranglerConfig as ContainerWranglerConfig)
    : serializeWranglerToml(wranglerConfig as WranglerConfig);

  const wranglerResult = await deployWorkerWithWrangler(toml, {
    accountId: opts.accountId,
    apiToken: opts.apiToken,
    scriptName,
  });

  // Persist to state
  const cwd = process.cwd();
  const stateDir = getStateDir(cwd);
  const state = (await readState(stateDir)) || createEmptyState(opts);
  const codeHash = opts.artifact ? await computeCodeHash(opts.artifact) : 'unknown';

  state.workers[name] = {
    scriptName,
    deployedAt: new Date().toISOString(),
    codeHash,
    ...(opts.containers && opts.containers.length > 0 ? { containers: opts.containers } : {}),
  };
  state.updatedAt = new Date().toISOString();
  await writeState(stateDir, state);

  return {
    success: wranglerResult.success,
    scriptName,
    error: wranglerResult.error,
  };
}

/**
 * List all workers tracked in local state.
 */
export async function listWorkers(): Promise<WorkerEntry[]> {
  const cwd = process.cwd();
  const stateDir = getStateDir(cwd);
  const state = await readState(stateDir);
  if (!state) return [];

  return Object.entries(state.workers).map(([name, w]: [string, WorkerState]) => ({
    name,
    scriptName: w.scriptName,
    deployedAt: w.deployedAt,
    codeHash: w.codeHash,
    ...(w.containers ? { containers: w.containers } : {}),
  }));
}

/**
 * Delete a worker from state. Actual deletion via wrangler is TODO.
 */
export async function deleteWorker(
  name: string,
  _opts: { accountId: string; apiToken: string },
): Promise<void> {
  // TODO: wrangler delete via provider
  const cwd = process.cwd();
  const stateDir = getStateDir(cwd);
  const state = await readState(stateDir);
  if (state) {
    delete state.workers[name];
    state.updatedAt = new Date().toISOString();
    await writeState(stateDir, state);
  }
}
