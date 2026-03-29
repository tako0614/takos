/**
 * State refresh — reconcile state with provider reality.
 *
 * Queries the provider to verify the state entries that have stable
 * provider-side identifiers and removes entries that are confirmed
 * missing. Entries that cannot be verified safely are left untouched
 * and reported as warnings.
 */

import type { TakosState } from './state-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RefreshChangeAction = 'removed' | 'warning';

export interface RefreshChange {
  /** Dotted key, e.g. "resources.db" */
  key: string;
  category: string;
  name: string;
  action: RefreshChangeAction;
  reason: string;
}

export interface RefreshResult {
  changes: RefreshChange[];
}

/**
 * Minimal interface for verifying that a provisioned resource still exists.
 *
 * Provider implementations can implement this to enable `state refresh`.
 */
export interface RefreshableProvider {
  /**
   * Check whether a resource exists with the provider.
   *
   * @param type   Resource type (e.g. 'd1', 'r2', 'kv', 'queue')
   * @param id     The provider-side resource ID stored in state
   * @param name   The logical resource name in the group manifest
   * @returns      true if the resource exists, false if it is confirmed
   *               missing, or null when the provider cannot verify it
   *               safely (unsupported type, missing identifier, etc.).
   */
  checkResourceExists(type: string, id: string, name: string): Promise<boolean | null>;
}

const refreshableResourceTypes = new Set(['d1', 'r2', 'kv', 'queue', 'vectorize']);

// ---------------------------------------------------------------------------
// Refresh logic
// ---------------------------------------------------------------------------

/**
 * Refresh state by checking each verifiable entry against the provider.
 *
 * - Resources that no longer exist are removed from state.
 * - Workers are checked when a script name is present.
 * - Containers, services, and routes are reported as unsupported warnings.
 * - The mutated state is returned (caller is responsible for persisting).
 *
 * @param state     Current TakosState (will be mutated)
 * @param provider  A RefreshableProvider, or undefined for dry-check
 * @returns         RefreshResult describing what changed
 */
export async function refreshState(
  state: TakosState,
  provider?: RefreshableProvider,
): Promise<RefreshResult> {
  const changes: RefreshChange[] = [];

  if (!provider) {
    // No provider — nothing to check. Return empty result.
    return { changes };
  }

  // ── Resources ─────────────────────────────────────────────────────────────
  for (const [name, resource] of Object.entries(state.resources)) {
    if (!refreshableResourceTypes.has(resource.type)) {
      changes.push({
        key: `resources.${name}`,
        category: 'resource',
        name,
        action: 'warning',
        reason: `Resource type "${resource.type}" cannot be verified by state refresh yet`,
      });
      continue;
    }

    if (!resource.id) {
      changes.push({
        key: `resources.${name}`,
        category: 'resource',
        name,
        action: 'warning',
        reason: `Resource "${name}" is missing its provider ID, so it cannot be verified`,
      });
      continue;
    }

    try {
      const exists = await provider.checkResourceExists(resource.type, resource.id, name);
      if (exists === false) {
        changes.push({
          key: `resources.${name}`,
          category: 'resource',
          name,
          action: 'removed',
          reason: `${resource.type} resource "${resource.id}" not found in provider`,
        });
        delete state.resources[name];
      } else if (exists === null) {
        changes.push({
          key: `resources.${name}`,
          category: 'resource',
          name,
          action: 'warning',
          reason: `Could not verify resource "${name}" — skipped`,
        });
      }
    } catch {
      changes.push({
        key: `resources.${name}`,
        category: 'resource',
        name,
        action: 'warning',
        reason: `Could not verify resource "${name}" — skipped`,
      });
    }
  }

  // ── Workers ───────────────────────────────────────────────────────────────
  for (const [name, worker] of Object.entries(state.workers)) {
    if (!worker.scriptName) {
      changes.push({
        key: `workers.${name}`,
        category: 'worker',
        name,
        action: 'warning',
        reason: `Worker "${name}" is missing its script name, so it cannot be verified`,
      });
      continue;
    }

    try {
      const exists = await provider.checkResourceExists('worker', worker.scriptName, name);
      if (exists === false) {
        changes.push({
          key: `workers.${name}`,
          category: 'worker',
          name,
          action: 'removed',
          reason: `Worker script "${worker.scriptName}" not found in provider`,
        });
        delete state.workers[name];
      } else if (exists === null) {
        changes.push({
          key: `workers.${name}`,
          category: 'worker',
          name,
          action: 'warning',
          reason: `Could not verify worker "${name}" — skipped`,
        });
      }
    } catch {
      changes.push({
        key: `workers.${name}`,
        category: 'worker',
        name,
        action: 'warning',
        reason: `Could not verify worker "${name}" — skipped`,
      });
    }
  }

  // ── Containers ────────────────────────────────────────────────────────────
  for (const [name] of Object.entries(state.containers)) {
    changes.push({
      key: `containers.${name}`,
      category: 'container',
      name,
      action: 'warning',
      reason: 'Container state is not refreshable yet and was left untouched',
    });
  }

  // ── Services ──────────────────────────────────────────────────────────────
  for (const [name] of Object.entries(state.services)) {
    changes.push({
      key: `services.${name}`,
      category: 'service',
      name,
      action: 'warning',
      reason: 'Service state is not refreshable yet and was left untouched',
    });
  }

  // ── Routes ────────────────────────────────────────────────────────────────
  for (const [name] of Object.entries(state.routes)) {
    changes.push({
      key: `routes.${name}`,
      category: 'route',
      name,
      action: 'warning',
      reason: 'Route state is not refreshable yet and was left untouched',
    });
  }

  return { changes };
}
