/**
 * Git Smart HTTP route handler.
 *
 * URL pattern: /git/:owner/:repo.git/<service>
 * - GET  /git/:owner/:repo.git/info/refs?service=<service>
 * - POST /git/:owner/:repo.git/git-upload-pack
 * - POST /git/:owner/:repo.git/git-receive-pack
 */

import { Hono } from 'hono';
import type { Env, User, Repository } from '../../../shared/types';
import { requireGitAuth, optionalGitAuth } from '../../middleware/git-auth';
import { handleInfoRefs } from '../../../application/services/git-smart/smart-http/info-refs';
import { handleUploadPack } from '../../../application/services/git-smart/smart-http/upload-pack';
import { handleReceivePack, handleReceivePackFromStream } from '../../../application/services/git-smart/smart-http/receive-pack';
import { triggerPushWorkflows } from '../../../application/services/actions/actions-triggers';
import { recordPushActivity, type CommitMeta } from '../../../application/services/activitypub/push-activities';
import { deliverToFollowers } from '../../../application/services/activitypub/activity-delivery';
import { getCommitLog } from '../../../application/services/git-smart/core/commit-index';
import { getDb } from '../../../infra/db';
import { accounts, repositories } from '../../../infra/db/schema';
import { eq, and } from 'drizzle-orm';
import { checkSpaceAccess } from '../../../application/services/identity/space-access';
import { logError } from '../../../shared/utils/logger';
import { MAX_GIT_REQUEST_BODY_BYTES, GIT_PUSH_LOCK_LEASE_MS } from '../../../shared/config/limits';
import type {
  D1Database,
  DurableObjectStubBinding,
  R2Bucket,
} from '../../../shared/types/bindings.ts';

type Variables = {
  user?: User;
};

const smartHttpRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const ZERO_SHA = '0000000000000000000000000000000000000000';

type RepoPushLockNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubBinding;
};

/**
 * Resolve :owner (username or workspace slug) + :repo to a repository.
 *
 * User accounts directly own repos, so the account's id is the repo owner.
 * This allows git URLs like `/git/takos/main.git` where `takos` is the username.
 */
async function resolveRepo(
  db: D1Database,
  owner: string,
  repoName: string,
): Promise<{ repo: Repository; spaceId: string } | null> {
  const drizzle = getDb(db);

  const account = await drizzle
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(eq(accounts.slug, owner))
    .get();

  if (!account) {
    return null;
  }

  // Clean repo name — strip trailing .git if present
  const cleanName = repoName.replace(/\.git$/, '');

  // Repos are directly owned by the account (user or team)
  const repo = await drizzle.select().from(repositories).where(
    and(eq(repositories.accountId, account.id), eq(repositories.name, cleanName))
  ).get();

  if (!repo) return null;

  return {
    repo: {
      id: repo.id,
      space_id: repo.accountId,
      name: repo.name,
      description: repo.description,
      visibility: repo.visibility,
      default_branch: repo.defaultBranch,
      forked_from_id: repo.forkedFromId,
      stars: repo.stars,
      forks: repo.forks,
      git_enabled: repo.gitEnabled,
      is_official: repo.isOfficial,
      official_category: repo.officialCategory,
      official_maintainer: repo.officialMaintainer,
      featured: repo.featured,
      install_count: repo.installCount,
      created_at: repo.createdAt,
      updated_at: repo.updatedAt,
    } as Repository,
    spaceId: account.id,
  };
}

function getGitBucket(env: Env): R2Bucket {
  const bucket = env.GIT_OBJECTS;
  if (!bucket) throw new Error('GIT_OBJECTS R2 bucket not configured');
  return bucket;
}

function gitResponse(data: Uint8Array, contentType: string): Response {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return new Response(copy.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    },
  });
}

