import type { Context } from "hono";
import { parsePagination } from "../../../shared/utils/index.ts";
import type { PublicRouteEnv } from "../route-auth.ts";
import {
  evictActorKeyByActorUrl,
  HttpSignatureError,
} from "../../middleware/http-signature.ts";
import type {
  StoreRecord,
  StoreRepositoryRecord,
} from "./activitypub-queries.ts";
import type { ActivityPubStoreDeps } from "./deps.ts";
import {
  buildAcceptActivity,
  buildRejectActivity,
} from "./activity-builders.ts";
import {
  activityJson,
  orderedCollectionResponse,
  parsePageNumber,
} from "./helpers.ts";

export type ActivityPubContext = Context<PublicRouteEnv>;

type StoreRouteHandler = (
  c: ActivityPubContext,
  storeRecord: StoreRecord,
) => Response | Promise<Response>;

type RepoRouteHandler = (
  c: ActivityPubContext,
  repo: StoreRepositoryRecord,
) => Response | Promise<Response>;

export function withStoreRecord(
  deps: ActivityPubStoreDeps,
  handler: StoreRouteHandler,
) {
  return async (c: ActivityPubContext): Promise<Response> => {
    const storeRecord = await deps.findStoreBySlug(
      c.env,
      c.req.param("store") ?? "",
    );
    if (!storeRecord) {
      return c.json({ error: "Store not found" }, 404);
    }

    return handler(c, storeRecord);
  };
}

export function withCanonicalRepo(
  deps: ActivityPubStoreDeps,
  handler: RepoRouteHandler,
) {
  return async (c: ActivityPubContext): Promise<Response> => {
    const repo = await deps.findCanonicalRepo(
      c.env,
      c.req.param("owner") ?? "",
      c.req.param("repoName") ?? "",
    );
    if (!repo) {
      return c.json({ error: "Repository not found" }, 404);
    }

    return handler(c, repo);
  };
}

// ---------------------------------------------------------------------------
// Inbox replay protection
// ---------------------------------------------------------------------------
//
// Two complementary checks: (1) reject requests whose `Date` header is more
// than 5 minutes off our clock, matching Cavage §2.1.2; (2) record recently
// seen activity ids in a bounded in-memory set so re-delivered identical
// signed POSTs return 200 OK without re-processing. Cache survives only the
// worker instance's lifetime, which is acceptable for short-window replay
// protection (a determined attacker who waits past worker recycling will get
// through, but the same recycle drops their signature's freshness window
// anyway since signatures cover the `Date` header).

const INBOX_DATE_SKEW_MS = 5 * 60 * 1_000;
const INBOX_DEDUP_MAX_ENTRIES = 2_048;
const inboxDedup = new Map<string, number>(); // activityId → expiresAt

function isWithinInboxDedup(activityId: string): boolean {
  const expires = inboxDedup.get(activityId);
  if (!expires) return false;
  if (expires < Date.now()) {
    inboxDedup.delete(activityId);
    return false;
  }
  return true;
}

function recordInboxDedup(activityId: string): void {
  if (inboxDedup.size >= INBOX_DEDUP_MAX_ENTRIES) {
    const oldestKey = inboxDedup.keys().next().value;
    if (oldestKey !== undefined) inboxDedup.delete(oldestKey);
  }
  inboxDedup.set(activityId, Date.now() + INBOX_DATE_SKEW_MS * 4);
}

/** Test helper. */
export function _resetInboxDedupForTests(): void {
  inboxDedup.clear();
}

/**
 * Optional context describing the inbox target for finer-grained decisions.
 *
 * `private` + `repoId` switches on the Follow-rejection path for private
 * repositories (Round 11 audit ActivityPub finding #9): Followers without a
 * `visit` grant get an AP `Reject` activity instead of a silent
 * `addFollower`.
 */
export interface InboxTargetContext {
  repoId?: string;
  isPrivateRepo?: boolean;
}

/** Actor object types that we treat as cache-worthy for `Update` eviction. */
const ACTOR_OBJECT_TYPES = new Set([
  "Person",
  "Service",
  "Repository",
  "Store",
  "Organization",
  "Application",
  "Group",
]);

