import { Hono } from "hono";
import { z } from "zod";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import { zValidator } from "../zod-validator.ts";
import {
  getServiceForUser,
  getServiceForUserWithRole,
} from "../../../application/services/platform/workers.ts";
import { ServiceDesiredStateService } from "../../../application/services/platform/worker-desired-state.ts";
import { logError } from "../../../shared/utils/logger.ts";
import { InternalError, NotFoundError } from "takos-common/errors";

export const workersSettingsConfigRouteDeps = {
  getServiceForUser,
  getServiceForUserWithRole,
  createDesiredStateService: (env: AuthenticatedRouteEnv["Bindings"]) =>
    new ServiceDesiredStateService(env),
};

const settingsConfig = new Hono<AuthenticatedRouteEnv>()
  .get("/:id/settings", async (c) => {
    const user = c.get("user");
    const workerId = c.req.param("id");

    const worker = await workersSettingsConfigRouteDeps.getServiceForUser(
      c.env.DB,
      workerId,
      user.id,
    );

    if (!worker) {
      throw new NotFoundError("Service");
    }

    try {
      const desiredState = workersSettingsConfigRouteDeps
        .createDesiredStateService(c.env);
      const settings = await desiredState.getRuntimeConfig(
        worker.space_id,
        worker.id,
      );

      return c.json({
        compatibility_date: settings.compatibility_date,
        compatibility_flags: settings.compatibility_flags,
        limits: settings.limits,
        applies_on_next_deploy: true,
        updated_at: settings.updated_at,
      });
    } catch (err) {
      logError("Failed to get service settings", err, {
        module: "routes/services/settings",
      });
      throw new InternalError("Failed to get service settings");
    }
  })
  .patch(
    "/:id/settings",
    zValidator(
      "json",
      z.object({
        compatibility_date: z.string().optional(),
        compatibility_flags: z.array(z.string()).optional(),
        limits: z.object({
          cpu_ms: z.number().optional(),
          subrequests: z.number().optional(),
        }).optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const workerId = c.req.param("id");
      const body = c.req.valid("json");

      const worker = await workersSettingsConfigRouteDeps
        .getServiceForUserWithRole(c.env.DB, workerId, user.id, [
          "owner",
          "admin",
          "editor",
        ]);

      if (!worker) {
        throw new NotFoundError("Service");
      }

      try {
        const desiredState = workersSettingsConfigRouteDeps
          .createDesiredStateService(c.env);
        const settings = await desiredState.saveRuntimeConfig({
          spaceId: worker.space_id,
          workerId: worker.id,
          compatibilityDate: body.compatibility_date,
          compatibilityFlags: body.compatibility_flags,
          limits: body.limits,
        });

        return c.json({
          success: true,
          settings: {
            compatibility_date: settings.compatibility_date,
            compatibility_flags: settings.compatibility_flags,
            limits: settings.limits,
            updated_at: settings.updated_at,
          },
          applies_on_next_deploy: true,
        });
      } catch (err) {
        logError("Failed to update service settings", err, {
          module: "routes/services/settings",
        });
        throw new InternalError("Failed to update service settings");
      }
    },
  );

export default settingsConfig;
