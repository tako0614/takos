import type { Hono } from "hono";
import { CacheTTL, withCache } from "../../middleware/cache.ts";
import { parsePagination } from "../../../shared/utils/index.ts";
import {
  DELETE_REF,
} from "../../../application/services/activitypub/push-activities.ts";
import type { StoreRecord } from "./activitypub-queries.ts";
import type { ActivityPubStoreDeps } from "./deps.ts";
import {
  buildAnnounceActivity,
  buildInventoryLogActivity,
} from "./activity-builders.ts";
import {
  activityJson,
  buildRepoActivity,
  buildRepoCollectionItems,
  buildSearchCollectionUrl,
  buildSearchServiceId,
  buildStoreActorId,
  buildStoreSummary,
  enc,
  getOriginFromUrl,
  isExpandedObjectRequest,
  orderedCollectionResponse,
  parsePageNumber,
  storeActorContext,
  takosContext,
} from "./helpers.ts";
import {
  type ActivityPubContext,
  handleFollowers,
  handleInbox,
  withStoreRecord,
} from "./route-handlers.ts";
import type { PublicRouteEnv } from "../route-auth.ts";

async function handleStoreInventoryRoute(
  c: ActivityPubContext,
  storeRecord: StoreRecord,
  deps: ActivityPubStoreDeps,
): Promise<Response> {
  const origin = getOriginFromUrl(c.req.url);
  const collectionUrl = `${
    buildStoreActorId(origin, storeRecord.slug)
  }/inventory`;
  const page = c.req.query("page");
  const pageNum = parsePageNumber(page);
  const { limit } = parsePagination(c.req.query());
  const expand = isExpandedObjectRequest(c.req.query("expand"));

  if (!page) {
    return orderedCollectionResponse(
      c,
      collectionUrl,
      undefined,
      1,
      storeRecord.publicRepoCount,
      [],
    );
  }

  const result = await deps.listStoreRepositories(c.env, storeRecord.slug, {
    limit,
    offset: (pageNum - 1) * limit,
  });

  return orderedCollectionResponse(
    c,
    collectionUrl,
    page,
    pageNum,
    result.total,
    buildRepoCollectionItems(origin, result.items, expand),
  );
}

