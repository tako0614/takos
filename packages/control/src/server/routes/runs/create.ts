import { z } from 'zod';
import { badRequest } from '../shared/helpers';
import type { Hono } from 'hono';
import type { Env } from '../../../shared/types';
import type { BaseVariables } from '../shared/helpers';
import { errorResponse } from '../../../shared/utils/error-response';

type RunRouteApp = Hono<{ Bindings: Env; Variables: BaseVariables }>;
import { zValidator } from '../zod-validator';
import { createThreadRun } from '../../../application/services/execution/run-creation';

export function registerRunCreateRoutes(app: RunRouteApp) {
  app.post('/threads/:threadId/runs',
    zValidator('json', z.object({
      agent_type: z.string().optional(),
      input: z.record(z.unknown()).optional(),
      parent_run_id: z.string().optional(),
      model: z.string().optional(),
    })),
    async (c) => {
      const user = c.get('user');
      const threadId = c.req.param('threadId');
      const body = c.req.valid('json' as never) as { agent_type?: string; input?: Record<string, unknown>; parent_run_id?: string; model?: string };
      const result = await createThreadRun(c.env, {
        userId: user.id,
        threadId,
        agentType: body.agent_type,
        input: body.input,
        parentRunId: body.parent_run_id,
        model: body.model,
      });

      if (!result.ok) {
        if (result.status === 400) {
          return badRequest(c, result.error);
        }
        return errorResponse(c, result.status, result.error);
      }

      return c.json({ run: result.run }, result.status);
    },
  );
}
