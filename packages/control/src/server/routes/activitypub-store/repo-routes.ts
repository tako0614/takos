import type { Hono } from "hono";
import { CacheTTL, withCache } from "../../middleware/cache.ts";
import { parsePagination } from "../../../shared/utils/index.ts";
import {
  DELETE_REF,
} from "../../../application/services/activitypub/push-activities.ts";
import { HttpSignatureError } from "../../middleware/http-signature.ts";
import type { StoreRepositoryRecord } from "./activitypub-queries.ts";
import type { ActivityPubStoreDeps } from "./deps.ts";
import {
  buildRepoDeleteActivity,
  buildRepoOutboxFallbackActivity,
  buildRepoPushActivity,
  buildRepoTagActivity,
} from "./activity-builders.ts";
import {
  activityJson,
  buildRepoActor,
  buildRepoActorId,
  buildStoreActorId,
  getOriginFromUrl,
  orderedCollectionResponse,
  parsePageNumber,
} from "./helpers.ts";
import {
  type ActivityPubContext,
  handleFollowers,
  handleInbox,
  withCanonicalRepo,
} from "./route-handlers.ts";
import type { PublicRouteEnv } from "../route-auth.ts";

const SIGNED_FETCH_DATE_SKEW_MS = 5 * 60 * 1_000;

async function verifySignedActorFetch(
  c: ActivityPubContext,
  deps: ActivityPubStoreDeps,
  expectedActorUrl: string,
): Promise<Response | null> {
  const dateHeader = c.req.header("date");
  if (!dateHeader) {
    return c.json({ error: "Date header is required" }, 400);
  }
  const requestDate = Date.parse(dateHeader);
  if (!Number.isFinite(requestDate)) {
    return c.json({ error: "Invalid Date header" }, 400);
  }
  if (Math.abs(Date.now() - requestDate) > SIGNED_FETCH_DATE_SKEW_MS) {
    return c.json({ error: "Date header skew exceeds 5 minutes" }, 401);
  }

  if (!c.req.header("signature")) {
    return c.json(
      { error: "HTTP Signature header is required for private actor fetch" },
      401,
    );
  }

  try {
    const sigResult = await deps.verifyHttpSignature(c.req.raw);
    if (!sigResult.verified) {
      return c.json({ error: "Invalid HTTP signature" }, 401);
    }
    if (sigResult.actorUrl !== expectedActorUrl) {
      return c.json(
        { error: "Signature actor does not match actor query" },
        403,
      );
    }
  } catch (err) {
    if (err instanceof HttpSignatureError) {
      return c.json({
        error: `Signature verification failed: ${err.message}`,
      }, 401);
    }
    return c.json({ error: "Signature verification failed" }, 401);
  }

  return null;
}

async function handleRepoActorRoute(
  c: ActivityPubContext,
  deps: ActivityPubStoreDeps,
): Promise<Response> {
  const owner = c.req.param("owner") ?? "";
  const repoName = c.req.param("repoName") ?? "";

  const publicKeyPem = c.env.PLATFORM_PUBLIC_KEY;

  const publicRepo = await deps.findCanonicalRepo(c.env, owner, repoName);
  if (publicRepo) {
    return activityJson(
      c,
      buildRepoActor(getOriginFromUrl(c.req.url), publicRepo, { publicKeyPem }),
    );
  }

  const repo = await deps.findCanonicalRepoIncludingPrivate(
    c.env,
    owner,
    repoName,
  );
  if (!repo || repo.visibility === "public") {
    return c.json({ error: "Repository not found" }, 404);
  }

  const requestActorUrl = c.req.query("actor");
  if (!requestActorUrl) {
    return c.json({ error: "Repository not found" }, 404);
  }

  const signatureFailure = await verifySignedActorFetch(
    c,
    deps,
    requestActorUrl,
  );
  if (signatureFailure) return signatureFailure;

  const hasGrant = await deps.checkGrant(
    c.env.DB,
    repo.id,
    requestActorUrl,
    "visit",
  );
  if (!hasGrant) {
    return c.json({ error: "Repository not found" }, 404);
  }

  return activityJson(
    c,
    buildRepoActor(getOriginFromUrl(c.req.url), repo, {
      omitPushUri: true,
      publicKeyPem,
    }),
  );
}

