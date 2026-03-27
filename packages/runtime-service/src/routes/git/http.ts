import { Hono } from 'hono';
import type { Context } from 'hono';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import path from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { badRequest, internalError, notFound } from '@takos/common/middleware/hono';
import { REPOS_BASE_DIR } from '../../shared/config.js';
import { isPathWithinBase } from '../../runtime/paths.js';
import { validateGitName } from '../../runtime/validation.js';
import { runGitHttpBackend } from '../../runtime/git-http-backend.js';
import { enforceSpaceScopeMiddleware } from '../../middleware/space-scope.js';

// --- LFS policy helpers ---

export const LFS_OID_PATTERN = /^[a-f0-9]{64}$/i;
export const LFS_CONTENT_TYPE = 'application/vnd.git-lfs+json';
export const MAX_LFS_UPLOAD_BYTES = 1024 * 1024 * 1024;
export const LFS_UPLOAD_TOO_LARGE_ERROR = 'LFS upload payload exceeds maximum size';

export interface LfsBatchObjectDescriptor {
  oid: string;
  size: number;
}

export interface ParsedLfsBatchRequest {
  operation: 'upload' | 'download';
  objects: LfsBatchObjectDescriptor[];
}

export interface LfsBatchObjectResponse {
  oid: string;
  size: number;
  actions?: {
    upload?: {
      href: string;
      expires_in: number;
    };
    download?: {
      href: string;
      expires_in: number;
    };
  };
  error?: {
    code: number;
    message: string;
  };
}

export function normalizeLfsOid(oid: string | undefined): string | null {
  if (typeof oid !== 'string' || !LFS_OID_PATTERN.test(oid)) {
    return null;
  }
  return oid.toLowerCase();
}

export function parseLfsBatchRequest(body: unknown): ParsedLfsBatchRequest | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const operation = (body as { operation?: unknown }).operation;
  const objects = (body as { objects?: unknown }).objects;

  if (
    (operation !== 'upload' && operation !== 'download') ||
    !Array.isArray(objects)
  ) {
    return null;
  }

  const parsedObjects: LfsBatchObjectDescriptor[] = [];
  for (const object of objects) {
    if (!object || typeof object !== 'object') {
      return null;
    }

    const oid = normalizeLfsOid((object as { oid?: unknown }).oid as string | undefined);
    const size = (object as { size?: unknown }).size;

    if (
      !oid ||
      typeof size !== 'number' ||
      !Number.isFinite(size) ||
      size < 0
    ) {
      return null;
    }

    parsedObjects.push({ oid, size });
  }

  return {
    operation,
    objects: parsedObjects,
  };
}

export function getLfsObjectPath(repoGitDir: string, oid: string): string {
  return path.resolve(
    repoGitDir,
    'lfs',
    'objects',
    oid.slice(0, 2),
    oid.slice(2, 4),
    oid
  );
}

export function buildLfsBatchObjectResponse(params: {
  operation: 'upload' | 'download';
  oid: string;
  size: number;
  exists: boolean;
  href: string;
}): LfsBatchObjectResponse {
  const { operation, oid, size, exists, href } = params;

  if (operation === 'upload') {
    if (exists) {
      return { oid, size };
    }
    return {
      oid,
      size,
      actions: {
        upload: {
          href,
          expires_in: 3600,
        },
      },
    };
  }

  if (!exists) {
    return {
      oid,
      size,
      error: {
        code: 404,
        message: 'Object does not exist',
      },
    };
  }

  return {
    oid,
    size,
    actions: {
      download: {
        href,
        expires_in: 3600,
      },
    },
  };
}

export function parseContentLength(headerValue: string | undefined): number | null {
  if (typeof headerValue !== 'string' || headerValue.trim().length === 0) {
    return null;
  }
  if (!/^\d+$/.test(headerValue)) {
    return NaN;
  }
  return Number.parseInt(headerValue, 10);
}