function extractActorObjectUrl(
  body: Record<string, unknown>,
): string | null {
  const obj = body.object;
  if (!obj || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;
  const type = record.type;
  const typeSet = Array.isArray(type)
    ? type.filter((t): t is string => typeof t === "string")
    : typeof type === "string"
    ? [type]
    : [];
  if (!typeSet.some((t) => ACTOR_OBJECT_TYPES.has(t))) return null;
  const id = typeof record.id === "string" ? record.id : null;
  return id;
}

export async function handleInbox(
  c: ActivityPubContext,
  targetActorUrl: string,
  deps: ActivityPubStoreDeps,
  targetContext?: InboxTargetContext,
): Promise<Response> {
  // Read the body as bytes BEFORE parsing so we can:
  //   (a) pass it to `verifyHttpSignature` for Digest header verification
  //       (Round 11 audit finding #7), and
  //   (b) still parse the same bytes as JSON for activity dispatch.
  // Hono's `c.req.raw` body is a one-shot stream; once consumed we cannot
  // re-read it, so we must buffer up front.
  let bodyBytes: Uint8Array;
  try {
    const buf = await c.req.raw.arrayBuffer();
    bodyBytes = new Uint8Array(buf);
  } catch {
    return c.json({ error: "Failed to read request body" }, 400);
  }

  let body: Record<string, unknown>;
  try {
    const text = new TextDecoder().decode(bodyBytes);
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const type = String(body.type ?? "");
  const actorUrl = typeof body.actor === "string" ? body.actor : null;

  if (!actorUrl) {
    return c.json({ error: "actor field is required" }, 400);
  }

  // Date-skew check (replay protection step 1).
  // The HTTP Signature spec requires a `Date` header in the signing string,
  // so reject requests where Date is missing or more than 5 minutes off.
  const dateHeader = c.req.header("date");
  if (!dateHeader) {
    return c.json({ error: "Date header is required" }, 400);
  }
  const requestDate = Date.parse(dateHeader);
  if (!Number.isFinite(requestDate)) {
    return c.json({ error: "Invalid Date header" }, 400);
  }
  if (Math.abs(Date.now() - requestDate) > INBOX_DATE_SKEW_MS) {
    return c.json({ error: "Date header skew exceeds 5 minutes" }, 401);
  }

  const signatureHeader = c.req.header("signature");
  if (!signatureHeader) {
    // Strict mode: per docs/platform/activitypub.md, inbound activities MUST
    // be signed. Reject any activity without an HTTP Signature header.
    return c.json(
      { error: "HTTP Signature header is required for inbox delivery" },
      401,
    );
  }
  try {
    const sigResult = await deps.verifyHttpSignature(c.req.raw, bodyBytes);

    if (!sigResult.verified) {
      return c.json({ error: "Invalid HTTP signature" }, 401);
    }

    if (sigResult.actorUrl !== actorUrl) {
      return c.json(
        { error: "Signature actor does not match activity actor" },
        403,
      );
    }
  } catch (err) {
    if (err instanceof HttpSignatureError) {
      // Digest header mismatch is a 400 (client presented a malformed body),
      // not a 401 (auth failure). The error message carries "Digest header"
      // for that class of failure.
      const status = err.message.toLowerCase().includes("digest header")
        ? 400
        : 401;
      return c.json({
        error: `Signature verification failed: ${err.message}`,
      }, status);
    }

    console.error("HTTP Signature verification error:", err);
    return c.json({ error: "Signature verification failed" }, 401);
  }

  // Replay dedup (step 2). After signature verification, dedup by activity
  // id so a captured signed POST cannot be replayed indefinitely. Activities
  // without an `id` field cannot be deduped — those are processed every time
  // (which the addFollower / removeFollower paths handle idempotently).
  const activityId = typeof body.id === "string" ? body.id : null;
  if (activityId) {
    if (isWithinInboxDedup(activityId)) {
      return c.json({ duplicate: true });
    }
    recordInboxDedup(activityId);
  }

  if (type === "Follow") {
    // Private-repo protection (Round 11 audit finding #9): if the target is
    // a private repo actor, the follower needs a `visit` grant before we'll
    // accept the subscription. Store actors (no `repoId` in context) always
    // accept.
    if (targetContext?.isPrivateRepo && targetContext.repoId) {
      const hasVisitGrant = await deps.checkGrant(
        c.env.DB,
        targetContext.repoId,
        actorUrl,
        "visit",
      );
      if (!hasVisitGrant) {
        return activityJson(c, buildRejectActivity(targetActorUrl, body));
      }
    }

    await deps.addFollower(c.env.DB, targetActorUrl, actorUrl);
    return activityJson(c, buildAcceptActivity(targetActorUrl, body));
  }

  if (type === "Undo") {
    const innerObject = body.object as Record<string, unknown> | undefined;
    if (innerObject && String(innerObject.type ?? "") === "Follow") {
      await deps.removeFollower(c.env.DB, targetActorUrl, actorUrl);
      return activityJson(c, buildAcceptActivity(targetActorUrl, body));
    }
  }

  // `Update` of a remote actor: bust our 24h actor-key cache so the next
  // signed delivery from that actor re-fetches the document (Round 11 audit
  // finding #17). We don't otherwise persist actor state server-side, so
  // evict-and-ack is the complete response.
  if (type === "Update") {
    const actorObjectId = extractActorObjectUrl(body);
    if (actorObjectId) {
      evictActorKeyByActorUrl(actorObjectId);
    }
    return c.json({ ok: true });
  }

  // `Like` / `Announce` (and similar informational types) are acknowledged
  // but not persisted. Prior to Round 11 audit finding #17 we returned 422
  // which made legitimate relays retry forever; 202 Accepted signals "got
  // it, nothing to do". Anything genuinely unsupported still falls through
  // to the 422 below.
  if (type === "Like" || type === "Announce") {
    return c.json({ ok: true }, 202);
  }

  return c.json({ error: "Unsupported activity type" }, 422);
}

export async function handleFollowers(
  c: ActivityPubContext,
  targetActorUrl: string,
  deps: ActivityPubStoreDeps,
): Promise<Response> {
  const collectionUrl = `${targetActorUrl}/followers`;
  const page = c.req.query("page");
  const { limit } = parsePagination(c.req.query());
  const pageNum = parsePageNumber(page);

  const result = await deps.listFollowers(c.env.DB, targetActorUrl, {
    limit,
    offset: page ? (pageNum - 1) * limit : 0,
  });

  return orderedCollectionResponse(
    c,
    collectionUrl,
    page,
    pageNum,
    result.total,
    page ? result.items : [],
  );
}
