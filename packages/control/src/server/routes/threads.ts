import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, ThreadStatus, MessageRole } from '../../shared/types';
import { badRequest, notFound, internalError, parseLimit, parseOffset, requireWorkspaceAccess, type BaseVariables } from './shared/route-auth';
import { logError } from '../../shared/utils/logger';
import { zValidator } from './zod-validator';
import {
  checkThreadAccess,
  createMessage,
  createThread,
  listThreads,
  updateThread,
  updateThreadStatus,
} from '../../application/services/threads/threads';
import {
  createThreadShare,
  listThreadShares,
  revokeThreadShare,
  type ThreadShareMode,
} from '../../application/services/threads/thread-shares';
import { searchSpaceThreads, searchThreadMessages } from '../../application/services/threads/thread-search';
import { getThreadTimeline } from '../../application/services/threads/thread-timeline';
import { getThreadHistory } from '../../application/services/threads/thread-history';
import { exportThread } from '../../application/services/threads/thread-export';
import { getPlatformServices } from '../../platform/accessors.ts';

export default new Hono<{ Bindings: Env; Variables: BaseVariables }>()

.get('/spaces/:spaceId/threads',
  zValidator('query', z.object({ status: z.string().optional() })),
  async (c) => {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  const { status: statusQuery } = c.req.valid('query');
  const status = statusQuery as ThreadStatus | undefined;

  const access = await requireWorkspaceAccess(c, spaceId, user.id);
  if (access instanceof Response) return access;

  const threadsList = await listThreads(c.env.DB, access.space.id, { status });
  return c.json({ threads: threadsList });
})

.get('/spaces/:spaceId/threads/search',
  zValidator('query', z.object({
    q: z.string().optional(),
    type: z.string().optional(),
    limit: z.string().optional(),
    offset: z.string().optional(),
  })),
  async (c) => {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  const validatedQuery = c.req.valid('query');
  const q = (validatedQuery.q || '').trim();
  const type = (validatedQuery.type || 'all').toLowerCase(); // keyword | semantic | all
  const limit = parseLimit(validatedQuery.limit, 20, 100);
  const offset = parseOffset(validatedQuery.offset);

  const access = await requireWorkspaceAccess(c, spaceId, user.id);
  if (access instanceof Response) return access;
  const resolvedSpaceId = access.space.id;

  if (!q) {
    return badRequest(c, 'q is required');
  }

  return c.json(await searchSpaceThreads({
    env: c.env,
    spaceId: resolvedSpaceId,
    query: q,
    type,
    limit,
    offset,
  }));
})

.post('/spaces/:spaceId/threads',
  zValidator('json', z.object({ title: z.string().optional(), locale: z.enum(['ja', 'en']).optional() })),
  async (c) => {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  const body = c.req.valid('json');

  const access = await requireWorkspaceAccess(
    c,
    spaceId,
    user.id,
    ['owner', 'admin', 'editor'],
    'Workspace not found or insufficient permissions'
  );
  if (access instanceof Response) return access;

  const thread = await createThread(c.env.DB, access.space.id, body);

  return c.json({ thread }, 201);
})

.get('/threads/:id', async (c) => {
  const user = c.get('user');
  const threadId = c.req.param('id');

  const access = await checkThreadAccess(c.env.DB, threadId, user.id);
  if (!access) {
    return notFound(c, 'Thread');
  }

  return c.json({
    thread: access.thread,
    role: access.role,
  });
})

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
})

.patch('/threads/:id',
  zValidator('json', z.object({
    title: z.string().optional(),
    locale: z.enum(['ja', 'en']).nullable().optional(),
    status: z.enum(['active', 'archived', 'deleted']).optional(),
    context_window: z.number().int().min(20).max(200).optional(),
  })),
  async (c) => {
  const user = c.get('user');
  const threadId = c.req.param('id');
  const body = c.req.valid('json');

  const access = await checkThreadAccess(c.env.DB, threadId, user.id, ['owner', 'admin', 'editor']);
  if (!access) {
    return notFound(c, 'Thread');
  }

  const updates: { title?: string | null; locale?: 'ja' | 'en' | null; status?: ThreadStatus; context_window?: number } = {};

  if (body.title !== undefined) {
    updates.title = body.title || null;
  }

  if (body.locale !== undefined) {
    updates.locale = body.locale;
  }

  if (body.status) {
    updates.status = body.status;
  }

  if (body.context_window !== undefined) {
    updates.context_window = body.context_window;
  }

  if (Object.keys(updates).length === 0) {
    return badRequest(c, 'No valid updates provided');
  }

  const thread = await updateThread(c.env.DB, threadId, updates);

  return c.json({ thread });
})

.delete('/threads/:id', async (c) => {
  const user = c.get('user');
  const threadId = c.req.param('id');

  const access = await checkThreadAccess(c.env.DB, threadId, user.id, ['owner', 'admin']);
  if (!access) {
    return notFound(c, 'Thread');
  }

  await updateThreadStatus(c.env.DB, threadId, 'deleted');

  return c.json({ success: true });
})

