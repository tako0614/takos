import type { Context, Hono } from "hono";
import { actorFromAuthenticatedRequest, requireDbAndActor } from "../shared/api/auth.ts";
import type { ApiBindings } from "../shared/api/bindings.ts";
import {
  commonError,
  parsePositiveLimit,
  parsePositiveOffset,
  readJsonBody,
  resolveRequestId,
} from "../shared/api/common.ts";
import {
  parseCreateRunInput,
  parseCreateThreadMessageInput,
  parseCreateThreadShareInput,
  parseUpdateThreadInput,
} from "../shared/api/input-parsers.ts";
import {
  createThreadRun,
  RunCreateFailedError,
  RunCreateInputError,
  RunQueueUnavailableError,
  RunRateLimitError,
} from "../shared/runs/create.ts";
import {
  InvalidRunListCursorError,
  listThreadRuns,
} from "../shared/runs/list.ts";
import { exportThread } from "../shared/threads/export.ts";
import { getThreadHistory } from "../shared/threads/history.ts";
import {
  createThreadMessage,
  listThreadMessages,
} from "../shared/threads/messages.ts";
import {
  deleteThread,
  setThreadArchived,
  updateThread,
} from "../shared/threads/mutations.ts";
import { readThreadAccess } from "../shared/threads/read-model.ts";
import { searchThreadMessages } from "../shared/threads/search.ts";
import {
  createThreadShareWithLink,
  listThreadSharesWithLinks,
  revokeThreadShare,
} from "../shared/threads/shares.ts";

async function handleThreadArchive(
  c: Context<{ Bindings: ApiBindings }>,
  archived: boolean,
) {
  const resolved = await requireDbAndActor(c);
  if (!resolved.ok) return resolved.response;
  const { db, actor } = resolved;

  const updated = await setThreadArchived(
    db,
    c.req.param("threadId"),
    actor.actorAccountId,
    archived,
  );
  if (!updated) {
    return c.json(commonError("NOT_FOUND", "Thread not found"), {
      status: 404,
    });
  }

  return c.json({ success: true });
}

