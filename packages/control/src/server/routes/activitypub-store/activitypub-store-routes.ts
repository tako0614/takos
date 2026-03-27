import { Hono, type Context } from 'hono';
import { CacheTTL, withCache } from '../../middleware/cache';
import { parseLimit, type PublicRouteEnv } from '../shared/route-auth';
import {
  findStoreBySlug,
  findStoreRepository,
  listStoreRepositories,
  searchStoreRepositories,
  type StoreRecord,
  type StoreRepositoryRecord,
} from './activitypub-queries';

const activitypubStore = new Hono<PublicRouteEnv>();

const AP_CONTENT_TYPE = 'application/activity+json; charset=utf-8';
const JSON_LD_CONTENT_TYPE = 'application/ld+json; charset=utf-8';
const JRD_CONTENT_TYPE = 'application/jrd+json; charset=utf-8';
const AS_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public';

type ActivityPubContext = Context<PublicRouteEnv>;

function getOrigin(c: ActivityPubContext): string {
  return new URL(c.req.url).origin;
}

function getHost(c: ActivityPubContext): string {
  return new URL(c.req.url).host;
}

function localGitContext(origin: string): Record<string, string> {
  return {
    tkg: `${origin}/ns/takos-git#`,
    GitRepository: 'tkg:GitRepository',
    SearchService: 'tkg:SearchService',
  };
}

function actorContext(origin: string): Array<string | Record<string, string>> {
  return [
    'https://www.w3.org/ns/activitystreams',
    'https://w3id.org/security/v1',
    localGitContext(origin),
  ];
}

function objectContext(origin: string): Array<string | Record<string, string>> {
  return [
    'https://www.w3.org/ns/activitystreams',
    localGitContext(origin),
  ];
}

function activityJson(_c: ActivityPubContext, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': AP_CONTENT_TYPE,
    },
  });
}

function jsonLd(_c: ActivityPubContext, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': JSON_LD_CONTENT_TYPE,
    },
  });
}

function jrdJson(_c: ActivityPubContext, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': JRD_CONTENT_TYPE,
    },
  });
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value);
}

function buildStoreActorId(origin: string, store: string): string {
  return `${origin}/ap/stores/${encodePathPart(store)}`;
}

function buildSearchServiceId(origin: string, store: string): string {
  return `${buildStoreActorId(origin, store)}/search`;
}

function buildRepoObjectId(origin: string, store: string, owner: string, repoName: string): string {
  return `${buildStoreActorId(origin, store)}/repositories/${encodePathPart(owner)}/${encodePathPart(repoName)}`;
}

function buildStoreSummary(store: StoreRecord): string {
  const summary = store.description;
  if (summary && summary.trim().length > 0) {
    return summary;
  }
  return `Public repository catalog for ${store.name}`;
}

function buildSearchCollectionUrl(origin: string, store: string): string {
  return `${buildStoreActorId(origin, store)}/search/repositories`;
}

function buildRepoObject(origin: string, store: string, repo: StoreRepositoryRecord): Record<string, unknown> {
  const owner = repo.ownerSlug || store;
  const encodedOwner = encodePathPart(owner);
  const encodedRepo = encodePathPart(repo.name);
  const repoObjectId = buildRepoObjectId(origin, store, owner, repo.name);
  const baseProfileUrl = `${origin}/@${encodedOwner}/${encodedRepo}`;

  return {
    '@context': objectContext(origin),
    id: repoObjectId,
    type: ['Document', 'tkg:GitRepository'],
    name: repo.name,
    summary: repo.description || '',
    url: baseProfileUrl,
    published: repo.createdAt,
    updated: repo.updatedAt,
    attributedTo: buildStoreActorId(origin, store),
    'tkg:owner': owner,
    'tkg:visibility': repo.visibility,
    'tkg:defaultBranch': repo.defaultBranch,
    'tkg:cloneUrl': `${origin}/git/${encodedOwner}/${encodedRepo}.git`,
    'tkg:browseUrl': baseProfileUrl,
    'tkg:branchesEndpoint': `${baseProfileUrl}/branches`,
    'tkg:commitsEndpoint': `${baseProfileUrl}/commits`,
    'tkg:treeUrlTemplate': `${baseProfileUrl}/tree/{ref}/{+path}`,
    'tkg:blobUrlTemplate': `${baseProfileUrl}/blob/{ref}/{+path}`,
    'tkg:refsEndpoint': `${origin}/git/${encodedOwner}/${encodedRepo}.git/info/refs?service=git-upload-pack`,
  };
}

