import { Hono } from "hono";
import type { Env } from "../../../shared/types/index.ts";
import type { BaseVariables } from "../route-auth.ts";
import { NotFoundError } from "@takos/worker-platform-utils/errors";
import { checkRunAccess } from "./access.ts";
import { getPlatformServices } from "../../../platform/accessors.ts";
import { createRunObservationSseStream } from "./observation.ts";

type RunSseRouteEnv = { Bindings: Env; Variables: BaseVariables };

/** Check authority immediately before releasing each upstream SSE chunk. */
export function guardSseStream(
  upstream: ReadableStream<Uint8Array>,
  authorize: () => Promise<boolean>,
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  let closed = false;

  const cancel = async (reason: unknown) => {
    if (closed) return;
    closed = true;
    try {
      await reader.cancel(reason);
    } catch {
      // The upstream may already have failed; no pending bytes are released.
    } finally {
      reader.releaseLock();
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (closed) return;
      try {
        if (!(await authorize())) {
          await cancel("run authority revoked");
          controller.close();
          return;
        }
        if (closed) return;
        const chunk = await reader.read();
        if (closed) return;
        if (chunk.done) {
          closed = true;
          reader.releaseLock();
          controller.close();
          return;
        }
        // A pending read can span a revocation. Prove current authority again
        // after it settles, before any of its bytes reach the client.
        if (!(await authorize())) {
          await cancel("run authority revoked");
          controller.close();
          return;
        }
        if (closed) return;
        controller.enqueue(chunk.value);
      } catch (error) {
        if (!closed) {
          await cancel(error);
          controller.error(error);
        }
      }
    },
    cancel(reason) {
      return cancel(reason);
    },
  });
}

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

    if (!sseNotifier) {
      const stream = createRunObservationSseStream(
        c.env,
        runId,
        access.run.status,
        lastEventId ?? 0,
        {
          authorize: async () =>
            Boolean(await checkRunAccess(c.env.DB, runId, user.id)),
        },
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
    const stream = guardSseStream(
      sseNotifier.subscribe(channel, lastEventId),
      async () => Boolean(await checkRunAccess(c.env.DB, runId, user.id)),
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
