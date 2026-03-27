import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import path from 'path';
import * as fs from 'fs/promises';
import {
  S3_ENDPOINT,
  S3_REGION,
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  S3_BUCKET,
  MAX_R2_DOWNLOAD_FILE_BYTES,
  MAX_R2_DOWNLOAD_TOTAL_BYTES,
} from '../shared/config.js';
import { pushLog } from '../runtime/logging.js';
import { isPathWithinBase } from '../runtime/paths.js';
import { randomBytes } from 'crypto';
import { createLogger } from '@takos/common/logger';

function generateTempSuffix(): string {
  const id = randomBytes(6).toString('base64').replace(/[+/=]/g, '').slice(0, 8);
  return `${Date.now()}-${id}`;
}

const logger = createLogger({ service: 'takos-runtime' });

export const s3Client = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT || undefined,
  credentials: {
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  },
});

export function isR2Configured(): boolean {
  return Boolean(S3_ENDPOINT && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY && S3_BUCKET);
}

/**
 * Common validation for file paths: rejects empty, control chars, traversal, and absolute paths.
 */
function isPathSafe(filePath: string): boolean {
  if (filePath.length === 0) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(filePath)) return false;
  // Check traversal in raw form
  if (filePath.includes('..')) return false;
  // Decode percent-encoding and check again
  try {
    const decoded = decodeURIComponent(filePath);
    if (decoded.includes('..')) return false;
  } catch {
    return false; // Invalid percent-encoding
  }
  if (filePath.startsWith('/') || /^[A-Za-z]:/.test(filePath)) return false;
  return true;
}

/**
 * Check that a normalized path does not escape via traversal.
 */
function isNormalizedPathSafe(normalizedPath: string): boolean {
  return !normalizedPath.startsWith('..') && !normalizedPath.includes('/..') && !normalizedPath.includes('\\..');
}

/**
 * Validates and normalizes a relative path. Returns the normalized path or null if invalid.
 */
function validateRelativePath(relativePath: string): string | null {
  if (!isPathSafe(relativePath)) return null;
  const normalized = path.normalize(relativePath);
  if (!isNormalizedPathSafe(normalized)) return null;
  return normalized;
}

/**
 * Validates a file path from S3 metadata to prevent path traversal attacks.
 * Returns the sanitized full path or null if the path is invalid/malicious.
 */
