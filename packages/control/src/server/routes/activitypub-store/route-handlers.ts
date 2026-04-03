import type { Context } from "hono";
import { parsePagination } from "../../../shared/utils/index.ts";
import type { PublicRouteEnv } from "../route-auth.ts";
import { HttpSignatureError } from "../../middleware/http-signature.ts";
import type {
  StoreRecord,
  StoreRepositoryRecord,
} from "./activitypub-queries.ts";
import type { ActivityPubStoreDeps } from "./deps.ts";
import { buildAcceptActivity } from "./activity-builders.ts";
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

export async function handleInbox(
  c: ActivityPubContext,
  targetActorUrl: string,
  deps: ActivityPubStoreDeps,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const type = String(body.type ?? "");
  const actorUrl = typeof body.actor === "string" ? body.actor : null;

  if (!actorUrl) {
    return c.json({ error: "actor field is required" }, 400);
  }

  const signatureHeader = c.req.header("signature");
  if (signatureHeader) {
    try {
      const sigResult = await deps.verifyHttpSignature(c.req.raw);

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
        return c.json({
          error: `Signature verification failed: ${err.message}`,
        }, 401);
      }

      console.error("HTTP Signature verification error:", err);
      return c.json({ error: "Signature verification failed" }, 401);
    }
  } else {
    console.warn(
      `[ActivityPub] Inbox received activity without HTTP Signature from actor: ${actorUrl}`,
    );
  }

  if (type === "Follow") {
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
