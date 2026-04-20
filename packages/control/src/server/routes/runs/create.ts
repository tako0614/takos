import { z } from "zod";
import type { Hono } from "hono";
import type { Env } from "../../../shared/types/index.ts";
import type { BaseVariables } from "../route-auth.ts";
import { AppError, BadRequestError } from "takos-common/errors";

type RunRouteApp = Hono<{ Bindings: Env; Variables: BaseVariables }>;
import { zValidator } from "../zod-validator.ts";
import { runsRouteDeps } from "./deps.ts";

export function registerRunCreateRoutes(app: RunRouteApp) {
  app.post(
    "/threads/:threadId/runs",
    zValidator(
      "json",
      z.object({
        agent_type: z.string().optional(),
        input: z.record(z.unknown()).optional(),
        parent_run_id: z.string().optional(),
        model: z.string().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const threadId = c.req.param("threadId");
      const body = c.req.valid("json") as {
        agent_type?: string;
        input?: Record<string, unknown>;
        parent_run_id?: string;
        model?: string;
      };
      const result = await runsRouteDeps.createThreadRun(c.env, {
        userId: user.id,
        threadId,
        agentType: body.agent_type,
        input: body.input,
        parentRunId: body.parent_run_id,
        model: body.model,
      });

      if (!result.ok) {
        if (result.status === 400) {
          throw new BadRequestError(result.error);
        }
        throw new AppError(result.error, undefined, result.status);
      }

      return c.json({ run: result.run }, result.status);
    },
  );
}
