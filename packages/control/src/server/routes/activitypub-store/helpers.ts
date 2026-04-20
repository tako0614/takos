import type {
  StoreRecord,
  StoreRepositoryRecord,
} from "./activitypub-queries.ts";

const AP_CONTENT_TYPE = "application/activity+json; charset=utf-8";
const JSON_LD_CONTENT_TYPE = "application/ld+json; charset=utf-8";
const JRD_CONTENT_TYPE = "application/jrd+json; charset=utf-8";
export const ACTIVITYSTREAMS_CONTEXT = "https://www.w3.org/ns/activitystreams";
export const AS_PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
const FORGEFED_NS = "https://forgefed.org/ns";
const TAKOS_NS = "https://takos.jp/ns#";

export function getOriginFromUrl(url: string): string {
  return new URL(url).origin;
}

export function getHostFromUrl(url: string): string {
  return new URL(url).host;
}

export function parsePageNumber(page: string | undefined): number {
  const pageNumParsed = Number.parseInt(page ?? "", 10);
  return Number.isFinite(pageNumParsed) && pageNumParsed > 0
    ? pageNumParsed
    : 1;
}

export function isExpandedObjectRequest(expand: string | undefined): boolean {
  return (expand || "").toLowerCase() === "object";
}

export function takosContext(): Record<string, unknown> {
  return {
    takos: TAKOS_NS,
    Store: "takos:Store",
    inventory: { "@id": "takos:inventory", "@type": "@id" },
    stores: { "@id": "takos:stores", "@type": "@id" },
    defaultBranchRef: "takos:defaultBranchRef",
    defaultBranchHash: "takos:defaultBranchHash",
    beforeHash: "takos:beforeHash",
    afterHash: "takos:afterHash",
  };
}

export function storeActorContext(): Array<string | Record<string, unknown>> {
  return [
    ACTIVITYSTREAMS_CONTEXT,
    "https://w3id.org/security/v1",
    takosContext(),
  ];
}

export function repoActorContext(): Array<string | Record<string, unknown>> {
  return [
    ACTIVITYSTREAMS_CONTEXT,
    FORGEFED_NS,
    "https://w3id.org/security/v1",
    takosContext(),
  ];
}

export function activityContext(): Array<string | Record<string, unknown>> {
  return [
    ACTIVITYSTREAMS_CONTEXT,
    FORGEFED_NS,
    takosContext(),
  ];
}

export function activityJson(_c: unknown, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": AP_CONTENT_TYPE },
  });
}

export function jsonLd(_c: unknown, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": JSON_LD_CONTENT_TYPE },
  });
}

export function jrdJson(_c: unknown, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": JRD_CONTENT_TYPE },
  });
}

export function enc(value: string): string {
  return encodeURIComponent(value);
}

export function buildStoreActorId(origin: string, store: string): string {
  return `${origin}/ap/stores/${enc(store)}`;
}

export function buildRepoActorId(
  origin: string,
  owner: string,
  repoName: string,
): string {
  return `${origin}/ap/repos/${enc(owner)}/${enc(repoName)}`;
}

export function buildSearchServiceId(origin: string, store: string): string {
  return `${buildStoreActorId(origin, store)}/search`;
}

export function buildSearchCollectionUrl(
  origin: string,
  store: string,
): string {
  return `${buildStoreActorId(origin, store)}/search/repositories`;
}

export function buildStoreSummary(store: StoreRecord): string {
  if (store.description?.trim()) return store.description;
  return `Public repository catalog for ${store.name}`;
}

