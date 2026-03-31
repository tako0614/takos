import { Hono, type Context } from 'hono';
import { CacheTTL, withCache } from '../../middleware/cache.ts';
import type { PublicRouteEnv } from '../route-auth.ts';
import { parsePagination } from '../../../shared/utils/index.ts';
import {
  findCanonicalRepo,
  findCanonicalRepoIncludingPrivate,
  findStoreBySlug,
  listStoreRepositories,
  listStoresForRepo,
  searchStoreRepositories,
  type StoreRecord,
  type StoreRepositoryRecord,
} from './activitypub-queries.ts';
import { listPushActivities, listPushActivitiesForRepoIds, DELETE_REF } from '../../../application/services/activitypub/push-activities.ts';
import { hasExplicitInventory, listInventoryActivities, listInventoryItems } from '../../../application/services/activitypub/store-inventory.ts';
import { addFollower, removeFollower, listFollowers } from '../../../application/services/activitypub/followers.ts';
import { checkGrant } from '../../../application/services/activitypub/grants.ts';
import { verifyHttpSignature, HttpSignatureError } from '../../middleware/http-signature.ts';

const activitypubStore = new Hono<PublicRouteEnv>();

const AP_CONTENT_TYPE = 'application/activity+json; charset=utf-8';
const JSON_LD_CONTENT_TYPE = 'application/ld+json; charset=utf-8';
const JRD_CONTENT_TYPE = 'application/jrd+json; charset=utf-8';
const AS_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public';
const FORGEFED_NS = 'https://forgefed.org/ns';
const TAKOS_NS = 'https://takos.jp/ns#';

type ActivityPubContext = Context<PublicRouteEnv>;

function getOrigin(c: ActivityPubContext): string {
  return new URL(c.req.url).origin;
}

function getHost(c: ActivityPubContext): string {
  return new URL(c.req.url).host;
}

/* ------------------------------------------------------------------ */
/*  JSON-LD contexts                                                   */
/* ------------------------------------------------------------------ */

function takosContext(): Record<string, unknown> {
  return {
    takos: TAKOS_NS,
    Store: 'takos:Store',
    inventory: { '@id': 'takos:inventory', '@type': '@id' },
    stores: { '@id': 'takos:stores', '@type': '@id' },
    defaultBranchRef: 'takos:defaultBranchRef',
    defaultBranchHash: 'takos:defaultBranchHash',
  };
}

function storeActorContext(): Array<string | Record<string, unknown>> {
  return [
    'https://www.w3.org/ns/activitystreams',
    'https://w3id.org/security/v1',
    takosContext(),
  ];
}

function repoActorContext(): Array<string | Record<string, unknown>> {
  return [
    'https://www.w3.org/ns/activitystreams',
    FORGEFED_NS,
    'https://w3id.org/security/v1',
    takosContext(),
  ];
}

function activityContext(): Array<string | Record<string, unknown>> {
  return [
    'https://www.w3.org/ns/activitystreams',
    FORGEFED_NS,
    takosContext(),
  ];
}

/* ------------------------------------------------------------------ */
/*  Response helpers                                                   */
/* ------------------------------------------------------------------ */

function activityJson(_c: ActivityPubContext, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': AP_CONTENT_TYPE },
  });
}

function jsonLd(_c: ActivityPubContext, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': JSON_LD_CONTENT_TYPE },
  });
}

function jrdJson(_c: ActivityPubContext, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': JRD_CONTENT_TYPE },
  });
}

/* ------------------------------------------------------------------ */
/*  URL builders                                                       */
/* ------------------------------------------------------------------ */

function enc(value: string): string {
  return encodeURIComponent(value);
}

function buildStoreActorId(origin: string, store: string): string {
  return `${origin}/ap/stores/${enc(store)}`;
}

function buildRepoActorId(origin: string, owner: string, repoName: string): string {
  return `${origin}/ap/repos/${enc(owner)}/${enc(repoName)}`;
}

function buildSearchServiceId(origin: string, store: string): string {
  return `${buildStoreActorId(origin, store)}/search`;
}

function buildSearchCollectionUrl(origin: string, store: string): string {
  return `${buildStoreActorId(origin, store)}/search/repositories`;
}