function buildActivityId(repoObjectId: string, kind: 'create' | 'update', timestamp: string): string {
  return `${repoObjectId}/activities/${kind}/${encodeURIComponent(timestamp)}`;
}

function buildRepoActivity(origin: string, store: string, repo: StoreRepositoryRecord): Record<string, unknown> {
  const repoObject = buildRepoObject(origin, store, repo);
  const isUpdate = repo.updatedAt !== repo.createdAt;
  const type = isUpdate ? 'Update' : 'Create';
  const timestamp = isUpdate ? repo.updatedAt : repo.createdAt;

  return {
    '@context': objectContext(origin),
    id: buildActivityId(String(repoObject.id), isUpdate ? 'update' : 'create', timestamp),
    type,
    actor: buildStoreActorId(origin, store),
    published: timestamp,
    to: [AS_PUBLIC],
    object: repoObject,
  };
}

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

  let store: string | null = null;
  let domain: string | null = null;

  if (resource.startsWith('acct:')) {
    const acct = resource.slice(5);
    const atIndex = acct.lastIndexOf('@');
    if (atIndex > 0) {
      store = acct.slice(0, atIndex);
      domain = acct.slice(atIndex + 1);
    }
  } else if (resource.startsWith('http://') || resource.startsWith('https://')) {
    try {
      const url = new URL(resource);
      domain = url.host;
      const match = url.pathname.match(/^\/ap\/stores\/([^/]+)$/);
      if (match) {
        store = decodeURIComponent(match[1]);
      }
    } catch {
      // URL constructor throws on malformed resource URIs
      return c.json({ error: 'Invalid resource format' }, 400);
    }
  } else {
    return c.json({ error: 'Invalid resource format' }, 400);
  }

  if (!store || !domain) {
    return c.json({ error: 'Invalid resource format' }, 400);
  }

  if (domain !== requestHost) {
    return c.json({ error: 'Actor not found' }, 404);
  }

  const storeRecord = await findStoreBySlug(c.env, store);
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

activitypubStore.get('/ns/takos-git', withCache({
  ttl: CacheTTL.PUBLIC_CONTENT,
  includeQueryParams: false,
}), async (c) => {
  const origin = getOrigin(c);
  return jsonLd(c, {
    '@context': {
      tkg: `${origin}/ns/takos-git#`,
      GitRepository: 'tkg:GitRepository',
      repositories: { '@id': 'tkg:repositories', '@type': '@id' },
      search: { '@id': 'tkg:search', '@type': '@id' },
      repositorySearch: { '@id': 'tkg:repositorySearch', '@type': '@id' },
      distributionMode: 'tkg:distributionMode',
      query: 'tkg:query',
      owner: 'tkg:owner',
      visibility: 'tkg:visibility',
      defaultBranch: 'tkg:defaultBranch',
      cloneUrl: { '@id': 'tkg:cloneUrl', '@type': '@id' },
      browseUrl: { '@id': 'tkg:browseUrl', '@type': '@id' },
      branchesEndpoint: { '@id': 'tkg:branchesEndpoint', '@type': '@id' },
      commitsEndpoint: { '@id': 'tkg:commitsEndpoint', '@type': '@id' },
      treeUrlTemplate: 'tkg:treeUrlTemplate',
      blobUrlTemplate: 'tkg:blobUrlTemplate',
      refsEndpoint: { '@id': 'tkg:refsEndpoint', '@type': '@id' },
    },
  });
});

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
  const searchServiceId = buildSearchServiceId(origin, storeRecord.slug);

  return activityJson(c, {
    '@context': actorContext(origin),
    id: actorId,
    type: 'Group',
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
    'tkg:repositories': `${actorId}/repositories`,
    'tkg:search': searchServiceId,
    'tkg:repositorySearch': buildSearchCollectionUrl(origin, storeRecord.slug),
    'tkg:distributionMode': 'pull-only',
  });
});

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
    '@context': objectContext(origin),
    id: searchServiceId,
    type: ['Service', 'tkg:SearchService'],
    attributedTo: actorId,
    name: `${storeRecord.name} Search`,
    summary: `Search endpoints for the ${storeRecord.slug} store catalog`,
    'tkg:repositorySearch': buildSearchCollectionUrl(origin, storeRecord.slug),
  });
});

