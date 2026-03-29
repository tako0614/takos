import fs from 'node:fs/promises';
import path from 'node:path';
import type { TakosState } from './state-types.js';

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
export async function readState(stateDir: string, group: string): Promise<TakosState | null> {
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
 */
export async function writeState(stateDir: string, group: string, state: TakosState): Promise<void> {
  await fs.mkdir(stateDir, { recursive: true });
  const filePath = getStateFilePath(stateDir, group);
  await fs.writeFile(filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * state ファイルを削除する。
 */
export async function deleteStateFile(stateDir: string, group: string): Promise<void> {
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
export async function listStateGroups(stateDir: string): Promise<string[]> {
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
