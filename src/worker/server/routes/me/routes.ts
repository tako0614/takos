import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../../shared/types/index.ts";
import { type BaseVariables } from "../route-auth.ts";
import { zValidator } from "../zod-validator.ts";
import {
  AuthorizationError,
  NotFoundError,
} from "@takos/worker-platform-utils/errors";
import {
  ensureUserSettings,
  formatUserSettingsResponse,
  updateUserSettings,
} from "../../../application/services/identity/user-settings.ts";
import {
  toUserResponse,
  toWorkspaceResponse,
} from "../../../application/services/identity/response-formatters.ts";
import { getOrCreatePersonalWorkspace } from "../../../application/services/identity/spaces.ts";
import privacy from "./privacy.ts";

const activityVisibilitySchema = z.string().trim().toLowerCase().pipe(
  z.enum(["public", "followers", "private"]),
);

export const userSettingsPatchSchema = z
  .object({
    setup_completed: z.boolean().optional(),
    auto_update_enabled: z.boolean().optional(),
    private_account: z.boolean().optional(),
    activity_visibility: activityVisibilitySchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one setting is required",
  });

export default new Hono<{ Bindings: Env; Variables: BaseVariables }>()
  .use("*", async (c, next) => {
    const user = c.get("user");
    if (user?.principal_kind && user.principal_kind !== "user") {
      throw new AuthorizationError(
        "/api/me is only available to human accounts",
      );
    }
    await next();
  })
  .get("/", async (c) => {
    const user = c.get("user");
    return c.json(toUserResponse(user));
  })
  .get("/personal-space", async (c) => {
    const user = c.get("user");
    const personalSpace = await getOrCreatePersonalWorkspace(
      c.env,
      user.id,
    );

    if (!personalSpace) {
      throw new NotFoundError("Personal space");
    }

    return c.json({ space: toWorkspaceResponse(personalSpace) });
  })
  // Get user settings (including setup state)
  .get("/settings", async (c) => {
    const user = c.get("user");

    const settings = await ensureUserSettings(c.env.DB, user.id);
    return c.json(formatUserSettingsResponse(settings));
  })
  // Update user settings
  .patch(
    "/settings",
    zValidator("json", userSettingsPatchSchema),
    async (c) => {
      const user = c.get("user");
      const body = c.req.valid("json");
      const settings = await updateUserSettings(c.env.DB, user.id, body);
      return c.json(formatUserSettingsResponse(settings));
    },
  )
  .route("/privacy", privacy);
