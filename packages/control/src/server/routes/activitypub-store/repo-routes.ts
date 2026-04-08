import type { Hono } from "hono";
import { CacheTTL, withCache } from "../../middleware/cache.ts";
import { parsePagination } from "../../../shared/utils/index.ts";
import {
  DELETE_REF,
} from "../../../application/services/activitypub/push-activities.ts";
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
  enc,
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

  if (!page) {
    return orderedCollectionResponse(c, collectionUrl, undefined, 1, 0, []);
  }

  const pageNum = parsePageNumber(page);
  const pushResult = await deps.listPushActivities(c.env.DB, repo.id, {
    limit,
    offset: (pageNum - 1) * limit,
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

  if (activities.length === 0 && pageNum === 1) {
    activities.push(buildRepoOutboxFallbackActivity(origin, repo));
  }

  return orderedCollectionResponse(
    c,
    collectionUrl,
    page,
    pageNum,
    pushResult.total || activities.length,
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
    withCanonicalRepo(deps, (c, repo) =>
      handleInbox(
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

  activitypubStore.get(
    "/ap/stores/:store/repositories/:owner/:repoName",
    (c) => {
      const owner = c.req.param("owner");
      const repoName = c.req.param("repoName");
      return c.redirect(
        `${getOriginFromUrl(c.req.url)}/ap/repos/${enc(owner)}/${
          enc(repoName)
        }`,
        301,
      );
    },
  );
}
