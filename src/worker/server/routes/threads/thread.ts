import type { Hono } from "hono";
import { z } from "zod";
import { NotFoundError } from "@takos/worker-platform-utils/errors";
import type { Env } from "../../../shared/types/index.ts";
import type { BaseVariables } from "../route-auth.ts";
import { zValidator } from "../zod-validator.ts";
import {
  checkThreadAccess,
  deleteThread,
  updateThread,
  updateThreadStatus,
} from "../../../application/services/threads/thread-service.ts";
import { exportThread } from "../../../application/services/threads/thread-export.ts";
import { buildThreadUpdates, requireThreadAccess } from "./helpers.ts";
import { MAX_CLIENT_THREAD_TITLE_CHARACTERS } from "../../../shared/utils/client-thread.ts";
import { THREAD_EXPORT_FORMATS } from "../../../../contracts/public/thread-export.ts";
import { InMemoryRateLimiter } from "../../../shared/utils/rate-limiter.ts";

type ThreadsRouter = Hono<{ Bindings: Env; Variables: BaseVariables }>;

export const threadUpdateSchema = z.object({
  title: z.string().trim().max(MAX_CLIENT_THREAD_TITLE_CHARACTERS).optional(),
  locale: z.enum(["ja", "en"]).nullable().optional(),
  context_window: z.number().int().min(20).max(200).optional(),
}).strict();

export const threadExportQuerySchema = z
  .object({
    format: z.enum(THREAD_EXPORT_FORMATS).default("markdown"),
    include_internal: z.enum(["0", "1"]).default("0"),
  })
  .strict();

export const threadExportLimiter = new InMemoryRateLimiter({
  maxRequests: 12,
  windowMs: 60_000,
  keyGenerator: (c) => {
    const user = (c.get as (key: "user") => { id?: string } | undefined)(
      "user",
    );
    return `${user?.id || "unknown"}:${c.req.param("id")}`;
  },
  message: "Too many Thread export attempts.",
});

export function registerThreadCrudRoutes(app: ThreadsRouter) {
  app.get("/threads/:id", async (c) => {
    const user = c.get("user");
    const threadId = c.req.param("id");
    const access = requireThreadAccess(
      await checkThreadAccess(c.env.DB, threadId, user.id),
    );

    return c.json({
      thread: access.thread,
    });
  });

  app.patch(
    "/threads/:id",
    zValidator("json", threadUpdateSchema),
    async (c) => {
      const user = c.get("user");
      const threadId = c.req.param("id");
      requireThreadAccess(
        await checkThreadAccess(c.env.DB, threadId, user.id),
      );

      const thread = await updateThread(
        c.env.DB,
        threadId,
        buildThreadUpdates(c.req.valid("json")),
      );
      if (!thread) {
        throw new NotFoundError("Thread");
      }

      return c.json({ thread });
    },
  );

  app.delete("/threads/:id", async (c) => {
    const user = c.get("user");
    const threadId = c.req.param("id");
    requireThreadAccess(
      await checkThreadAccess(c.env.DB, threadId, user.id),
    );

    await deleteThread(c.env, c.env.DB, threadId, user.id);
    return c.json({ success: true, thread_id: threadId, status: "deleted" });
  });

  app.post("/threads/:id/archive", async (c) => {
    const user = c.get("user");
    const threadId = c.req.param("id");
    requireThreadAccess(
      await checkThreadAccess(c.env.DB, threadId, user.id),
    );

    const thread = await updateThreadStatus(c.env.DB, threadId, "archived");
    if (!thread) {
      throw new NotFoundError("Thread");
    }
    return c.json({ success: true, thread_id: thread.id, status: thread.status });
  });

  app.post("/threads/:id/unarchive", async (c) => {
    const user = c.get("user");
    const threadId = c.req.param("id");
    requireThreadAccess(
      await checkThreadAccess(c.env.DB, threadId, user.id),
    );

    const thread = await updateThreadStatus(c.env.DB, threadId, "active");
    if (!thread) {
      throw new NotFoundError("Thread");
    }
    return c.json({ success: true, thread_id: thread.id, status: thread.status });
  });

  app.get(
    "/threads/:id/export",
    threadExportLimiter.middleware(),
    zValidator("query", threadExportQuerySchema),
    async (c) => {
      const user = c.get("user");
      const threadId = c.req.param("id");
      const exportQuery = c.req.valid("query");
      const format = exportQuery.format;
      const includeInternal = exportQuery.include_internal === "1";
      const access = requireThreadAccess(
        await checkThreadAccess(c.env.DB, threadId, user.id),
      );

      const response = await exportThread({
        db: c.env.DB,
        offload: c.env.TAKOS_OFFLOAD,
        threadId,
        includeInternal,
        includeInternalAuthorized: true,
        format,
      });
      if (!response) {
        throw new NotFoundError("Thread");
      }

      return response;
    },
  );
}
