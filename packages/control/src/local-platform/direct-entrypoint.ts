import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function resolveEntrypointUrl(): Promise<string | null> {
  const entrypoint = process.argv[1];
  if (!entrypoint) return null;
  if (
    entrypoint.startsWith('.') ||
    entrypoint.startsWith('/') ||
    entrypoint.startsWith('file:')
  ) {
    return pathToFileURL(path.resolve(process.cwd(), entrypoint)).href;
  }
  if (typeof import.meta.resolve === 'function') {
    return import.meta.resolve(entrypoint);
  }
  return null;
}

export async function isDirectEntrypoint(moduleUrl: string): Promise<boolean> {
  return moduleUrl === await resolveEntrypointUrl();
}

export function logEntrypointError(error: unknown): never {
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
  } else {
    console.error(String(error));
  }
  process.exit(1);
}
