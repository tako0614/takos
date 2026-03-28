import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { type ActionContext } from '../executor.js';
import { pushLog } from '../../logging.js';
import { s3Client, isR2Configured } from '../../../storage/r2.js';
import { R2_BUCKET } from '../../../shared/config.js';
import { getErrorMessage } from 'takos-common/errors';
import { parseTarEntriesFromGzipArchive } from './tar-parser.js';

function toStringArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * Matches only null, CR, and LF — the characters that break line-oriented
 * key/name formats (cache keys, artifact names).
 *
 * This is intentionally narrower than ALL_CONTROL_CHARS_PATTERN in
 * runtime/validation.ts, which rejects all C0 control characters + DEL
 * for git paths, author names, and similar security-sensitive inputs.
 */
export const LINE_UNSAFE_CHARS_PATTERN = /[\0\r\n]/;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_R2_PREFIX = 'actions/cache';
const CACHE_NAMESPACE_VERSION = 'v2';
const CACHE_NAMESPACE_HASH_LENGTH = 24;
const CACHE_MAX_KEY_LENGTH = 512;
const CACHE_ALLOWED_TAR_ENTRY_TYPES = new Set(['0', '1', '2', '5', '7']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CacheNamespaceInfo {
  value: string;
  source: string;
}

interface CacheObjectCandidate {
  r2Key: string;
  mode: 'namespaced' | 'legacy';
}

function spawnTar(args: string[], cwd: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tar = spawn('tar', args, { cwd });

    tar.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`tar failed with code ${code}`));
      }
    });

    tar.on('error', reject);
  });
}

