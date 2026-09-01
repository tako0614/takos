import type { Hono } from "hono";
import { z } from "zod";
import type { Env, ThreadStatus } from "../../../shared/types/index.ts";
import type { BaseVariables } from "../route-auth.ts";
import { routeAuthDeps } from "../route-auth.ts";
import { parsePagination } from "../../../shared/utils/index.ts";
import { zValidator } from "../zod-validator.ts";
import {
  createThread,
  listThreads,
} from "../../../application/services/threads/thread-service.ts";
import { searchSpaceThreads } from "../../../application/services/threads/thread-search.ts";
import { threadSearchQuerySchema } from "./search-query.ts";
import { CLIENT_OPERATION_ID_PATTERN, ClientOperationConflictError } from "../../../shared/utils/client-operation-id.ts";
import { MAX_CLIENT_THREAD_TITLE_CHARACTERS } from "../../../shared/utils/client-thread.ts";
import { InMemoryRateLimiter } from "../../../shared/utils/rate-limiter.ts";
import {
  BadRequestError,
  ConflictError,
} from "@takos/worker-platform-utils/errors";

type ThreadsRouter = Hono<{ Bindings: Env; Variables: BaseVariables }>;

const threadListQuerySchema = z.object({
  status: z.enum(["active", "archived"]).optional(),
}).strict();

export const threadCreateSchema = z.object({
  title: z.string().max(MAX_CLIENT_THREAD_TITLE_CHARACTERS).optional(),
  locale: z.enum(["ja", "en"]).optional(),
  idempotency_key: z.string().regex(CLIENT_OPERATION_ID_PATTERN).optional(),
}).strict();

export const threadCreateLimiter = new InMemoryRateLimiter({
  maxRequests: 30,
  windowMs: 60_000,
  keyGenerator: (c) => {
    const user = (c.get as (key: "user") => { id?: string } | undefined)(
      "user",
    );
    return `${user?.id || "unknown"}:${c.req.param("spaceId")}`;
  },
  message: "Too many conversation creation attempts.",
});

export function registerThreadSpaceRoutes(app: ThreadsRouter) {
  app.get(
    "/spaces/:spaceId/threads",
    zValidator("query", threadListQuerySchema),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");
      const { status } = c.req.valid("query") as { status?: ThreadStatus };

      const access = await routeAuthDeps.requireSpaceAccess(
        c,
        spaceId,
        user.id,
      );
      const page = await listThreads(
        c.env.DB,
        access.space.id,
        {
          status,
        },
      );

      return c.json(page);
    },
  );

  app.get(
    "/spaces/:spaceId/threads/search",
    zValidator("query", threadSearchQuerySchema),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");
      const query = c.req.valid("query");
      const { limit, offset } = parsePagination(query, { maxLimit: 100 });

      const access = await routeAuthDeps.requireSpaceAccess(
        c,
        spaceId,
        user.id,
      );

      return c.json(
        await searchSpaceThreads({
          env: c.env,
          spaceId: access.space.id,
          query: query.q,
          type: query.type,
          limit,
          offset,
        }),
      );
    },
  );

  app.post(
    "/spaces/:spaceId/threads",
    threadCreateLimiter.middleware(),
    zValidator("json", threadCreateSchema),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");
      const body = c.req.valid("json");

      const access = await routeAuthDeps.requireSpaceAccess(
        c,
        spaceId,
        user.id,
        "Workspace not found",
      );

      try {
        const thread = await createThread(
          c.env.DB,
          access.space.id,
          body,
        );
        return c.json({ thread }, 201);
      } catch (error) {
        if (error instanceof ClientOperationConflictError) {
          throw new ConflictError(error.message);
        }
        throw error;
      }
    },
  );
}
