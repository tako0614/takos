import { Hono } from "hono";
import { z } from "zod";

import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from "takos-common/errors";

import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import { zValidator } from "../zod-validator.ts";
import {
  getServiceForUser,
  getServiceForUserWithRole,
} from "../../../application/services/platform/workers.ts";
import {
  listServiceConsumes,
  replaceServiceConsumes,
} from "../../../application/services/platform/service-publications.ts";
import { logError } from "../../../shared/utils/logger.ts";

const consumeSchema = z.object({
  publication: z.string().min(1),
  env: z.record(z.string().min(1)).optional(),
});

export const workersSettingsConsumesRouteDeps = {
  getServiceForUser,
  getServiceForUserWithRole,
  listServiceConsumes,
  replaceServiceConsumes,
};

const settingsConsumes = new Hono<AuthenticatedRouteEnv>()
  .get("/:id/consumes", async (c) => {
    const user = c.get("user");
    const workerId = c.req.param("id");

    const worker = await workersSettingsConsumesRouteDeps.getServiceForUser(
      c.env.DB,
      workerId,
      user.id,
    );

    if (!worker) {
      throw new NotFoundError("Service");
    }

    try {
      const consumes = await workersSettingsConsumesRouteDeps
        .listServiceConsumes(
          c.env,
          worker.space_id,
          worker.id,
        );
      return c.json({
        consumes,
        applies_on_next_deploy: true,
      });
    } catch (err) {
      logError("Failed to get service consumes", err, {
        module: "routes/services/settings",
      });
      throw new InternalError("Failed to get service consumes");
    }
  })
  .put(
    "/:id/consumes",
    zValidator(
      "json",
      z.object({
        consumes: z.array(consumeSchema).optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const workerId = c.req.param("id");
      const body = c.req.valid("json");

      const worker = await workersSettingsConsumesRouteDeps
        .getServiceForUserWithRole(
          c.env.DB,
          workerId,
          user.id,
          ["owner", "admin"],
        );

      if (!worker) {
        throw new NotFoundError("Service");
      }

      try {
        const consumes = await workersSettingsConsumesRouteDeps
          .replaceServiceConsumes(c.env, {
            spaceId: worker.space_id,
            serviceId: worker.id,
            serviceName: worker.slug || worker.service_name || worker.id,
            consumes: body.consumes,
          });

        return c.json({
          success: true,
          consumes,
          applies_on_next_deploy: true,
        });
      } catch (err) {
        logError("Failed to update service consumes", err, {
          module: "routes/services/settings",
        });
        if (err instanceof Error) {
          throw new BadRequestError(err.message);
        }
        throw new InternalError("Failed to update service consumes");
      }
    },
  );

export default settingsConsumes;
