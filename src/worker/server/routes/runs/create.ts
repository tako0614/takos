import { z } from "zod";
import type { Hono } from "hono";
import type { Env } from "../../../shared/types/index.ts";
import type { BaseVariables } from "../route-auth.ts";
import { AppError, BadRequestError } from "@takos/worker-platform-utils/errors";

type RunRouteApp = Hono<{ Bindings: Env; Variables: BaseVariables }>;
import { zValidator } from "../zod-validator.ts";
import { createThreadRun } from "../../../application/services/execution/run-creation.ts";
import { CLIENT_OPERATION_ID_PATTERN } from "../../../shared/utils/client-operation-id.ts";
import { AGENT_TYPES } from "../../../shared/types/agent-tasks.ts";
import {
  MAX_RUN_INPUT_BYTES,
  stringifyBoundedRunInput,
} from "../../../shared/utils/run-input.ts";

export const createRunSchema = z.object({
  agent_type: z.enum(AGENT_TYPES).optional(),
  input: z.record(z.unknown()).superRefine((value, context) => {
    if (stringifyBoundedRunInput(value) === null) {
      context.addIssue({
        code: "custom",
        message: `Run input must not exceed ${MAX_RUN_INPUT_BYTES} bytes`,
      });
    }
  }).optional(),
  parent_run_id: z.string().min(1).max(128).optional(),
  model: z.string().min(1).max(128).optional(),
  idempotency_key: z.string().regex(CLIENT_OPERATION_ID_PATTERN).optional(),
  confirmation_grant_id: z.string().min(1).max(128).optional(),
}).strict();

export function registerRunCreateRoutes(app: RunRouteApp) {
  app.post(
    "/threads/:threadId/runs",
    zValidator(
      "json",
      createRunSchema,
    ),
    async (c) => {
      const user = c.get("user");
      const threadId = c.req.param("threadId");
      const body = c.req.valid("json") as {
        agent_type?: string;
        input?: Record<string, unknown>;
        parent_run_id?: string;
        model?: string;
        idempotency_key?: string;
        confirmation_grant_id?: string;
      };
      const result = await createThreadRun(c.env, {
        userId: user.id,
        threadId,
        agentType: body.agent_type,
        input: body.input,
        parentRunId: body.parent_run_id,
        model: body.model,
        idempotencyKey: body.idempotency_key,
        confirmationGrantId: body.confirmation_grant_id,
      });

      if (!result.ok) {
        if (result.status === 400) {
          throw new BadRequestError(result.error);
        }
        throw new AppError(result.error, undefined, result.status);
      }

      return c.json({ run: result.run, reused: result.reused }, result.status);
    },
  );
}