// ---------------------------------------------------------------------------
// --- Validators ---
// ---------------------------------------------------------------------------

export interface ValidatedRepoParams {
  spaceId: string;
  repoName: string;
}

export type ResolvedRepoGitDir = ValidatedRepoParams & { repoGitDir: string };

export interface ValidatedLfsObjectRequest {
  oid: string;
  objectPath: string;
  repo: ResolvedRepoGitDir;
}

export function validateRepoParams(c: Context): ValidatedRepoParams | { error: Response } {
  const spaceId = c.req.param('spaceId') ?? c.req.param('workspaceId') ?? '';
  const pathParts = c.req.path.split('/').filter(Boolean);
  const repoSegment = c.req.param('repoName') ?? pathParts[2] ?? '';
  const repoName = repoSegment.replace(/\.git$/i, '');
  const safeSpaceId = validateGitName(spaceId);
  const safeRepoName = validateGitName(repoName);

  if (!safeSpaceId || !safeRepoName) {
    return { error: badRequest(c, 'Invalid space or repository name') };
  }

  return {
    spaceId: safeSpaceId,
    repoName: safeRepoName,
  };
}

export async function resolveRepoGitDir(
  c: Context
): Promise<ResolvedRepoGitDir | { error: Response }> {
  const params = validateRepoParams(c);
  if ('error' in params) return params;

  const repoGitDir = path.resolve(REPOS_BASE_DIR, params.spaceId, `${params.repoName}.git`);
  const resolvedBase = path.resolve(REPOS_BASE_DIR);

  if (!isPathWithinBase(resolvedBase, repoGitDir)) {
    return { error: badRequest(c, 'Invalid space or repository name') };
  }

  try {
    const stats = await fsPromises.stat(repoGitDir);
    if (!stats.isDirectory()) {
      return { error: notFound(c, 'Repository not found') };
    }
  } catch (err) {
    const errCode = err instanceof Error && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
    if (errCode === 'ENOENT') {
      return { error: notFound(c, 'Repository not found') };
    }
    throw err;
  }

  return {
    ...params,
    repoGitDir,
  };
}

export function validateLfsObjectOid(c: Context): string | { error: Response } {
  const normalizedOid = normalizeLfsOid(c.req.param('oid'));
  if (!normalizedOid) {
    return { error: badRequest(c, 'Invalid LFS object id') };
  }
  return normalizedOid;
}

export async function validateLfsObjectRequest(
  c: Context,
  oid: string | null = null
): Promise<ValidatedLfsObjectRequest | { error: Response }> {
  const normalizedOidResult = oid ?? validateLfsObjectOid(c);
  if (typeof normalizedOidResult === 'object' && 'error' in normalizedOidResult) {
    return normalizedOidResult;
  }
  const normalizedOid = typeof normalizedOidResult === 'string' ? normalizedOidResult : oid!;

  const repo = await resolveRepoGitDir(c);
  if ('error' in repo) {
    return repo;
  }

  const objectPath = getLfsObjectPath(repo.repoGitDir, normalizedOid);
  if (!isPathWithinBase(repo.repoGitDir, objectPath)) {
    return { error: badRequest(c, 'Invalid LFS object path') };
  }

  return {
    oid: normalizedOid,
    objectPath,
    repo,
  };
}

// ---------------------------------------------------------------------------
// Route helpers
// ---------------------------------------------------------------------------

const app = new Hono();

const enforceSpaceScope = enforceSpaceScopeMiddleware((c) => [
  c.req.param('spaceId'),
]);

