import { Hono } from "hono";
import type { Env } from "../../../shared/types/index.ts";
import { type BaseVariables, parseJsonBody } from "../route-auth.ts";
import {
  AuthorizationError,
  BadRequestError,
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
  .patch("/settings", async (c) => {
    const user = c.get("user");
    const body = await parseJsonBody<{
      setup_completed?: boolean;
      auto_update_enabled?: boolean;
      private_account?: boolean;
      activity_visibility?: string;
    }>(c);

    if (!body) {
      throw new BadRequestError("Invalid JSON body");
    }

    if (
      body.private_account !== undefined &&
      typeof body.private_account !== "boolean"
    ) {
      throw new BadRequestError("private_account must be boolean");
    }

    let activityVisibility = body.activity_visibility;
    if (activityVisibility !== undefined) {
      if (typeof activityVisibility !== "string") {
        throw new BadRequestError("activity_visibility must be string");
      }
      activityVisibility = activityVisibility.trim().toLowerCase();
      if (!["public", "followers", "private"].includes(activityVisibility)) {
        throw new BadRequestError(
          "activity_visibility must be one of public|followers|private",
        );
      }
    }

    const settings = await updateUserSettings(c.env.DB, user.id, {
      ...body,
      activity_visibility: activityVisibility,
    });
    return c.json(formatUserSettingsResponse(settings));
  })
  .route("/privacy", privacy);