export function registerThreadsPublicRoutes(
  app: Hono<{ Bindings: ApiBindings }>,
): void {
  app.get("/api/threads/:threadId", async (c) => {
    const resolved = await requireDbAndActor(c);
    if (!resolved.ok) return resolved.response;
    const { db, actor } = resolved;

    const access = await readThreadAccess(
      db,
      c.req.param("threadId"),
      actor.actorAccountId,
    );
    if (!access) {
      return c.json(commonError("NOT_FOUND", "Thread not found"), {
        status: 404,
      });
    }

    return c.json({
      thread: access.thread,
      role: access.role,
    });
  });

  app.patch("/api/threads/:threadId", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    const body = await readJsonBody(c.req);
    const input = parseUpdateThreadInput(body);
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

    const thread = await updateThread(
      db,
      c.req.param("threadId"),
      actorResult.actor.actorAccountId,
      input.value,
    );
    if (!thread) {
      return c.json(commonError("NOT_FOUND", "Thread not found"), {
        status: 404,
      });
    }

    return c.json({ thread });
  });

  app.delete("/api/threads/:threadId", async (c) => {
    const resolved = await requireDbAndActor(c);
    if (!resolved.ok) return resolved.response;
    const { db, actor } = resolved;

    const deleted = await deleteThread(
      db,
      c.req.param("threadId"),
      actor.actorAccountId,
    );
    if (!deleted) {
      return c.json(commonError("NOT_FOUND", "Thread not found"), {
        status: 404,
      });
    }

    return c.json({ success: true });
  });

  app.post(
    "/api/threads/:threadId/archive",
    (c) => handleThreadArchive(c, true),
  );

  app.post(
    "/api/threads/:threadId/unarchive",
    (c) => handleThreadArchive(c, false),
  );

  app.get("/api/threads/:threadId/runs", async (c) => {
    const resolved = await requireDbAndActor(c);
    if (!resolved.ok) return resolved.response;
    const { db, actor } = resolved;

    try {
      const result = await listThreadRuns(
        db,
        c.req.param("threadId"),
        actor.actorAccountId,
        {
          activeOnly: c.req.query("active_only") === "1",
          limit: parsePositiveLimit(c.req.query("limit"), 50, 200),
          cursor: c.req.query("cursor") ?? undefined,
        },
      );
      if (!result) {
        return c.json(commonError("NOT_FOUND", "Thread not found"), {
          status: 404,
        });
      }
      return c.json(result);
    } catch (error) {
      if (error instanceof InvalidRunListCursorError) {
        return c.json(commonError("INVALID_ARGUMENT", "Invalid cursor"), {
          status: 400,
        });
      }
      throw error;
    }
  });

  app.post("/api/threads/:threadId/runs", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    const body = await readJsonBody(c.req);
    const input = parseCreateRunInput(body);
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

    try {
      const result = await createThreadRun(
        {
          DB: db,
          RUN_QUEUE: c.env?.RUN_QUEUE,
          RUN_NOTIFIER: c.env?.RUN_NOTIFIER,
        },
        c.req.param("threadId"),
        actorResult.actor.actorAccountId,
        input.value,
      );
      if (!result) {
        return c.json(
          commonError(
            "NOT_FOUND",
            "Thread not found or insufficient permissions",
          ),
          { status: 404 },
        );
      }
      return c.json({ run: result.run }, 201);
    } catch (error) {
      if (error instanceof RunQueueUnavailableError) {
        return c.json(
          commonError("INTERNAL_ERROR", "run queue is not configured"),
          { status: 503 },
        );
      }
      if (error instanceof RunRateLimitError) {
        return c.json(commonError("RESOURCE_EXHAUSTED", error.message), {
          status: 429,
        });
      }
      if (error instanceof RunCreateInputError) {
        return c.json(commonError("INVALID_ARGUMENT", error.message), {
          status: 400,
        });
      }
      if (error instanceof RunCreateFailedError) {
        return c.json(commonError("INTERNAL_ERROR", error.message), {
          status: 500,
        });
      }
      throw error;
    }
  });

  app.get("/api/threads/:threadId/history", async (c) => {
    const resolved = await requireDbAndActor(c);
    if (!resolved.ok) return resolved.response;
    const { db, actor } = resolved;

    const result = await getThreadHistory(
      {
        DB: db,
        TAKOS_OFFLOAD: c.env?.TAKOS_OFFLOAD,
      },
      c.req.param("threadId"),
      actor.actorAccountId,
      {
        limit: parsePositiveLimit(c.req.query("limit"), 100, 200),
        offset: parsePositiveOffset(c.req.query("offset")),
        includeMessages: c.req.query("include_messages") !== "0",
        rootRunId: c.req.query("root_run_id") ?? null,
      },
    );
    if (!result) {
      return c.json(commonError("NOT_FOUND", "Thread not found"), {
        status: 404,
      });
    }

    return c.json(result);
  });

  app.get("/api/threads/:threadId/export", async (c) => {
    const resolved = await requireDbAndActor(c);
    if (!resolved.ok) return resolved.response;
    const { db, actor } = resolved;

    const response = await exportThread(
      db,
      c.req.param("threadId"),
      actor.actorAccountId,
      {
        format: c.req.query("format")?.toLowerCase() || "markdown",
        includeInternal: c.req.query("include_internal") === "1",
      },
    );
    if (!response) {
      return c.json(commonError("NOT_FOUND", "Thread not found"), {
        status: 404,
      });
    }

    return response;
  });

  app.get("/api/threads/:threadId/messages", async (c) => {
    const resolved = await requireDbAndActor(c);
    if (!resolved.ok) return resolved.response;
    const { db, actor } = resolved;

    const result = await listThreadMessages(
      db,
      c.req.param("threadId"),
      actor.actorAccountId,
      {
        limit: parsePositiveLimit(c.req.query("limit"), 100, 200),
        offset: parsePositiveOffset(c.req.query("offset")),
        offload: c.env?.TAKOS_OFFLOAD,
      },
    );
    if (!result) {
      return c.json(commonError("NOT_FOUND", "Thread not found"), {
        status: 404,
      });
    }

    return c.json(result);
  });

  app.get("/api/threads/:threadId/messages/search", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    const q = c.req.query("q")?.trim() || "";
    if (!q) {
      return c.json(commonError("INVALID_ARGUMENT", "q is required"), {
        status: 400,
      });
    }
    const actorResult = await actorFromAuthenticatedRequest(
      c.req.raw,
      resolveRequestId(c.req),
      { env: c.env },
    );
    if (!actorResult.ok) return actorResult.response;

    const result = await searchThreadMessages(
      {
        DB: db,
        AI: c.env?.AI,
        VECTORIZE: c.env?.VECTORIZE,
      },
      c.req.param("threadId"),
      actorResult.actor.actorAccountId,
      {
        query: q,
        type: c.req.query("type")?.toLowerCase() || "all",
        limit: parsePositiveLimit(c.req.query("limit"), 20, 100),
        offset: parsePositiveOffset(c.req.query("offset")),
      },
    );
    if (!result) {
      return c.json(commonError("NOT_FOUND", "Thread not found"), {
        status: 404,
      });
    }

    return c.json(result);
  });

  app.post("/api/threads/:threadId/messages", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    const body = await readJsonBody(c.req);
    const input = parseCreateThreadMessageInput(body);
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

    const message = await createThreadMessage(
      db,
      c.req.param("threadId"),
      actorResult.actor.actorAccountId,
      input.value,
      { offload: c.env?.TAKOS_OFFLOAD },
    );
    if (!message) {
      return c.json(commonError("NOT_FOUND", "Thread not found"), {
        status: 404,
      });
    }

    return c.json({ message }, 201);
  });

  app.get("/api/threads/:threadId/shares", async (c) => {
    const resolved = await requireDbAndActor(c);
    if (!resolved.ok) return resolved.response;
    const { db, actor } = resolved;

    const shares = await listThreadSharesWithLinks(
      db,
      c.req.param("threadId"),
      actor.actorAccountId,
      new URL(c.req.url).origin,
    );
    if (!shares) {
      return c.json(commonError("NOT_FOUND", "Thread not found"), {
        status: 404,
      });
    }

    return c.json({ shares });
  });

  app.post("/api/threads/:threadId/share", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    const body = await readJsonBody(c.req);
    const input = parseCreateThreadShareInput(body);
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

    try {
      const created = await createThreadShareWithLink(
        db,
        c.req.param("threadId"),
        actorResult.actor.actorAccountId,
        new URL(c.req.url).origin,
        input.value,
      );
      if (!created) {
        return c.json(commonError("NOT_FOUND", "Thread not found"), {
          status: 404,
        });
      }

      return c.json({
        share: created.share,
        share_path: created.share.share_path,
        share_url: created.share.share_url,
        password_required: created.password_required,
      }, 201);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Failed to create share";
      return c.json(commonError("INVALID_ARGUMENT", message), {
        status: 400,
      });
    }
  });

  app.post("/api/threads/:threadId/shares/:shareId/revoke", async (c) => {
    const resolved = await requireDbAndActor(c);
    if (!resolved.ok) return resolved.response;
    const { db, actor } = resolved;

    const revoked = await revokeThreadShare(
      db,
      c.req.param("threadId"),
      c.req.param("shareId"),
      actor.actorAccountId,
    );
    if (revoked === null) {
      return c.json(commonError("NOT_FOUND", "Thread not found"), {
        status: 404,
      });
    }
    if (!revoked) {
      return c.json(commonError("NOT_FOUND", "Share not found"), {
        status: 404,
      });
    }

    return c.json({ success: true });
  });
}
