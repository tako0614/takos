import { Hono } from "hono";
import type { Env } from "../../../shared/types/index.ts";
import type { BaseVariables } from "../route-auth.ts";
import { NotFoundError } from "@takos/worker-platform-utils/errors";
import { checkRunAccess } from "./access.ts";
import { getPlatformServices } from "../../../platform/accessors.ts";
import { createRunObservationSseStream } from "./observation.ts";

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
    let lastEventId: number | undefined;
    if (lastEventIdRaw) {
      const parsed = parseInt(lastEventIdRaw, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        lastEventId = parsed;
      }
    }

    // Subscribe before reading the persisted timeline so commits during replay
    // wake the next read. Process-local/Redis history only signals availability;
    // SQL/object-store observation owns replay, ordering and terminal closure.
    const notifications = sseNotifier?.subscribe(`run:${runId}`, lastEventId);
    const stream = createRunObservationSseStream(
      c.env,
      runId,
      access.run.status,
      lastEventId ?? 0,
      { notifications },
    );

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
