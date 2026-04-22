import * as fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import * as path from "node:path";
import {
  verifyNoSymlinkPathComponents,
  verifyPathWithinAfterAccess,
  verifyPathWithinBeforeCreate,
} from "./paths.ts";
import { SymlinkNotAllowedError, SymlinkWriteError } from "../shared/errors.ts";

function isSymlinkOpenError(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ELOOP";
}

export async function writeFileWithinSpace(
  baseDir: string,
  fullPath: string,
  content: string | Uint8Array,
  encoding?: string,
  mode?: number,
): Promise<number> {
  await verifyNoSymlinkPathComponents(baseDir, fullPath, "path");
  await verifyPathWithinBeforeCreate(baseDir, fullPath, "path");

  const dirPath = path.dirname(fullPath);
  await fs.mkdir(dirPath, { recursive: true });
  // Re-verify after mkdir to catch symlink-swap TOCTOU attacks:
  // An attacker could replace a parent directory with a symlink between
  // the initial check and mkdir. This second check closes that window.
  await verifyNoSymlinkPathComponents(baseDir, dirPath, "path");
  await verifyPathWithinAfterAccess(baseDir, dirPath, "path");

  try {
    const lstats = await fs.lstat(fullPath);
    if (lstats.isSymbolicLink()) {
      throw new SymlinkWriteError();
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  let handle: fs.FileHandle;
  try {
    handle = await fs.open(
      fullPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC |
        fsConstants.O_NOFOLLOW,
    );
  } catch (err) {
    if (isSymlinkOpenError(err)) {
      throw new SymlinkNotAllowedError();
    }
    throw err;
  }

  try {
    await verifyPathWithinAfterAccess(baseDir, fullPath, "path");
    if (typeof content === "string") {
      await handle.writeFile(
        content,
        encoding as Parameters<typeof handle.writeFile>[1],
      );
    } else {
      await handle.writeFile(content);
    }
    if (typeof mode === "number") {
      await handle.chmod(mode);
    }
    const stats = await handle.stat();
    return stats.size;
  } finally {
    await handle.close();
  }
}