function validateAndSanitizeFilePath(filePath: string, baseDir: string): string | null {
  if (/[<>:"|?*\\]/.test(filePath)) return null;

  const normalizedPath = validateRelativePath(filePath);
  if (!normalizedPath) return null;

  const fullPath = path.resolve(baseDir, normalizedPath);
  const resolvedBase = path.resolve(baseDir);

  if (!isPathWithinBase(resolvedBase, fullPath, { resolveInputs: true })) {
    return null;
  }

  return fullPath;
}

async function resolveBaseDirectory(baseDir: string, createIfMissing: boolean): Promise<string> {
  if (createIfMissing) {
    await fs.mkdir(baseDir, { recursive: true });
  }

  const resolvedBase = await fs.realpath(baseDir);
  const baseStats = await fs.stat(resolvedBase);
  if (!baseStats.isDirectory()) {
    throw new Error(`Base path is not a directory: ${baseDir}`);
  }

  return resolvedBase;
}

async function resolvePathWithinBase(baseDir: string, targetPath: string): Promise<string | null> {
  try {
    const resolvedPath = await fs.realpath(targetPath);
    if (!isPathWithinBase(baseDir, resolvedPath, { resolveInputs: true })) {
      return null;
    }
    return resolvedPath;
  } catch {
    return null;
  }
}

async function hasEscapingSymlinkComponent(baseDir: string, targetPath: string): Promise<boolean> {
  const absoluteTarget = path.resolve(targetPath);
  if (!isPathWithinBase(baseDir, absoluteTarget, { resolveInputs: true })) {
    return true;
  }

  const relativePath = path.relative(baseDir, absoluteTarget);
  if (relativePath === '' || relativePath === '.') {
    return false;
  }

  const pathParts = relativePath.split(path.sep).filter(Boolean);
  let currentPath = baseDir;

  for (const pathPart of pathParts) {
    currentPath = path.join(currentPath, pathPart);
    let currentStats: Awaited<ReturnType<typeof fs.lstat>>;

    try {
      currentStats = await fs.lstat(currentPath);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') {
        return false;
      }
      return true;
    }

    if (!currentStats.isSymbolicLink()) {
      continue;
    }

    const resolvedLinkTarget = await resolvePathWithinBase(baseDir, currentPath);
    if (!resolvedLinkTarget) {
      return true;
    }
  }

  return false;
}

async function downloadSpaceFiles(
  spaceId: string,
  localDir: string,
  logs: string[]
): Promise<number> {
  const prefix = `workspaces/${spaceId}/files/`;
  let continuationToken: string | undefined;
  let fileCount = 0;
  let totalDownloadedBytes = 0;
  let downloadFailureCount = 0;
  const resolvedBaseDir = await resolveBaseDirectory(localDir, true);

  pushLog(logs, 'Downloading space files...');

  do {
    const listResult = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of listResult.Contents ?? []) {
      if (!obj.Key) continue;

      const fileId = obj.Key.slice(prefix.length);
      if (!fileId || fileId.endsWith('/')) continue;

      const fileSize = obj.Size ?? 0;
      if (fileSize > MAX_R2_DOWNLOAD_FILE_BYTES) {
        pushLog(logs, `Warning: Skipping file too large (${fileSize} bytes): ${obj.Key}`);
        continue;
      }
      if (totalDownloadedBytes + fileSize > MAX_R2_DOWNLOAD_TOTAL_BYTES) {
        pushLog(logs, `Warning: Total download limit reached. Stopping download.`);
        break;
      }

      try {
        const getResult = await s3Client.send(
          new GetObjectCommand({ Bucket: S3_BUCKET, Key: obj.Key })
        );
        if (!getResult.Body) continue;

        const rawFilePath = getResult.Metadata?.['file-path'] || fileId;
        const validatedPath = validateAndSanitizeFilePath(rawFilePath, resolvedBaseDir);
        if (!validatedPath) {
          pushLog(logs, `Warning: Skipping file with invalid path: ${rawFilePath}`);
          continue;
        }

        const targetDir = path.dirname(validatedPath);
        if (await hasEscapingSymlinkComponent(resolvedBaseDir, targetDir)) {
          pushLog(logs, `Warning: Skipping file with symlink escape attempt: ${rawFilePath}`);
          continue;
        }

        await fs.mkdir(targetDir, { recursive: true });
        const resolvedTargetDir = await resolvePathWithinBase(resolvedBaseDir, targetDir);
        if (!resolvedTargetDir) {
          pushLog(logs, `Warning: Skipping file due to symlink escape after mkdir: ${rawFilePath}`);
          continue;
        }

        const content = await getResult.Body.transformToByteArray();

        if (content.length > MAX_R2_DOWNLOAD_FILE_BYTES) {
          pushLog(logs, `Warning: Downloaded file too large (${content.length} bytes), skipping: ${rawFilePath}`);
          continue;
        }

        // Atomic write: temp file then rename, with symlink race check
        const tempPath = `${validatedPath}.${generateTempSuffix()}.tmp`;
        await fs.writeFile(tempPath, content);

        const resolvedTempPath = await resolvePathWithinBase(resolvedBaseDir, tempPath);
        if (!resolvedTempPath) {
          await fs.unlink(tempPath).catch((err) => {
            logger.debug(`Failed to clean up temp file ${tempPath}`, { error: err });
          });
          pushLog(logs, `Warning: Path traversal detected after write, skipping: ${rawFilePath}`);
          continue;
        }

        if (!(await resolvePathWithinBase(resolvedBaseDir, resolvedTargetDir))) {
          await fs.unlink(tempPath).catch(() => undefined);
          pushLog(logs, `Warning: Destination directory escaped base path, skipping: ${rawFilePath}`);
          continue;
        }

        await fs.rename(tempPath, validatedPath);

        const resolvedFinalPath = await resolvePathWithinBase(resolvedBaseDir, validatedPath);
        if (!resolvedFinalPath) {
          // Attempt to remove the escaped file
          await fs.unlink(validatedPath).catch(() => undefined);
          pushLog(logs, `Warning: Path traversal detected after rename, removed: ${rawFilePath}`);
          downloadFailureCount++;
          continue;
        }

        totalDownloadedBytes += content.length;
        fileCount++;
      } catch (err) {
        pushLog(logs, `Warning: Failed to download ${obj.Key}: ${err}`);
        downloadFailureCount++;
      }
    }

    // Check if we've exceeded total limit before continuing pagination
    if (totalDownloadedBytes >= MAX_R2_DOWNLOAD_TOTAL_BYTES) {
      break;
    }

    continuationToken = listResult.NextContinuationToken;
  } while (continuationToken);

  pushLog(logs, `Downloaded ${fileCount} files (${totalDownloadedBytes} bytes total)`);
  if (downloadFailureCount > 0) {
    throw new Error(`Failed to download ${downloadFailureCount} space files from R2`);
  }
  return fileCount;
}

