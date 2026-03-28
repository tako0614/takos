import fs from 'node:fs/promises';
import path from 'node:path';
import type { TakosState } from './state-types.js';

const STATE_FILE_NAME = 'state.json';

/**
 * .takos ディレクトリのパスを返す（state.json の格納先）。
 */
export function getStateDir(manifestDir: string): string {
  return path.join(manifestDir, '.takos');
}

/**
 * .takos/state.json のフルパスを返す（表示用）。
 */
export function getStateFilePath(manifestDir: string): string {
  return path.join(manifestDir, '.takos', STATE_FILE_NAME);
}

/**
 * state.json を読み込む。ファイルがなければ null を返す（初回 apply）。
 */
export async function readState(stateDir: string): Promise<TakosState | null> {
  const filePath = path.join(stateDir, STATE_FILE_NAME);
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
 * state.json を書き込む。ディレクトリがなければ作成する。
 */
export async function writeState(stateDir: string, state: TakosState): Promise<void> {
  await fs.mkdir(stateDir, { recursive: true });
  const filePath = path.join(stateDir, STATE_FILE_NAME);
  await fs.writeFile(filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}