async function cleanupTempFile(tempPath: string, context: ActionContext, reason: string): Promise<void> {
  try {
    await fs.unlink(tempPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      const message = getErrorMessage(err);
      pushLog(context.logs, `Warning: Failed to clean up temp file (${reason}): ${tempPath} - ${message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Cache key validation
// ---------------------------------------------------------------------------

function validateCacheKey(rawKey: string, label: string): string {
  if (typeof rawKey !== 'string') {
    throw new Error(`Invalid ${label}: expected string`);
  }
  if (rawKey.trim().length === 0) {
    throw new Error(`Invalid ${label}: must not be empty`);
  }
  if (rawKey.length > CACHE_MAX_KEY_LENGTH) {
    throw new Error(`Invalid ${label}: exceeds ${CACHE_MAX_KEY_LENGTH} characters`);
  }
  if (LINE_UNSAFE_CHARS_PATTERN.test(rawKey)) {
    throw new Error(`Invalid ${label}: contains control characters`);
  }
  return rawKey;
}

// ---------------------------------------------------------------------------
// R2 object helpers
// ---------------------------------------------------------------------------

function isObjectNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }

  const maybeErr = err as {
    name?: string;
    Code?: string;
    $metadata?: {
      httpStatusCode?: number;
    };
  };

  return (
    maybeErr.name === 'NoSuchKey' ||
    maybeErr.Code === 'NoSuchKey' ||
    maybeErr.$metadata?.httpStatusCode === 404
  );
}

// ---------------------------------------------------------------------------
// Cache namespace resolution
// ---------------------------------------------------------------------------

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

function buildCacheNamespace(context: ActionContext): CacheNamespaceInfo {
  const spaceId = firstNonEmpty([context.env.TAKOS_SPACE_ID, context.env.SPACE_ID]);
  const repository = firstNonEmpty([context.env.GITHUB_REPOSITORY]);
  const workflow = firstNonEmpty([context.env.GITHUB_WORKFLOW]);

  const namespaceParts: string[] = [];
  if (spaceId) {
    namespaceParts.push(`workspace:${spaceId}`);
  }
  if (repository) {
    namespaceParts.push(`repository:${repository}`);
  }
  if (namespaceParts.length === 0 && workflow) {
    namespaceParts.push(`workflow:${workflow}`);
  }
  if (namespaceParts.length === 0) {
    namespaceParts.push('default');
  }

  const seed = namespaceParts.join('|');
  const value = createHash('sha256')
    .update(seed)
    .digest('hex')
    .slice(0, CACHE_NAMESPACE_HASH_LENGTH);

  return { value, source: seed };
}

function buildNamespacedCacheObjectKey(cacheKey: string, namespace: CacheNamespaceInfo): string {
  return `${CACHE_R2_PREFIX}/${CACHE_NAMESPACE_VERSION}/${namespace.value}/${cacheKey}.tar.gz`;
}

function buildLegacyCacheObjectKey(cacheKey: string): string {
  return `${CACHE_R2_PREFIX}/${cacheKey}.tar.gz`;
}

function buildCacheObjectCandidates(
  cacheKey: string,
  namespace: CacheNamespaceInfo
): CacheObjectCandidate[] {
  return [
    {
      r2Key: buildNamespacedCacheObjectKey(cacheKey, namespace),
      mode: 'namespaced',
    },
    {
      r2Key: buildLegacyCacheObjectKey(cacheKey),
      mode: 'legacy',
    },
  ];
}

// ---------------------------------------------------------------------------
// Archive path safety
// ---------------------------------------------------------------------------

function normalizeArchivePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  return normalized || '.';
}

function isAbsoluteArchivePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:\//.test(value);
}

function containsTraversalSegments(value: string): boolean {
  return value.split('/').some((segment) => segment === '..');
}

function assertSafeArchivePath(value: string, label: string, allowDot: boolean): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is empty`);
  }

  const normalizedValue = normalizeArchivePath(value);
  if (!allowDot && normalizedValue === '.') {
    throw new Error(`${label} resolves to workspace root`);
  }
  if (isAbsoluteArchivePath(normalizedValue)) {
    throw new Error(`${label} is absolute: ${value}`);
  }
  if (containsTraversalSegments(normalizedValue)) {
    throw new Error(`${label} contains path traversal: ${value}`);
  }

  return normalizedValue;
}

function validateCacheArchiveEntries(archiveData: Uint8Array): void {
  const entries = parseTarEntriesFromGzipArchive(archiveData);

  for (const entry of entries) {
    if (!CACHE_ALLOWED_TAR_ENTRY_TYPES.has(entry.type)) {
      throw new Error(`Unsupported archive entry type "${entry.type}" (${entry.path || '<empty>'})`);
    }

    const entryPath = assertSafeArchivePath(entry.path, 'Archive entry path', true);
    if (entryPath === '.' && entry.type !== '5') {
      throw new Error('Archive entry path "." is only allowed for directory entries');
    }

    if (entry.type === '1' || entry.type === '2') {
      if (entry.linkPath.trim().length === 0) {
        throw new Error(`Archive link entry "${entryPath}" has empty target`);
      }
      assertSafeArchivePath(entry.linkPath, `Archive link target for "${entryPath}"`, true);
    }
  }
}

// ---------------------------------------------------------------------------
// Exported cache operations
// ---------------------------------------------------------------------------

export async function cache(
  inputs: {
    path: string | string[];
    key: string;
    'restore-keys'?: string[];
  },
  context: ActionContext
): Promise<{ cacheHit: boolean }> {
  pushLog(context.logs, 'Running actions/cache');

  if (!isR2Configured()) {
    pushLog(context.logs, 'Warning: R2 storage not configured, cache disabled');
    return { cacheHit: false };
  }

  const cachePaths = toStringArray(inputs.path);
  const cacheKey = validateCacheKey(inputs.key, 'cache key');
  const restoreKeys: string[] = [];
  for (const restoreKey of inputs['restore-keys'] || []) {
    try {
      restoreKeys.push(validateCacheKey(restoreKey, 'restore key'));
    } catch (err) {
      pushLog(context.logs, `Warning: Ignoring invalid restore key: ${getErrorMessage(err)}`);
    }
  }

  pushLog(context.logs, `Cache key: ${cacheKey}`);
  pushLog(context.logs, `Cache paths: ${cachePaths.join(', ')}`);
  const cacheNamespace = buildCacheNamespace(context);
  pushLog(
    context.logs,
    `Cache namespace: ${cacheNamespace.value} (seed: ${cacheNamespace.source})`
  );

  const keysToTry = [...new Set([cacheKey, ...restoreKeys])];
  let cacheHit = false;
  let matchedKey = '';

  restoreLoop: for (const key of keysToTry) {
    for (const candidate of buildCacheObjectCandidates(key, cacheNamespace)) {
      try {
        const getResult = await s3Client.send(
          new GetObjectCommand({
            Bucket: R2_BUCKET,
            Key: candidate.r2Key,
          })
        );

        if (!getResult.Body) {
          continue;
        }

        pushLog(
          context.logs,
          `Cache hit for key: ${key} (${candidate.mode}, object: ${candidate.r2Key})`
        );

        const cacheData = await getResult.Body.transformToByteArray();
        const tempTarPath = path.join(context.workspacePath, '.cache-temp.tar.gz');
        await fs.writeFile(tempTarPath, cacheData);

        try {
          validateCacheArchiveEntries(cacheData);
          await spawnTar(
            ['-xzf', tempTarPath, '--no-same-owner', '--no-same-permissions', '-C', context.workspacePath],
            context.workspacePath
          );
        } catch (err) {
          throw new Error(
            `Rejected cache archive "${candidate.r2Key}": ${getErrorMessage(err)}`
          );
        } finally {
          await cleanupTempFile(tempTarPath, context, 'cache restore');
        }

        if (candidate.mode === 'legacy') {
          pushLog(
            context.logs,
            `Warning: Restored legacy global cache key "${key}". Future saves use namespaced keys.`
          );
        }

        cacheHit = true;
        matchedKey = key;
        break restoreLoop;
      } catch (err) {
        if (isObjectNotFoundError(err)) {
          continue;
        }

        pushLog(
          context.logs,
          `Warning: Cache restore failed for key "${key}" (${candidate.mode}): ${getErrorMessage(err)}`
        );
      }
    }
  }

  context.setOutput('cache-primary-key', cacheKey);
  context.setOutput('cache-matched-key', cacheHit ? matchedKey : '');

  if (!cacheHit) {
    pushLog(context.logs, 'Cache miss');
  }

  return { cacheHit };
}

