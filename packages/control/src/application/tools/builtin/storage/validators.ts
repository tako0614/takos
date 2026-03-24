import type { ToolContext } from '../../types';

export function validateStoragePath(path: string, fieldName: string = 'path'): string {
  if (!path || typeof path !== 'string') {
    throw new Error(`Invalid ${fieldName}: must be a non-empty string`);
  }

  if (/\0/.test(path)) {
    throw new Error(`Invalid ${fieldName}: contains null bytes`);
  }

  const normalized = path
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');

  return normalized;
}

export function validateR2Key(key: string, _context: ToolContext): string {
  return validateStoragePath(key, 'key');
}

export function validateKVKey(key: string): string {
  if (!key || typeof key !== 'string') {
    throw new Error('Invalid KV key: must be a non-empty string');
  }

  if (/\0/.test(key)) {
    throw new Error('Invalid KV key: contains null bytes');
  }

  return key;
}
