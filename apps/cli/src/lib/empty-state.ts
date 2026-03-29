/**
 * Factory for an empty TakosState object.
 *
 * Used by entity modules (resource, worker, container, service) when no
 * existing state file is found and a fresh state needs to be created.
 */
import type { TakosState } from './state/state-types.js';

export function createEmptyState(opts: { group: string; env: string; groupName?: string }): TakosState {
  return {
    version: 1,
    provider: 'cloudflare',
    env: opts.env,
    group: opts.group,
    groupName: opts.groupName || 'takos',
    updatedAt: new Date().toISOString(),
    resources: {},
    workers: {},
    containers: {},
    services: {},
    routes: {},
  };
}
