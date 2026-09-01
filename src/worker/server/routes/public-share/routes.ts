import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../../shared/types/index.ts";
import { zValidator } from "../zod-validator.ts";
import { verifyThreadShareAccess } from "../../../application/services/threads/thread-shares.ts";
import { listThreadMessages } from "../../../application/services/threads/thread-service.ts";
import { getDb } from "../../../infra/db/index.ts";
import { threads } from "../../../infra/db/schema.ts";
import { eq } from "drizzle-orm";
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  ServiceUnavailableError,
} from "@takos/worker-platform-utils/errors";
import {
  DEFAULT_PUBLIC_THREAD_SHARE_PAGE_SIZE,
  MAX_PUBLIC_THREAD_SHARE_MESSAGE_CONTENT_BYTES,
  MAX_PUBLIC_THREAD_SHARE_PAGE_CONTENT_BYTES,
  MAX_PUBLIC_THREAD_SHARE_PAGE_OFFSET,
  MAX_PUBLIC_THREAD_SHARE_PAGE_SIZE,
  MAX_THREAD_SHARE_PASSWORD_CHARACTERS,
  THREAD_SHARE_TOKEN_PATTERN,
  type PublicThreadShareMessage,
} from "../../../../contracts/public/thread-share.ts";

type Variables = Record<string, never>;
const SHARE_PASSWORD_MAX_ATTEMPTS = 5;
const SHARE_PASSWORD_WINDOW_MS = 60_000;

const publicSharePageQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PUBLIC_THREAD_SHARE_PAGE_SIZE)
      .optional(),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .max(MAX_PUBLIC_THREAD_SHARE_PAGE_OFFSET)
      .optional(),
  })
  .strict();

const publicShareAccessSchema = z
  .object({
    password: z.string().max(MAX_THREAD_SHARE_PASSWORD_CHARACTERS).optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_PUBLIC_THREAD_SHARE_PAGE_SIZE)
      .optional(),
    offset: z
      .number()
      .int()
      .min(0)
      .max(MAX_PUBLIC_THREAD_SHARE_PAGE_OFFSET)
      .optional(),
  })
  .strict();

type SharedPageInput = { limit: number; offset: number };

const utf8Encoder = new TextEncoder();

function truncateUtf8(
  value: string,
  maximumBytes: number,
): {
  value: string;
  truncated: boolean;
} {
  const bytes = utf8Encoder.encode(value);
  if (bytes.byteLength <= maximumBytes) return { value, truncated: false };
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let end = maximumBytes;
  while (end > 0) {
    try {
      return {
        value: decoder.decode(bytes.slice(0, end)),
        truncated: true,
      };
    } catch {
      end -= 1;
    }
  }
  return { value: "", truncated: true };
}

function sanitizeSharedMessages(
  messages: Awaited<ReturnType<typeof listThreadMessages>>["messages"],
): {
  messages: PublicThreadShareMessage[];
  scanned: number;
  truncated: boolean;
} {
  const sanitized: PublicThreadShareMessage[] = [];
  let remainingBytes = MAX_PUBLIC_THREAD_SHARE_PAGE_CONTENT_BYTES;
  let scanned = 0;
  let truncated = false;

  // Safety by default: system/tool messages never cross the unauthenticated
  // share boundary. Count them as scanned rows so pagination still advances.
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") {
      scanned += 1;
      continue;
    }
    const content = truncateUtf8(
      message.content,
      MAX_PUBLIC_THREAD_SHARE_MESSAGE_CONTENT_BYTES,
    );
    const contentBytes = utf8Encoder.encode(content.value).byteLength;
    if (contentBytes > remainingBytes) {
      truncated = true;
      break;
    }
    sanitized.push({
      id: message.id,
      role: message.role,
      content: content.value,
      content_truncated: content.truncated,
      sequence: message.sequence,
      created_at: message.created_at,
    });
    remainingBytes -= contentBytes;
    scanned += 1;
    truncated ||= content.truncated;
  }

  return { messages: sanitized, scanned, truncated };
}

async function buildSharedThreadPayload(
  env: Env,
  threadId: string,
  token: string,
  page: SharedPageInput,
) {
  const db = getDb(env.DB);

  const thread = await db
    .select({
      id: threads.id,
      title: threads.title,
      status: threads.status,
      createdAt: threads.createdAt,
      updatedAt: threads.updatedAt,
    })
    .from(threads)
    .where(eq(threads.id, threadId))
    .get();

  if (!thread || thread.status === "deleted") {
    return null;
  }

  const messagePage = await listThreadMessages(
    env,
    env.DB,
    threadId,
    page.limit,
    page.offset,
  );
  const publicMessages = sanitizeSharedMessages(messagePage.messages);
  const nextOffset = messagePage.offset + publicMessages.scanned;
  const hasMore = nextOffset < messagePage.total;

  return {
    token,
    thread: {
      id: thread.id,
      title: thread.title,
      created_at: thread.createdAt,
      updated_at: thread.updatedAt,
    },
    messages: publicMessages.messages,
    page: {
      limit: page.limit,
      offset: messagePage.offset,
      has_more: hasMore,
      next_offset: hasMore ? nextOffset : null,
      message_data_truncated:
        messagePage.messageDataTruncated || publicMessages.truncated,
    },
  };
}

