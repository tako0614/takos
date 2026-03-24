import * as fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import * as path from 'path';
import { Hono } from 'hono';
import {
  resolvePathWithin,
  verifyPathWithinAfterAccess,
} from '../../runtime/paths.js';
import { isProbablyBinary } from '../../runtime/validation.js';
import { resolveSessionWorkDir } from './session-utils.js';
import { OwnerBindingError, SymlinkWriteError, isBoundaryViolationError } from '../../shared/errors.js';
import { forbidden, internalError } from '@takos/common/middleware/hono';

function handleRouteError(c: import('hono').Context, err: unknown, label: string, opts?: { checkSymlink?: boolean }): Response {
  if (err instanceof OwnerBindingError) return forbidden(c, err.message);
  if (opts?.checkSymlink && isBoundaryViolationError(err)) {
    return forbidden(c, err instanceof SymlinkWriteError ? 'Cannot write to symlinks' : 'Path escapes workspace boundary');
  }
  c.get('log')?.error(`${label} error`, { error: err as Error });
  return internalError(c, `${label} failed`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function safeReadFileNoFollow(filePath: string): Promise<{ buffer: Buffer; size: number } | null> {
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) return null;
    const buffer = await handle.readFile();
    return { buffer, size: stat.size };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ELOOP') {
      return null;
    }
    throw err;
  } finally {
    await handle?.close();
  }
}

const SNAPSHOT_EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  'dist',
  'build',
  '.cache',
  '.turbo',
  '.wrangler',
  'coverage',
  '__pycache__',
  'venv',
  '.venv',
]);

const MAX_SNAPSHOT_FILE_SIZE = 5 * 1024 * 1024;
const MAX_SNAPSHOT_TOTAL_SIZE = 100 * 1024 * 1024;

type SnapshotFile = {
  path: string;
  content: string;
  size: number;
  is_binary?: boolean;
  encoding?: 'utf-8' | 'base64';
};

// ---------------------------------------------------------------------------
// Snapshot route
// ---------------------------------------------------------------------------

const app = new Hono();

app.post('/session/snapshot', async (c) => {
  try {
    const body = await c.req.json() as {
      session_id: string;
      space_id: string;
      path?: string;
      include_binary?: boolean;
    };
    const { path: snapshotPath, include_binary } = body;

    const session = await resolveSessionWorkDir(c, body);
    if ('error' in session) return session.error;
    const { sessionId: session_id, workDir } = session;
    const targetDir = snapshotPath ? resolvePathWithin(workDir, snapshotPath, 'path', true) : workDir;
    const targetLstats = await fs.lstat(targetDir);
    if (targetLstats.isSymbolicLink()) {
      return forbidden(c, 'Symlinks are not allowed');
    }
    await verifyPathWithinAfterAccess(workDir, targetDir, 'path');

    const files: SnapshotFile[] = [];
    let totalSize = 0;
    const skippedDirs: string[] = [];
    const skippedLargeFiles: string[] = [];
    const skippedBinaryFiles: string[] = [];
    const skippedSymlinkPaths: string[] = [];

    const excludeDirs = new Set(SNAPSHOT_EXCLUDE_DIRS);
    if (snapshotPath) {
      const rootDir = snapshotPath.split('/').filter(Boolean)[0];
      if (rootDir) excludeDirs.delete(rootDir);
    }

    async function walkDir(dir: string, prefix: string = ''): Promise<void> {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        const relativePath = prefix ? `${prefix}/${item.name}` : item.name;

        const lstats = await fs.lstat(fullPath).catch(() => null);
        if (!lstats) continue;

        if (lstats.isSymbolicLink()) {
          skippedSymlinkPaths.push(relativePath);
          continue;
        }

        if (lstats.isDirectory()) {
          if (excludeDirs.has(item.name)) {
            skippedDirs.push(relativePath);
            continue;
          }
          try {
            await verifyPathWithinAfterAccess(workDir, fullPath, 'path');
          } catch {
            skippedSymlinkPaths.push(relativePath);
            continue;
          }
          await walkDir(fullPath, relativePath);
          continue;
        }

        if (!lstats.isFile()) continue;

        try {
          await verifyPathWithinAfterAccess(workDir, fullPath, 'path');

          const result = await safeReadFileNoFollow(fullPath);
          if (!result) {
            skippedSymlinkPaths.push(relativePath);
            continue;
          }

          const { buffer, size } = result;

          if (size > MAX_SNAPSHOT_FILE_SIZE) {
            skippedLargeFiles.push(relativePath);
            continue;
          }

          if (totalSize + size > MAX_SNAPSHOT_TOTAL_SIZE) {
            c.get('log')?.info('Snapshot total size limit reached', { totalSize });
            return;
          }

          await verifyPathWithinAfterAccess(workDir, fullPath, 'path');
          const isBinary = isProbablyBinary(buffer);

          if (isBinary && !include_binary) {
            skippedBinaryFiles.push(relativePath);
            continue;
          }

          const encoding = isBinary ? 'base64' : 'utf-8';
          files.push({
            path: relativePath,
            content: buffer.toString(encoding),
            size,
            is_binary: isBinary,
            encoding,
          });
          totalSize += size;
        } catch {
          // Skip unreadable files or files failing boundary checks.
        }
      }
    }

    const startPrefix = snapshotPath ? snapshotPath.replace(/^\/+/, '') : '';
    await walkDir(targetDir, startPrefix);

    c.get('log')?.info('Snapshot complete', { fileCount: files.length, totalSize, skippedDirs: skippedDirs.length });

    return c.json({
      success: true,
      session_id,
      files,
      file_count: files.length,
      total_size: totalSize,
      skipped_dirs: skippedDirs,
      skipped_large_files: skippedLargeFiles,
      skipped_binary_files: skippedBinaryFiles,
      skipped_symlink_paths: skippedSymlinkPaths,
    });
  } catch (err) {
    return handleRouteError(c, err, 'Snapshot', { checkSymlink: true });
  }
});

export default app;
