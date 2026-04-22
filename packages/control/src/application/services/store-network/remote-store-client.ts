/**
 * Remote Store Client — fetches Takos Store Network public REST APIs.
 *
 * The file path is kept for compatibility with existing imports while the
 * protocol is now plain JSON endpoints.
 */

type JsonObject = Record<string, unknown>;

const JSON_ACCEPT = "application/json";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_STORE_REDIRECTS = 5;
const STORE_API_PATH_PATTERN = /^\/api\/public\/stores\/([^/]+)\/?$/;
const STORE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

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
  packageIcon?: string | null;
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

interface NormalizedStoreUrl extends StoreResolutionResult {
  origin: string;
  pathname: string;
}

export class RemoteStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteStoreError";
  }
}

function parseUrl(rawUrl: string, errorMessage = "Invalid URL"): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new RemoteStoreError(errorMessage);
  }

  return parsed;
}

function assertSafeParsedUrl(parsed: URL): void {
  if (parsed.protocol !== "https:") {
    throw new RemoteStoreError("Only HTTPS URLs are allowed");
  }

  if (parsed.username || parsed.password) {
    throw new RemoteStoreError("URL credentials are not allowed");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === "localhost") {
    throw new RemoteStoreError("Blocked request to private host");
  }

  if (!hostname.includes(".")) {
    throw new RemoteStoreError("Invalid domain");
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    throw new RemoteStoreError("Blocked request to IP address");
  }

  if (hostname.startsWith("[") || hostname.includes(":")) {
    throw new RemoteStoreError("Blocked request to IPv6 address");
  }

  if (
    hostname.length > 253 || hostname.endsWith(".") ||
    hostname.split(".").some((label) =>
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
    )
  ) {
    throw new RemoteStoreError("Invalid domain");
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

export function assertSafeUrl(rawUrl: string): void {
  assertSafeParsedUrl(parseUrl(rawUrl));
}

function validateStoreSlug(storeSlug: string): void {
  if (!STORE_SLUG_PATTERN.test(storeSlug)) {
    throw new RemoteStoreError("Invalid store slug");
  }
}

function normalizeStoreApiUrl(rawUrl: string): NormalizedStoreUrl {
  const parsed = parseUrl(rawUrl, "Invalid store URL");
  assertSafeParsedUrl(parsed);

  if (parsed.search || parsed.hash) {
    throw new RemoteStoreError(
      "Store URL must not include query or fragment",
    );
  }

  const match = parsed.pathname.match(STORE_API_PATH_PATTERN);
  if (!match) {
    throw new RemoteStoreError("Invalid store URL format");
  }

  let storeSlug: string;
  try {
    storeSlug = decodeURIComponent(match[1]);
  } catch {
    throw new RemoteStoreError("Invalid store slug");
  }
  validateStoreSlug(storeSlug);

  if (match[1] !== encodeURIComponent(storeSlug)) {
    throw new RemoteStoreError("Invalid store URL format");
  }

  const normalized = new URL(parsed.toString());
  normalized.pathname = `/api/public/stores/${encodeURIComponent(storeSlug)}`;
  normalized.search = "";
  normalized.hash = "";

  return {
    storeUrl: normalized.toString(),
    domain: normalized.host,
    storeSlug,
    origin: normalized.origin,
    pathname: normalized.pathname,
  };
}

function normalizeIdentifierDomain(rawDomain: string): string {
  const domain = rawDomain.trim().toLowerCase();
  if (!domain) {
    throw new RemoteStoreError(
      "Invalid store identifier: slug and domain must not be empty",
    );
  }
  if (
    domain.includes("://") || domain.includes("/") ||
    domain.includes("\\") || domain.includes("?") ||
    domain.includes("#") || domain.includes("@") ||
    domain.includes(":")
  ) {
    throw new RemoteStoreError("Invalid store domain");
  }

  const parsed = parseUrl(`https://${domain}/`, "Invalid store domain");
  if (
    parsed.pathname !== "/" || parsed.search || parsed.hash ||
    parsed.username || parsed.password
  ) {
    throw new RemoteStoreError("Invalid store domain");
  }
  assertSafeParsedUrl(parsed);
  return parsed.host;
}

function normalizeStoreDocumentId(
  rawId: unknown,
  expected: NormalizedStoreUrl,
): string {
  if (rawId === undefined || rawId === null || rawId === "") {
    return expected.storeUrl;
  }
  if (typeof rawId !== "string") {
    throw new RemoteStoreError("Invalid remote store id");
  }

  const actual = normalizeStoreApiUrl(rawId);
  if (actual.storeUrl !== expected.storeUrl) {
    throw new RemoteStoreError("Remote store id does not match requested URL");
  }
  return actual.storeUrl;
}

function normalizeStoreEndpointUrl(
  rawValue: unknown,
  expected: NormalizedStoreUrl,
  fieldName: string,
  suffixPath: string,
): string {
  const expectedPath = `${expected.pathname}/${suffixPath}`;
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return `${expected.origin}${expectedPath}`;
  }
  if (typeof rawValue !== "string") {
    throw new RemoteStoreError(`Invalid ${fieldName}`);
  }

  let parsed: URL;
  try {
    parsed = new URL(rawValue.trim(), expected.storeUrl);
  } catch {
    throw new RemoteStoreError(`Invalid ${fieldName}`);
  }
  assertSafeParsedUrl(parsed);

  if (parsed.origin !== expected.origin) {
    throw new RemoteStoreError(
      `${fieldName} must be same-origin with store id`,
    );
  }
  if (parsed.pathname !== expectedPath || parsed.search || parsed.hash) {
    throw new RemoteStoreError(
      `${fieldName} must point to ${expectedPath}`,
    );
  }

  return parsed.toString();
}

export async function storeFetch(
  url: string,
  accept = JSON_ACCEPT,
  redirectDepth = 0,
): Promise<Response> {
  const currentUrl = parseUrl(url);
  assertSafeParsedUrl(currentUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(currentUrl.toString(), {
      headers: { Accept: accept },
      signal: controller.signal,
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
        if (redirectDepth >= MAX_STORE_REDIRECTS) {
          throw new RemoteStoreError("Too many redirects");
        }
        const redirectUrl = new URL(location, currentUrl);
        if (redirectUrl.protocol !== "https:") {
          throw new RemoteStoreError("Redirected to non-HTTPS URL");
        }
        assertSafeParsedUrl(redirectUrl);
        if (redirectUrl.origin !== currentUrl.origin) {
          throw new RemoteStoreError("Cross-origin redirects are not allowed");
        }
        return storeFetch(redirectUrl.toString(), accept, redirectDepth + 1);
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
    const normalized = normalizeStoreApiUrl(trimmed);
    return {
      storeUrl: normalized.storeUrl,
      domain: normalized.domain,
      storeSlug: normalized.storeSlug,
    };
  }

  if (trimmed.includes("@")) {
    const parts = trimmed.split("@");
    if (parts.length !== 2) {
      throw new RemoteStoreError("Invalid store identifier");
    }
    const storeSlug = parts[0].trim();
    const domain = normalizeIdentifierDomain(parts[1]);
    if (!storeSlug || !domain) {
      throw new RemoteStoreError(
        "Invalid store identifier: slug and domain must not be empty",
      );
    }
    validateStoreSlug(storeSlug);
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
  const expected = normalizeStoreApiUrl(storeUrl);
  const response = await storeFetch(expected.storeUrl);
  if (!response.ok) {
    throw new RemoteStoreError("Failed to fetch remote store");
  }

  const body = await response.json() as JsonObject;
  const store = isJsonObject(body.store) ? body.store : body;
  return parseStoreDocument(store, expected);
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
  expected: NormalizedStoreUrl,
): RemoteStoreDocument {
  const id = normalizeStoreDocumentId(store.id, expected);
  return {
    id,
    slug: expected.storeSlug,
    name: String(store.name ?? ""),
    summary: typeof store.summary === "string" ? store.summary : null,
    iconUrl: typeof store.icon_url === "string" ? store.icon_url : null,
    repositoryCount: Number(store.repository_count ?? 0),
    inventoryUrl: normalizeStoreEndpointUrl(
      store.inventory_url,
      expected,
      "inventory_url",
      "inventory",
    ),
    searchUrl: normalizeStoreEndpointUrl(
      store.search_url,
      expected,
      "search_url",
      "search/repositories",
    ),
    feedUrl: normalizeStoreEndpointUrl(
      store.feed_url,
      expected,
      "feed_url",
      "feed",
    ),
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
    packageIcon: typeof obj.package_icon === "string"
      ? obj.package_icon
      : typeof obj.packageIcon === "string"
      ? obj.packageIcon
      : null,
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