function pageInput(value: {
  limit?: number;
  offset?: number;
}): SharedPageInput {
  return {
    limit: value.limit ?? DEFAULT_PUBLIC_THREAD_SHARE_PAGE_SIZE,
    offset: value.offset ?? 0,
  };
}

async function rateLimitKey(token: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", utf8Encoder.encode(token)),
  );
  return `thread-share-password:${Array.from(digest, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("")}`;
}

async function enforcePasswordAttemptRateLimit(
  env: Env,
  token: string,
): Promise<void> {
  const namespace = env.RATE_LIMITER_DO;
  if (!namespace) {
    throw new ServiceUnavailableError(
      "Password-protected shares require the durable rate limiter",
    );
  }
  try {
    const key = await rateLimitKey(token);
    const stub = namespace.get(namespace.idFromName(key));
    const response = await stub.fetch("http://rate-limiter/hit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key,
        maxRequests: SHARE_PASSWORD_MAX_ATTEMPTS,
        windowMs: SHARE_PASSWORD_WINDOW_MS,
      }),
    });
    const body = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (
      !response.ok ||
      !body ||
      typeof body.allowed !== "boolean" ||
      typeof body.reset !== "number" ||
      !Number.isFinite(body.reset)
    ) {
      throw new TypeError("invalid durable rate-limiter response");
    }
    if (!body.allowed) {
      const retryAfter = Math.max(
        1,
        Math.ceil((body.reset - Date.now()) / 1_000),
      );
      throw new RateLimitError(
        "Too many password attempts. Please try again later.",
        retryAfter,
      );
    }
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    throw new ServiceUnavailableError(
      "Password verification rate limiter is unavailable",
    );
  }
}

export default new Hono<{ Bindings: Env; Variables: Variables }>()
  // GET /api/public/thread-shares/:token
  // Returns 401 with requires_password when share is password-protected.
  .get(
    "/thread-shares/:token",
    zValidator("query", publicSharePageQuerySchema),
    async (c) => {
      const token = c.req.param("token");
      if (!THREAD_SHARE_TOKEN_PATTERN.test(token)) throw new NotFoundError();
      const page = pageInput(c.req.valid("query"));

      const access = await verifyThreadShareAccess({
        db: c.env.DB,
        token,
        password: null,
      });
      if ("error" in access) {
        if (access.error === "password_required") {
          throw new AuthenticationError("Password required", {
            requires_password: true,
          });
        }
        throw new NotFoundError();
      }

      const payload = await buildSharedThreadPayload(
        c.env,
        access.threadId,
        token,
        page,
      );
      if (!payload) {
        throw new NotFoundError();
      }

      return c.json({
        share: {
          mode: access.share.mode,
          expires_at: access.share.expires_at,
          created_at: access.share.created_at,
        },
        ...payload,
      });
    },
  )
  // POST /api/public/thread-shares/:token/access
  // Body: { password }
  .post(
    "/thread-shares/:token/access",
    zValidator("json", publicShareAccessSchema),
    async (c) => {
      const token = c.req.param("token");
      if (!THREAD_SHARE_TOKEN_PATTERN.test(token)) throw new NotFoundError();
      const body = c.req.valid("json");
      const page = pageInput(body);

      const access = await verifyThreadShareAccess({
        db: c.env.DB,
        token,
        password: body.password || null,
        beforePasswordVerification: () =>
          enforcePasswordAttemptRateLimit(c.env, token),
      });
      if ("error" in access) {
        if (access.error === "password_required") {
          throw new AuthenticationError("Password required", {
            requires_password: true,
          });
        }
        if (access.error === "forbidden") {
          throw new AuthorizationError("Invalid password", {
            invalid_password: true,
          });
        }
        throw new NotFoundError();
      }

      const payload = await buildSharedThreadPayload(
        c.env,
        access.threadId,
        token,
        page,
      );
      if (!payload) {
        throw new NotFoundError();
      }

      return c.json({
        share: {
          mode: access.share.mode,
          expires_at: access.share.expires_at,
          created_at: access.share.created_at,
        },
        ...payload,
      });
    },
  );
