import { BadRequestError } from "takos-common/errors";
import type { ThreadStatus } from "../../../shared/types/index.ts";
import type { ThreadShareMode } from "../../../application/services/threads/thread-shares.ts";
import { requireFound } from "../validation-utils.ts";

type ThreadsRouteDeps = typeof import("./deps.ts").threadsRouteDeps;

type ThreadUpdateInput = {
  title?: string;
  locale?: "ja" | "en" | null;
  status?: ThreadStatus;
  context_window?: number;
};

type ThreadShareInput = {
  mode?: ThreadShareMode;
  password?: string;
  expires_at?: string;
  expires_in_days?: number;
};

export function requireThreadAccess(
  access: Awaited<ReturnType<ThreadsRouteDeps["checkThreadAccess"]>>,
) {
  return requireFound(access, "Thread");
}

export function buildThreadUpdates(body: ThreadUpdateInput) {
  const updates: {
    title?: string | null;
    locale?: "ja" | "en" | null;
    status?: ThreadStatus;
    context_window?: number;
  } = {};

  if (body.title !== undefined) {
    updates.title = body.title || null;
  }

  if (body.locale !== undefined) {
    updates.locale = body.locale;
  }

  if (body.status) {
    updates.status = body.status;
  }

  if (body.context_window !== undefined) {
    updates.context_window = body.context_window;
  }

  if (Object.keys(updates).length === 0) {
    throw new BadRequestError("No valid updates provided");
  }

  return updates;
}

export function resolveThreadShareInput(body: ThreadShareInput) {
  const mode: ThreadShareMode = body.mode === "password"
    ? "password"
    : "public";

  let expiresAt: string | null = null;
  if (body.expires_at) {
    expiresAt = body.expires_at;
  } else if (typeof body.expires_in_days === "number") {
    const days = body.expires_in_days;
    if (!Number.isFinite(days) || days <= 0 || days > 365) {
      throw new BadRequestError("expires_in_days must be between 1 and 365");
    }
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
      .toISOString();
  }

  return {
    mode,
    expiresAt,
    password: body.password || null,
  };
}

export function withThreadShareLinks<T extends { token: string }>(
  origin: string,
  shares: T[],
) {
  return shares.map((share) => {
    const sharePath = `/share/${share.token}`;
    return {
      ...share,
      share_path: sharePath,
      share_url: origin + sharePath,
    };
  });
}
