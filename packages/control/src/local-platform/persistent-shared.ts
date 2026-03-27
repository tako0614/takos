import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { rm } from 'node:fs/promises';

export async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureParentDirectory(filePath);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function removeLocalDataDir(dataDir: string): Promise<void> {
  await rm(dataDir, { recursive: true, force: true });
}
