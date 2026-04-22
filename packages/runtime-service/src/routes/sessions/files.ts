import * as fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import * as path from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import type { RuntimeEnv } from "../../types/hono.d.ts";
import { MAX_SESSION_FILE_READ_BYTES } from "../../shared/config.ts";
import {
  resolvePathWithin,
  verifyNoSymlinkPathComponents,
  verifyPathWithinAfterAccess,
  verifyPathWithinBeforeCreate,
} from "../../runtime/paths.ts";
import { isProbablyBinary } from "../../runtime/validation.ts";
import { resolveSessionWorkDir } from "./session-utils.ts";
import {
  isBoundaryViolationError,
  OwnerBindingError,
  SymlinkEscapeError,
  SymlinkNotAllowedError,
  SymlinkWriteError,
} from "../../shared/errors.ts";
import {
  badRequest,
  forbidden,
  internalError,
  notFound,
} from "takos-common/middleware/hono";
import { Buffer } from "node:buffer";

function handleRouteError(
  c: Context<RuntimeEnv>,
  err: unknown,
  label: string,
  opts?: { checkSymlink?: boolean },
): Response {
  if (err instanceof OwnerBindingError) return forbidden(c, err.message);
  if (opts?.checkSymlink && isBoundaryViolationError(err)) {
    return forbidden(
      c,
      err instanceof SymlinkWriteError
        ? "Cannot write to symlinks"
        : "Path escapes workspace boundary",
    );
  }
  c.get("log")?.error(`${label} error`, { error: err as Error });
  return internalError(c, `${label} failed`);
}

