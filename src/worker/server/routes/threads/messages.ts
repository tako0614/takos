import { Hono, type Hono as HonoType } from "hono";
import { z } from "zod";
import {
  BadRequestError,
  ConflictError,
  InternalError,
} from "@takos/worker-platform-utils/errors";
import type { Env } from "../../../shared/types/index.ts";
import type { BaseVariables } from "../route-auth.ts";
import { parsePagination } from "../../../shared/utils/index.ts";
import { logError } from "../../../shared/utils/logger.ts";
import { zValidator } from "../zod-validator.ts";
import {
  ArchivedThreadWriteError,
  checkThreadAccess,
  createMessage,
} from "../../../application/services/threads/thread-service.ts";
import { searchThreadMessages } from "../../../application/services/threads/thread-search.ts";
import { getThreadTimeline } from "../../../application/services/threads/thread-timeline.ts";
import { getThreadHistory } from "../../../application/services/threads/thread-history.ts";
import { requireThreadAccess } from "./helpers.ts";
import { threadSearchQuerySchema } from "./search-query.ts";
import { CLIENT_OPERATION_ID_PATTERN } from "../../../shared/utils/client-operation-id.ts";
import { ClientOperationConflictError } from "../../../shared/utils/client-operation-id.ts";
import {
  DEFAULT_CHAT_TIMELINE_MESSAGES,
  MAX_CHAT_TIMELINE_MESSAGES,
  MAX_CLIENT_ATTACHMENT_ID_CHARACTERS,
  MAX_CLIENT_ATTACHMENT_MIME_CHARACTERS,
  MAX_CLIENT_ATTACHMENT_NAME_CHARACTERS,
  MAX_CLIENT_ATTACHMENT_PATH_CHARACTERS,
  MAX_CLIENT_ATTACHMENT_SIZE_BYTES,
  MAX_CLIENT_MESSAGE_ATTACHMENTS,
  MAX_CLIENT_MESSAGE_CHARACTERS,
} from "../../../shared/utils/client-message.ts";
import {
  canonicalizeClientMessageAttachments,
  InvalidClientMessageAttachmentError,
} from "../../../application/services/threads/message-attachment-authority.ts";

type ThreadsRouter = HonoType<{ Bindings: Env; Variables: BaseVariables }>;

export const timelineQuerySchema = z.object({
  limit: z.string().optional(),
  offset: z.string().optional(),
  latest: z.enum(["0", "1"]).optional(),
});

export const historyQuerySchema = z.object({
  limit: z.string().optional(),
  offset: z.string().optional(),
  include_messages: z.enum(["0", "1"]).optional(),
  root_run_id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
  latest: z.enum(["0", "1"]).optional(),
});

type ThreadHistoryRouteOptions = Omit<
  Parameters<typeof getThreadHistory>[2],
  "spaceId"
>;

type ThreadHistoryRouteDeps = {
  checkThreadAccess: typeof checkThreadAccess;
  getThreadHistory: typeof getThreadHistory;
};

export async function getAuthorizedThreadHistory(
  env: Env,
  threadId: string,
  userId: string,
  options: ThreadHistoryRouteOptions,
  deps: ThreadHistoryRouteDeps = { checkThreadAccess, getThreadHistory },
) {
  const access = requireThreadAccess(
    await deps.checkThreadAccess(env.DB, threadId, userId),
  );
  return await deps.getThreadHistory(env, threadId, {
    ...options,
    spaceId: access.thread.space_id,
  });
}

const clientAttachmentSchema = z.object({
  file_id: z.string().min(1).max(MAX_CLIENT_ATTACHMENT_ID_CHARACTERS),
  path: z.string().min(1).max(MAX_CLIENT_ATTACHMENT_PATH_CHARACTERS).optional(),
  name: z.string().min(1).max(MAX_CLIENT_ATTACHMENT_NAME_CHARACTERS),
  mime_type: z.string().max(MAX_CLIENT_ATTACHMENT_MIME_CHARACTERS).nullable()
    .optional(),
  size: z.number().int().nonnegative().max(MAX_CLIENT_ATTACHMENT_SIZE_BYTES)
    .optional(),
}).strict();