function getLfsObjectHref(c: import('hono').Context, spaceId: string, repoName: string, oid: string): string {
  const protocol = c.req.header('x-forwarded-proto') || 'http';
  const host = c.req.header('host') || 'localhost';
  return `${protocol}://${host}/git/${spaceId}/${repoName}.git/info/lfs/objects/${oid}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath, fs.constants.F_OK);
    return true;
  } catch (err) {
    const errCode = err instanceof Error && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
    if (errCode === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

/**
 * Validate space/repo params and return safe git path suffix, or return error Response.
 */
function validateGitParams(
  c: import('hono').Context,
  suffix: string
): string | { error: Response } {
  const params = validateRepoParams(c);
  if ('error' in params) return params;

  const { spaceId, repoName } = params;
  return `/${spaceId}/${repoName}.git/${suffix}`;
}

function sendGitResult(
  c: import('hono').Context,
  result: { status: number; headers: Record<string, string>; body: Buffer }
): Response {
  const headers = new Headers();
  for (const [key, value] of Object.entries(result.headers)) {
    headers.set(key, value);
  }
  const responseBody = Uint8Array.from(result.body);
  return new Response(responseBody as unknown as BodyInit, {
    status: result.status,
    headers,
  });
}

app.use('/git/:spaceId/:repoName.git/*', enforceSpaceScope);

app.post('/git/:spaceId/:repoName.git/info/lfs/objects/batch', async (c) => {
  try {
    const resolved = await resolveRepoGitDir(c);
    if ('error' in resolved) return resolved.error;

    const body = await c.req.json();
    const parsedRequest = parseLfsBatchRequest(body);
    if (!parsedRequest) {
      return badRequest(c, 'Invalid LFS batch request');
    }

    const { operation, objects: requestObjects } = parsedRequest;
    const objects = await Promise.all(requestObjects.map(async ({ oid, size }) => {
      const objectPath = getLfsObjectPath(resolved.repoGitDir, oid);

      if (!isPathWithinBase(resolved.repoGitDir, objectPath)) {
        return {
          oid,
          size,
          error: {
            code: 400,
            message: 'Invalid object path',
          },
        };
      }

      const exists = await fileExists(objectPath);
      const href = getLfsObjectHref(c, resolved.spaceId, resolved.repoName, oid);
      return buildLfsBatchObjectResponse({
        operation,
        oid,
        size,
        exists,
        href,
      });
    }));

    c.header('content-type', LFS_CONTENT_TYPE);
    return c.json({
      transfer: 'basic',
      objects,
    });
  } catch (err) {
    c.get('log')?.error('Git LFS batch error', { error: err as Error });
    return internalError(c);
  }
});

app.put('/git/:spaceId/:repoName.git/info/lfs/objects/:oid', async (c) => {
  try {
    const oidResult = validateLfsObjectOid(c);
    if (typeof oidResult === 'object' && 'error' in oidResult) return oidResult.error;
    const normalizedOid = oidResult as string;

    const contentLength = parseContentLength(c.req.header('content-length'));
    if (Number.isNaN(contentLength)) {
      return badRequest(c, 'Invalid Content-Length');
    }
    if (typeof contentLength === 'number' && contentLength > MAX_LFS_UPLOAD_BYTES) {
      return c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'LFS object too large' } }, 413);
    }

    const validatedObject = await validateLfsObjectRequest(c, normalizedOid);
    if ('error' in validatedObject) return validatedObject.error;

    const { objectPath } = validatedObject;

    if (await fileExists(objectPath)) {
      return c.body(null, 200);
    }

    await fsPromises.mkdir(path.dirname(objectPath), { recursive: true });

    const tempPath = `${objectPath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      let receivedBytes = 0;
      const sizeLimiter = new Transform({
        transform(chunk, _encoding, callback) {
          receivedBytes += chunk.length;
          if (receivedBytes > MAX_LFS_UPLOAD_BYTES) {
            callback(new Error(LFS_UPLOAD_TOO_LARGE_ERROR));
            return;
          }
          callback(null, chunk);
        },
      });

      // Convert the web ReadableStream to a Node.js Readable stream
      const rawBody = c.req.raw.body;
      if (!rawBody) {
        return badRequest(c, 'Missing request body');
      }
      const nodeStream = Readable.fromWeb(rawBody as import('stream/web').ReadableStream);

      await pipeline(nodeStream, sizeLimiter, fs.createWriteStream(tempPath, { flags: 'wx' }));
      await fsPromises.rename(tempPath, objectPath);
    } catch (err) {
      await fsPromises.rm(tempPath, { force: true }).catch(() => undefined);
      const errMessage = err instanceof Error ? err.message : undefined;
      const errCode = err instanceof Error && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
      if (errMessage === LFS_UPLOAD_TOO_LARGE_ERROR) {
        return c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'LFS object too large' } }, 413);
      }
      if (errCode === 'EEXIST') {
        return c.body(null, 200);
      }
      throw err;
    }

    return c.body(null, 200);
  } catch (err) {
    c.get('log')?.error('Git LFS upload error', { error: err as Error });
    return internalError(c);
  }
});

