import { Hono } from 'hono';
import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import { parseWorkflow } from 'takos-actions-engine';
import { generateId, safeJsonParseOrDefault, toIsoString } from '../../../shared/utils';
import { parseJsonBody } from '../route-auth';
import type { AuthenticatedRouteEnv } from '../route-auth';
import { checkRepoAccess } from '../../../application/services/source/repos';
import type { RepoAccess } from '../../../application/services/source/repos';
import * as gitStore from '../../../application/services/git-smart';
import { getDb } from '../../../infra/db';
import type { Database } from '../../../infra/db';
import { workflows } from '../../../infra/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { NotFoundError, InternalError } from 'takos-common/errors';
import { ok } from '../response-helpers';

interface WorkflowParseResult {
  name: string | null;
  triggers: string[];
  errors: string[];
}

interface CachedWorkflowRow {
  id: string;
  path: string;
  name: string | null;
  content: string;
  triggers: string | null;
  parsedAt: string | Date | null;
}

async function upsertWorkflowCache(
  db: Database,
  repoId: string,
  path: string,
  content: string,
  name: string | null,
  triggers: string[],
  timestamp: string,
  existingId?: string
): Promise<string> {
  const workflowId = existingId || generateId();
  const triggerJson = JSON.stringify(triggers);

  if (existingId) {
    await db.update(workflows)
      .set({ content, name, triggers: triggerJson, parsedAt: timestamp, updatedAt: timestamp })
      .where(eq(workflows.id, workflowId));
  } else {
    await db.insert(workflows).values({
      id: workflowId, repoId, path, name, content,
      triggers: triggerJson, parsedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
    });
  }

  return workflowId;
}

function buildCachedWorkflowResponse(cached: CachedWorkflowRow) {
  return {
    id: cached.id,
    path: cached.path,
    name: cached.name,
    content: cached.content,
    triggers: safeJsonParseOrDefault<string[]>(cached.triggers, []),
    parsed_at: toIsoString(cached.parsedAt),
  };
}

function parseWorkflowContent(content: string): WorkflowParseResult {
  try {
    const { workflow, diagnostics } = parseWorkflow(content);
    const errors = diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => d.message);

    if (errors.length > 0) {
      return { name: null, triggers: [], errors };
    }

    const triggers: string[] = [];
    const on = workflow.on;

    if (typeof on === 'string') {
      triggers.push(on);
    } else if (Array.isArray(on)) {
      triggers.push(...on);
    } else if (on && typeof on === 'object') {
      triggers.push(...Object.keys(on));
    }

    return { name: workflow.name || null, triggers, errors: [] };
  } catch (err) {
    return { name: null, triggers: [], errors: [String(err)] };
  }
}

/** Resolve the effective branch name from an optional override and repo defaults. */
function resolveRefName(branch: string | undefined, repoAccess: RepoAccess): string {
  return branch || repoAccess.repo.default_branch || 'main';
}

/** Resolve a workflow blob from a git ref + path. Returns null if any step fails. */
async function resolveWorkflowBlob(
  d1: D1Database,
  bucket: R2Bucket,
  repoId: string,
  refName: string,
  path: string,
): Promise<Uint8Array | null> {
  const commitSha = await gitStore.resolveRef(d1, repoId, refName);
  if (!commitSha) return null;

  const commit = await gitStore.getCommitData(bucket, commitSha);
  if (!commit) return null;

  return gitStore.getBlobAtPath(bucket, commit.tree, path);
}

async function listWorkflowFiles(
  d1: D1Database,
  bucket: R2Bucket,
  repoId: string,
  ref: string
): Promise<Array<{ path: string; sha: string }>> {
  const commitSha = await gitStore.resolveRef(d1, repoId, ref);
  if (!commitSha) {
    return [];
  }

  const commit = await gitStore.getCommitData(bucket, commitSha);
  if (!commit) {
    return [];
  }

  const workflowsDir = await gitStore.listDirectory(bucket, commit.tree, '.takos/workflows');
  if (!workflowsDir) {
    return [];
  }

  return workflowsDir
    .filter((entry) => {
      const name = entry.name.toLowerCase();
      return (
        entry.mode !== gitStore.FILE_MODES.DIRECTORY &&
        (name.endsWith('.yml') || name.endsWith('.yaml'))
      );
    })
    .map((entry) => ({
      path: `.takos/workflows/${entry.name}`,
      sha: entry.sha,
    }));
}

