import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../shared/types';
import { zValidator } from './zod-validator';
import { verifyThreadShareAccess } from '../../application/services/threads/thread-shares';
import { getDb } from '../../infra/db';
import { threads, messages } from '../../infra/db/schema';
import { eq, asc } from 'drizzle-orm';
import { InMemoryRateLimiter } from '../../shared/utils/rate-limiter';
import { AuthenticationError, AuthorizationError, NotFoundError, RateLimitError } from '@takoserver/common/errors';

type Variables = Record<string, never>;

// Per-token rate limiter for password verification attempts.
// 5 attempts per minute per share token to prevent brute-force password guessing.
const sharePasswordRateLimiter = new InMemoryRateLimiter({
  maxRequests: 5,
  windowMs: 60_000,
  message: 'Too many password attempts. Please try again later.',
});

function sanitizeSharedMessages(messages: Array<{ id: string; role: string; content: string; sequence: number; createdAt: string }>) {
  // Safety by default: do not expose system/tool messages in unauthenticated share views.
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      sequence: m.sequence,
      created_at: m.createdAt,
    }));
}

async function buildSharedThreadPayload(env: Env, threadId: string, token: string) {
  const db = getDb(env.DB);

  const thread = await db.select({
    id: threads.id,
    title: threads.title,
    status: threads.status,
    createdAt: threads.createdAt,
    updatedAt: threads.updatedAt,
  }).from(threads).where(eq(threads.id, threadId)).get();

  if (!thread || thread.status === 'deleted') {
    return null;
  }

  const messageRows = await db.select({
    id: messages.id,
    role: messages.role,
    content: messages.content,
    sequence: messages.sequence,
    createdAt: messages.createdAt,
  }).from(messages).where(eq(messages.threadId, threadId)).orderBy(asc(messages.sequence)).all();

  return {
    token,
    thread: {
      id: thread.id,
      title: thread.title,
      created_at: thread.createdAt,
      updated_at: thread.updatedAt,
    },
    messages: sanitizeSharedMessages(messageRows as unknown as Array<{ id: string; role: string; content: string; sequence: number; createdAt: string }>),
  };
}

export default new Hono<{ Bindings: Env; Variables: Variables }>()
  // GET /api/public/thread-shares/:token
  // Returns 401 with requires_password when share is password-protected.
  .get('/thread-shares/:token', async (c) => {
    const token = c.req.param('token');

    const access = await verifyThreadShareAccess({ db: c.env.DB, token, password: null });
    if ('error' in access) {
      if (access.error === 'password_required') {
        throw new AuthenticationError('Password required');
      }
      throw new NotFoundError();
    }

    const payload = await buildSharedThreadPayload(c.env, access.threadId, token);
    if (!payload) {
      throw new NotFoundError();
    }

    return c.json({
      share: {
        mode: access.share.mode,
        expires_at: access.share.expires_at,
        created_at: access.share.created_at,
      },
      ...payload,
    });
  })

  // POST /api/public/thread-shares/:token/access
  // Body: { password }
  .post('/thread-shares/:token/access',
    zValidator('json', z.object({
      password: z.string().optional(),
    })),
    async (c) => {
    const token = c.req.param('token');
    const body = c.req.valid('json');

    // Rate-limit password attempts per share token to prevent brute-force guessing.
    const rateLimitKey = `share-password:${token}`;
    const rateLimitInfo = sharePasswordRateLimiter.check(rateLimitKey);
    if (rateLimitInfo.remaining <= 0) {
      const retryAfter = Math.ceil((rateLimitInfo.reset - Date.now()) / 1000);
      c.header('Retry-After', String(retryAfter));
      throw new RateLimitError('Rate limit exceeded', retryAfter);
    }
    sharePasswordRateLimiter.hit(rateLimitKey);

    const access = await verifyThreadShareAccess({ db: c.env.DB, token, password: body.password || null });
    if ('error' in access) {
      if (access.error === 'password_required') {
        throw new AuthenticationError('Password required');
      }
      if (access.error === 'forbidden') {
        throw new AuthorizationError('Invalid password');
      }
      throw new NotFoundError();
    }

    const payload = await buildSharedThreadPayload(c.env, access.threadId, token);
    if (!payload) {
      throw new NotFoundError();
    }

    return c.json({
      share: {
        mode: access.share.mode,
        expires_at: access.share.expires_at,
        created_at: access.share.created_at,
      },
      ...payload,
    });
  });