app.get('/git/:spaceId/:repoName.git/info/lfs/objects/:oid', async (c) => {
  try {
    const validatedObject = await validateLfsObjectRequest(c);
    if ('error' in validatedObject) return validatedObject.error;
    const { objectPath } = validatedObject;

    let stats: fs.Stats;
    try {
      stats = await fsPromises.stat(objectPath);
      if (!stats.isFile()) {
        return notFound(c, 'LFS object not found');
      }
    } catch (err) {
      const errCode = err instanceof Error && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
      if (errCode === 'ENOENT') {
        return notFound(c, 'LFS object not found');
      }
      throw err;
    }

    // Read the file and return as binary response
    const buffer = await fsPromises.readFile(objectPath);
    return new Response(new Blob([buffer]), {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(stats.size),
      },
    });
  } catch (err) {
    c.get('log')?.error('Git LFS download error', { error: err as Error });
    return internalError(c);
  }
});

app.get('/git/:spaceId/:repoName.git/info/refs', async (c) => {
  try {
    const service = c.req.query('service');

    if (!service || !['git-upload-pack', 'git-receive-pack'].includes(service)) {
      return c.text('Invalid service parameter', 400);
    }

    const gitPathResult = validateGitParams(c, 'info/refs');
    if (typeof gitPathResult === 'object' && 'error' in gitPathResult) return gitPathResult.error;
    const gitPath = gitPathResult as string;

    return sendGitResult(c, await runGitHttpBackend({
      projectRoot: REPOS_BASE_DIR,
      gitPath,
      service,
      requestBody: null,
      contentType: undefined,
    }));
  } catch (err) {
    c.get('log')?.error('Git info/refs error', { error: err as Error });
    return c.text('Internal server error', 500);
  }
});

function createPackHandler(service: 'git-upload-pack' | 'git-receive-pack') {
  return async (c: import('hono').Context) => {
    try {
      const gitPathResult = validateGitParams(c, service);
      if (typeof gitPathResult === 'object' && 'error' in gitPathResult) return gitPathResult.error;
      const gitPath = gitPathResult as string;

      const rawBody = Buffer.from(await c.req.arrayBuffer());

      return sendGitResult(
        c,
        await runGitHttpBackend({
          projectRoot: REPOS_BASE_DIR,
          gitPath,
          service,
          requestBody: rawBody,
          contentType: c.req.header('content-type'),
        })
      );
    } catch (err) {
      c.get('log')?.error(`Git ${service} error`, { error: err as Error });
      return c.text('Internal server error', 500);
    }
  };
}

app.post(
  '/git/:spaceId/:repoName.git/git-upload-pack',
  createPackHandler('git-upload-pack')
);

// receive-pack (push): limit aligned with Workers-side MAX_PUSH_PACKFILE_BYTES (90MB)
// plus overhead for pkt-line commands and headers
app.post(
  '/git/:spaceId/:repoName.git/git-receive-pack',
  createPackHandler('git-receive-pack')
);

export default app;
