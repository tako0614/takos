/**
 * GET /api/seed-repositories
 *
 * Returns the list of seed repositories for the new-workspace popup.
 * No auth required — this is static public config.
 */

import { Hono } from 'hono';
import { SEED_REPOSITORIES } from '../../application/services/seed-repositories';

const router = new Hono();

router.get('/seed-repositories', (c) => {
  return c.json({ repositories: SEED_REPOSITORIES });
});

export default router;
