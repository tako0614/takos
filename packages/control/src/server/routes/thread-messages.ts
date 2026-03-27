import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, MessageRole } from '../../shared/types';
import { parseLimit, parseOffset, type BaseVariables } from './shared/route-auth';
import { BadRequestError, NotFoundError, InternalError } from '@takos/common/errors';
import { logError } from '../../shared/utils/logger';
import { zValidator } from './zod-validator';
import {
  checkThreadAccess,
  createMessage,
} from '../../application/services/threads/thread-service';
import { searchThreadMessages } from '../../application/services/threads/thread-search';
import { getThreadTimeline } from '../../application/services/threads/thread-timeline';
import { getThreadHistory } from '../../application/services/threads/thread-history';

export default new Hono<{ Bindings: Env; Variables: BaseVariables }>()

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
    throw new NotFoundError('Thread');
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
    throw new NotFoundError('Thread');
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
    throw new BadRequestError('q is required');
  }

  const access = await checkThreadAccess(c.env.DB, threadId, user.id);
  if (!access) {
    throw new NotFoundError('Thread');
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
    throw new NotFoundError('Thread');
  }

  const content = typeof body.content === 'string' ? body.content : '';
  const attachmentCount = Array.isArray(body.metadata?.attachments) ? body.metadata.attachments.length : 0;

  if (!content && attachmentCount === 0) {
    throw new BadRequestError('Content is required');
  }

  let message;
  try {
    message = await createMessage(c.env, c.env.DB, access.thread, {
      ...body,
      content,
    });
  } catch (err) {
    logError('Failed to create message', err, { action: 'create_message', threadId });
    throw new InternalError('Failed to create message');
  }

  return c.json({ message }, 201);
});