async function handleRepoOutboxRoute(
  c: ActivityPubContext,
  repo: StoreRepositoryRecord,
  deps: ActivityPubStoreDeps,
): Promise<Response> {
  const origin = getOriginFromUrl(c.req.url);
  const repoActorId = buildRepoActorId(origin, repo.ownerSlug, repo.name);
  const collectionUrl = `${repoActorId}/outbox`;
  const page = c.req.query("page");
  const { limit } = parsePagination(c.req.query());

  // Round 11 audit finding #11/#12: both the root OrderedCollection and
  // paged responses previously reported `totalItems: 0` on the root and
  // `pushResult.total || activities.length` on the page. For a busy repo
  // that undercounted, and for an empty repo the synthetic Create fallback
  // was miscounted. Derive the canonical count from a single paginated
  // fetch and reuse it for both shapes, upshifting by 1 when we fall back
  // to a synthetic Create activity so the single item is reflected.
  const pageNum = page ? parsePageNumber(page) : 1;
  const pushResult = await deps.listPushActivities(c.env.DB, repo.id, {
    limit: page ? limit : 1,
    offset: page ? (pageNum - 1) * limit : 0,
  });

  const activities = pushResult.items.map((push) => {
    if (push.ref.startsWith("refs/tags/")) {
      return buildRepoTagActivity(repoActorId, push);
    }

    if (push.ref === DELETE_REF) {
      return buildRepoDeleteActivity(repoActorId, push.createdAt);
    }

    return buildRepoPushActivity(repoActorId, push);
  });

  const usedFallback = pushResult.total === 0 && pageNum === 1;
  if (page && activities.length === 0 && pageNum === 1 && usedFallback) {
    activities.push(buildRepoOutboxFallbackActivity(origin, repo));
  }

  // `totalItems` = real push count, or 1 for the synthetic Create in the
  // zero-push case. Both the root collection and the page report this.
  const totalItems = pushResult.total > 0 ? pushResult.total : 1;

  if (!page) {
    return orderedCollectionResponse(
      c,
      collectionUrl,
      undefined,
      1,
      totalItems,
      [],
    );
  }

  return orderedCollectionResponse(
    c,
    collectionUrl,
    page,
    pageNum,
    totalItems,
    activities,
  );
}

export function registerRepoRoutes(
  activitypubStore: Hono<PublicRouteEnv>,
  deps: ActivityPubStoreDeps,
): void {
  activitypubStore.get(
    "/ap/repos/:owner/:repoName",
    withCache({
      ttl: CacheTTL.PUBLIC_CONTENT,
      queryParamsToInclude: ["actor"],
    }),
    (c) => handleRepoActorRoute(c, deps),
  );

  activitypubStore.post(
    "/ap/repos/:owner/:repoName/inbox",
    async (c) => {
      // Round 11 audit finding #9: to reject Follows on private repos we
      // need to look up the repo *including* private visibility, so we
      // cannot reuse `withCanonicalRepo` which only returns public rows.
      const repo = await deps.findCanonicalRepoIncludingPrivate(
        c.env,
        c.req.param("owner") ?? "",
        c.req.param("repoName") ?? "",
      );
      if (!repo) {
        return c.json({ error: "Repository not found" }, 404);
      }
      return handleInbox(
        c,
        buildRepoActorId(
          getOriginFromUrl(c.req.url),
          repo.ownerSlug,
          repo.name,
        ),
        deps,
        {
          repoId: repo.id,
          isPrivateRepo: repo.visibility !== "public",
        },
      );
    },
  );

  activitypubStore.get(
    "/ap/repos/:owner/:repoName/outbox",
    withCache({
      ttl: CacheTTL.PUBLIC_LISTING,
      queryParamsToInclude: ["page", "limit"],
    }),
    withCanonicalRepo(deps, (c, repo) => handleRepoOutboxRoute(c, repo, deps)),
  );

  activitypubStore.get(
    "/ap/repos/:owner/:repoName/followers",
    withCache({
      ttl: CacheTTL.PUBLIC_LISTING,
      queryParamsToInclude: ["page"],
    }),
    withCanonicalRepo(deps, (c, repo) =>
      handleFollowers(
        c,
        buildRepoActorId(
          getOriginFromUrl(c.req.url),
          repo.ownerSlug,
          repo.name,
        ),
        deps,
      )),
  );

  activitypubStore.get(
    "/ap/repos/:owner/:repoName/stores",
    withCache({
      ttl: CacheTTL.PUBLIC_LISTING,
      queryParamsToInclude: ["page"],
    }),
    withCanonicalRepo(deps, async (c, repo) => {
      const origin = getOriginFromUrl(c.req.url);
      const repoActorId = buildRepoActorId(origin, repo.ownerSlug, repo.name);
      const collectionUrl = `${repoActorId}/stores`;
      const storeRecords = await deps.listStoresForRepo(c.env, repo.ownerId);
      const storeUris = storeRecords.map((store) =>
        buildStoreActorId(origin, store.slug)
      );

      return orderedCollectionResponse(
        c,
        collectionUrl,
        c.req.query("page"),
        1,
        storeUris.length,
        storeUris,
      );
    }),
  );
}
