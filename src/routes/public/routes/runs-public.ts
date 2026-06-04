import type { Hono } from "hono";
import { actorFromAuthenticatedRequest, requireDbAndActor } from "../shared/api/auth.ts";
import type { ApiBindings } from "../shared/api/bindings.ts";
import {
  commonError,
  parseRunEventCursor,
  readJsonBody,
  resolveRequestId,
} from "../shared/api/common.ts";
import { buildRunNotifierHeaders } from "../shared/api/forwarding.ts";
import { parseCreateRunArtifactInput } from "../shared/api/input-parsers.ts";
import {
  createRunArtifact,
  listRunArtifacts,
  readArtifactAccess,
} from "../shared/runs/artifacts.ts";
import {
  cancelRun,
  RunAlreadyFinishedError,
} from "../shared/runs/mutations.ts";
import {
  createRunObservationSseStream,
  loadRunObservation,
} from "../shared/runs/observation.ts";
import { readRunAccess } from "../shared/runs/read-model.ts";

export function registerRunsPublicRoutes(
  app: Hono<{ Bindings: ApiBindings }>,
): void {
  app.get("/api/runs/:id", async (c) => {
    const resolved = await requireDbAndActor(c);
    if (!resolved.ok) return resolved.response;
    const { db, actor } = resolved;

    const access = await readRunAccess(
      db,
      c.req.param("id"),
      actor.actorAccountId,
    );
    if (!access) {
      return c.json(commonError("NOT_FOUND", "Run not found"), { status: 404 });
    }

    return c.json({
      run: access.run,
      role: access.role,
    });
  });

  app.get("/api/runs/:id/events", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    const lastEventId = parseRunEventCursor(c.req.query("last_event_id"));
    if (lastEventId === null) {
      return c.json(commonError("INVALID_ARGUMENT", "Invalid last_event_id"), {
        status: 400,
      });
    }
    const actorResult = await actorFromAuthenticatedRequest(
      c.req.raw,
      resolveRequestId(c.req),
      { env: c.env },
    );
    if (!actorResult.ok) return actorResult.response;

    const access = await readRunAccess(
      db,
      c.req.param("id"),
      actorResult.actor.actorAccountId,
    );
    if (!access) {
      return c.json(commonError("NOT_FOUND", "Run not found"), { status: 404 });
    }

    const observation = await loadRunObservation(
      {
        DB: db,
        TAKOS_OFFLOAD: c.env?.TAKOS_OFFLOAD,
        RUN_NOTIFIER: c.env?.RUN_NOTIFIER,
      },
      c.req.param("id"),
      access.run.status,
      lastEventId,
    );
    return c.json({
      events: observation.events,
      run_status: observation.runStatus,
    });
  });

  app.get("/api/runs/:id/replay", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    const lastEventId = parseRunEventCursor(
      c.req.query("last_event_id") ?? c.req.query("after"),
    );
    if (lastEventId === null) {
      return c.json(commonError("INVALID_ARGUMENT", "Invalid last_event_id"), {
        status: 400,
      });
    }
    const actorResult = await actorFromAuthenticatedRequest(
      c.req.raw,
      resolveRequestId(c.req),
      { env: c.env },
    );
    if (!actorResult.ok) return actorResult.response;

    const access = await readRunAccess(
      db,
      c.req.param("id"),
      actorResult.actor.actorAccountId,
    );
    if (!access) {
      return c.json(commonError("NOT_FOUND", "Run not found"), { status: 404 });
    }

    const observation = await loadRunObservation(
      {
        DB: db,
        TAKOS_OFFLOAD: c.env?.TAKOS_OFFLOAD,
        RUN_NOTIFIER: c.env?.RUN_NOTIFIER,
      },
      c.req.param("id"),
      access.run.status,
      lastEventId,
    );
    return c.json({
      events: observation.events,
      run_status: observation.runStatus,
    });
  });

  app.get("/api/runs/:id/ws", async (c) => {
    const resolved = await requireDbAndActor(c);
    if (!resolved.ok) return resolved.response;
    const { db, actor } = resolved;

    const access = await readRunAccess(
      db,
      c.req.param("id"),
      actor.actorAccountId,
    );
    if (!access) {
      return c.json(commonError("NOT_FOUND", "Run not found"), { status: 404 });
    }

    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
      return c.json(commonError("BAD_REQUEST", "Expected WebSocket upgrade"), {
        status: 426,
      });
    }

    const namespace = c.env?.RUN_NOTIFIER;
    if (!namespace) {
      return c.json(
        commonError("INTERNAL_ERROR", "run notifier is not configured"),
        { status: 503 },
      );
    }

    const id = namespace.idFromName(c.req.param("id"));
    const stub = namespace.get(id);
    const headers = buildRunNotifierHeaders(c.req.raw.headers, {
      "X-WS-Auth-Validated": "true",
      "X-WS-User-Id": actor.actorAccountId,
    });
    return await stub.fetch(
      new Request(c.req.raw.url, {
        method: c.req.raw.method,
        headers,
        body: c.req.raw.body,
      }),
    );
  });

  app.get("/api/runs/:id/sse", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    const lastEventId = parseRunEventCursor(
      c.req.header("Last-Event-ID") ??
        c.req.query("last_event_id") ??
        c.req.query("after"),
    );
    if (lastEventId === null) {
      return c.json(commonError("INVALID_ARGUMENT", "Invalid last_event_id"), {
        status: 400,
      });
    }
    const actorResult = await actorFromAuthenticatedRequest(
      c.req.raw,
      resolveRequestId(c.req),
      { env: c.env },
    );
    if (!actorResult.ok) return actorResult.response;

    const access = await readRunAccess(
      db,
      c.req.param("id"),
      actorResult.actor.actorAccountId,
    );
    if (!access) {
      return c.json(commonError("NOT_FOUND", "Run not found"), { status: 404 });
    }

    const stream = createRunObservationSseStream(
      {
        DB: db,
        TAKOS_OFFLOAD: c.env?.TAKOS_OFFLOAD,
        RUN_NOTIFIER: c.env?.RUN_NOTIFIER,
      },
      c.req.param("id"),
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
  });

  app.post("/api/runs/:id/cancel", async (c) => {
    const resolved = await requireDbAndActor(c);
    if (!resolved.ok) return resolved.response;
    const { db, actor } = resolved;

    try {
      const cancelled = await cancelRun(
        {
          DB: db,
          TAKOS_OFFLOAD: c.env?.TAKOS_OFFLOAD,
          RUN_NOTIFIER: c.env?.RUN_NOTIFIER,
        },
        c.req.param("id"),
        actor.actorAccountId,
      );
      if (!cancelled) {
        return c.json(commonError("NOT_FOUND", "Run not found"), {
          status: 404,
        });
      }
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof RunAlreadyFinishedError) {
        return c.json(commonError("INVALID_ARGUMENT", error.message), {
          status: 400,
        });
      }
      throw error;
    }
  });

  app.get("/api/runs/:id/artifacts", async (c) => {
    const resolved = await requireDbAndActor(c);
    if (!resolved.ok) return resolved.response;
    const { db, actor } = resolved;

    const artifacts = await listRunArtifacts(
      db,
      c.req.param("id"),
      actor.actorAccountId,
    );
    if (!artifacts) {
      return c.json(commonError("NOT_FOUND", "Run not found"), { status: 404 });
    }

    return c.json({ artifacts });
  });

  app.post("/api/runs/:id/artifacts", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    const body = await readJsonBody(c.req);
    const input = parseCreateRunArtifactInput(body);
    if (!input.ok) {
      return c.json(commonError("INVALID_ARGUMENT", input.message), {
        status: 400,
      });
    }
    const actorResult = await actorFromAuthenticatedRequest(
      c.req.raw,
      resolveRequestId(c.req),
      { env: c.env },
    );
    if (!actorResult.ok) return actorResult.response;

    const artifact = await createRunArtifact(
      db,
      c.req.param("id"),
      actorResult.actor.actorAccountId,
      input.value,
    );
    if (!artifact) {
      return c.json(commonError("NOT_FOUND", "Run not found"), { status: 404 });
    }

    return c.json({ artifact }, 201);
  });

  app.get("/api/artifacts/:id", async (c) => {
    const resolved = await requireDbAndActor(c);
    if (!resolved.ok) return resolved.response;
    const { db, actor } = resolved;

    const artifact = await readArtifactAccess(
      db,
      c.req.param("id"),
      actor.actorAccountId,
    );
    if (!artifact) {
      return c.json(commonError("NOT_FOUND", "Artifact not found"), {
        status: 404,
      });
    }

    return c.json({ artifact });
  });
}
