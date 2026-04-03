import type { Hono } from "hono";
import { z } from "zod";
import { BadRequestError } from "takos-common/errors";
import type { Env, ThreadStatus } from "../../../shared/types/index.ts";
import type { BaseVariables } from "../route-auth.ts";
import { parsePagination } from "../../../shared/utils/index.ts";
import { zValidator } from "../zod-validator.ts";
import { threadsRouteDeps } from "./deps.ts";

type ThreadsRouter = Hono<{ Bindings: Env; Variables: BaseVariables }>;

const threadListQuerySchema = z.object({
  status: z.string().optional(),
});

const threadSearchQuerySchema = z.object({
  q: z.string().optional(),
  type: z.string().optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
});

const threadCreateSchema = z.object({
  title: z.string().optional(),
  locale: z.enum(["ja", "en"]).optional(),
});

export function registerThreadSpaceRoutes(app: ThreadsRouter) {
  app.get(
    "/spaces/:spaceId/threads",
    zValidator("query", threadListQuerySchema),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");
      const { status: statusQuery } = c.req.valid("query");
      const status = statusQuery as ThreadStatus | undefined;

      const access = await threadsRouteDeps.requireSpaceAccess(
        c,
        spaceId,
        user.id,
      );
      const threads = await threadsRouteDeps.listThreads(
        c.env.DB,
        access.space.id,
        {
          status,
        },
      );

      return c.json({ threads });
    },
  );

  app.get(
    "/spaces/:spaceId/threads/search",
    zValidator("query", threadSearchQuerySchema),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");
      const query = c.req.valid("query");
      const q = (query.q || "").trim();
      const type = (query.type || "all").toLowerCase();
      const { limit, offset } = parsePagination(query, { maxLimit: 100 });

      if (!q) {
        throw new BadRequestError("q is required");
      }

      const access = await threadsRouteDeps.requireSpaceAccess(
        c,
        spaceId,
        user.id,
      );

      return c.json(
        await threadsRouteDeps.searchSpaceThreads({
          env: c.env,
          spaceId: access.space.id,
          query: q,
          type,
          limit,
          offset,
        }),
      );
    },
  );

  app.post(
    "/spaces/:spaceId/threads",
    zValidator("json", threadCreateSchema),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");
      const body = c.req.valid("json");

      const access = await threadsRouteDeps.requireSpaceAccess(
        c,
        spaceId,
        user.id,
        ["owner", "admin", "editor"],
        "Workspace not found or insufficient permissions",
      );

      const thread = await threadsRouteDeps.createThread(
        c.env.DB,
        access.space.id,
        body,
      );
      return c.json({ thread }, 201);
    },
  );
}