async function handleStoreSearchRepositoriesRoute(
  c: ActivityPubContext,
  storeRecord: StoreRecord,
  deps: ActivityPubStoreDeps,
): Promise<Response> {
  const query = (c.req.query("q") || "").trim();
  if (!query) {
    return c.json({ error: "q parameter required" }, 400);
  }

  const origin = getOriginFromUrl(c.req.url);
  const collectionUrl = buildSearchCollectionUrl(origin, storeRecord.slug);
  const page = c.req.query("page");
  const pageNum = parsePageNumber(page);
  const { limit } = parsePagination(c.req.query());
  const expand = isExpandedObjectRequest(c.req.query("expand"));

  if (!page) {
    const result = await deps.searchStoreRepositories(
      c.env,
      storeRecord.slug,
      query,
      {
        limit: 1,
        offset: 0,
      },
    );

    return activityJson(c, {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${collectionUrl}?q=${encodeURIComponent(query)}`,
      type: "OrderedCollection",
      totalItems: result.total,
      first: `${collectionUrl}?q=${encodeURIComponent(query)}&page=1`,
    });
  }

  const result = await deps.searchStoreRepositories(
    c.env,
    storeRecord.slug,
    query,
    {
      limit,
      offset: (pageNum - 1) * limit,
    },
  );

  return activityJson(c, {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `${collectionUrl}?q=${encodeURIComponent(query)}&page=${pageNum}`,
    type: "OrderedCollectionPage",
    partOf: `${collectionUrl}?q=${encodeURIComponent(query)}`,
    totalItems: result.total,
    orderedItems: buildRepoCollectionItems(origin, result.items, expand),
  });
}

async function handleStoreOutboxRoute(
  c: ActivityPubContext,
  storeRecord: StoreRecord,
  deps: ActivityPubStoreDeps,
): Promise<Response> {
  const origin = getOriginFromUrl(c.req.url);
  const actorId = buildStoreActorId(origin, storeRecord.slug);
  const collectionUrl = `${actorId}/outbox`;
  const page = c.req.query("page");
  const pageNum = parsePageNumber(page);
  const { limit } = parsePagination(c.req.query());

  const explicit = await deps.hasExplicitInventory(
    c.env.DB,
    storeRecord.accountId,
    storeRecord.slug,
  );

  if (explicit) {
    if (!page) {
      const invResult = await deps.listInventoryActivities(
        c.env.DB,
        storeRecord.accountId,
        storeRecord.slug,
        { limit: 1, offset: 0 },
      );
      const activeItems = await deps.listInventoryItems(
        c.env.DB,
        storeRecord.accountId,
        storeRecord.slug,
        { limit: 100, offset: 0 },
      );
      const localRepoIds = activeItems.items.map((i) => i.localRepoId).filter((
        id,
      ): id is string => !!id);
      const announceResult = localRepoIds.length > 0
        ? await deps.listPushActivitiesForRepoIds(c.env.DB, localRepoIds, {
          limit: 1,
          offset: 0,
        })
        : { total: 0 };

      return orderedCollectionResponse(
        c,
        collectionUrl,
        undefined,
        1,
        invResult.total + announceResult.total,
        [],
      );
    }

    const invResult = await deps.listInventoryActivities(
      c.env.DB,
      storeRecord.accountId,
      storeRecord.slug,
      {
        limit,
        offset: (pageNum - 1) * limit,
      },
    );

    const invActivities = invResult.items.map((item) => ({
      ts: item.createdAt,
      activity: buildInventoryLogActivity(actorId, item),
    }));

    const activeItems = await deps.listInventoryItems(
      c.env.DB,
      storeRecord.accountId,
      storeRecord.slug,
      { limit: 100, offset: 0 },
    );
    const localRepoIds = activeItems.items.map((i) => i.localRepoId).filter((
      id,
    ): id is string => !!id);

    let announceActivities: Array<{
      ts: string;
      activity: Record<string, unknown>;
    }> = [];
    if (localRepoIds.length > 0) {
      const pushResult = await deps.listPushActivitiesForRepoIds(
        c.env.DB,
        localRepoIds,
        {
          limit,
          offset: (pageNum - 1) * limit,
        },
      );

      const repoIdToItem = new Map(
        activeItems.items.filter((i) => i.localRepoId).map((i) => [
          i.localRepoId!,
          i,
        ]),
      );

      announceActivities = pushResult.items
        .filter((push) => push.ref !== DELETE_REF)
        .map((push) => {
          const invItem = repoIdToItem.get(push.repoId);
          return {
            ts: push.createdAt,
            activity: buildAnnounceActivity(
              actorId,
              push,
              invItem?.repoActorUrl || "",
            ),
          };
        });
    }

    const merged = [...invActivities, ...announceActivities]
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, limit);

    return orderedCollectionResponse(
      c,
      collectionUrl,
      page,
      pageNum,
      invResult.total + announceActivities.length,
      merged.map((item) => item.activity),
    );
  }

  if (!page) {
    return orderedCollectionResponse(
      c,
      collectionUrl,
      undefined,
      1,
      storeRecord.publicRepoCount,
      [],
    );
  }

  const result = await deps.listStoreRepositories(c.env, storeRecord.slug, {
    limit,
    offset: (pageNum - 1) * limit,
  });

  return orderedCollectionResponse(
    c,
    collectionUrl,
    page,
    pageNum,
    result.total,
    result.items.map((repo) =>
      buildRepoActivity(origin, storeRecord.slug, repo)
    ),
  );
}

export function registerStoreRoutes(
  activitypubStore: Hono<PublicRouteEnv>,
  deps: ActivityPubStoreDeps,
): void {
  activitypubStore.get(
    "/ap/stores/:store",
    withCache({
      ttl: CacheTTL.PUBLIC_CONTENT,
      includeQueryParams: false,
    }),
    withStoreRecord(deps, async (c, storeRecord) => {
      const origin = getOriginFromUrl(c.req.url);
      const actorId = buildStoreActorId(origin, storeRecord.slug);

      return activityJson(c, {
        "@context": storeActorContext(),
        id: actorId,
        type: ["Service", "Store"],
        preferredUsername: storeRecord.slug,
        name: storeRecord.name,
        summary: buildStoreSummary(storeRecord),
        url: actorId,
        icon: storeRecord.picture
          ? { type: "Image", url: storeRecord.picture }
          : undefined,
        inbox: `${actorId}/inbox`,
        outbox: `${actorId}/outbox`,
        followers: `${actorId}/followers`,
        publicKey: {
          id: `${actorId}#main-key`,
          owner: actorId,
          publicKeyPem: c.env.PLATFORM_PUBLIC_KEY,
        },
        inventory: `${actorId}/inventory`,
        search: buildSearchServiceId(origin, storeRecord.slug),
        repositorySearch: buildSearchCollectionUrl(origin, storeRecord.slug),
      });
    }),
  );

  activitypubStore.post(
    "/ap/stores/:store/inbox",
    withStoreRecord(deps, (c, storeRecord) =>
      handleInbox(
        c,
        buildStoreActorId(getOriginFromUrl(c.req.url), storeRecord.slug),
        deps,
      )),
  );

  activitypubStore.get(
    "/ap/stores/:store/followers",
    withCache({
      ttl: CacheTTL.PUBLIC_LISTING,
      queryParamsToInclude: ["page"],
    }),
    withStoreRecord(deps, (c, storeRecord) =>
      handleFollowers(
        c,
        buildStoreActorId(getOriginFromUrl(c.req.url), storeRecord.slug),
        deps,
      )),
  );

  activitypubStore.get(
    "/ap/stores/:store/inventory",
    withCache({
      ttl: CacheTTL.PUBLIC_LISTING,
      queryParamsToInclude: ["page", "limit", "expand"],
    }),
    withStoreRecord(
      deps,
      (c, storeRecord) => handleStoreInventoryRoute(c, storeRecord, deps),
    ),
  );

  activitypubStore.get("/ap/stores/:store/repositories", (c) => {
    const store = c.req.param("store");
    const origin = getOriginFromUrl(c.req.url);
    const query = c.req.url.includes("?") ? `?${c.req.url.split("?")[1]}` : "";
    return c.redirect(
      `${origin}/ap/stores/${enc(store)}/inventory${query}`,
      301,
    );
  });

  activitypubStore.get(
    "/ap/stores/:store/search",
    withCache({
      ttl: CacheTTL.PUBLIC_CONTENT,
      includeQueryParams: false,
    }),
    withStoreRecord(deps, async (c, storeRecord) => {
      const origin = getOriginFromUrl(c.req.url);
      const actorId = buildStoreActorId(origin, storeRecord.slug);

      return activityJson(c, {
        "@context": [
          "https://www.w3.org/ns/activitystreams",
          takosContext(),
        ],
        id: buildSearchServiceId(origin, storeRecord.slug),
        type: "Service",
        attributedTo: actorId,
        name: `${storeRecord.name} Search`,
        summary: `Search endpoints for the ${storeRecord.slug} store catalog`,
        repositorySearch: buildSearchCollectionUrl(origin, storeRecord.slug),
      });
    }),
  );

  activitypubStore.get(
    "/ap/stores/:store/search/repositories",
    withCache({
      ttl: CacheTTL.PUBLIC_LISTING,
      queryParamsToInclude: ["q", "page", "limit", "expand"],
    }),
    withStoreRecord(
      deps,
      (c, storeRecord) =>
        handleStoreSearchRepositoriesRoute(c, storeRecord, deps),
    ),
  );

  activitypubStore.get(
    "/ap/stores/:store/outbox",
    withCache({
      ttl: CacheTTL.PUBLIC_LISTING,
      queryParamsToInclude: ["page", "limit"],
    }),
    withStoreRecord(
      deps,
      (c, storeRecord) => handleStoreOutboxRoute(c, storeRecord, deps),
    ),
  );
}
