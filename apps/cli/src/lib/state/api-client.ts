/**
 * API client for group/state operations.
 *
 * Uses the existing auth/config infrastructure (config-auth.ts) to resolve
 * endpoint URL and authentication token, then provides typed helpers for
 * the group-state CRUD endpoints on the takos API.
 */

import { api } from '../api.js';
import { getConfig, isAuthenticated } from '../config-auth.js';
import type { TakosState } from './state-types.js';

// ---------------------------------------------------------------------------
// Types — API response shapes
// ---------------------------------------------------------------------------

interface GroupRecord {
  id: string;
  name: string;
  provider?: string;
  env?: string;
  groupName?: string;
  updatedAt?: string;
}

interface EntityRecord {
  id: string;
  category: string; // 'resource' | 'worker' | 'container' | 'service' | 'route'
  name: string;
  config: Record<string, unknown>;
}

interface GroupsListResponse {
  groups: GroupRecord[];
}

interface GroupDetailResponse {
  group: GroupRecord;
  entities: EntityRecord[];
}

interface GroupCreateResponse {
  group: GroupRecord;
}

// ---------------------------------------------------------------------------
// Availability check
// ---------------------------------------------------------------------------

/**
 * Returns true when the API endpoint is configured and the user is
 * authenticated. When false, callers should fall back to file-based state.
 */
export function hasApiEndpoint(): boolean {
  try {
    const config = getConfig();
    return isAuthenticated() && !!config.apiUrl;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// API helpers — group state CRUD
// ---------------------------------------------------------------------------

/**
 * Read a group's full state via the API.
 * Returns null when the group does not exist or the request fails.
 */
export async function readGroupStateFromApi(group: string): Promise<TakosState | null> {
  try {
    const res = await api<GroupDetailResponse>(
      `/api/groups/${encodeURIComponent(group)}/state`,
    );
    if (!res.ok) return null;

    return apiResponseToState(res.data);
  } catch {
    return null;
  }
}

/**
 * Write (upsert) a group's full state via the API.
 */
export async function writeGroupStateToApi(group: string, state: TakosState): Promise<void> {
  const res = await api<void>(`/api/groups/${encodeURIComponent(group)}/state`, {
    method: 'PUT',
    body: stateToApiPayload(state) as unknown as Record<string, unknown>,
  });

  if (!res.ok) {
    throw new Error(`Failed to write state for group "${group}": ${res.error}`);
  }
}

/**
 * Delete a group's state via the API.
 */
export async function deleteGroupStateFromApi(group: string): Promise<void> {
  const res = await api<void>(`/api/groups/${encodeURIComponent(group)}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    throw new Error(`Failed to delete group "${group}": ${res.error}`);
  }
}

/**
 * List all group names via the API.
 */
export async function listGroupsFromApi(): Promise<string[]> {
  const res = await api<GroupsListResponse>('/api/groups');
  if (!res.ok) return [];

  return (res.data.groups ?? []).map((g) => g.name);
}

// ---------------------------------------------------------------------------
// Response / payload converters
// ---------------------------------------------------------------------------

function apiResponseToState(data: GroupDetailResponse): TakosState {
  const { group, entities } = data;

  const state: TakosState = {
    version: 1,
    provider: group.provider ?? 'cloudflare',
    env: group.env ?? 'unknown',
    group: group.name,
    groupName: group.groupName ?? group.name,
    updatedAt: group.updatedAt ?? new Date().toISOString(),
    resources: {},
    workers: {},
    containers: {},
    services: {},
    routes: {},
  };

  for (const entity of entities) {
    const config = entity.config ?? {};
    switch (entity.category) {
      case 'resource':
        state.resources[entity.name] = {
          type: (config.type as string) ?? 'unknown',
          id: (config.id as string) ?? '',
          binding: (config.binding as string) ?? entity.name,
          createdAt: (config.createdAt as string) ?? '',
        };
        break;
      case 'worker':
        state.workers[entity.name] = {
          scriptName: (config.scriptName as string) ?? '',
          deployedAt: (config.deployedAt as string) ?? '',
          codeHash: (config.codeHash as string) ?? '',
          ...(config.containers ? { containers: config.containers as string[] } : {}),
        };
        break;
      case 'container':
        state.containers[entity.name] = {
          deployedAt: (config.deployedAt as string) ?? '',
          imageHash: (config.imageHash as string) ?? '',
        };
        break;
      case 'service':
        state.services[entity.name] = {
          deployedAt: (config.deployedAt as string) ?? '',
          imageHash: (config.imageHash as string) ?? '',
          ...(config.ipv4 ? { ipv4: config.ipv4 as string } : {}),
        };
        break;
      case 'route':
        state.routes[entity.name] = {
          target: (config.target as string) ?? '',
          ...(config.path ? { path: config.path as string } : {}),
          ...(config.domain ? { domain: config.domain as string } : {}),
          ...(config.url ? { url: config.url as string } : {}),
        };
        break;
    }
  }

  return state;
}

function stateToApiPayload(state: TakosState): {
  provider: string;
  env: string;
  groupName: string;
  entities: Array<{ category: string; name: string; config: Record<string, unknown> }>;
} {
  const entities: Array<{ category: string; name: string; config: Record<string, unknown> }> = [];

  for (const [name, resource] of Object.entries(state.resources)) {
    entities.push({ category: 'resource', name, config: { ...resource } });
  }
  for (const [name, worker] of Object.entries(state.workers)) {
    entities.push({ category: 'worker', name, config: { ...worker } });
  }
  for (const [name, container] of Object.entries(state.containers)) {
    entities.push({ category: 'container', name, config: { ...container } });
  }
  for (const [name, service] of Object.entries(state.services)) {
    entities.push({ category: 'service', name, config: { ...service } });
  }
  for (const [name, route] of Object.entries(state.routes)) {
    entities.push({ category: 'route', name, config: { ...route } });
  }

  return {
    provider: state.provider,
    env: state.env,
    groupName: state.groupName,
    entities,
  };
}