activitypubStore.post('/ap/stores/:store/inbox', async (c) => {
  const store = c.req.param('store');
  const storeRecord = await findStoreBySlug(c.env, store);
  if (!storeRecord) {
    return c.json({ error: 'Store not found' }, 404);
  }

  return c.json({
    error: 'not_implemented',
    message: 'Store inbox is not implemented. Use outbox polling for updates.',
  }, 501);
});

activitypubStore.get('/ap/stores/:store/followers', withCache({
  ttl: CacheTTL.PUBLIC_LISTING,
  queryParamsToInclude: ['page'],
}), async (c) => {
  const store = c.req.param('store');
  const storeRecord = await findStoreBySlug(c.env, store);
  if (!storeRecord) {
    return c.json({ error: 'Store not found' }, 404);
  }

  const actorId = buildStoreActorId(getOrigin(c), storeRecord.slug);
  return orderedCollectionResponse(c, `${actorId}/followers`, c.req.query('page'), 1, 0, []);
});

activitypubStore.get('/ap/stores/:store/repositories', withCache({
  ttl: CacheTTL.PUBLIC_LISTING,
  queryParamsToInclude: ['page', 'limit', 'expand'],
}), async (c) => {
  const store = c.req.param('store');
  const storeRecord = await findStoreBySlug(c.env, store);
  if (!storeRecord) {
    return c.json({ error: 'Store not found' }, 404);
  }

  const origin = getOrigin(c);
  const collectionUrl = `${buildStoreActorId(origin, storeRecord.slug)}/repositories`;
  const page = c.req.query('page');
  const pageNum = parseLimit(page, 1, 100000);
  const limit = parseLimit(c.req.query('limit'), 20, 100);
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
      ? buildRepoObject(origin, storeRecord.slug, repo)
      : buildRepoObjectId(origin, storeRecord.slug, repo.ownerSlug, repo.name)
  ));

  return orderedCollectionResponse(c, collectionUrl, page, pageNum, result.total, orderedItems);
});

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
  const pageNum = parseLimit(page, 1, 100000);
  const limit = parseLimit(c.req.query('limit'), 20, 100);
  const expand = (c.req.query('expand') || '').toLowerCase() === 'object';

  if (!page) {
    const result = await searchStoreRepositories(c.env, storeRecord.slug, query, {
      limit: 1,
      offset: 0,
    });

    return activityJson(c, {
      '@context': objectContext(origin),
      id: `${collectionUrl}?q=${encodeURIComponent(query)}`,
      type: 'OrderedCollection',
      totalItems: result.total,
      first: `${collectionUrl}?q=${encodeURIComponent(query)}&page=1`,
      'tkg:query': query,
    });
  }

  const result = await searchStoreRepositories(c.env, storeRecord.slug, query, {
    limit,
    offset: (pageNum - 1) * limit,
  });

  const orderedItems = result.items.map((repo) => (
    expand
      ? buildRepoObject(origin, storeRecord.slug, repo)
      : buildRepoObjectId(origin, storeRecord.slug, repo.ownerSlug, repo.name)
  ));

  return activityJson(c, {
    '@context': objectContext(origin),
    id: `${collectionUrl}?q=${encodeURIComponent(query)}&page=${pageNum}`,
    type: 'OrderedCollectionPage',
    partOf: `${collectionUrl}?q=${encodeURIComponent(query)}`,
    totalItems: result.total,
    'tkg:query': query,
    orderedItems,
  });
});

activitypubStore.get('/ap/stores/:store/repositories/:owner/:repoName', withCache({
  ttl: CacheTTL.PUBLIC_CONTENT,
  includeQueryParams: false,
}), async (c) => {
  const store = c.req.param('store');
  const owner = c.req.param('owner');
  const repoName = c.req.param('repoName');

  const repo = await findStoreRepository(c.env, store, owner, repoName);
  if (!repo) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  return activityJson(c, buildRepoObject(getOrigin(c), store, repo));
});

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
  const collectionUrl = `${buildStoreActorId(origin, storeRecord.slug)}/outbox`;
  const page = c.req.query('page');
  const pageNum = parseLimit(page, 1, 100000);
  const limit = parseLimit(c.req.query('limit'), 20, 100);

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

export default activitypubStore;
