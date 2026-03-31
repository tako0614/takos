/**
 * State sync — reconcile local and remote state.
 *
 * Compares the local file-based state with the API-backed remote state
 * and resolves differences. The newer version wins by default; when
 * versions are equal, updatedAt is used as the tiebreaker.
 */

import type { TakosState } from './state-types.ts';
import { readStateFromFile, writeStateToFile } from './state-file.ts';
import { hasApiEndpoint, readGroupStateFromApi, writeGroupStateToApi } from './api-client.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncAction = 'local-updated' | 'remote-updated' | 'already-in-sync' | 'no-remote' | 'no-local' | 'no-api';

export interface SyncResult {
  action: SyncAction;
  localVersion?: number;
  remoteVersion?: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Sync logic
// ---------------------------------------------------------------------------

/**
 * Synchronise local file state with remote API state.
 *
 * Resolution strategy:
 *   - Higher version wins
 *   - Equal version: newer updatedAt wins
 *   - Only one side exists: that side is propagated to the other
 *   - API not available: return early with 'no-api'
 */
export async function syncState(
  stateDir: string,
  group: string,
): Promise<SyncResult> {
  if (!hasApiEndpoint()) {
    return {
      action: 'no-api',
      message: 'API not available (not authenticated or no endpoint configured). Nothing to sync.',
    };
  }

  const [local, remote] = await Promise.all([
    readStateFromFile(stateDir, group),
    readGroupStateFromApi(group).catch(() => null),
  ]);

  // Neither side has state
  if (!local && !remote) {
    return {
      action: 'already-in-sync',
      message: 'No state found locally or remotely.',
    };
  }

  // Only local exists — push to remote
  if (local && !remote) {
    try {
      await writeGroupStateToApi(group, local);
      return {
        action: 'remote-updated',
        localVersion: local.version,
        message: 'Pushed local state to remote (remote had no state).',
      };
    } catch {
      return {
        action: 'no-remote',
        localVersion: local.version,
        message: 'Local state exists but failed to push to remote.',
      };
    }
  }

  // Only remote exists — pull to local
  if (!local && remote) {
    await writeStateToFile(stateDir, group, remote);
    return {
      action: 'local-updated',
      remoteVersion: remote.version,
      message: 'Pulled remote state to local (local had no state).',
    };
  }

  // Both exist — resolve by version, then by updatedAt
  if (!local || !remote) {
    // Unreachable: all null cases handled above. Guard for type narrowing.
    return { action: 'already-in-sync', message: 'State is in sync.' };
  }
  const localState = local;
  const remoteState = remote;

  const localVer = localState.version || 0;
  const remoteVer = remoteState.version || 0;

  if (localVer === remoteVer) {
    // Same version — compare updatedAt timestamps
    const localTime = new Date(localState.updatedAt || 0).getTime();
    const remoteTime = new Date(remoteState.updatedAt || 0).getTime();

    if (localTime === remoteTime) {
      return {
        action: 'already-in-sync',
        localVersion: localVer,
        remoteVersion: remoteVer,
        message: 'Local and remote state are identical.',
      };
    }

    if (localTime > remoteTime) {
      await writeGroupStateToApi(group, localState);
      return {
        action: 'remote-updated',
        localVersion: localVer,
        remoteVersion: remoteVer,
        message: `Same version (${localVer}) but local is newer — pushed to remote.`,
      };
    }

    // Remote is newer
    await writeStateToFile(stateDir, group, remoteState);
    return {
      action: 'local-updated',
      localVersion: localVer,
      remoteVersion: remoteVer,
      message: `Same version (${remoteVer}) but remote is newer — pulled to local.`,
    };
  }

  if (localVer > remoteVer) {
    await writeGroupStateToApi(group, localState);
    return {
      action: 'remote-updated',
      localVersion: localVer,
      remoteVersion: remoteVer,
      message: `Local version (${localVer}) > remote (${remoteVer}) — pushed to remote.`,
    };
  }

  // Remote version is higher
  await writeStateToFile(stateDir, group, remoteState);
  return {
    action: 'local-updated',
    localVersion: localVer,
    remoteVersion: remoteVer,
    message: `Remote version (${remoteVer}) > local (${localVer}) — pulled to local.`,
  };
}