function readContentLength(request: Request): number | null {
  const raw = request.headers.get('content-length');
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function readRequestBodyWithLimit(request: Request, maxBytes: number): Promise<Uint8Array> {
  const contentLength = readContentLength(request);
  if (contentLength !== null && contentLength > maxBytes) {
    throw new Error(`Request body exceeds ${maxBytes} bytes`);
  }

  if (!request.body) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error(`Request body exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

async function acquireRepoPushLock(env: Env, repoId: string): Promise<{ token: string } | null> {
  if (!env.GIT_PUSH_LOCK) return null;

  const lockNamespace = env.GIT_PUSH_LOCK as unknown as RepoPushLockNamespace;
  const id = lockNamespace.idFromName(`repo:${repoId}`);
  const stub = lockNamespace.get(id) as DurableObjectStubBinding;
  const token = crypto.randomUUID();
  const res = await stub.fetch('https://git-push-lock/acquire', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, leaseMs: GIT_PUSH_LOCK_LEASE_MS }),
  });

  if (res.status === 409) {
    throw new Error('Another push is already in progress for this repository');
  }
  if (!res.ok) {
    throw new Error(`Failed to acquire push lock: ${res.status}`);
  }

  return { token };
}

async function releaseRepoPushLock(env: Env, repoId: string, lock: { token: string } | null): Promise<void> {
  if (!env.GIT_PUSH_LOCK || !lock) return;

  const lockNamespace = env.GIT_PUSH_LOCK as unknown as RepoPushLockNamespace;
  const id = lockNamespace.idFromName(`repo:${repoId}`);
  const stub = lockNamespace.get(id) as DurableObjectStubBinding;
  await stub.fetch('https://git-push-lock/release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: lock.token }),
  }).catch((err: unknown) => {
    logError('Failed to release push lock', err, { action: 'release_push_lock', repoId });
  });
}

// --- info/refs (ref discovery) ---
// For upload-pack (clone/fetch): allow anonymous access to public repos
// For receive-pack (push): always require auth
smartHttpRoutes.get('/git/:owner/:repo/info/refs', optionalGitAuth, async (c) => {
  const service = c.req.query('service');
  if (service !== 'git-upload-pack' && service !== 'git-receive-pack') {
    return c.text('Invalid service\n', 403);
  }

  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  const result = await resolveRepo(c.env.DB, owner, repo);

  if (!result) {
    return c.text('Repository not found\n', 404);
  }

  const user = c.get('user');

  // Check access
  if (service === 'git-receive-pack') {
    // Push requires write access
    if (!user) {
      return new Response('Authentication required\n', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="takos"', 'Content-Type': 'text/plain' },
      });
    }
    const access = await checkSpaceAccess(c.env.DB, result.spaceId, user.id, ['owner', 'admin', 'editor']);
    if (!access) {
      return c.text('Permission denied\n', 403);
    }
  } else {
    // Clone/fetch: allow public repos without auth, require auth for private
    if (result.repo.visibility !== 'public') {
      if (!user) {
        return new Response('Authentication required\n', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Basic realm="takos"', 'Content-Type': 'text/plain' },
        });
      }
      const access = await checkSpaceAccess(c.env.DB, result.spaceId, user.id);
      if (!access) {
        return c.text('Permission denied\n', 403);
      }
    }
  }

  const bucket = getGitBucket(c.env);
  const data = await handleInfoRefs(c.env.DB, result.repo.id, service);
  return gitResponse(data, `application/x-${service}-advertisement`);
});

// --- git-upload-pack (clone/fetch) ---
smartHttpRoutes.post('/git/:owner/:repo/git-upload-pack', optionalGitAuth, async (c) => {
  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  const result = await resolveRepo(c.env.DB, owner, repo);

  if (!result) {
    return c.text('Repository not found\n', 404);
  }

  const user = c.get('user');

  // Access check for private repos
  if (result.repo.visibility !== 'public') {
    if (!user) {
      return new Response('Authentication required\n', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="takos"', 'Content-Type': 'text/plain' },
      });
    }
    const access = await checkSpaceAccess(c.env.DB, result.spaceId, user.id);
    if (!access) {
      return c.text('Permission denied\n', 403);
    }
  }

  const bucket = getGitBucket(c.env);
  let body: Uint8Array;
  try {
    body = await readRequestBodyWithLimit(c.req.raw, MAX_GIT_REQUEST_BODY_BYTES);
  } catch (err) {
    return c.text(`${err instanceof Error ? err.message : 'Request body too large'}\n`, 413);
  }
  const data = await handleUploadPack(c.env.DB, bucket, result.repo.id, body);

  return gitResponse(data, 'application/x-git-upload-pack-result');
});

// --- git-receive-pack (push) ---
smartHttpRoutes.post('/git/:owner/:repo/git-receive-pack', requireGitAuth, async (c) => {
  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  const result = await resolveRepo(c.env.DB, owner, repo);

  if (!result) {
    return c.text('Repository not found\n', 404);
  }

  const user = c.get('user');
  if (!user) {
    return c.text('Authentication required\n', 401);
  }

  // Write access check
  const access = await checkSpaceAccess(c.env.DB, result.spaceId, user.id, ['owner', 'admin', 'editor']);
  if (!access) {
    return c.text('Permission denied\n', 403);
  }

  const bucket = getGitBucket(c.env);
  let pushLock: { token: string } | null = null;
  try {
    pushLock = await acquireRepoPushLock(c.env, result.repo.id);
  } catch (err) {
    return c.text(`${err instanceof Error ? err.message : 'Repository push lock failed'}\n`, 409);
  }

  // Pre-check Content-Length before reading body
  const contentLength = readContentLength(c.req.raw);
  if (contentLength !== null && contentLength > MAX_GIT_REQUEST_BODY_BYTES) {
    await releaseRepoPushLock(c.env, result.repo.id, pushLock);
    return c.text(`Request body exceeds ${MAX_GIT_REQUEST_BODY_BYTES} bytes\n`, 413);
  }

  try {
    // Use streaming path: parse pkt-line commands and accumulate packfile
    // data incrementally from the request body stream, enforcing byte
    // limits during the read itself — no full-buffer arrayBuffer() call.
    const stream = c.req.raw.body;
    let receivePack: { response: Uint8Array; updatedRefs: { oldSha: string; newSha: string; refName: string }[] };
    try {
      if (stream) {
        receivePack = await handleReceivePackFromStream(c.env.DB, bucket, result.repo.id, stream, MAX_GIT_REQUEST_BODY_BYTES);
      } else {
        receivePack = await handleReceivePack(c.env.DB, bucket, result.repo.id, new Uint8Array());
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Request body too large';
      if (msg.includes('exceeds limit')) {
        return c.text(`${msg}\n`, 413);
      }
      throw err;
    }
    const { response, updatedRefs } = receivePack;

    if (updatedRefs.length > 0) {
      c.executionCtx.waitUntil((async () => {
        for (const ref of updatedRefs) {
          // Handle tag refs — record a Tag activity
          if (ref.refName.startsWith('refs/tags/') && ref.newSha !== ZERO_SHA) {
            try {
              await recordPushActivity(c.env.DB, {
                repoId: result.repo.id,
                accountId: result.repo.space_id,
                ref: ref.refName,
                beforeSha: ref.oldSha === ZERO_SHA ? null : ref.oldSha,
                afterSha: ref.newSha,
                pusherName: user.name || null,
                commitCount: 0,
                commits: [],
              });
            } catch (err) {
              logError('Failed to record tag activity', err, { action: 'record_tag_activity', repoId: result.repo.id, refName: ref.refName });
            }
            continue;
          }

          if (!ref.refName.startsWith('refs/heads/') || ref.newSha === ZERO_SHA) {
            continue;
          }

          // Record ForgeFed Push activity for ActivityPub outbox
          try {
            // Fetch recent commits for metadata sharing
            const commitLog = await getCommitLog(c.env.DB, bucket, result.repo.id, ref.newSha, 20);
            const commits: CommitMeta[] = commitLog
              .filter((c) => ref.oldSha === ZERO_SHA || c.sha !== ref.oldSha)
              .map((c) => ({
                hash: c.sha,
                message: c.message,
                authorName: c.author.name,
                authorEmail: c.author.email,
                committed: new Date(c.committer.timestamp * 1000).toISOString(),
              }));

            await recordPushActivity(c.env.DB, {
              repoId: result.repo.id,
              accountId: result.repo.space_id,
              ref: ref.refName,
              beforeSha: ref.oldSha === ZERO_SHA ? null : ref.oldSha,
              afterSha: ref.newSha,
              pusherName: user.name || null,
              commitCount: commits.length,
              commits,
            });

            // Deliver Push activity to repo followers
            try {
              const origin = new URL(c.req.url).origin;
              const repoActorUrl = `${origin}/ap/repos/${encodeURIComponent(owner)}/${encodeURIComponent(result.repo.name)}`;
              const pushActivity: Record<string, unknown> = {
                '@context': [
                  'https://www.w3.org/ns/activitystreams',
                  'https://forgefed.org/ns',
                ],
                type: 'Push',
                actor: repoActorUrl,
                published: new Date().toISOString(),
                to: ['https://www.w3.org/ns/activitystreams#Public'],
                target: ref.refName,
                object: commits.length > 0
                  ? {
                      type: 'OrderedCollection',
                      totalItems: commits.length,
                      orderedItems: commits.map((cm) => ({
                        type: 'Commit',
                        hash: cm.hash,
                        message: cm.message,
                        attributedTo: { name: cm.authorName, email: cm.authorEmail },
                        committed: cm.committed,
                      })),
                    }
                  : { type: 'OrderedCollection', totalItems: 0, orderedItems: [] },
              };

              // TODO: PLATFORM_PRIVATE_KEY env var needs to be configured for signed delivery
              const signingKey = c.env.PLATFORM_PRIVATE_KEY || undefined;
              const signingKeyId = signingKey ? `${repoActorUrl}#main-key` : undefined;

              deliverToFollowers(c.env.DB, repoActorUrl, pushActivity, signingKey, signingKeyId)
                .catch((err: unknown) => {
                  logError('Failed to deliver push activity to followers', err, {
                    action: 'deliver_push_activity',
                    repoId: result.repo.id,
                    refName: ref.refName,
                  });
                });
            } catch (deliveryErr) {
              logError('Failed to initiate push activity delivery', deliveryErr, {
                action: 'deliver_push_activity',
                repoId: result.repo.id,
                refName: ref.refName,
              });
            }
          } catch (err) {
            logError('Failed to record push activity', err, { action: 'record_push_activity', repoId: result.repo.id, refName: ref.refName });
          }

          // Trigger CI workflows
          if (c.env.WORKFLOW_QUEUE) {
            try {
              await triggerPushWorkflows({
                db: c.env.DB,
                bucket,
                queue: c.env.WORKFLOW_QUEUE,
                encryptionKey: c.env.ENCRYPTION_KEY,
              }, {
                repoId: result.repo.id,
                branch: ref.refName.slice('refs/heads/'.length),
                before: ref.oldSha === ZERO_SHA ? null : ref.oldSha,
                after: ref.newSha,
                actorId: user.id,
                actorName: user.name || null,
                actorEmail: user.email || null,
              });
            } catch (err) {
              logError('Failed to trigger push workflows', err, { action: 'trigger_push_workflows', repoId: result.repo.id, refName: ref.refName });
            }
          }
        }
      })());
    }

    return gitResponse(response, 'application/x-git-receive-pack-result');
  } finally {
    await releaseRepoPushLock(c.env, result.repo.id, pushLock);
  }
});

export { smartHttpRoutes };
