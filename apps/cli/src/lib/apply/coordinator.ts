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

import type { DiffResult } from '../state/diff.js';
import type { AppManifest } from '../app-manifest.js';
import { applyOverrides } from './overrides.js';
import { topologicalSort } from './topological-sort.js';
import { executeEntry } from './entry-executor.js';

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
  if (env?.inject) {
    await resolveAndInjectTemplates(resolved, opts);
  }

  // 6. lifecycle.postApply
  if (lifecycle?.postApply) {
    const hook: LifecycleHookInput = lifecycle.postApply;
    await runLifecycleHook(hook, opts);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Lifecycle hooks (stub)
// ---------------------------------------------------------------------------

type LifecycleHookInput = { command: string; timeoutSeconds?: number; sandbox?: boolean };

async function runLifecycleHook(
  _hook: LifecycleHookInput,
  _opts: ApplyOpts,
): Promise<void> {
  process.stderr.write('Warning: lifecycle hooks (preApply / postApply) are not yet implemented — skipping.\n');
}

// ---------------------------------------------------------------------------
// Template injection (stub)
// ---------------------------------------------------------------------------

async function resolveAndInjectTemplates(
  _manifest: AppManifest,
  _opts: ApplyOpts,
): Promise<void> {
  process.stderr.write('Warning: template variable injection (env.inject) is not yet implemented — skipping.\n');
}
