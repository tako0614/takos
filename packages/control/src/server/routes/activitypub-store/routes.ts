import { Hono, type Context } from 'hono';
import { CacheTTL, withCache } from '../../middleware/cache';
import type { PublicRouteEnv } from '../route-auth';
import { parsePagination } from '../../../shared/utils';
import {
  findCanonicalRepo,
  findStoreBySlug,
  listStoreRepositories,
  listStoresForRepo,
  searchStoreRepositories,
  type StoreRecord,
  type StoreRepositoryRecord,
} from './activitypub-queries';
import { listPushActivities } from '../../../application/services/activitypub/push-activities';
import { hasExplicitInventory, listInventoryActivities } from '../../../application/services/activitypub/store-inventory';
import { addFollower, removeFollower, listFollowers } from '../../../application/services/activitypub/followers';

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
  options?: { includeContext?: boolean },
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
    pushUri: [`${origin}/git/${enc(owner)}/${enc(repo.name)}.git`],
    stores: `${repoActorId}/stores`,
    defaultBranchRef: repo.defaultBranch ? `refs/heads/${repo.defaultBranch}` : undefined,
    defaultBranchHash: repo.defaultBranchHash ?? null,
  };

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
    // Real outbox: Add/Remove activities from inventory log
    if (!page) {
      const result = await listInventoryActivities(c.env.DB, storeRecord.accountId, storeRecord.slug, { limit: 1, offset: 0 });
      return orderedCollectionResponse(c, collectionUrl, undefined, 1, result.total, []);
    }

    const result = await listInventoryActivities(c.env.DB, storeRecord.accountId, storeRecord.slug, {
      limit,
      offset: (pageNum - 1) * limit,
    });

    const activities = result.items.map((item) => ({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${actorId}/activities/${item.activityType.toLowerCase()}/${encodeURIComponent(item.createdAt)}`,
      type: item.activityType,
      actor: actorId,
      published: item.createdAt,
      to: [AS_PUBLIC],
      object: item.repoActorUrl,
      target: `${actorId}/inventory`,
    }));

    return orderedCollectionResponse(c, collectionUrl, page, pageNum, result.total, activities);
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
  includeQueryParams: false,
}), async (c) => {
  const owner = c.req.param('owner');
  const repoName = c.req.param('repoName');

  const repo = await findCanonicalRepo(c.env, owner, repoName);
  if (!repo) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  return activityJson(c, buildRepoActor(getOrigin(c), repo));
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

  const activities: Record<string, unknown>[] = pushResult.items.map((push) => ({
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
      orderedItems: push.commits.map((c) => ({
        type: 'Commit',
        hash: c.hash,
        message: c.message,
        attributedTo: { name: c.authorName, email: c.authorEmail },
        committed: c.committed,
      })),
    } : {
      type: 'OrderedCollection',
      totalItems: push.commitCount,
      orderedItems: [],
    },
  }));

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
