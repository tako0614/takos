import * as fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import * as path from 'path';
import {
  verifyNoSymlinkPathComponents,
  verifyPathWithinAfterAccess,
  verifyPathWithinBeforeCreate,
} from './paths.js';
import { SymlinkNotAllowedError, SymlinkWriteError } from '../shared/errors.js';

class SpaceFileTooLargeError extends Error {
  code = 'FILE_TOO_LARGE' as const;

  constructor(public readonly filePath: string, public readonly maxBytes: number) {
    super(`File exceeds size limit (${maxBytes} bytes): ${filePath}`);
    this.name = 'SpaceFileTooLargeError';
  }
}

function isSymlinkOpenError(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ELOOP';
}

export async function writeFileWithinSpace(
  baseDir: string,
  fullPath: string,
  content: string | Buffer,
  encoding?: BufferEncoding,
  mode?: number
): Promise<number> {
  await verifyNoSymlinkPathComponents(baseDir, fullPath, 'path');
  await verifyPathWithinBeforeCreate(baseDir, fullPath, 'path');

  const dirPath = path.dirname(fullPath);
  await fs.mkdir(dirPath, { recursive: true });
  // Re-verify after mkdir to catch symlink-swap TOCTOU attacks:
  // An attacker could replace a parent directory with a symlink between
  // the initial check and mkdir. This second check closes that window.
  await verifyNoSymlinkPathComponents(baseDir, dirPath, 'path');
  await verifyPathWithinAfterAccess(baseDir, dirPath, 'path');

  try {
    const lstats = await fs.lstat(fullPath);
    if (lstats.isSymbolicLink()) {
      throw new SymlinkWriteError();
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  let handle: fs.FileHandle;
  try {
    handle = await fs.open(
      fullPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW
    );
  } catch (err) {
    if (isSymlinkOpenError(err)) {
      throw new SymlinkNotAllowedError();
    }
    throw err;
  }

  try {
    await verifyPathWithinAfterAccess(baseDir, fullPath, 'path');
    if (typeof content === 'string') {
      await handle.writeFile(content, encoding);
    } else {
      await handle.writeFile(content);
    }
    if (typeof mode === 'number') {
      await handle.chmod(mode);
    }
    const stats = await handle.stat();
    return stats.size;
  } finally {
    await handle.close();
  }
}

/** @deprecated Use {@link writeFileWithinSpace} instead. */
export const writeFileWithinWorkspace = writeFileWithinSpace;