async function uploadSpaceFiles(
  spaceId: string,
  localDir: string,
  outputPaths: string[],
  logs: string[]
): Promise<number> {
  let uploadCount = 0;
  let uploadFailureCount = 0;
  const resolvedBaseDir = await resolveBaseDirectory(localDir, false);

  for (const relativePath of outputPaths) {
    // Validate the relative path before processing
    const sanitizedRelativePath = validateRelativePath(relativePath);
    if (!sanitizedRelativePath) {
      pushLog(logs, `Warning: Skipping file with invalid path: ${relativePath}`);
      continue;
    }

    // Validate the full local path to prevent reading outside localDir
    const validatedLocalPath = validateAndSanitizeFilePath(sanitizedRelativePath, resolvedBaseDir);
    if (!validatedLocalPath) {
      pushLog(logs, `Warning: Skipping file with path traversal attempt: ${relativePath}`);
      continue;
    }

    try {
      const resolvedLocalPath = await resolvePathWithinBase(resolvedBaseDir, validatedLocalPath);
      if (!resolvedLocalPath) {
        pushLog(logs, `Warning: Skipping file with symlink escape attempt: ${sanitizedRelativePath}`);
        continue;
      }

      const localStats = await fs.stat(resolvedLocalPath).catch(() => null);
      if (!localStats?.isFile()) {
        pushLog(logs, `Warning: Skipping non-file upload path: ${sanitizedRelativePath}`);
        continue;
      }

      const content = await fs.readFile(resolvedLocalPath);
      const fileId = `output-${generateTempSuffix()}`;
      const r2Key = `workspaces/${spaceId}/files/${fileId}`;

      await s3Client.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: r2Key,
          Body: content,
          Metadata: {
            'file-path': sanitizedRelativePath,
            'uploaded-at': new Date().toISOString(),
          },
        })
      );

      pushLog(logs, `Uploaded: ${sanitizedRelativePath}`);
      uploadCount++;
    } catch (err) {
      pushLog(logs, `Warning: Failed to upload ${sanitizedRelativePath}: ${err}`);
      uploadFailureCount++;
    }
  }

  if (uploadFailureCount > 0) {
    throw new Error(`Failed to upload ${uploadFailureCount} space files to R2`);
  }
  return uploadCount;
}

/** @internal Exposed for unit tests only. */
export const _testInternals = { downloadSpaceFiles, uploadSpaceFiles, downloadWorkspaceFiles: downloadSpaceFiles, uploadWorkspaceFiles: uploadSpaceFiles };
