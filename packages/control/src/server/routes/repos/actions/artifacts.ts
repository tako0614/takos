import { Hono } from 'hono';
import { checkRepoAccess } from '../../../../application/services/source/repos.ts';
import type { AuthenticatedRouteEnv } from '../../route-auth.ts';
import { NotFoundError, InternalError, GoneError } from 'takos-common/errors';
import { ok } from '../../response-utils.ts';
import {
  deleteWorkflowArtifactById,
  getWorkflowArtifactById,
  listWorkflowArtifactsForRun,
} from '../../../../application/services/platform/workflow-artifacts.ts';

export default new Hono<AuthenticatedRouteEnv>()
  .get('/repos/:repoId/actions/runs/:runId/artifacts', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const runId = c.req.param('runId');
    const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
    if (!repoAccess) {
      throw new NotFoundError('Repository');
    }

    const artifacts = await listWorkflowArtifactsForRun(c.env, repoId, runId);
    if (!artifacts) {
      throw new NotFoundError('Run');
    }

    return c.json({
      artifacts: artifacts.map((a) => ({
        id: a.id,
        name: a.name,
        size_bytes: a.sizeBytes,
        mime_type: a.mimeType,
        expires_at: a.expiresAt,
        created_at: a.createdAt,
      })),
    });
  })
  .get('/repos/:repoId/actions/artifacts/:artifactId', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const artifactId = c.req.param('artifactId');
    const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
    if (!repoAccess) {
      throw new NotFoundError('Repository');
    }

    const artifact = await getWorkflowArtifactById(c.env, repoId, artifactId);

    if (!artifact) {
      throw new NotFoundError('Artifact');
    }

    if (artifact.expiresAt && new Date(artifact.expiresAt) < new Date()) {
      throw new GoneError('Artifact has expired');
    }

    if (!c.env.GIT_OBJECTS) {
      throw new InternalError('Storage not configured');
    }

    const object = await c.env.GIT_OBJECTS.get(artifact.r2Key);
    if (!object) {
      throw new NotFoundError('Artifact file');
    }

    const headers = new Headers();
    headers.set('Content-Type', artifact.mimeType || 'application/octet-stream');
    if (artifact.sizeBytes) {
      headers.set('Content-Length', String(artifact.sizeBytes));
    }
    headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(artifact.name)}"`);
    headers.set('Cache-Control', 'private, max-age=3600');

    return new Response(object.body as ReadableStream, { headers });
  })
  .delete('/repos/:repoId/actions/artifacts/:artifactId', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const artifactId = c.req.param('artifactId');
    const repoAccess = await checkRepoAccess(c.env, repoId, user.id, ['owner', 'admin', 'editor']);
    if (!repoAccess) {
      throw new NotFoundError('Repository');
    }

    const artifact = await deleteWorkflowArtifactById(c.env, c.env.GIT_OBJECTS || null, repoId, artifactId);
    if (!artifact) {
      throw new NotFoundError('Artifact');
    }

    return ok(c);
  });
