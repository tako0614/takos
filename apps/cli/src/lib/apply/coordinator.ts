/**
 * Apply coordinator — Layer 2 dispatcher.
 *
 * Receives a DiffResult and AppManifest, then delegates each entry
 * to the appropriate Layer 1 entity operation (resource / worker /
 * container / service).  Handles overrides, topological ordering,
 * lifecycle hooks, and rollback-on-failure.
 *
 * The coordinator itself does NOT contain business logic for
 * provisioning or deploying; it only orchestrates calls to
 * `lib/entities/*`.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { DiffResult } from '../state/diff.ts';
import type { AppManifest } from '../app-manifest.ts';
import type { TemplateContext } from '../group-deploy/deploy-models.ts';
import { applyOverrides } from './overrides.ts';
import { topologicalSort } from './topological-sort.ts';
import { executeEntry } from './entry-executor.ts';
import { execCommand } from '../group-deploy/cloudflare-utils.ts';
import { readState, getStateDir } from '../state/state-file.ts';

export const DEFAULT_CONTAINER_PORT = 8080;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ApplyOpts {
  group: string;
  env: string;
  accountId: string;
  apiToken: string;
  groupName?: string;
  namespace?: string;
  manifestDir?: string;
  baseDomain?: string;
  autoApprove?: boolean;
  /** When a Takos access token was issued during apply, pass it here for env.inject. */
  takosAccessToken?: string;
}

export interface ApplyEntryResult {
  name: string;
  category: string;
  action: string;
  status: 'success' | 'failed';
  error?: string;
}

