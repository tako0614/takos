/**
 * Remote Store Client — fetches Takos Store Network public REST APIs.
 *
 * The file path is kept for compatibility with existing imports while the
 * protocol is now plain JSON endpoints.
 */

type JsonObject = Record<string, unknown>;

const JSON_ACCEPT = "application/json";
const FETCH_TIMEOUT_MS = 10_000;

export interface RemoteStoreDocument {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  iconUrl: string | null;
  repositoryCount: number;
  inventoryUrl: string;
  searchUrl: string;
  feedUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RemoteRepository {
  id: string;
  name: string;
  summary: string;
  url: string;
  repositoryUrl: string;
  published: string;
  updated: string;
  owner?: string | null;
  defaultBranch?: string | null;
  defaultBranchHash?: string | null;
  cloneUrl?: string | null;
  browseUrl?: string | null;
}

export interface RemoteCollection {
  id: string;
  type: string;
  totalItems: number;
  items?: RemoteRepository[];
  /** @deprecated legacy alias used by older callers */
  orderedItems?: RemoteRepository[];
  first?: string;
  next?: string;
}

export interface RemoteActivity {
  activityId: string;
  activityType: string;
  published: string;
  object: RemoteRepository;
}

export interface RemoteFeedResult {
  id: string;
  type: string;
  totalItems: number;
  activities?: RemoteActivity[];
  first?: string;
  next?: string;
}

export interface StoreResolutionResult {
  storeUrl: string;
  domain: string;
  storeSlug: string;
}

export class RemoteStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteStoreError";
  }
}

export function assertSafeUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new RemoteStoreError("Invalid URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new RemoteStoreError("Only HTTP(S) URLs are allowed");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === "localhost") {
    throw new RemoteStoreError("Blocked request to private host");
  }

  if (!hostname.includes(".")) {
    throw new RemoteStoreError("Invalid domain");
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    const parts = hostname.split(".").map(Number);
    const isPrivate = parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254) ||
      parts[0] === 0;
    if (isPrivate) {
      throw new RemoteStoreError("Blocked request to private IP");
    }
  }

  if (hostname.startsWith("[") || hostname.includes(":")) {
    throw new RemoteStoreError("Blocked request to IPv6 address");
  }

  const blockedSuffixes = [
    ".local",
    ".internal",
    ".localhost",
    ".test",
    ".invalid",
    ".example",
  ];
  if (blockedSuffixes.some((suffix) => hostname.endsWith(suffix))) {
    throw new RemoteStoreError("Blocked request to internal domain");
  }
}

export async function storeFetch(
  url: string,
  accept = JSON_ACCEPT,
): Promise<Response> {
  assertSafeUrl(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: accept },
      signal: controller.signal,
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
        const redirectUrl = new URL(location, url).toString();
        return storeFetch(redirectUrl, accept);
      }
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resolve a Store Network identifier.
 *
 * Accepted formats:
 * - `store-slug@domain.example`
 * - `https://domain.example/api/public/stores/store-slug`
 */
export function resolveStoreIdentifier(
  identifier: string,
): StoreResolutionResult {
  const trimmed = identifier.trim();
  if (!trimmed) {
    throw new RemoteStoreError("Store identifier is required");
  }

  if (trimmed.includes("://")) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new RemoteStoreError("Invalid store URL");
    }
    if (url.protocol !== "https:") {
      throw new RemoteStoreError("Only HTTPS store URLs are allowed");
    }
    const match = url.pathname.match(/^\/api\/public\/stores\/([^/]+)$/);
    if (!match) {
      throw new RemoteStoreError("Invalid store URL format");
    }
    return {
      storeUrl: url.toString(),
      domain: url.host,
      storeSlug: decodeURIComponent(match[1]),
    };
  }

  if (trimmed.includes("@")) {
    const atIndex = trimmed.lastIndexOf("@");
    const storeSlug = trimmed.slice(0, atIndex);
    const domain = trimmed.slice(atIndex + 1);
    if (!storeSlug || !domain) {
      throw new RemoteStoreError(
        "Invalid store identifier: slug and domain must not be empty",
      );
    }
    return {
      storeUrl: `https://${domain}/api/public/stores/${
        encodeURIComponent(storeSlug)
      }`,
      domain,
      storeSlug,
    };
  }

  throw new RemoteStoreError(
    'Invalid store identifier. Use "slug@domain" or a public Store API URL.',
  );
}

export async function fetchRemoteStoreDocument(
  storeUrl: string,
): Promise<RemoteStoreDocument> {
  const response = await storeFetch(storeUrl);
  if (!response.ok) {
    throw new RemoteStoreError("Failed to fetch remote store");
  }

  const body = await response.json() as JsonObject;
  const store = isJsonObject(body.store) ? body.store : body;
  return parseStoreDocument(store, storeUrl);
}

export async function fetchRemoteRepositories(
  repositoriesUrl: string,
  options: {
    page?: number;
    limit?: number;
    offset?: number;
    expand?: boolean;
  } = {},
): Promise<RemoteCollection> {
  const url = new URL(repositoriesUrl);
  if (options.limit) url.searchParams.set("limit", String(options.limit));
  if (options.offset !== undefined) {
    url.searchParams.set("offset", String(options.offset));
  } else if (options.page && options.limit) {
    url.searchParams.set("offset", String((options.page - 1) * options.limit));
  }

  const response = await storeFetch(url.toString());
  if (!response.ok) {
    throw new RemoteStoreError(
      "Failed to fetch repositories from remote store",
    );
  }

  const body = await response.json() as JsonObject;
  return parseCollection(body, url.toString());
}