const workflowsRouter = new Hono<AuthenticatedRouteEnv>()
  .get('/repos/:repoId/workflows', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const branch = c.req.query('branch');
  const db = getDb(c.env.DB);

  const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const workflowsData = await db.select().from(workflows)
    .where(eq(workflows.repoId, repoId))
    .orderBy(asc(workflows.path))
    .all();

  const workflowsList = workflowsData.map((w) => ({
    id: w.id,
    path: w.path,
    name: w.name,
    triggers: safeJsonParseOrDefault<string[]>(w.triggers, []),
    parsed_at: toIsoString(w.parsedAt),
    updated_at: toIsoString(w.updatedAt),
  }));

  const bucket = c.env.GIT_OBJECTS;
  if (bucket) {
    const refName = resolveRefName(branch, repoAccess);
    try {
      const gitFiles = await listWorkflowFiles(c.env.DB, bucket, repoId, refName);
      const cachedPaths = new Set(workflowsList.map((w) => w.path));

      const uncached = gitFiles
        .filter((f) => !cachedPaths.has(f.path))
        .map((f) => f.path);

      return c.json({
        workflows: workflowsList,
        uncached_paths: uncached,
      });
    } catch {
      // Continue if Git store access fails
    }
  }

  return c.json({ workflows: workflowsList, uncached_paths: [] });
  })
  .get('/repos/:repoId/workflows/:path{.+}', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const path = c.req.param('path');
  const branch = c.req.query('branch');
  const db = getDb(c.env.DB);

  const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const cached = await db.select().from(workflows)
    .where(and(eq(workflows.repoId, repoId), eq(workflows.path, path)))
    .get();

  const refresh = c.req.query('refresh') === 'true';

  if (!cached || refresh) {
    const bucket = c.env.GIT_OBJECTS;
    if (!bucket) {
      if (cached) {
        return c.json({ workflow: buildCachedWorkflowResponse(cached) });
      }
      throw new NotFoundError('Workflow');
    }

    const refName = resolveRefName(branch, repoAccess);
    const blob = await resolveWorkflowBlob(c.env.DB, bucket, repoId, refName, path);

    if (!blob) {
      if (cached) {
        return c.json({ workflow: buildCachedWorkflowResponse(cached) });
      }
      throw new NotFoundError('Workflow file');
    }

    const content = new TextDecoder().decode(blob);
    const { name, triggers, errors } = parseWorkflowContent(content);

    const timestamp = new Date().toISOString();
    const workflowId = await upsertWorkflowCache(db, repoId, path, content, name, triggers, timestamp, cached?.id);

    return c.json({
      workflow: {
        id: workflowId,
        path,
        name,
        content,
        triggers,
        parsed_at: timestamp,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  }

  return c.json({ workflow: buildCachedWorkflowResponse(cached) });
  })
  .post('/repos/:repoId/workflows/:path{.+}/sync', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const rawPath = c.req.param('path');
  const path = rawPath.replace(/\/sync$/, '');
  const body = await parseJsonBody<{ branch?: string }>(c, {});
  const db = getDb(c.env.DB);

  const repoAccess = await checkRepoAccess(c.env, repoId, user.id, ['owner', 'admin', 'editor']);
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const bucket = c.env.GIT_OBJECTS;
  if (!bucket) {
    throw new InternalError('Git storage not configured');
  }

  const refName = resolveRefName(body.branch, repoAccess);
  const blob = await resolveWorkflowBlob(c.env.DB, bucket, repoId, refName, path);
  if (!blob) {
    throw new NotFoundError('Workflow file');
  }

  const content = new TextDecoder().decode(blob);
  const { name, triggers, errors } = parseWorkflowContent(content);

  const timestamp = new Date().toISOString();
  const existing = await db.select({ id: workflows.id })
    .from(workflows)
    .where(and(eq(workflows.repoId, repoId), eq(workflows.path, path)))
    .get();

  const workflowId = await upsertWorkflowCache(db, repoId, path, content, name, triggers, timestamp, existing?.id);

  return c.json({
    workflow: {
      id: workflowId,
      path,
      name,
      content,
      triggers,
      parsed_at: timestamp,
      errors: errors.length > 0 ? errors : undefined,
    },
    synced: true,
  });
  })
  .post('/repos/:repoId/workflows/sync-all', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const body = await parseJsonBody<{ branch?: string }>(c, {});
  const db = getDb(c.env.DB);

  const repoAccess = await checkRepoAccess(c.env, repoId, user.id, ['owner', 'admin', 'editor']);
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const bucket = c.env.GIT_OBJECTS;
  if (!bucket) {
    throw new InternalError('Git storage not configured');
  }

  const refName = resolveRefName(body.branch, repoAccess);
  const workflowFiles = await listWorkflowFiles(c.env.DB, bucket, repoId, refName);

  const timestamp = new Date().toISOString();
  const synced: string[] = [];
  const errors: Array<{ path: string; error: string }> = [];

  for (const file of workflowFiles) {
    try {
      const blob = await resolveWorkflowBlob(c.env.DB, bucket, repoId, refName, file.path);
      if (!blob) continue;

      const content = new TextDecoder().decode(blob);
      const { name, triggers, errors: parseErrors } = parseWorkflowContent(content);

      if (parseErrors.length > 0) {
        errors.push({ path: file.path, error: parseErrors.join(', ') });
      }

      const existing = await db.select({ id: workflows.id })
        .from(workflows)
        .where(and(eq(workflows.repoId, repoId), eq(workflows.path, file.path)))
        .get();

      await upsertWorkflowCache(db, repoId, file.path, content, name, triggers, timestamp, existing?.id);

      synced.push(file.path);
    } catch (err) {
      errors.push({ path: file.path, error: String(err) });
    }
  }

  return c.json({
    synced,
    errors: errors.length > 0 ? errors : undefined,
    total: workflowFiles.length,
  });
  })
  .delete('/repos/:repoId/workflows/:path{.+}', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const path = c.req.param('path');
  const db = getDb(c.env.DB);

  const repoAccess = await checkRepoAccess(c.env, repoId, user.id, ['owner', 'admin']);
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const existing = await db.select({ id: workflows.id })
    .from(workflows)
    .where(and(eq(workflows.repoId, repoId), eq(workflows.path, path)))
    .get();

  if (!existing) {
    throw new NotFoundError('Workflow');
  }

  await db.delete(workflows)
    .where(and(eq(workflows.repoId, repoId), eq(workflows.path, path)));

  return ok(c);
  });

export default workflowsRouter;
