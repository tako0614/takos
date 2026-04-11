import { Hono } from "hono";
import { z } from "zod";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import { BadRequestError } from "takos-common/errors";
import { zValidator } from "../zod-validator.ts";
import {
  getServiceForUser,
  getServiceForUserWithRole,
} from "../../../application/services/platform/workers.ts";
import { ServiceDesiredStateService } from "../../../application/services/platform/worker-desired-state.ts";
import { logError } from "../../../shared/utils/logger.ts";
import { InternalError, NotFoundError } from "takos-common/errors";

export const workersSettingsEnvVarsRouteDeps = {
  getServiceForUser,
  getServiceForUserWithRole,
  createDesiredStateService: (env: AuthenticatedRouteEnv["Bindings"]) =>
    new ServiceDesiredStateService(env),
};

const settingsEnvVars = new Hono<AuthenticatedRouteEnv>()
  .get("/:id/env", async (c) => {
    const user = c.get("user");
    const workerId = c.req.param("id");

    const worker = await workersSettingsEnvVarsRouteDeps.getServiceForUser(
      c.env.DB,
      workerId,
      user.id,
    );

    if (!worker) {
      throw new NotFoundError("Service");
    }

    try {
      const desiredState = workersSettingsEnvVarsRouteDeps
        .createDesiredStateService(c.env);
      const envVars = await desiredState.listLocalEnvVarSummaries(
        worker.space_id,
        worker.id,
      );

      return c.json({
        env: envVars,
        applies_on_next_deploy: true,
      });
    } catch (err) {
      logError("Failed to get environment variables", err, {
        module: "routes/services/settings",
      });
      throw new InternalError("Failed to get environment variables");
    }
  })
  .patch(
    "/:id/env",
    zValidator(
      "json",
      z.object({
        variables: z.array(z.object({
          name: z.string(),
          value: z.string(),
          secret: z.boolean().optional(),
        })),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const workerId = c.req.param("id");
      const body = c.req.valid("json");

      if (!Array.isArray(body.variables)) {
        throw new BadRequestError("variables array is required");
      }

      const worker = await workersSettingsEnvVarsRouteDeps
        .getServiceForUserWithRole(c.env.DB, workerId, user.id, [
          "owner",
          "admin",
          "editor",
        ]);

      if (!worker) {
        throw new NotFoundError("Service");
      }

      try {
        const desiredState = workersSettingsEnvVarsRouteDeps
          .createDesiredStateService(c.env);
        const normalizedVariables = body.variables.map((v) => ({
          name: v.name,
          value: v.value,
          secret: v.secret === true,
        }));
        await desiredState.replaceLocalEnvVars({
          spaceId: worker.space_id,
          workerId: worker.id,
          variables: normalizedVariables,
        });

        const env = await desiredState.listLocalEnvVarSummaries(
          worker.space_id,
          worker.id,
        );

        return c.json({
          success: true,
          env,
          applies_on_next_deploy: true,
        });
      } catch (err) {
        logError("Failed to update environment variables", err, {
          module: "routes/services/settings",
        });
        if (err instanceof Error) {
          throw new BadRequestError(err.message);
        }
        throw new InternalError("Failed to update environment variables");
      }
    },
  );

export default settingsEnvVars;
