import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../shared/types';
import { badRequest, notFound, type BaseVariables } from './shared/route-auth';
import { zValidator } from './zod-validator';
import { checkThreadAccess } from '../../application/services/threads/thread-service';
import {
  createThreadShare,
  listThreadShares,
  revokeThreadShare,
  type ThreadShareMode,
} from '../../application/services/threads/thread-shares';

export default new Hono<{ Bindings: Env; Variables: BaseVariables }>()

.post('/threads/:id/share',
  zValidator('json', z.object({
    mode: z.string().optional(),
    password: z.string().optional(),
    expires_at: z.string().optional(),
    expires_in_days: z.number().optional(),
  })),
  async (c) => {
  const user = c.get('user');
  const threadId = c.req.param('id');
  const body = c.req.valid('json') as { mode?: ThreadShareMode; password?: string; expires_at?: string; expires_in_days?: number };

  const access = await checkThreadAccess(c.env.DB, threadId, user.id, ['owner', 'admin', 'editor']);
  if (!access) {
    return notFound(c, 'Thread');
  }

  const mode: ThreadShareMode = body.mode === 'password' ? 'password' : 'public';

  let expiresAt: string | null = null;
  if (body.expires_at) {
    expiresAt = body.expires_at;
  } else if (typeof body.expires_in_days === 'number') {
    const days = body.expires_in_days;
    if (!Number.isFinite(days) || days <= 0 || days > 365) {
      return badRequest(c, 'expires_in_days must be between 1 and 365');
    }
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  try {
    const created = await createThreadShare({
      db: c.env.DB,
      threadId,
      spaceId: access.thread.space_id,
      createdBy: user.id,
      mode,
      password: body.password || null,
      expiresAt,
    });

    const sharePath = `/share/${created.share.token}`;
    const origin = new URL(c.req.url).origin;

    return c.json({
      share: created.share,
      share_path: sharePath,
      share_url: origin + sharePath,
      password_required: created.passwordRequired,
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create share';
    return badRequest(c, message);
  }
})

.get('/threads/:id/shares', async (c) => {
  const user = c.get('user');
  const threadId = c.req.param('id');

  const access = await checkThreadAccess(c.env.DB, threadId, user.id);
  if (!access) {
    return notFound(c, 'Thread');
  }

  const shares = await listThreadShares(c.env.DB, threadId);
  const origin = new URL(c.req.url).origin;
  const withLinks = shares.map((s) => {
    const sharePath = `/share/${s.token}`;
    return {
      ...s,
      share_path: sharePath,
      share_url: origin + sharePath,
    };
  });

  return c.json({ shares: withLinks });
})

.post('/threads/:id/shares/:shareId/revoke', async (c) => {
  const user = c.get('user');
  const threadId = c.req.param('id');
  const shareId = c.req.param('shareId');

  const access = await checkThreadAccess(c.env.DB, threadId, user.id, ['owner', 'admin', 'editor']);
  if (!access) {
    return notFound(c, 'Thread');
  }

  const ok = await revokeThreadShare({ db: c.env.DB, threadId, shareId });
  if (!ok) {
    return notFound(c, 'Share');
  }

  return c.json({ success: true });
});