export function buildRepoActor(
  origin: string,
  repo: StoreRepositoryRecord,
  options?: {
    includeContext?: boolean;
    omitPushUri?: boolean;
    publicKeyPem?: string;
  },
): Record<string, unknown> {
  const owner = repo.ownerSlug;
  const repoActorId = buildRepoActorId(origin, owner, repo.name);
  const baseProfileUrl = `${origin}/@${enc(owner)}/${enc(repo.name)}`;

  const obj: Record<string, unknown> = {
    id: repoActorId,
    type: "Repository",
    name: repo.name,
    summary: repo.description || "",
    url: baseProfileUrl,
    // ForgeFed §3.1: Repository SHOULD point at its owning user/group via
    // attributedTo. Mastodon/Forgejo display logic depends on this.
    attributedTo: `${origin}/@${enc(owner)}`,
    published: repo.createdAt,
    updated: repo.updatedAt,
    inbox: `${repoActorId}/inbox`,
    outbox: `${repoActorId}/outbox`,
    followers: `${repoActorId}/followers`,
    cloneUri: [`${origin}/git/${enc(owner)}/${enc(repo.name)}.git`],
    stores: `${repoActorId}/stores`,
    defaultBranchRef: repo.defaultBranch
      ? `refs/heads/${repo.defaultBranch}`
      : undefined,
    defaultBranchHash: repo.defaultBranchHash ?? null,
  };

  // Repository actors must publish a publicKey so other servers can verify
  // signed delivery from this actor (signed `Push`/`Update`/`Delete`).
  // Without this, signed inbound POST verification cannot resolve the key
  // and cross-instance federation breaks. The kernel reuses
  // PLATFORM_PUBLIC_KEY for all platform-managed actors.
  if (options?.publicKeyPem) {
    obj.publicKey = {
      id: `${repoActorId}#main-key`,
      owner: repoActorId,
      publicKeyPem: options.publicKeyPem,
    };
  }

  if (!options?.omitPushUri) {
    obj.pushUri = [`${origin}/git/${enc(owner)}/${enc(repo.name)}.git`];
  }

  if (options?.includeContext !== false) {
    obj["@context"] = repoActorContext();
  }
  return obj;
}

export function buildRepoActivity(
  origin: string,
  storeSlug: string,
  repo: StoreRepositoryRecord,
): Record<string, unknown> {
  const repoActor = buildRepoActor(origin, repo, { includeContext: false });
  const isUpdate = repo.updatedAt !== repo.createdAt;
  const type = isUpdate ? "Update" : "Create";
  const timestamp = isUpdate ? repo.updatedAt : repo.createdAt;

  return {
    "@context": activityContext(),
    id: `${repoActor.id}/activities/${isUpdate ? "update" : "create"}/${
      encodeURIComponent(timestamp)
    }`,
    type,
    actor: buildStoreActorId(origin, storeSlug),
    published: timestamp,
    to: [AS_PUBLIC],
    object: repoActor,
  };
}

function buildOrderedCollection(
  collectionUrl: string,
  totalItems: number,
  first = `${collectionUrl}?page=1`,
): Record<string, unknown> {
  return {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    id: collectionUrl,
    type: "OrderedCollection",
    totalItems,
    first,
  };
}

function buildOrderedCollectionPage(
  pageId: string,
  partOf: string,
  totalItems: number,
  orderedItems: unknown[],
): Record<string, unknown> {
  return {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    id: pageId,
    type: "OrderedCollectionPage",
    partOf,
    totalItems,
    orderedItems,
  };
}

export function orderedCollectionResponse(
  c: unknown,
  collectionUrl: string,
  page: string | undefined,
  pageNum: number,
  totalItems: number,
  orderedItems: unknown[],
): Response {
  return activityJson(
    c,
    page
      ? buildOrderedCollectionPage(
        `${collectionUrl}?page=${pageNum}`,
        collectionUrl,
        totalItems,
        orderedItems,
      )
      : buildOrderedCollection(collectionUrl, totalItems),
  );
}

export function buildRepoCollectionItems(
  origin: string,
  repos: StoreRepositoryRecord[],
  expand: boolean,
): unknown[] {
  return repos.map((repo) =>
    expand
      ? buildRepoActor(origin, repo)
      : buildRepoActorId(origin, repo.ownerSlug, repo.name)
  );
}