/* ------------------------------------------------------------------ */
/*  Object builders                                                    */
/* ------------------------------------------------------------------ */

function buildStoreSummary(store: StoreRecord): string {
  if (store.description?.trim()) return store.description;
  return `Public repository catalog for ${store.name}`;
}

function buildRepoActor(
  origin: string,
  repo: StoreRepositoryRecord,
  options?: { includeContext?: boolean; omitPushUri?: boolean },
): Record<string, unknown> {
  const owner = repo.ownerSlug;
  const repoActorId = buildRepoActorId(origin, owner, repo.name);
  const baseProfileUrl = `${origin}/@${enc(owner)}/${enc(repo.name)}`;

  const obj: Record<string, unknown> = {
    id: repoActorId,
    type: 'Repository',
    name: repo.name,
    summary: repo.description || '',
    url: baseProfileUrl,
    published: repo.createdAt,
    updated: repo.updatedAt,
    inbox: `${repoActorId}/inbox`,
    outbox: `${repoActorId}/outbox`,
    followers: `${repoActorId}/followers`,
    cloneUri: [`${origin}/git/${enc(owner)}/${enc(repo.name)}.git`],
    stores: `${repoActorId}/stores`,
    defaultBranchRef: repo.defaultBranch ? `refs/heads/${repo.defaultBranch}` : undefined,
    defaultBranchHash: repo.defaultBranchHash ?? null,
  };

  if (!options?.omitPushUri) {
    obj.pushUri = [`${origin}/git/${enc(owner)}/${enc(repo.name)}.git`];
  }

  if (options?.includeContext !== false) {
    obj['@context'] = repoActorContext();
  }
  return obj;
}

function buildRepoActivity(
  origin: string,
  storeSlug: string,
  repo: StoreRepositoryRecord,
): Record<string, unknown> {
  const repoActor = buildRepoActor(origin, repo, { includeContext: false });
  const isUpdate = repo.updatedAt !== repo.createdAt;
  const type = isUpdate ? 'Update' : 'Create';
  const timestamp = isUpdate ? repo.updatedAt : repo.createdAt;

  return {
    '@context': activityContext(),
    id: `${repoActor.id}/activities/${isUpdate ? 'update' : 'create'}/${encodeURIComponent(timestamp)}`,
    type,
    actor: buildStoreActorId(origin, storeSlug),
    published: timestamp,
    to: [AS_PUBLIC],
    object: repoActor,
  };
}

/* ------------------------------------------------------------------ */
/*  Collection helper                                                  */
/* ------------------------------------------------------------------ */

