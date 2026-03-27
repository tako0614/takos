import { Hono } from 'hono';
import { z } from 'zod';
import type {
  Env,
  ReminderStatus,
  ReminderTriggerType,
  ReminderPriority,
} from '../../shared/types';
import { checkSpaceAccess } from '../../shared/utils';
import { forbidden, notFound, internalError, parseLimit, requireSpaceAccess, type BaseVariables } from './shared/route-auth';
import { zValidator } from './zod-validator';
import {
  listReminders,
  getReminderById,
  createReminder,
  updateReminder,
  deleteReminder,
  triggerReminder,
} from '../../application/services/memory';

export default new Hono<{ Bindings: Env; Variables: BaseVariables }>()

  // List reminders for a workspace
  .get('/spaces/:spaceId/reminders',
    zValidator('query', z.object({
      status: z.string().optional(),
      limit: z.string().optional(),
    })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await requireSpaceAccess(c, spaceId, user.id);
    if (access instanceof Response) {
      return access;
    }

    const validatedQuery = c.req.valid('query');
    const status = validatedQuery.status as ReminderStatus | undefined;
    const limit = parseLimit(validatedQuery.limit, 50, 100);

    const reminders = await listReminders(c.env.DB, access.space.id, {
      status,
      limit,
    });

    return c.json({ reminders });
  })

  // Get a specific reminder
  .get('/reminders/:id', async (c) => {
    const user = c.get('user');
    const reminderId = c.req.param('id');

    const reminder = await getReminderById(c.env.DB, reminderId);
    if (!reminder) {
      return notFound(c, 'Reminder');
    }

    const access = await checkSpaceAccess(c.env.DB, reminder.space_id, user.id);
    if (!access) {
      return forbidden(c);
    }

    return c.json(reminder);
  })

  // Create a reminder
  .post('/spaces/:spaceId/reminders',
    zValidator('json', z.object({
      content: z.string().min(1, 'content is required'),
      context: z.string().optional(),
      trigger_type: z.enum(['time', 'condition', 'context']),
      trigger_value: z.string().optional(),
      priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
    })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');

    const access = await requireSpaceAccess(c, spaceId, user.id);
    if (access instanceof Response) {
      return access;
    }

    const body = c.req.valid('json');

    const reminder = await createReminder(c.env.DB, {
      spaceId: access.space.id,
      userId: user.id,
      content: body.content,
      context: body.context || null,
      triggerType: body.trigger_type,
      triggerValue: body.trigger_value || null,
      priority: body.priority,
    });

    if (!reminder) {
      return internalError(c, 'Failed to create reminder');
    }
    return c.json(reminder, 201);
  })

  // Update a reminder
  .patch('/reminders/:id',
    zValidator('json', z.object({
      content: z.string().optional(),
      context: z.string().optional(),
      trigger_value: z.string().optional(),
      status: z.enum(['pending', 'triggered', 'completed', 'dismissed']).optional(),
      priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
    })),
    async (c) => {
    const user = c.get('user');
    const reminderId = c.req.param('id');

    const reminder = await getReminderById(c.env.DB, reminderId);
    if (!reminder) {
      return notFound(c, 'Reminder');
    }

    const access = await checkSpaceAccess(c.env.DB, reminder.space_id, user.id, ['owner', 'admin', 'editor']);
    if (!access) {
      return forbidden(c);
    }

    const body = c.req.valid('json');

    const updated = await updateReminder(c.env.DB, reminderId, {
      content: body.content,
      context: body.context,
      triggerValue: body.trigger_value,
      status: body.status,
      priority: body.priority,
    });

    return c.json(updated);
  })

  // Delete a reminder
  .delete('/reminders/:id', async (c) => {
    const user = c.get('user');
    const reminderId = c.req.param('id');

    const reminder = await getReminderById(c.env.DB, reminderId);
    if (!reminder) {
      return notFound(c, 'Reminder');
    }

    const access = await checkSpaceAccess(c.env.DB, reminder.space_id, user.id, ['owner', 'admin', 'editor']);
    if (!access) {
      return forbidden(c);
    }

    await deleteReminder(c.env.DB, reminderId);

    return c.json({ success: true });
  })

  // Trigger a reminder manually
  .post('/reminders/:id/trigger', async (c) => {
    const user = c.get('user');
    const reminderId = c.req.param('id');

    const reminder = await getReminderById(c.env.DB, reminderId);
    if (!reminder) {
      return notFound(c, 'Reminder');
    }

    const access = await checkSpaceAccess(c.env.DB, reminder.space_id, user.id, ['owner', 'admin', 'editor']);
    if (!access) {
      return forbidden(c);
    }

    const updated = await triggerReminder(c.env.DB, reminderId);

    return c.json(updated);
  });