export async function searchRemoteRepositories(
  searchUrl: string,
  query: string,
  options: {
    page?: number;
    limit?: number;
    offset?: number;
    expand?: boolean;
  } = {},
): Promise<RemoteCollection> {
  const url = new URL(searchUrl);
  url.searchParams.set("q", query);
  if (options.limit) url.searchParams.set("limit", String(options.limit));
  if (options.offset !== undefined) {
    url.searchParams.set("offset", String(options.offset));
  } else if (options.page && options.limit) {
    url.searchParams.set("offset", String((options.page - 1) * options.limit));
  }

  const response = await storeFetch(url.toString());
  if (!response.ok) {
    throw new RemoteStoreError("Failed to search repositories on remote store");
  }

  const body = await response.json() as JsonObject;
  return parseCollection(body, url.toString());
}

export async function fetchRemoteFeed(
  feedUrl: string,
  options: { page?: number; limit?: number; offset?: number } = {},
): Promise<RemoteFeedResult> {
  const url = new URL(feedUrl);
  if (options.limit) url.searchParams.set("limit", String(options.limit));
  if (options.offset !== undefined) {
    url.searchParams.set("offset", String(options.offset));
  } else if (options.page && options.limit) {
    url.searchParams.set("offset", String((options.page - 1) * options.limit));
  }

  const response = await storeFetch(url.toString());
  if (!response.ok) {
    throw new RemoteStoreError("Failed to fetch feed from remote store");
  }

  const body = await response.json() as JsonObject;
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const activities = rawItems.flatMap((item): RemoteActivity[] => {
    if (!isJsonObject(item)) return [];
    return [{
      activityId: String(item.id ?? ""),
      activityType: String(item.type ?? "update"),
      published: String(item.published ?? ""),
      object: parseRepositoryObject(
        isJsonObject(item.repository) ? item.repository : {},
      ),
    }];
  });

  return {
    id: String(body.id ?? feedUrl),
    type: "StoreFeed",
    totalItems: Number(body.total ?? body.totalItems ?? activities.length),
    activities,
  };
}

function parseStoreDocument(
  store: JsonObject,
  fallbackUrl: string,
): RemoteStoreDocument {
  return {
    id: String(store.id ?? fallbackUrl),
    slug: String(store.slug ?? ""),
    name: String(store.name ?? ""),
    summary: typeof store.summary === "string" ? store.summary : null,
    iconUrl: typeof store.icon_url === "string" ? store.icon_url : null,
    repositoryCount: Number(store.repository_count ?? 0),
    inventoryUrl: String(store.inventory_url ?? `${fallbackUrl}/inventory`),
    searchUrl: String(
      store.search_url ?? `${fallbackUrl}/search/repositories`,
    ),
    feedUrl: typeof store.feed_url === "string"
      ? store.feed_url
      : `${fallbackUrl}/feed`,
    createdAt: typeof store.created_at === "string" ? store.created_at : null,
    updatedAt: typeof store.updated_at === "string" ? store.updated_at : null,
  };
}

function parseCollection(
  body: JsonObject,
  fallbackUrl: string,
): RemoteCollection {
  const rawItems = Array.isArray(body.items)
    ? body.items
    : Array.isArray(body.repositories)
    ? body.repositories
    : Array.isArray(body.orderedItems)
    ? body.orderedItems
    : [];
  const items = rawItems.map((item) =>
    parseRepositoryObject(isJsonObject(item) ? item : {})
  );
  return {
    id: String(body.id ?? fallbackUrl),
    type: "RepositoryCollection",
    totalItems: Number(body.total ?? body.totalItems ?? items.length),
    items,
    orderedItems: items,
    first: typeof body.first === "string" ? body.first : undefined,
    next: typeof body.next === "string" ? body.next : undefined,
  };
}

function parseRepositoryObject(obj: JsonObject): RemoteRepository {
  const repositoryUrl = String(obj.repository_url ?? obj.url ?? obj.id ?? "");
  const created = String(obj.created_at ?? obj.published ?? "");
  const updated = String(obj.updated_at ?? obj.updated ?? created);
  return {
    id: String(obj.id ?? repositoryUrl),
    name: String(obj.name ?? ""),
    summary: String(obj.summary ?? ""),
    url: repositoryUrl,
    repositoryUrl,
    published: created,
    updated,
    owner: typeof obj.owner === "string" ? obj.owner : null,
    defaultBranch: typeof obj.default_branch === "string"
      ? obj.default_branch
      : typeof obj.defaultBranch === "string"
      ? obj.defaultBranch
      : null,
    defaultBranchHash: typeof obj.default_branch_hash === "string"
      ? obj.default_branch_hash
      : typeof obj.defaultBranchHash === "string"
      ? obj.defaultBranchHash
      : null,
    cloneUrl: typeof obj.clone_url === "string"
      ? obj.clone_url
      : typeof obj.cloneUrl === "string"
      ? obj.cloneUrl
      : null,
    browseUrl: typeof obj.browse_url === "string"
      ? obj.browse_url
      : typeof obj.browseUrl === "string"
      ? obj.browseUrl
      : repositoryUrl,
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
