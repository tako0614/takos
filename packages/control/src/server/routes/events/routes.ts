import { Hono, type MiddlewareHandler } from "hono";
import type { Env } from "../../../shared/types/index.ts";
import type { BaseVariables } from "../route-auth.ts";
import {
  AppError,
  BadRequestError,
  ErrorCodes,
  NotFoundError,
} from "takos-common/errors";
import { getPlatformServices } from "../../../platform/accessors.ts";
import {
  checkSpaceAccess,
  loadSpace,
} from "../../../application/services/identity/space-access.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import { requireAnyAuth } from "../../middleware/oauth-auth.ts";
import type { PlatformServices } from "../../../platform/platform-config.ts";

type EventsRouteEnv = { Bindings: Env; Variables: BaseVariables };

// ---------------------------------------------------------------------------
// Channel naming
// ---------------------------------------------------------------------------

/**
 * Build the SSE channel name for a given space's event bus.
 *
 * Exported so server-side emit helpers (see {@link emitGroupLifecycleEvent})
 * stay aligned with the subscribe-side handler — both must agree on the
 * channel name.
 */
export function buildSpaceEventChannel(spaceId: string): string {
  return `events:space:${spaceId}`;
}

// ---------------------------------------------------------------------------
// Group lifecycle event types (kept in sync with docs/reference/api.md `events`)
// ---------------------------------------------------------------------------

export type GroupLifecycleEventType =
  | "group.deployed"
  | "group.deleted"
  | "group.rollback"
  | "group.unhealthy";

export interface GroupLifecycleEventPayload {
  event: GroupLifecycleEventType;
  space_id: string;
  group_name: string;
  deployment_id?: string | null;
  timestamp: string;
}

function isSseNotifier(
  value: unknown,
): value is PlatformServices["sseNotifier"] {
  return typeof value === "object" && value !== null &&
    "subscribe" in value && typeof value.subscribe === "function";
}

// ---------------------------------------------------------------------------
// Space scope resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the target space id for the request, in the order:
 *
 *   1. `X-Takos-Space-Id` header
 *   2. session cookie -> user's personal space
 *
 * Throws `BadRequestError` if no source supplies a space id.
 */
async function resolveEventsSpaceId(
  c: import("hono").Context<EventsRouteEnv>,
): Promise<string> {
  // 1. Header takes precedence
  const headerValue = c.req.header("X-Takos-Space-Id");
  if (headerValue && headerValue.trim().length > 0) {
    return headerValue.trim();
  }

  // 2. Session cookie -> user's personal space
  const user = c.get("user");
  if (user) {
    const personalSpace = await loadSpace(c.env.DB, "me", user.id);
    if (personalSpace) {
      return personalSpace.id;
    }
  }

  throw new BadRequestError(
    "space scope is required: provide X-Takos-Space-Id header or authenticate with a session cookie linked to a personal space",
  );
}

// ---------------------------------------------------------------------------
// SSE handler
// ---------------------------------------------------------------------------

/**
 * GET /api/events
 *
 * SSE stream of `group.*` lifecycle events for a space.
 *
 * Spec: `docs/reference/api.md#events`, `docs/architecture/kernel.md#event-bus`.
 *
 * Auth: session cookie, PAT, or OAuth bearer.
 * Required scope (token-based auth): `events:subscribe`. Session cookie users
 * skip the scope check (matching the design note in `oauth-auth.ts`).
 *
 * Delivery is fire-and-forget — no replay, no delivery guarantee.
 */
export function createEventsRouter(): Hono<EventsRouteEnv> {
  const router = new Hono<EventsRouteEnv>();

  // Single combined auth middleware: session cookie | PAT | OAuth.
  // Cast: requireAnyAuth declares `Variables: { user?: User }`, but after the
  // middleware runs `user` is always set — the route handlers below can rely
  // on `c.get('user')` returning a non-null value.
  router.use(
    "*",
    requireAnyAuth(["events:subscribe"]) as MiddlewareHandler<EventsRouteEnv>,
  );

  router.get("/", async (c) => {
    // 1. Resolve target space id (header > personal space)
    const spaceId = await resolveEventsSpaceId(c);

    // 2. Membership check — confirm the authenticated user has access to the
    //    resolved space. Without this, an attacker holding a valid token for
    //    space A could subscribe to space B by spoofing the header.
    const user = c.get("user");
    const access = await checkSpaceAccess(c.env.DB, spaceId, user.id);
    if (!access) {
      throw new NotFoundError("Space");
    }

    // 3. Acquire SSE notifier (Node-only service — not available on CF Workers)
    const services = getPlatformServices(c);
    const sseNotifier = services.sseNotifier;
    if (!sseNotifier) {
      throw new AppError(
        "SSE not available in this environment",
        ErrorCodes.NOT_FOUND,
        404,
      );
    }

    // 4. Optional Last-Event-ID resume support (mirrors runs/sse.ts)
    const lastEventIdRaw = c.req.header("Last-Event-ID") ??
      c.req.query("last_event_id");
    let lastEventId: number | undefined;
    if (lastEventIdRaw) {
      const parsed = parseInt(lastEventIdRaw, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        lastEventId = parsed;
      }
    }

    // 5. Subscribe and stream
    const channel = buildSpaceEventChannel(access.space.id);
    const stream = sseNotifier.subscribe(channel, lastEventId);

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

// ---------------------------------------------------------------------------
// Emit helper (server-side fan-out)
// ---------------------------------------------------------------------------

/**
 * Emit a group lifecycle event to the SSE bus for a space.
 *
 * Fire-and-forget: errors are logged but never thrown to the caller. Designed
 * to be called from deploy / delete / rollback handlers without coupling them
 * to the SSE notifier internals.
 *
 * Takes a raw `Env` rather than a Hono context so this can be invoked from
 * non-route layers (e.g. background jobs) in the future.
 */
export function emitGroupLifecycleEvent(
  env: Env,
  params: {
    type: GroupLifecycleEventType;
    spaceId: string;
    groupName: string;
    deploymentId?: string | null;
    timestamp?: string;
  },
): void {
  // Pull the SSE notifier from the env opaque slot — same pattern as
  // run-events.ts. Avoiding `getPlatformServices()` here keeps this helper
  // usable from non-Hono call sites.
  const maybeSseNotifier = Reflect.get(env, "SSE_NOTIFIER");
  const sseNotifier = isSseNotifier(maybeSseNotifier)
    ? maybeSseNotifier
    : undefined;
  if (!sseNotifier) {
    // No notifier (CF Workers env, or Node without Redis-backed SSE). The
    // events bus is fire-and-forget so we silently drop the event.
    return;
  }

  const payload: GroupLifecycleEventPayload = {
    event: params.type,
    space_id: params.spaceId,
    group_name: params.groupName,
    deployment_id: params.deploymentId ?? null,
    timestamp: params.timestamp ?? new Date().toISOString(),
  };

  try {
    sseNotifier.emit(buildSpaceEventChannel(params.spaceId), {
      type: params.type,
      data: payload,
    });
  } catch (err) {
    logWarn(`Failed to emit group lifecycle event ${params.type}`, {
      module: "routes/events",
      detail: err,
    });
  }
}
