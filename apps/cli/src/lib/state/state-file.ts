/**
 * State file management — unified API + file fallback.
 *
 * Default behaviour:
 *   - When the takos API is reachable and authenticated, state is
 *     read/written via the API (see ./api-client.ts).
 *   - When the API is unavailable (offline, local dev, no credentials)
 *     or when `opts.offline` is explicitly set, the file-based backend
 *     (.takos/state.{group}.json) is used instead.
 *   - The fallback is silent — no login prompt or error is shown when
 *     the API is simply not available (covers CF-token-only workflows
 *     and self-hosted environments without a takos API).
 *
 * The file-based helpers (`readStateFromFile`, `writeStateToFile`, etc.)
 * are still exported for direct use in tests and migration tooling.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { TakosState } from './state-types.js';
import {
  hasApiEndpoint,
  readGroupStateFromApi,
  writeGroupStateToApi,
  deleteGroupStateFromApi,
  listGroupsFromApi,
} from './api-client.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface StateAccessOptions {
  /** Force file-based backend even when the API is available. */
  offline?: boolean;
  /**
   * Expected version for optimistic locking (file-based backend only).
   * When set, writeState will fail if the on-disk version differs from
   * this value, indicating a concurrent modification.
   */
  expectedVersion?: number;
}

// ---------------------------------------------------------------------------
// File-based helpers (fallback / legacy)
// ---------------------------------------------------------------------------

/**
 * .takos ディレクトリのパスを返す（state ファイルの格納先）。
 */
export function getStateDir(manifestDir: string): string {
  return path.join(manifestDir, '.takos');
}

/**
 * .takos/state.{group}.json のフルパスを返す（表示用）。
 */
export function getStateFilePath(stateDir: string, group: string): string {
  return path.join(stateDir, `state.${group}.json`);
}

/**
 * state.{group}.json を読み込む。ファイルがなければ null を返す（初回 apply）。
 */
export async function readStateFromFile(stateDir: string, group: string): Promise<TakosState | null> {
  const filePath = getStateFilePath(stateDir, group);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as TakosState;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * state.{group}.json を書き込む。ディレクトリがなければ作成する。
 *
 * When `expectedVersion` is provided, the function performs an optimistic
 * lock check: it reads the current file and verifies its version matches
 * the expected value. If another process has written in the meantime, the
 * version will differ and an error is thrown.
 *
 * The state's `version` field is always incremented before writing.
 */
export async function writeStateToFile(
  stateDir: string,
  group: string,
  state: TakosState,
  expectedVersion?: number,
): Promise<void> {
  await fs.mkdir(stateDir, { recursive: true });
  const filePath = getStateFilePath(stateDir, group);

  // Optimistic lock: verify version has not changed since last read
  if (expectedVersion !== undefined) {
    const current = await readStateFromFile(stateDir, group);
    if (current && current.version !== expectedVersion) {
      throw new Error(
        `State conflict: expected version ${expectedVersion}, got ${current.version}. ` +
          'Another operation may have modified the state. Re-read and retry.',
      );
    }
  }

  // Increment version before writing
  state.version = (state.version || 0) + 1;
  state.updatedAt = new Date().toISOString();

  await fs.writeFile(filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * state ファイルを削除する。
 */
export async function deleteStateFromFile(stateDir: string, group: string): Promise<void> {
  const filePath = getStateFilePath(stateDir, group);
  try {
    await fs.unlink(filePath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return; // already gone
    }
    throw err;
  }
}

/**
 * .takos/ 内の state.*.json をスキャンして group 名一覧を返す。
 */
export async function listStateGroupsFromFile(stateDir: string): Promise<string[]> {
  let files: string[];
  try {
    files = await fs.readdir(stateDir);
  } catch {
    return [];
  }
  const groups: string[] = [];
  for (const f of files) {
    if (f.startsWith('state.') && f.endsWith('.json')) {
      groups.push(f.slice('state.'.length, -'.json'.length));
    }
  }
  return groups.sort();
}

// ---------------------------------------------------------------------------
// Unified API — chooses API or file automatically
// ---------------------------------------------------------------------------

function useApi(opts?: StateAccessOptions): boolean {
  if (opts?.offline) return false;
  return hasApiEndpoint();
}

/**
 * Read state for a group. Uses the API when available; falls back to
 * local file when offline or unauthenticated.
 *
 * The fallback is silent — no error is shown when the API is not
 * available. This covers CF-token-only workflows and self-hosted
 * environments without a takos API.
 *
 * @param stateDir  Path to .takos directory (used only in file mode)
 * @param group     Group name
 * @param opts      Access options ({ offline?: boolean })
 */
export async function readState(
  stateDir: string,
  group: string,
  opts?: StateAccessOptions,
): Promise<TakosState | null> {
  if (useApi(opts)) {
    try {
      return await readGroupStateFromApi(group);
    } catch {
      // API unreachable — fall through to file silently
    }
  }
  return readStateFromFile(stateDir, group);
}

/**
 * Write state for a group. Uses the API when available; falls back to
 * local file when offline or unauthenticated.
 * When the API is used, a local file copy is also written for caching.
 *
 * In file mode, if `opts.expectedVersion` is set, an optimistic lock
 * check is performed before writing.
 */
export async function writeState(
  stateDir: string,
  group: string,
  state: TakosState,
  opts?: StateAccessOptions,
): Promise<void> {
  if (useApi(opts)) {
    try {
      await writeGroupStateToApi(group, state);
      // Also write locally as a cache (no lock check for cache writes)
      await writeStateToFile(stateDir, group, state).catch(() => {});
      return;
    } catch {
      // API unreachable — fall through to file silently
    }
  }
  await writeStateToFile(stateDir, group, state, opts?.expectedVersion);
}

/**
 * Delete state for a group. Uses the API when available; falls back to
 * local file when offline or unauthenticated.
 */
export async function deleteStateFile(
  stateDir: string,
  group: string,
  opts?: StateAccessOptions,
): Promise<void> {
  if (useApi(opts)) {
    try {
      await deleteGroupStateFromApi(group);
      // Also remove local file
      await deleteStateFromFile(stateDir, group).catch(() => {});
      return;
    } catch {
      // API unreachable — fall through to file silently
    }
  }
  await deleteStateFromFile(stateDir, group);
}

/**
 * List all group names. Uses the API when available; falls back to
 * scanning local files when offline or unauthenticated.
 */
export async function listStateGroups(
  stateDir: string,
  opts?: StateAccessOptions,
): Promise<string[]> {
  if (useApi(opts)) {
    try {
      return await listGroupsFromApi();
    } catch {
      // API unreachable — fall through to file silently
    }
  }
  return listStateGroupsFromFile(stateDir);
}