.post('/threads/:id/archive', async (c) => {
  const user = c.get('user');
  const threadId = c.req.param('id');

  const access = await checkThreadAccess(c.env.DB, threadId, user.id, ['owner', 'admin', 'editor']);
  if (!access) {
    return notFound(c, 'Thread');
  }

  await updateThreadStatus(c.env.DB, threadId, 'archived');

  return c.json({ success: true });
})

.post('/threads/:id/unarchive', async (c) => {
  const user = c.get('user');
  const threadId = c.req.param('id');

  const access = await checkThreadAccess(c.env.DB, threadId, user.id, ['owner', 'admin', 'editor']);
  if (!access) {
    return notFound(c, 'Thread');
  }

  await updateThreadStatus(c.env.DB, threadId, 'active');

  return c.json({ success: true });
})

.get('/threads/:id/messages',
  zValidator('query', z.object({ limit: z.string().optional(), offset: z.string().optional() })),
  async (c) => {
  const user = c.get('user');
  const threadId = c.req.param('id');
  const { limit: limitParam, offset: offsetParam } = c.req.valid('query');
  const limit = parseLimit(limitParam, 100, 200);
  const offset = parseOffset(offsetParam);

  const access = await checkThreadAccess(c.env.DB, threadId, user.id);
  if (!access) {
    return notFound(c, 'Thread');
  }

  return c.json(await getThreadTimeline(c.env, threadId, limit, offset));
})

.get('/threads/:id/history',
  zValidator('query', z.object({
    limit: z.string().optional(),
    offset: z.string().optional(),
    include_messages: z.string().optional(),
    root_run_id: z.string().optional(),
  })),
  async (c) => {
  const user = c.get('user');
  const threadId = c.req.param('id');
  const {
    limit: limitParam,
    offset: offsetParam,
    include_messages: includeMessagesParam,
    root_run_id: rootRunId,
  } = c.req.valid('query');
  const limit = parseLimit(limitParam, 100, 200);
  const offset = parseOffset(offsetParam);
  const includeMessages = includeMessagesParam !== '0';

  const access = await checkThreadAccess(c.env.DB, threadId, user.id);
  if (!access) {
    return notFound(c, 'Thread');
  }

  return c.json(await getThreadHistory(c.env, threadId, {
    limit,
    offset,
    includeMessages,
    rootRunId,
  }));
})

.get('/threads/:id/messages/search',
  zValidator('query', z.object({
    q: z.string().optional(),
    type: z.string().optional(),
    limit: z.string().optional(),
    offset: z.string().optional(),
  })),
  async (c) => {
  const user = c.get('user');
  const threadId = c.req.param('id');
  const validatedQuery = c.req.valid('query');
  const q = (validatedQuery.q || '').trim();
  const type = (validatedQuery.type || 'all').toLowerCase(); // keyword | semantic | all
  const limit = parseLimit(validatedQuery.limit, 20, 100);
  const offset = parseOffset(validatedQuery.offset);

  if (!q) {
    return badRequest(c, 'q is required');
  }

  const access = await checkThreadAccess(c.env.DB, threadId, user.id);
  if (!access) {
    return notFound(c, 'Thread');
  }

  return c.json(await searchThreadMessages({
    env: c.env,
    spaceId: access.thread.space_id,
    threadId,
    query: q,
    type,
    limit,
    offset,
  }));
})

.post('/threads/:id/messages',
  zValidator('json', z.object({
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.string().optional(),
    tool_calls: z.array(z.unknown()).optional(),
    tool_call_id: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })),
  async (c) => {
  const user = c.get('user');
  const threadId = c.req.param('id');
  const body = c.req.valid('json');

  const access = await checkThreadAccess(c.env.DB, threadId, user.id, ['owner', 'admin', 'editor']);
  if (!access) {
    return notFound(c, 'Thread');
  }

  const content = typeof body.content === 'string' ? body.content : '';
  const attachmentCount = Array.isArray(body.metadata?.attachments) ? body.metadata.attachments.length : 0;

  if (!content && attachmentCount === 0) {
    return badRequest(c, 'Content is required');
  }

  let message;
  try {
    message = await createMessage(c.env, c.env.DB, access.thread, {
      ...body,
      content,
    });
  } catch (err) {
    logError('Failed to create message', err, { action: 'create_message', threadId });
    return internalError(c, 'Failed to create message');
  }

  return c.json({ message }, 201);
})

.get('/threads/:id/export',
  zValidator('query', z.object({
    format: z.string().optional(),
    include_internal: z.string().optional(),
  })),
  async (c) => {
  const user = c.get('user');
  const threadId = c.req.param('id');
  const exportQuery = c.req.valid('query');
  const format = (exportQuery.format || 'markdown').toLowerCase();
  const includeInternal = exportQuery.include_internal === '1';

  const access = await checkThreadAccess(c.env.DB, threadId, user.id);
  if (!access) {
    return notFound(c, 'Thread');
  }

  const response = await exportThread({
    db: c.env.DB,
    renderPdf: getPlatformServices(c).documents.renderPdf,
    threadId,
    includeInternal,
    includeInternalRolesAllowed: ['owner', 'admin'].includes(access.role),
    format,
  });
  if (!response) {
    return notFound(c, 'Thread');
  }
  return response;
});