function handleReadFileError(
  c: Context<RuntimeEnv>,
  err: unknown,
): Response | null {
  const e = err as NodeJS.ErrnoException;
  if (e.code === "ENOENT") return notFound(c, "File not found");
  if (e.code === "FILE_TOO_LARGE") {
    return c.json({
      error: { code: "PAYLOAD_TOO_LARGE", message: "File too large" },
    }, 413);
  }
  if (err instanceof SymlinkNotAllowedError) {
    return forbidden(c, "Symlinks are not allowed");
  }
  if (err instanceof SymlinkEscapeError) {
    return forbidden(c, "Path escapes workspace boundary");
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function secureReadFile(
  workDir: string,
  fullPath: string,
  maxSize: number,
): Promise<
  { buffer: Buffer; stats: Awaited<ReturnType<fs.FileHandle["stat"]>> }
> {
  await verifyPathWithinAfterAccess(workDir, fullPath, "path");

  let fileHandle: fs.FileHandle;
  try {
    fileHandle = await fs.open(
      fullPath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ELOOP") {
      throw new SymlinkNotAllowedError();
    }
    throw err;
  }

  try {
    const stats = await fileHandle.stat();

    if (!stats.isFile()) {
      throw new Error("Not a regular file");
    }

    if (stats.size > maxSize) {
      const error = new Error("File too large") as Error & { code: string };
      error.code = "FILE_TOO_LARGE";
      throw error;
    }

    const buffer = Buffer.alloc(stats.size);
    if (stats.size > 0) {
      await fileHandle.read(buffer, 0, stats.size, 0);
    }

    return { buffer, stats };
  } finally {
    await fileHandle.close();
  }
}

async function prepareFileWriteTarget(
  workDir: string,
  fullPath: string,
): Promise<void> {
  await verifyNoSymlinkPathComponents(workDir, fullPath, "path");
  await verifyPathWithinBeforeCreate(workDir, fullPath, "path");

  const dirPath = path.dirname(fullPath);
  await fs.mkdir(dirPath, { recursive: true });
  await verifyPathWithinAfterAccess(workDir, dirPath, "path");

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
}

async function secureOpenFileForWrite(
  fullPath: string,
): Promise<fs.FileHandle> {
  try {
    return await fs.open(
      fullPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC |
        fsConstants.O_NOFOLLOW,
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ELOOP") {
      throw new SymlinkNotAllowedError();
    }
    throw err;
  }
}

async function resolveSessionFile(
  c: Context<RuntimeEnv>,
  body: Record<string, unknown>,
  requiredFields: string[],
): Promise<
  { workDir: string; fullPath: string; filePath: string } | { error: Response }
> {
  const filePath = body.path as string;

  const session = await resolveSessionWorkDir(c, body);
  if ("error" in session) return session;

  if (!filePath) {
    return { error: badRequest(c, `${requiredFields.join(", ")} required`) };
  }

  const { workDir } = session;
  const fullPath = resolvePathWithin(workDir, filePath, "path");
  return { workDir, fullPath, filePath };
}

async function writeFileToSession(
  c: Context<RuntimeEnv>,
  body: Record<string, unknown>,
  content: Uint8Array | string,
  encoding: string | undefined,
  label: string,
): Promise<Response> {
  try {
    const resolved = await resolveSessionFile(c, body, [
      "session_id",
      "space_id",
      "path",
    ]);
    if ("error" in resolved) return resolved.error;

    const { workDir, fullPath, filePath } = resolved;

    await prepareFileWriteTarget(workDir, fullPath);
    const fileHandle = await secureOpenFileForWrite(fullPath);
    try {
      await verifyPathWithinAfterAccess(workDir, fullPath, "path");
      if (typeof content === "string") {
        await fileHandle.writeFile(
          content,
          encoding as Parameters<typeof fileHandle.writeFile>[1],
        );
      } else {
        await fileHandle.writeFile(content);
      }
      const stats = await fileHandle.stat();
      return c.json({ success: true, path: filePath, size: stats.size });
    } finally {
      await fileHandle.close();
    }
  } catch (err) {
    return handleRouteError(c, err, label, { checkSymlink: true });
  }
}

// ---------------------------------------------------------------------------
// File routes
// ---------------------------------------------------------------------------

const app = new Hono<RuntimeEnv>();

app.post("/session/file/read", async (c) => {
  try {
    const body = await c.req.json() as {
      session_id: string;
      space_id: string;
      path: string;
      binary?: boolean;
    };
    const { path: filePath, binary } = body;

    const session = await resolveSessionWorkDir(c, body);
    if ("error" in session) return session.error;

    if (!filePath) {
      return badRequest(c, "session_id, space_id, and path required");
    }

    const { workDir } = session;
    const fullPath = resolvePathWithin(workDir, filePath, "path");

    try {
      const { buffer, stats } = await secureReadFile(
        workDir,
        fullPath,
        MAX_SESSION_FILE_READ_BYTES,
      );
      const isBinary = Boolean(binary) || isProbablyBinary(buffer);
      const fileEncoding = isBinary ? "base64" : "utf-8";

      return c.json({
        success: true,
        content: buffer.toString(fileEncoding),
        size: buffer.length,
        modified_at: stats.mtime.toISOString(),
        is_binary: isBinary,
        encoding: fileEncoding,
      });
    } catch (err) {
      const handled = handleReadFileError(c, err);
      if (handled) return handled;
      throw err;
    }
  } catch (err) {
    return handleRouteError(c, err, "File read");
  }
});

app.post("/session/file/write", async (c) => {
  const body = await c.req.json() as {
    content: string;
    [key: string]: unknown;
  };
  const { content } = body;
  if (content === undefined) {
    return badRequest(c, "session_id, space_id, path, and content required");
  }
  return writeFileToSession(c, body, content, "utf-8", "File write");
});

app.post("/session/file/write-binary", async (c) => {
  const body = await c.req.json() as {
    content_base64: string;
    [key: string]: unknown;
  };
  const { content_base64 } = body;
  if (content_base64 === undefined) {
    return badRequest(
      c,
      "session_id, space_id, path, and content_base64 required",
    );
  }
  return writeFileToSession(
    c,
    body,
    Buffer.from(content_base64, "base64"),
    undefined,
    "Binary file write",
  );
});

app.post("/session/file/delete", async (c) => {
  try {
    const body = await c.req.json() as Record<string, unknown>;
    const resolved = await resolveSessionFile(c, body, [
      "session_id",
      "space_id",
      "path",
    ]);
    if ("error" in resolved) return resolved.error;

    const { workDir, fullPath } = resolved;

    try {
      await verifyPathWithinAfterAccess(workDir, fullPath, "path");

      const lstats = await fs.lstat(fullPath);
      if (lstats.isSymbolicLink()) {
        await fs.unlink(fullPath);
      } else {
        await fs.rm(fullPath, { recursive: true, force: true });
      }

      return c.json({ success: true });
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        return notFound(c, "File not found");
      } else if (isBoundaryViolationError(err)) {
        return forbidden(c, "Path escapes workspace boundary");
      } else {
        throw err;
      }
    }
  } catch (err) {
    return handleRouteError(c, err, "File delete");
  }
});

app.post("/session/file/list", async (c) => {
  try {
    const body = await c.req.json() as {
      session_id: string;
      space_id: string;
      path?: string;
    };
    const { path: dirPath } = body;

    const session = await resolveSessionWorkDir(c, body);
    if ("error" in session) return session.error;

    const { workDir } = session;
    const targetDir = dirPath
      ? resolvePathWithin(workDir, dirPath, "path", true)
      : workDir;

    if (dirPath) {
      try {
        const lstats = await fs.lstat(targetDir);
        if (lstats.isSymbolicLink()) {
          return forbidden(c, "Cannot list symlinked directories");
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }

    const entries: Array<
      { name: string; type: "file" | "dir" | "symlink"; size?: number }
    > = [];

    try {
      const items = await fs.readdir(targetDir, { withFileTypes: true });
      for (const item of items) {
        const itemPath = path.join(targetDir, item.name);
        const lstats = await fs.lstat(itemPath);

        if (lstats.isSymbolicLink()) {
          entries.push({ name: item.name, type: "symlink" });
        } else if (lstats.isDirectory()) {
          entries.push({ name: item.name, type: "dir" });
        } else if (lstats.isFile()) {
          entries.push({ name: item.name, type: "file", size: lstats.size });
        }
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        // Directory doesn't exist yet -- return empty list
      } else if (isBoundaryViolationError(err)) {
        return forbidden(c, "Path escapes workspace boundary");
      } else {
        throw err;
      }
    }

    return c.json({ success: true, entries });
  } catch (err) {
    return handleRouteError(c, err, "File list");
  }
});

export default app;
