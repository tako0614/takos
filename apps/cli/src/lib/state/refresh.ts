/**
 * State refresh — reconcile state with provider reality.
 *
 * Queries the cloud provider to verify that each resource recorded in
 * state actually exists, and removes entries for resources that have
 * been deleted externally (orphaned state entries).
 *
 * This is a best-effort operation: if a provider does not implement
 * `checkResourceExists`, the resource is assumed to still exist.
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
 * When `checkResourceExists` is not supplied, all resources are assumed
 * to still exist (no-op refresh).
 */
export interface RefreshableProvider {
  /**
   * Check whether a resource exists with the provider.
   *
   * @param type   Resource type (e.g. 'd1', 'r2', 'kv', 'queue')
   * @param id     The provider-side resource ID stored in state
   * @param name   The logical resource name in the group manifest
   * @returns      true if the resource exists, false otherwise
   */
  checkResourceExists(type: string, id: string, name: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Refresh logic
// ---------------------------------------------------------------------------

/**
 * Refresh state by checking each entry against the provider.
 *
 * - Resources that no longer exist are removed from state.
 * - Workers, containers, and services are checked if the provider supports it.
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
    try {
      const exists = await provider.checkResourceExists(resource.type, resource.id, name);
      if (!exists) {
        changes.push({
          key: `resources.${name}`,
          category: 'resource',
          name,
          action: 'removed',
          reason: `${resource.type} resource "${resource.id}" not found in provider`,
        });
        delete state.resources[name];
      }
    } catch {
      // Provider check failed — assume resource still exists
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
    try {
      const exists = await provider.checkResourceExists('worker', worker.scriptName, name);
      if (!exists) {
        changes.push({
          key: `workers.${name}`,
          category: 'worker',
          name,
          action: 'removed',
          reason: `Worker script "${worker.scriptName}" not found in provider`,
        });
        delete state.workers[name];
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
  for (const [name, container] of Object.entries(state.containers)) {
    try {
      const exists = await provider.checkResourceExists('container', container.imageHash, name);
      if (!exists) {
        changes.push({
          key: `containers.${name}`,
          category: 'container',
          name,
          action: 'removed',
          reason: `Container "${name}" not found in provider`,
        });
        delete state.containers[name];
      }
    } catch {
      changes.push({
        key: `containers.${name}`,
        category: 'container',
        name,
        action: 'warning',
        reason: `Could not verify container "${name}" — skipped`,
      });
    }
  }

  // ── Services ──────────────────────────────────────────────────────────────
  for (const [name, service] of Object.entries(state.services)) {
    try {
      const exists = await provider.checkResourceExists('service', service.imageHash, name);
      if (!exists) {
        changes.push({
          key: `services.${name}`,
          category: 'service',
          name,
          action: 'removed',
          reason: `Service "${name}" not found in provider`,
        });
        delete state.services[name];
      }
    } catch {
      changes.push({
        key: `services.${name}`,
        category: 'service',
        name,
        action: 'warning',
        reason: `Could not verify service "${name}" — skipped`,
      });
    }
  }

  return { changes };
}
