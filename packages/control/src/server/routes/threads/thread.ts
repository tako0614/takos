import type { Hono } from "hono";
import { z } from "zod";
import { NotFoundError } from "takos-common/errors";
import type { Env } from "../../../shared/types/index.ts";
import type { BaseVariables } from "../route-auth.ts";
import { zValidator } from "../zod-validator.ts";
import { threadsRouteDeps } from "./deps.ts";
import { buildThreadUpdates, requireThreadAccess } from "./helpers.ts";

type ThreadsRouter = Hono<{ Bindings: Env; Variables: BaseVariables }>;

const threadUpdateSchema = z.object({
  title: z.string().optional(),
  locale: z.enum(["ja", "en"]).nullable().optional(),
  status: z.enum(["active", "archived", "deleted"]).optional(),
  context_window: z.number().int().min(20).max(200).optional(),
});

const threadExportQuerySchema = z.object({
  format: z.string().optional(),
  include_internal: z.string().optional(),
});

export function registerThreadCrudRoutes(app: ThreadsRouter) {
  app.get("/threads/:id", async (c) => {
    const user = c.get("user");
    const threadId = c.req.param("id");
    const access = requireThreadAccess(
      await threadsRouteDeps.checkThreadAccess(c.env.DB, threadId, user.id),
    );

    return c.json({
      thread: access.thread,
      role: access.role,
    });
  });

  app.patch(
    "/threads/:id",
    zValidator("json", threadUpdateSchema),
    async (c) => {
      const user = c.get("user");
      const threadId = c.req.param("id");
      requireThreadAccess(
        await threadsRouteDeps.checkThreadAccess(c.env.DB, threadId, user.id, [
          "owner",
          "admin",
          "editor",
        ]),
      );

      const thread = await threadsRouteDeps.updateThread(
        c.env.DB,
        threadId,
        buildThreadUpdates(c.req.valid("json")),
      );

      return c.json({ thread });
    },
  );

  app.delete("/threads/:id", async (c) => {
    const user = c.get("user");
    const threadId = c.req.param("id");
    requireThreadAccess(
      await threadsRouteDeps.checkThreadAccess(c.env.DB, threadId, user.id, [
        "owner",
        "admin",
      ]),
    );

    await threadsRouteDeps.deleteThread(c.env, c.env.DB, threadId);
    return c.json({ success: true });
  });

  app.post("/threads/:id/archive", async (c) => {
    const user = c.get("user");
    const threadId = c.req.param("id");
    requireThreadAccess(
      await threadsRouteDeps.checkThreadAccess(c.env.DB, threadId, user.id, [
        "owner",
        "admin",
        "editor",
      ]),
    );

    await threadsRouteDeps.updateThreadStatus(c.env.DB, threadId, "archived");
    return c.json({ success: true });
  });

  app.post("/threads/:id/unarchive", async (c) => {
    const user = c.get("user");
    const threadId = c.req.param("id");
    requireThreadAccess(
      await threadsRouteDeps.checkThreadAccess(c.env.DB, threadId, user.id, [
        "owner",
        "admin",
        "editor",
      ]),
    );

    await threadsRouteDeps.updateThreadStatus(c.env.DB, threadId, "active");
    return c.json({ success: true });
  });

  app.get(
    "/threads/:id/export",
    zValidator("query", threadExportQuerySchema),
    async (c) => {
      const user = c.get("user");
      const threadId = c.req.param("id");
      const exportQuery = c.req.valid("query");
      const format = (exportQuery.format || "markdown").toLowerCase();
      const includeInternal = exportQuery.include_internal === "1";
      const access = requireThreadAccess(
        await threadsRouteDeps.checkThreadAccess(c.env.DB, threadId, user.id),
      );

      const response = await threadsRouteDeps.exportThread({
        db: c.env.DB,
        renderPdf: threadsRouteDeps.getPlatformServices(c).documents.renderPdf,
        threadId,
        includeInternal,
        includeInternalRolesAllowed: ["owner", "admin"].includes(access.role),
        format,
      });
      if (!response) {
        throw new NotFoundError("Thread");
      }

      return response;
    },
  );
}
