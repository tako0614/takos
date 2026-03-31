/**
 * API client for group/state operations.
 *
 * Uses the existing auth/config infrastructure (config-auth.ts) to resolve
 * endpoint URL and authentication token, then provides typed helpers for
 * the group-state CRUD endpoints on the takos API.
 *
 * When the user is not authenticated with takos (e.g. only has a CF token
 * for apply), hasApiEndpoint() returns false and callers
 * silently fall back to the file-based backend — no extra login required.
 */

import { api } from '../api.ts';
import { getConfig, isAuthenticated } from '../config-auth.ts';
import type { TakosState } from './state-types.ts';

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



// ---------------------------------------------------------------------------
// Availability check
// ---------------------------------------------------------------------------

/**
 * Returns true when the API endpoint is configured and the user is
 * authenticated (takos token/session). When false, callers should fall
 * back to file-based state.
 *
 * Note: This intentionally does NOT require CF tokens. When a user only
 * has CF tokens (apply workflow) but no takos login, the
 * caller will automatically fall back to file-based state without
 * requiring additional authentication.
 */
export function hasApiEndpoint(): boolean {
  try {
    if (!isAuthenticated()) return false;
    const config = getConfig();
    return !!config.apiUrl;
  } catch {
    return false;
  }
}

/**
 * Returns the spaceId from the current takos config, if available.
 * Used by API calls that require a space scope.
 */
export function getDefaultSpaceId(): string | undefined {
  try {
    const config = getConfig();
    return config.spaceId ?? config.workspaceId;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// API helpers — group state CRUD
//
// Error convention:
//   Read operations (readGroupStateFromApi, listGroupsFromApi) return
//   null/empty on failure — callers fall back to local file state.
//   Write operations (writeGroupStateToApi, deleteGroupStateFromApi) throw
//   on failure — callers must handle or propagate the error.
// ---------------------------------------------------------------------------

/**
 * Build space-scoped headers. When the user has a default space configured
 * (via login, env var, or session file), requests are scoped to that space.
 */
function spaceHeaders(): Record<string, string> {
  const spaceId = getDefaultSpaceId();
  if (spaceId) return { 'X-Takos-Space-Id': spaceId };
  return {};
}

/**
 * Read a group's full state via the API.
 * Returns null when the group does not exist or the request fails.
 */
export async function readGroupStateFromApi(group: string): Promise<TakosState | null> {
  try {
    const res = await api<GroupDetailResponse>(
      `/api/groups/${encodeURIComponent(group)}/state`,
      { headers: spaceHeaders() },
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
    body: stateToApiPayload(state),
    headers: spaceHeaders(),
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
    headers: spaceHeaders(),
  });

  if (!res.ok) {
    throw new Error(`Failed to delete group "${group}": ${res.error}`);
  }
}

/**
 * List all group names via the API.
 */
export async function listGroupsFromApi(): Promise<string[]> {
  const res = await api<GroupsListResponse>('/api/groups', {
    headers: spaceHeaders(),
  });
  if (!res.ok) return [];

  return (res.data.groups ?? []).map((g) => g.name);
}

// ---------------------------------------------------------------------------
// Response / payload converters
// ---------------------------------------------------------------------------

/** Safely extract a string from an unknown config value, with a fallback. */
function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

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
          type: str(config.type, 'unknown'),
          id: str(config.id),
          binding: str(config.binding, entity.name),
          createdAt: str(config.createdAt),
        };
        break;
      case 'worker':
        state.workers[entity.name] = {
          scriptName: str(config.scriptName),
          deployedAt: str(config.deployedAt),
          codeHash: str(config.codeHash),
          ...(Array.isArray(config.containers) ? { containers: config.containers as string[] } : {}),
        };
        break;
      case 'container':
        state.containers[entity.name] = {
          deployedAt: str(config.deployedAt),
          imageHash: str(config.imageHash),
        };
        break;
      case 'service':
        state.services[entity.name] = {
          deployedAt: str(config.deployedAt),
          imageHash: str(config.imageHash),
          ...(typeof config.ipv4 === 'string' ? { ipv4: config.ipv4 } : {}),
        };
        break;
      case 'route':
        state.routes[entity.name] = {
          target: str(config.target),
          ...(typeof config.path === 'string' ? { path: config.path } : {}),
          ...(typeof config.domain === 'string' ? { domain: config.domain } : {}),
          ...(typeof config.url === 'string' ? { url: config.url } : {}),
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
