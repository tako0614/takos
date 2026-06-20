import { Hono } from "hono";
import type { Env } from "../../shared/types/index.ts";

import type { BaseVariables } from "./route-auth.ts";
import { BadRequestError } from "@takos/worker-platform-utils/errors";
import { getDb } from "../../infra/db/index.ts";
import { accounts } from "../../infra/db/schema.ts";
import { eq } from "drizzle-orm";

export default new Hono<{ Bindings: Env; Variables: BaseVariables }>()
  /**
   * GET /setup/status - Check if user has completed setup
   */
  .get("/status", async (c) => {
    const user = c.get("user");

    return c.json({
      setup_completed: !!user.setup_completed,
      username: user.username,
      email: user.email,
      name: user.name,
    });
  })
  /**
   * POST /setup/complete - Complete initial setup.
   *
   * Takos is a single-owner personal product: setup simply flips the
   * setupCompleted flag. No public @username handle is assigned.
   */
  .post("/complete", async (c) => {
    const user = c.get("user");

    if (user.setup_completed) {
      throw new BadRequestError("Setup already completed");
    }

    const db = getDb(c.env.DB);
    const timestamp = new Date().toISOString();
    await db.update(accounts).set({
      setupCompleted: true,
      updatedAt: timestamp,
    }).where(eq(accounts.id, user.id));

    return c.json({ success: true });
  });