function orderedCollectionResponse(
  c: ActivityPubContext,
  collectionUrl: string,
  page: string | undefined,
  pageNum: number,
  totalItems: number,
  orderedItems: unknown[],
): Response {
  if (page) {
    return activityJson(c, {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${collectionUrl}?page=${pageNum}`,
      type: 'OrderedCollectionPage',
      partOf: collectionUrl,
      totalItems,
      orderedItems,
    });
  }

  return activityJson(c, {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: collectionUrl,
    type: 'OrderedCollection',
    totalItems,
    first: `${collectionUrl}?page=1`,
  });
}

/* ------------------------------------------------------------------ */
/*  Shared inbox / followers handlers                                  */
/* ------------------------------------------------------------------ */

async function handleInbox(c: ActivityPubContext, targetActorUrl: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const type = String(body.type ?? '');
  const actorUrl = typeof body.actor === 'string' ? body.actor : null;

  if (!actorUrl) {
    return c.json({ error: 'actor field is required' }, 400);
  }

  // --- HTTP Signature verification (gradual rollout) ---
  // If a Signature header is present, verify it and ensure the signing actor
  // matches the actor claim in the activity body. If no Signature header is
  // present, log a warning and continue processing (to avoid breaking
  // federation with instances that don't yet sign requests).
  const signatureHeader = c.req.header('signature');
  if (signatureHeader) {
    try {
      const sigResult = await verifyHttpSignature(c.req.raw);

      if (!sigResult.verified) {
        return c.json({ error: 'Invalid HTTP signature' }, 401);
      }

      // Ensure the signing key's actor matches the actor claimed in the body
      if (sigResult.actorUrl !== actorUrl) {
        return c.json(
          { error: 'Signature actor does not match activity actor' },
          403,
        );
      }
    } catch (err) {
      if (err instanceof HttpSignatureError) {
        return c.json({ error: `Signature verification failed: ${err.message}` }, 401);
      }
      // Unexpected errors — log and reject
      console.error('HTTP Signature verification error:', err);
      return c.json({ error: 'Signature verification failed' }, 401);
    }
  } else {
    console.warn(
      `[ActivityPub] Inbox received activity without HTTP Signature from actor: ${actorUrl}`,
    );
  }

  if (type === 'Follow') {
    await addFollower(c.env.DB, targetActorUrl, actorUrl);
    return activityJson(c, {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Accept',
      actor: targetActorUrl,
      object: body,
    });
  }

  if (type === 'Undo') {
    const innerObject = body.object as Record<string, unknown> | undefined;
    if (innerObject && String(innerObject.type ?? '') === 'Follow') {
      await removeFollower(c.env.DB, targetActorUrl, actorUrl);
      return activityJson(c, {
        '@context': 'https://www.w3.org/ns/activitystreams',
        type: 'Accept',
        actor: targetActorUrl,
        object: body,
      });
    }
  }

  return c.json({ error: 'Unsupported activity type' }, 422);
}

async function handleFollowers(c: ActivityPubContext, targetActorUrl: string): Promise<Response> {
  const collectionUrl = `${targetActorUrl}/followers`;
  const page = c.req.query('page');
  const { limit } = parsePagination(c.req.query());
  const pageNum = Math.max(1, Number.parseInt(page ?? '', 10) || 1);

  const result = await listFollowers(c.env.DB, targetActorUrl, {
    limit,
    offset: page ? (pageNum - 1) * limit : 0,
  });

  if (!page) {
    return activityJson(c, {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: collectionUrl,
      type: 'OrderedCollection',
      totalItems: result.total,
      first: `${collectionUrl}?page=1`,
    });
  }

  return activityJson(c, {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${collectionUrl}?page=${pageNum}`,
    type: 'OrderedCollectionPage',
    partOf: collectionUrl,
    totalItems: result.total,
    orderedItems: result.items,
  });
}

/* ================================================================== */
/*  ROUTES                                                             */
/* ================================================================== */

/* --- WebFinger ---------------------------------------------------- */

activitypubStore.get('/.well-known/webfinger', withCache({
  ttl: CacheTTL.PUBLIC_CONTENT,
  queryParamsToInclude: ['resource'],
}), async (c) => {
  const resource = c.req.query('resource');
  if (!resource) {
    return c.json({ error: 'resource parameter required' }, 400);
  }

  const requestHost = getHost(c);
  const origin = getOrigin(c);

  let slug: string | null = null;
  let domain: string | null = null;
  let kind: 'store' | 'repo' = 'store';
  let repoOwner: string | null = null;
  let repoName: string | null = null;

  if (resource.startsWith('acct:')) {
    const acct = resource.slice(5);
    const atIndex = acct.lastIndexOf('@');
    if (atIndex > 0) {
      slug = acct.slice(0, atIndex);
      domain = acct.slice(atIndex + 1);
    }
  } else if (resource.startsWith('http://') || resource.startsWith('https://')) {
    try {
      const url = new URL(resource);
      domain = url.host;
      const storeMatch = url.pathname.match(/^\/ap\/stores\/([^/]+)$/);
      if (storeMatch) {
        slug = decodeURIComponent(storeMatch[1]);
        kind = 'store';
      } else {
        const repoMatch = url.pathname.match(/^\/ap\/repos\/([^/]+)\/([^/]+)$/);
        if (repoMatch) {
          repoOwner = decodeURIComponent(repoMatch[1]);
          repoName = decodeURIComponent(repoMatch[2]);
          kind = 'repo';
        }
      }
    } catch {
      return c.json({ error: 'Invalid resource format' }, 400);
    }
  } else {
    return c.json({ error: 'Invalid resource format' }, 400);
  }

  if (kind === 'repo' && repoOwner && repoName && domain) {
    if (domain !== requestHost) {
      return c.json({ error: 'Actor not found' }, 404);
    }
    const repo = await findCanonicalRepo(c.env, repoOwner, repoName);
    if (!repo) {
      return c.json({ error: 'Actor not found' }, 404);
    }
    const actorId = buildRepoActorId(origin, repo.ownerSlug, repo.name);
    return jrdJson(c, {
      subject: resource,
      aliases: [actorId],
      links: [
        { rel: 'self', type: 'application/activity+json', href: actorId },
      ],
    });
  }

  if (!slug || !domain) {
    return c.json({ error: 'Invalid resource format' }, 400);
  }

  if (domain !== requestHost) {
    return c.json({ error: 'Actor not found' }, 404);
  }

  const storeRecord = await findStoreBySlug(c.env, slug);
  if (!storeRecord) {
    return c.json({ error: 'Actor not found' }, 404);
  }

  const actorId = buildStoreActorId(origin, storeRecord.slug);
  return jrdJson(c, {
    subject: `acct:${storeRecord.slug}@${requestHost}`,
    aliases: [actorId],
    links: [
      { rel: 'self', type: 'application/activity+json', href: actorId },
    ],
  });
});

/* --- Takos namespace context -------------------------------------- */

activitypubStore.get('/ns/takos', withCache({
  ttl: CacheTTL.PUBLIC_CONTENT,
  includeQueryParams: false,
}), async (c) => {
  return jsonLd(c, { '@context': takosContext() });
});

// Backward-compatible redirect from old namespace endpoint
activitypubStore.get('/ns/takos-git', (c) => {
  return c.redirect(`${getOrigin(c)}/ns/takos`, 301);
});

/* --- Store actor -------------------------------------------------- */

activitypubStore.get('/ap/stores/:store', withCache({
  ttl: CacheTTL.PUBLIC_CONTENT,
  includeQueryParams: false,
}), async (c) => {
  const store = c.req.param('store');
  const storeRecord = await findStoreBySlug(c.env, store);
  if (!storeRecord) {
    return c.json({ error: 'Store not found' }, 404);
  }

  const origin = getOrigin(c);
  const actorId = buildStoreActorId(origin, storeRecord.slug);

  return activityJson(c, {
    '@context': storeActorContext(),
    id: actorId,
    type: ['Service', 'Store'],
    preferredUsername: storeRecord.slug,
    name: storeRecord.name,
    summary: buildStoreSummary(storeRecord),
    url: actorId,
    icon: storeRecord.picture ? { type: 'Image', url: storeRecord.picture } : undefined,
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
});

/* --- Store inbox -------------------------------------------------- */

activitypubStore.post('/ap/stores/:store/inbox', async (c) => {
  const store = c.req.param('store');
  const storeRecord = await findStoreBySlug(c.env, store);
  if (!storeRecord) {
    return c.json({ error: 'Store not found' }, 404);
  }

  return handleInbox(c, buildStoreActorId(getOrigin(c), storeRecord.slug));
});

/* --- Store followers ---------------------------------------------- */

activitypubStore.get('/ap/stores/:store/followers', withCache({
  ttl: CacheTTL.PUBLIC_LISTING,
  queryParamsToInclude: ['page'],
}), async (c) => {
  const store = c.req.param('store');
  const storeRecord = await findStoreBySlug(c.env, store);
  if (!storeRecord) {
    return c.json({ error: 'Store not found' }, 404);
  }

  return handleFollowers(c, buildStoreActorId(getOrigin(c), storeRecord.slug));
});

/* --- Store inventory (was: /repositories) ------------------------- */

activitypubStore.get('/ap/stores/:store/inventory', withCache({
  ttl: CacheTTL.PUBLIC_LISTING,
  queryParamsToInclude: ['page', 'limit', 'expand'],
}), async (c) => {
  const store = c.req.param('store');
  const storeRecord = await findStoreBySlug(c.env, store);
  if (!storeRecord) {
    return c.json({ error: 'Store not found' }, 404);
  }

  const origin = getOrigin(c);
  const collectionUrl = `${buildStoreActorId(origin, storeRecord.slug)}/inventory`;
  const page = c.req.query('page');
  const pageNumParsed = Number.parseInt(page ?? '', 10);
  const pageNum = Number.isFinite(pageNumParsed) && pageNumParsed > 0 ? pageNumParsed : 1;
  const { limit } = parsePagination(c.req.query());
  const expand = (c.req.query('expand') || '').toLowerCase() === 'object';

  if (!page) {
    return orderedCollectionResponse(c, collectionUrl, undefined, 1, storeRecord.publicRepoCount, []);
  }

  const result = await listStoreRepositories(c.env, storeRecord.slug, {
    limit,
    offset: (pageNum - 1) * limit,
  });

  const orderedItems = result.items.map((repo) => (
    expand
      ? buildRepoActor(origin, repo)
      : buildRepoActorId(origin, repo.ownerSlug, repo.name)
  ));

  return orderedCollectionResponse(c, collectionUrl, page, pageNum, result.total, orderedItems);
});

// Backward-compatible redirect from old endpoint
activitypubStore.get('/ap/stores/:store/repositories', (c) => {
  const store = c.req.param('store');
  const origin = getOrigin(c);
  const query = c.req.url.includes('?') ? `?${c.req.url.split('?')[1]}` : '';
  return c.redirect(`${origin}/ap/stores/${enc(store)}/inventory${query}`, 301);
});

/* --- Search service ----------------------------------------------- */

activitypubStore.get('/ap/stores/:store/search', withCache({
  ttl: CacheTTL.PUBLIC_CONTENT,
  includeQueryParams: false,
}), async (c) => {
  const store = c.req.param('store');
  const storeRecord = await findStoreBySlug(c.env, store);
  if (!storeRecord) {
    return c.json({ error: 'Store not found' }, 404);
  }

  const origin = getOrigin(c);
  const actorId = buildStoreActorId(origin, storeRecord.slug);
  const searchServiceId = buildSearchServiceId(origin, storeRecord.slug);

  return activityJson(c, {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      takosContext(),
    ],
    id: searchServiceId,
    type: 'Service',
    attributedTo: actorId,
    name: `${storeRecord.name} Search`,
    summary: `Search endpoints for the ${storeRecord.slug} store catalog`,
    repositorySearch: buildSearchCollectionUrl(origin, storeRecord.slug),
  });
});

/* --- Search repositories ------------------------------------------ */

activitypubStore.get('/ap/stores/:store/search/repositories', withCache({
  ttl: CacheTTL.PUBLIC_LISTING,
  queryParamsToInclude: ['q', 'page', 'limit', 'expand'],
}), async (c) => {
  const store = c.req.param('store');
  const storeRecord = await findStoreBySlug(c.env, store);
  if (!storeRecord) {
    return c.json({ error: 'Store not found' }, 404);
  }

  const query = (c.req.query('q') || '').trim();
  if (!query) {
    return c.json({ error: 'q parameter required' }, 400);
  }

  const origin = getOrigin(c);
  const collectionUrl = buildSearchCollectionUrl(origin, storeRecord.slug);
  const page = c.req.query('page');
  const pageNumParsed = Number.parseInt(page ?? '', 10);
  const pageNum = Number.isFinite(pageNumParsed) && pageNumParsed > 0 ? pageNumParsed : 1;
  const { limit } = parsePagination(c.req.query());
  const expand = (c.req.query('expand') || '').toLowerCase() === 'object';

  if (!page) {
    const result = await searchStoreRepositories(c.env, storeRecord.slug, query, {
      limit: 1,
      offset: 0,
    });

    return activityJson(c, {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${collectionUrl}?q=${encodeURIComponent(query)}`,
      type: 'OrderedCollection',
      totalItems: result.total,
      first: `${collectionUrl}?q=${encodeURIComponent(query)}&page=1`,
    });
  }

  const result = await searchStoreRepositories(c.env, storeRecord.slug, query, {
    limit,
    offset: (pageNum - 1) * limit,
  });

  const orderedItems = result.items.map((repo) => (
    expand
      ? buildRepoActor(origin, repo)
      : buildRepoActorId(origin, repo.ownerSlug, repo.name)
  ));

  return activityJson(c, {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${collectionUrl}?q=${encodeURIComponent(query)}&page=${pageNum}`,
    type: 'OrderedCollectionPage',
    partOf: `${collectionUrl}?q=${encodeURIComponent(query)}`,
    totalItems: result.total,
    orderedItems,
  });
});

/* --- Store outbox ------------------------------------------------- */

activitypubStore.get('/ap/stores/:store/outbox', withCache({
  ttl: CacheTTL.PUBLIC_LISTING,
  queryParamsToInclude: ['page', 'limit'],
}), async (c) => {
  const store = c.req.param('store');
  const storeRecord = await findStoreBySlug(c.env, store);
  if (!storeRecord) {
    return c.json({ error: 'Store not found' }, 404);
  }

  const origin = getOrigin(c);
  const actorId = buildStoreActorId(origin, storeRecord.slug);
  const collectionUrl = `${actorId}/outbox`;
  const page = c.req.query('page');
  const pageNumParsed = Number.parseInt(page ?? '', 10);
  const pageNum = Number.isFinite(pageNumParsed) && pageNumParsed > 0 ? pageNumParsed : 1;
  const { limit } = parsePagination(c.req.query());

  const explicit = await hasExplicitInventory(c.env.DB, storeRecord.accountId, storeRecord.slug);

  if (explicit) {
    // Real outbox: Add/Remove activities from inventory log + Announce for repo pushes
    if (!page) {
      // Count inventory activities + announce activities from inventory repos
      const invResult = await listInventoryActivities(c.env.DB, storeRecord.accountId, storeRecord.slug, { limit: 1, offset: 0 });
      const activeItems = await listInventoryItems(c.env.DB, storeRecord.accountId, storeRecord.slug, { limit: 100, offset: 0 });
      const localRepoIds = activeItems.items.map((i) => i.localRepoId).filter((id): id is string => !!id);
      const announceResult = localRepoIds.length > 0
        ? await listPushActivitiesForRepoIds(c.env.DB, localRepoIds, { limit: 1, offset: 0 })
        : { total: 0 };
      const totalItems = invResult.total + announceResult.total;
      return orderedCollectionResponse(c, collectionUrl, undefined, 1, totalItems, []);
    }

    // Fetch inventory activities (Add/Remove)
    const invResult = await listInventoryActivities(c.env.DB, storeRecord.accountId, storeRecord.slug, {
      limit,
      offset: (pageNum - 1) * limit,
    });

    const invActivities: { ts: string; activity: Record<string, unknown> }[] = invResult.items.map((item) => ({
      ts: item.createdAt,
      activity: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${actorId}/activities/${item.activityType.toLowerCase()}/${encodeURIComponent(item.createdAt)}`,
        type: item.activityType,
        actor: actorId,
        published: item.createdAt,
        to: [AS_PUBLIC],
        object: item.repoActorUrl,
        target: `${actorId}/inventory`,
      },
    }));

    // Fetch Announce-wrapped push/tag activities from inventory repos
    const activeItems = await listInventoryItems(c.env.DB, storeRecord.accountId, storeRecord.slug, { limit: 100, offset: 0 });
    const localRepoIds = activeItems.items.map((i) => i.localRepoId).filter((id): id is string => !!id);

    let announceActivities: { ts: string; activity: Record<string, unknown> }[] = [];
    if (localRepoIds.length > 0) {
      const pushResult = await listPushActivitiesForRepoIds(c.env.DB, localRepoIds, {
        limit,
        offset: (pageNum - 1) * limit,
      });

      // Build a lookup from localRepoId -> inventory item for actor URL construction
      const repoIdToItem = new Map(activeItems.items.filter((i) => i.localRepoId).map((i) => [i.localRepoId!, i]));

      announceActivities = pushResult.items
        .filter((push) => push.ref !== DELETE_REF)
        .map((push) => {
          const invItem = repoIdToItem.get(push.repoId);
          const repoActorUrl = invItem?.repoActorUrl || '';
          return {
            ts: push.createdAt,
            activity: {
              '@context': activityContext(),
              id: `${actorId}/activities/announce/${encodeURIComponent(push.createdAt)}`,
              type: 'Announce',
              actor: actorId,
              published: push.createdAt,
              to: [AS_PUBLIC],
              object: {
                type: push.ref.startsWith('refs/tags/') ? 'Create' : 'Push',
                actor: repoActorUrl,
                published: push.createdAt,
                target: push.ref,
              },
            },
          };
        });
    }

    // Merge and sort by timestamp (newest first), then take the page slice
    const merged = [...invActivities, ...announceActivities]
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, limit);

    const totalItems = invResult.total + announceActivities.length;
    return orderedCollectionResponse(c, collectionUrl, page, pageNum, totalItems, merged.map((m) => m.activity));
  }

  // Auto-list fallback: generate activities from repo timestamps
  if (!page) {
    return orderedCollectionResponse(c, collectionUrl, undefined, 1, storeRecord.publicRepoCount, []);
  }

  const result = await listStoreRepositories(c.env, storeRecord.slug, {
    limit,
    offset: (pageNum - 1) * limit,
  });

  return orderedCollectionResponse(
    c,
    collectionUrl,
    page,
    pageNum,
    result.total,
    result.items.map((repo) => buildRepoActivity(origin, storeRecord.slug, repo)),
  );
});

/* ================================================================== */
/*  Canonical Repository endpoints                                     */
/* ================================================================== */

/* --- Repo actor --------------------------------------------------- */

activitypubStore.get('/ap/repos/:owner/:repoName', withCache({
  ttl: CacheTTL.PUBLIC_CONTENT,
  queryParamsToInclude: ['actor'],
}), async (c) => {
  const owner = c.req.param('owner');
  const repoName = c.req.param('repoName');

  // Try public repo first (existing behavior)
  const publicRepo = await findCanonicalRepo(c.env, owner, repoName);
  if (publicRepo) {
    return activityJson(c, buildRepoActor(getOrigin(c), publicRepo));
  }

  // If not found as public, check if it exists as a private repo
  const repo = await findCanonicalRepoIncludingPrivate(c.env, owner, repoName);
  if (!repo || repo.visibility === 'public') {
    // No repo at all, or somehow still public — 404
    return c.json({ error: 'Repository not found' }, 404);
  }

  // Private repo exists — check for a valid grant via actor query param
  const requestActorUrl = c.req.query('actor');
  if (!requestActorUrl) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const hasGrant = await checkGrant(c.env.DB, repo.id, requestActorUrl, 'visit');
  if (!hasGrant) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  // Grant valid — return repo actor without pushUri for safety
  return activityJson(c, buildRepoActor(getOrigin(c), repo, { omitPushUri: true }));
});

/* --- Repo inbox --------------------------------------------------- */

activitypubStore.post('/ap/repos/:owner/:repoName/inbox', async (c) => {
  const owner = c.req.param('owner');
  const repoName = c.req.param('repoName');

  const repo = await findCanonicalRepo(c.env, owner, repoName);
  if (!repo) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  return handleInbox(c, buildRepoActorId(getOrigin(c), repo.ownerSlug, repo.name));
});

/* --- Repo outbox -------------------------------------------------- */

activitypubStore.get('/ap/repos/:owner/:repoName/outbox', withCache({
  ttl: CacheTTL.PUBLIC_LISTING,
  queryParamsToInclude: ['page', 'limit'],
}), async (c) => {
  const owner = c.req.param('owner');
  const repoName = c.req.param('repoName');

  const repo = await findCanonicalRepo(c.env, owner, repoName);
  if (!repo) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const origin = getOrigin(c);
  const repoActorId = buildRepoActorId(origin, repo.ownerSlug, repo.name);
  const collectionUrl = `${repoActorId}/outbox`;
  const page = c.req.query('page');
  const { limit } = parsePagination(c.req.query());

  if (!page) {
    return orderedCollectionResponse(c, collectionUrl, undefined, 1, 0, []);
  }

  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);

  // Fetch Push activities from DB
  const pushResult = await listPushActivities(c.env.DB, repo.id, {
    limit,
    offset: (pageNum - 1) * limit,
  });

  const activities: Record<string, unknown>[] = pushResult.items.map((push) => {
    // Tag activity — Create + Tag object
    if (push.ref.startsWith('refs/tags/')) {
      const tagName = push.ref.slice('refs/tags/'.length);
      return {
        '@context': activityContext(),
        id: `${repoActorId}/activities/tag/${encodeURIComponent(push.createdAt)}`,
        type: 'Create',
        actor: repoActorId,
        published: push.createdAt,
        to: [AS_PUBLIC],
        object: {
          type: 'Tag',
          name: tagName,
          ref: push.ref,
          target: push.afterSha,
          published: push.createdAt,
        },
      };
    }

    // Delete activity
    if (push.ref === DELETE_REF) {
      return {
        '@context': activityContext(),
        id: `${repoActorId}/activities/delete/${encodeURIComponent(push.createdAt)}`,
        type: 'Delete',
        actor: repoActorId,
        published: push.createdAt,
        to: [AS_PUBLIC],
        object: repoActorId,
      };
    }

    // Push activity (default)
    return {
      '@context': activityContext(),
      id: `${repoActorId}/activities/push/${encodeURIComponent(push.createdAt)}`,
      type: 'Push',
      actor: repoActorId,
      attributedTo: push.pusherActorUrl || undefined,
      published: push.createdAt,
      to: [AS_PUBLIC],
      target: push.ref,
      object: push.commits.length > 0 ? {
        type: 'OrderedCollection',
        totalItems: push.commits.length,
        orderedItems: push.commits.map((cm) => ({
          type: 'Commit',
          hash: cm.hash,
          message: cm.message,
          attributedTo: { name: cm.authorName, email: cm.authorEmail },
          committed: cm.committed,
        })),
      } : {
        type: 'OrderedCollection',
        totalItems: push.commitCount,
        orderedItems: [],
      },
    };
  });

  // If no push activities yet, fall back to a Create activity from repo timestamps
  if (activities.length === 0 && pageNum === 1) {
    activities.push({
      '@context': activityContext(),
      id: `${repoActorId}/activities/create/${encodeURIComponent(repo.createdAt)}`,
      type: 'Create',
      actor: repoActorId,
      published: repo.createdAt,
      to: [AS_PUBLIC],
      object: buildRepoActor(origin, repo, { includeContext: false }),
    });
  }

  return orderedCollectionResponse(c, collectionUrl, page, pageNum, pushResult.total || activities.length, activities);
});

/* --- Repo followers ----------------------------------------------- */

activitypubStore.get('/ap/repos/:owner/:repoName/followers', withCache({
  ttl: CacheTTL.PUBLIC_LISTING,
  queryParamsToInclude: ['page'],
}), async (c) => {
  const owner = c.req.param('owner');
  const repoName = c.req.param('repoName');

  const repo = await findCanonicalRepo(c.env, owner, repoName);
  if (!repo) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  return handleFollowers(c, buildRepoActorId(getOrigin(c), repo.ownerSlug, repo.name));
});

/* --- Repo stores collection --------------------------------------- */

activitypubStore.get('/ap/repos/:owner/:repoName/stores', withCache({
  ttl: CacheTTL.PUBLIC_LISTING,
  queryParamsToInclude: ['page'],
}), async (c) => {
  const owner = c.req.param('owner');
  const repoName = c.req.param('repoName');

  const repo = await findCanonicalRepo(c.env, owner, repoName);
  if (!repo) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const origin = getOrigin(c);
  const repoActorId = buildRepoActorId(origin, repo.ownerSlug, repo.name);
  const collectionUrl = `${repoActorId}/stores`;

  const storeRecords = await listStoresForRepo(c.env, repo.ownerId);
  const storeUris = storeRecords.map((s) => buildStoreActorId(origin, s.slug));

  return orderedCollectionResponse(c, collectionUrl, c.req.query('page'), 1, storeUris.length, storeUris);
});

/* ================================================================== */
/*  Legacy redirects                                                   */
/* ================================================================== */

activitypubStore.get('/ap/stores/:store/repositories/:owner/:repoName', (c) => {
  const owner = c.req.param('owner');
  const repoName = c.req.param('repoName');
  return c.redirect(`${getOrigin(c)}/ap/repos/${enc(owner)}/${enc(repoName)}`, 301);
});

export default activitypubStore;