export interface ApplyResult {
  applied: ApplyEntryResult[];
  skipped: string[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function applyDiff(
  diff: DiffResult,
  manifest: AppManifest,
  opts: ApplyOpts,
): Promise<ApplyResult> {
  const result: ApplyResult = { applied: [], skipped: [] };

  // 1. overrides (env-specific partial merge)
  const resolved = applyOverrides(manifest, opts.env);

  // 2. lifecycle.preApply
  const { lifecycle, update, env } = resolved.spec;

  if (lifecycle?.preApply) {
    const hook: LifecycleHookInput = lifecycle.preApply;
    await runLifecycleHook(hook, opts);
  }

  // 3. topological sort (respects dependsOn + default category ordering)
  const ordered = topologicalSort(diff.entries, resolved);

  // 4. execute each entry sequentially
  for (const entry of ordered) {
    if (entry.action === 'unchanged') {
      result.skipped.push(entry.name);
      continue;
    }

    try {
      await executeEntry(entry, resolved, opts);
      result.applied.push({
        name: entry.name,
        category: entry.category,
        action: entry.action,
        status: 'success',
      });
    } catch (error) {
      result.applied.push({
        name: entry.name,
        category: entry.category,
        action: entry.action,
        status: 'failed',
        error: String(error),
      });

      if (update?.rollbackOnFailure) {
        // stop processing; caller may inspect partial results
        break;
      }
    }
  }

  // 5. template variable injection
  if (env?.inject || opts.takosAccessToken) {
    await resolveAndInjectTemplates(resolved, opts, result);
  }

  // 6. lifecycle.postApply
  if (lifecycle?.postApply) {
    const hook: LifecycleHookInput = lifecycle.postApply;
    await runLifecycleHook(hook, opts);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

type LifecycleHookInput = { command: string; timeoutSeconds?: number; sandbox?: boolean };

async function runLifecycleHook(
  hook: LifecycleHookInput,
  opts: ApplyOpts,
): Promise<void> {
  const cwd = opts.manifestDir ?? process.cwd();

  const result = await execCommand('sh', ['-c', hook.command], { cwd });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(
      `Lifecycle hook failed (exit ${result.exitCode}): ${hook.command}` +
      (stderr ? `\n${stderr}` : ''),
    );
  }
}

// ---------------------------------------------------------------------------
// Template context builder (offline apply variant)
// ---------------------------------------------------------------------------

function buildOfflineTemplateContext(
  manifest: AppManifest,
  opts: ApplyOpts,
  state: import('../state/state-types.ts').TakosState | null,
): TemplateContext {
  const baseDomain = opts.baseDomain || `${manifest.metadata.name}.app.example.com`;

  // Routes
  const routes: TemplateContext['routes'] = {};
  for (const route of manifest.spec.routes ?? []) {
    const routeName = route.name;
    if (!routeName) continue;
    const domain = baseDomain;
    const routePath = route.path || '/';
    routes[routeName] = {
      url: `https://${domain}${routePath}`,
      domain,
      path: routePath,
    };
  }

  // Workers — build from local state
  const workers: TemplateContext['workers'] = {};
  if (state?.workers) {
    for (const name of Object.keys(state.workers)) {
      workers[name] = { url: undefined };
    }
  }
  // Also include workers declared in manifest but not yet in state
  for (const name of Object.keys(manifest.spec.workers ?? {})) {
    if (!workers[name]) {
      workers[name] = { url: undefined };
    }
  }

  // Containers — from state
  const containers: TemplateContext['containers'] = {};
  if (state?.containers) {
    for (const name of Object.keys(state.containers)) {
      containers[name] = {};
    }
  }
  for (const name of Object.keys(manifest.spec.containers ?? {})) {
    if (!containers[name]) {
      containers[name] = {};
    }
  }

  // Services — from state
  const services: TemplateContext['services'] = {};
  if (state?.services) {
    for (const [name, svc] of Object.entries(state.services)) {
      services[name] = { ipv4: svc.ipv4, port: undefined };
    }
  }
  for (const name of Object.keys(manifest.spec.services ?? {})) {
    if (!services[name]) {
      services[name] = {};
    }
  }

  // Resources — from state
  const resources: TemplateContext['resources'] = {};
  if (state?.resources) {
    for (const [name, res] of Object.entries(state.resources)) {
      resources[name] = { id: res.id };
    }
  }

  // Takos platform context
  const takos: TemplateContext['takos'] = {
    apiUrl: process.env.TAKOS_API_URL || '',
    accessToken: opts.takosAccessToken,
  };

  return { routes, containers, services, workers, resources, takos };
}

function resolveTemplateString(template: string, context: TemplateContext): string {
  return template.replace(/\$\{\{\s*([\w.]+)\s*\}\}/g, (_match, expr: string) => {
    const parts = expr.split('.');
    let current: unknown = context;
    for (const part of parts) {
      if (current == null || typeof current !== 'object' || Array.isArray(current)) return _match;
      current = (current as Readonly<Record<string, unknown>>)[part];
    }
    return current != null ? String(current) : _match;
  });
}

// ---------------------------------------------------------------------------
// Template injection
// ---------------------------------------------------------------------------

async function resolveAndInjectTemplates(
  manifest: AppManifest,
  opts: ApplyOpts,
  applyResult: ApplyResult,
): Promise<void> {
  if (!manifest.spec.env?.inject && !opts.takosAccessToken) return;

  const { accountId, apiToken } = opts;

  // Read current state to populate template context
  const cwd = opts.manifestDir ?? process.cwd();
  const stateDir = getStateDir(cwd);
  const state = await readState(stateDir, opts.group);

  const tmplCtx = buildOfflineTemplateContext(manifest, opts, state);

  // Resolve all template strings
  const resolvedEnv: Record<string, string> = {};
  for (const [key, template] of Object.entries(manifest.spec.env?.inject ?? {})) {
    resolvedEnv[key] = resolveTemplateString(template, tmplCtx);
  }

  // Inject TAKOS_ACCESS_TOKEN if one was issued during apply
  if (opts.takosAccessToken) {
    resolvedEnv['TAKOS_ACCESS_TOKEN'] = opts.takosAccessToken;
  }

  if (Object.keys(resolvedEnv).length === 0) return;

  // Collect deployed worker scriptNames from local state
  const deployedWorkers: Array<{ name: string; scriptName: string }> = [];
  if (state?.workers) {
    for (const [name, w] of Object.entries(state.workers)) {
      // Only inject into workers that were successfully applied or already existed
      const entry = applyResult.applied.find((e) => e.name === name && e.category === 'worker');
      const wasApplied = entry && entry.status === 'success';
      const wasSkipped = applyResult.skipped.includes(name);
      if (wasApplied || wasSkipped) {
        deployedWorkers.push({ name, scriptName: w.scriptName });
      }
    }
  }

  // Inject resolved env values via `wrangler secret put`
  for (const worker of deployedWorkers) {
    for (const [secretName, secretValue] of Object.entries(resolvedEnv)) {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-inject-'));
      try {
        const wranglerEnv: NodeJS.ProcessEnv = {
          CLOUDFLARE_ACCOUNT_ID: accountId,
          CLOUDFLARE_API_TOKEN: apiToken,
        };
        await execCommand(
          'npx',
          ['wrangler', 'secret', 'put', secretName, '--name', worker.scriptName],
          { cwd: tmpDir, env: wranglerEnv, stdin: secretValue },
        );
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* cleanup: best-effort temp dir removal */ });
      }
    }
  }
}