export const createMessageSchema = z.object({
  // Assistant, system, and tool messages are runtime-owned output. Allowing a
  // public client to forge them would corrupt the Agent transcript authority.
  role: z.literal("user"),
  content: z.string().max(MAX_CLIENT_MESSAGE_CHARACTERS).optional(),
  metadata: z.object({
    attachments: z.array(clientAttachmentSchema).max(
      MAX_CLIENT_MESSAGE_ATTACHMENTS,
    ).optional(),
  }).strict().optional(),
  idempotency_key: z.string().regex(CLIENT_OPERATION_ID_PATTERN).optional(),
}).strict();

export function registerThreadMessageRoutes(app: ThreadsRouter) {
  app.get(
    "/threads/:id/messages",
    zValidator("query", timelineQuerySchema),
    async (c) => {
      const user = c.get("user");
      const threadId = c.req.param("id");
      const { latest, ...paginationRaw } = c.req.valid("query");
      const { limit, offset } = parsePagination(paginationRaw, {
        limit: DEFAULT_CHAT_TIMELINE_MESSAGES,
        maxLimit: MAX_CHAT_TIMELINE_MESSAGES,
      });

      requireThreadAccess(
        await checkThreadAccess(
          c.env.DB,
          threadId,
          user.id,
        ),
      );

      return c.json(
        await getThreadTimeline(
          c.env,
          threadId,
          limit,
          offset,
          latest === "1",
        ),
      );
    },
  );

  app.get(
    "/threads/:id/history",
    zValidator("query", historyQuerySchema),
    async (c) => {
      const user = c.get("user");
      const threadId = c.req.param("id");
      const {
        include_messages: includeMessagesParam,
        root_run_id: rootRunId,
        latest,
        ...paginationRaw
      } = c.req.valid("query");
      const { limit, offset } = parsePagination(paginationRaw, {
        limit: 100,
        maxLimit: 200,
      });

      return c.json(
        await getAuthorizedThreadHistory(c.env, threadId, user.id, {
          limit,
          offset,
          includeMessages: includeMessagesParam !== "0",
          rootRunId,
          latest: latest === "1",
        }),
      );
    },
  );

  app.get(
    "/threads/:id/messages/search",
    zValidator("query", threadSearchQuerySchema),
    async (c) => {
      const user = c.get("user");
      const threadId = c.req.param("id");
      const query = c.req.valid("query");
      const { limit, offset } = parsePagination(query, { maxLimit: 100 });

      const access = requireThreadAccess(
        await checkThreadAccess(
          c.env.DB,
          threadId,
          user.id,
        ),
      );

      return c.json(
        await searchThreadMessages({
          env: c.env,
          spaceId: access.thread.space_id,
          threadId,
          query: query.q,
          type: query.type,
          limit,
          offset,
        }),
      );
    },
  );

  app.post(
    "/threads/:id/messages",
    zValidator("json", createMessageSchema),
    async (c) => {
      const user = c.get("user");
      const threadId = c.req.param("id");
      const body = c.req.valid("json");
      const access = requireThreadAccess(
        await checkThreadAccess(c.env.DB, threadId, user.id),
      );
      const content = typeof body.content === "string" ? body.content : "";
      let attachments;
      try {
        attachments = await canonicalizeClientMessageAttachments(
          c.env.DB,
          access.thread.space_id,
          threadId,
          body.metadata?.attachments ?? [],
        );
      } catch (err) {
        if (err instanceof InvalidClientMessageAttachmentError) {
          throw new BadRequestError(err.message);
        }
        throw err;
      }

      if (!content && attachments.length === 0) {
        throw new BadRequestError("Content is required");
      }

      try {
        const message = await createMessage(
          c.env,
          c.env.DB,
          access.thread,
          {
            ...body,
            content,
            metadata: attachments.length > 0 ? { attachments } : undefined,
            require_active_thread: true,
          },
        );

        return c.json({ message }, 201);
      } catch (err) {
        if (err instanceof ClientOperationConflictError) {
          throw new ConflictError(err.message);
        }
        if (err instanceof ArchivedThreadWriteError) {
          throw new ConflictError(err.message);
        }
        logError("Failed to create message", err, {
          action: "create_message",
          threadId,
        });
        throw new InternalError("Failed to create message");
      }
    },
  );
}

const threadMessagesRoutes = new Hono<
  { Bindings: Env; Variables: BaseVariables }
>();
registerThreadMessageRoutes(threadMessagesRoutes);

export default threadMessagesRoutes;
