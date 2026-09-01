import { Hono } from "hono";
import type { Env } from "../../../shared/types/index.ts";
import type { BaseVariables } from "../route-auth.ts";
import {
  BadRequestError,
  NotFoundError,
} from "@takos/worker-platform-utils/errors";
import { checkRunAccess } from "./access.ts";
import { getPlatformServices } from "../../../platform/accessors.ts";
import {
  createRunObservationSseStream,
  parseRunReplayCursor,
} from "./observation.ts";

type RunSseRouteEnv = { Bindings: Env; Variables: BaseVariables };

/**
 * SSE endpoint for run events.
 *
 * GET /api/runs/:id/sse
 */
export function createRunSseRouter(): Hono<RunSseRouteEnv> {
  const router = new Hono<RunSseRouteEnv>();

  router.get("/:id/sse", async (c) => {
    const user = c.get("user");
    const runId = c.req.param("id");

    // Auth — same as WS route
    const access = await checkRunAccess(c.env.DB, runId, user.id);
    if (!access) {
      throw new NotFoundError("Run");
    }

    // Get SSE notifier from platform services
    const services = getPlatformServices(c);
    const sseNotifier = services.sseNotifier;

    // Parse Last-Event-ID from header or query parameter
    const lastEventIdRaw = c.req.header("Last-Event-ID") ??
      c.req.query("last_event_id");
    const lastEventId = parseRunReplayCursor(lastEventIdRaw);
    if (lastEventId === null) {
      throw new BadRequestError("Invalid last_event_id");
    }

    if (!sseNotifier) {
      const stream = createRunObservationSseStream(
        c.env,
        runId,
        access.run.status,
        lastEventId,
      );

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // Subscribe to the run channel
    const channel = `run:${runId}`;
    const stream = sseNotifier.subscribe(channel, lastEventId);

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  });

  return router;
}
