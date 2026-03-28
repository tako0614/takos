import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../shared/types';
import { now } from '../../shared/utils';
import { validateUsername } from '../../shared/utils/reserved-usernames';
import { type BaseVariables } from './shared/route-auth';
import { BadRequestError, ConflictError } from '@takoserver/common/errors';
import { zValidator } from './zod-validator';
import { getDb } from '../../infra/db';
import { accounts } from '../../infra/db/schema';
import { eq, and, ne } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const completeSetupSchema = z.object({
  username: z.string(),
});

const checkUsernameSchema = z.object({
  username: z.string(),
});

export default new Hono<{ Bindings: Env; Variables: BaseVariables }>()
  /**
   * GET /setup/status - Check if user has completed setup
   */
  .get('/status', async (c) => {
    const user = c.get('user');

    return c.json({
      setup_completed: !!user.setup_completed,
      username: user.username,
      email: user.email,
      name: user.name,
    });
  })

  /**
   * POST /setup/complete - Complete initial setup
   * Required: username
   */
  .post('/complete',
    zValidator('json', completeSetupSchema),
    async (c) => {
    const user = c.get('user');

    // If already setup, return error
    if (user.setup_completed) {
      throw new BadRequestError('Setup already completed');
    }

    const body = c.req.valid('json');
    const { username } = body;

    // Validate username
    const usernameError = validateUsername(username);
    if (usernameError) {
      throw new BadRequestError(usernameError);
    }

    // Check if username is already taken
    const db = getDb(c.env.DB);
    const existingAccount = await db.select({ id: accounts.id }).from(accounts).where(
      and(eq(accounts.slug, username.toLowerCase()), ne(accounts.id, user.id))
    ).get();

    if (existingAccount) {
      throw new ConflictError('This username is already taken');
    }

    const timestamp = now();
    await db.update(accounts).set({
      slug: username.toLowerCase(),
      setupCompleted: true,
      updatedAt: timestamp,
    }).where(eq(accounts.id, user.id));

    return c.json({
      success: true,
      username: username.toLowerCase(),
    });
  })

  /**
   * POST /setup/check-username - Check if username is available
   */
  .post('/check-username',
    zValidator('json', checkUsernameSchema),
    async (c) => {
    const body = c.req.valid('json');
    const { username } = body;

    // Validate username format
    const usernameError = validateUsername(username);
    if (usernameError) {
      return c.json({ available: false, error: usernameError });
    }

    // Check if username is already taken
    const existing = await getDb(c.env.DB).select({ id: accounts.id }).from(accounts).where(
      eq(accounts.slug, username.toLowerCase())
    ).get();

    if (existing) {
      return c.json({ available: false, error: 'This username is already taken' });
    }

    return c.json({ available: true });
  });
