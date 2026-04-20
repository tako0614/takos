/**
 * Remote Store Client — fetches ActivityPub store data from remote Takos instances.
 * Handles WebFinger resolution, actor fetching, and repository browsing.
 */

/** Opaque JSON object from a remote AP endpoint. */
type JsonObject = Record<string, unknown>;

const AP_ACCEPT = "application/activity+json, application/ld+json; q=0.9";
const JRD_ACCEPT = "application/jrd+json, application/json; q=0.9";
const FETCH_TIMEOUT_MS = 10_000;

export interface RemoteStoreActor {
  id: string;
  type: string | string[];
  preferredUsername: string;
  name: string;
  summary: string;
  url: string;
  icon?: { type: string; url: string } | null;
  inbox: string;
  outbox: string;
  followers: string;
  publicKey?: {
    id: string;
    owner: string;
    publicKeyPem: string;
  } | null;
  /** inventory collection URL (new spec) */
  inventory?: string;
  search?: string;
  repositorySearch?: string;
  /** @deprecated use inventory — kept for backward compatibility with legacy remotes */
  repositories?: string;
}

export interface RemoteRepository {
  id: string;
  type: string | string[];
  name: string;
  summary: string;
  url: string;
  published: string;
  updated: string;
  attributedTo?: string;
  inbox?: string;
  outbox?: string;
  followers?: string;
  cloneUri?: string[];
  stores?: string;
  defaultBranchRef?: string;
  defaultBranchHash?: string | null;
  /** @deprecated legacy tkg: fields — kept for backward compatibility */
  owner?: string;
  visibility?: string;
  defaultBranch?: string;
  cloneUrl?: string;
  browseUrl?: string;
}

export interface RemoteCollection {
  id: string;
  type: string;
  totalItems: number;
  orderedItems?: RemoteRepository[];
  first?: string;
  next?: string;
}

/** Preserves the activity wrapper when parsing outbox items. */
export interface RemoteActivity {
  activityId: string;
  activityType: string;
  published: string;
  object: RemoteRepository;
}

export interface RemoteOutboxResult {
  id: string;
  type: string;
  totalItems: number;
  activities?: RemoteActivity[];
  first?: string;
  next?: string;
}

export interface WebFingerResult {
  actorUrl: string;
  domain: string;
  storeSlug: string;
}

/**
 * Reject URLs that target private/internal networks to prevent SSRF.
 * Applied to every outbound fetch, not just the initial identifier.
 */
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

  // Must contain at least one dot (TLD requirement)
  if (!hostname.includes(".")) {
    throw new RemoteStoreError("Invalid domain");
  }

  // Block IPv4 private ranges
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

  // Block IPv6
  if (hostname.startsWith("[") || hostname.includes(":")) {
    throw new RemoteStoreError("Blocked request to IPv6 address");
  }

  // Block common internal TLDs
  const blockedSuffixes = [
    ".local",
    ".internal",
    ".localhost",
    ".test",
    ".invalid",
    ".example",
  ];
  if (blockedSuffixes.some((s) => hostname.endsWith(s))) {
    throw new RemoteStoreError("Blocked request to internal domain");
  }
}

/**
 * Error type for remote store operations.
 * Uses a safe message that can be shown to clients without leaking internal URLs.
 */
export class RemoteStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteStoreError";
  }
}

export async function apFetch(
  url: string,
  accept = AP_ACCEPT,
): Promise<Response> {
  // Validate every outbound URL against SSRF
  assertSafeUrl(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: accept },
      signal: controller.signal,
      redirect: "manual", // Don't follow redirects — validate each hop
    });

    // If redirect, validate the target before following
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
        const redirectUrl = new URL(location, url).toString();
        return apFetch(redirectUrl, accept);
      }
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resolve a store identifier via WebFinger.
 * Accepts formats:
 *   - "store-slug@domain.example" (acct URI)
 *   - "https://domain.example/ap/stores/store-slug" (direct URL)
 */
export async function resolveStoreViaWebFinger(
  identifier: string,
): Promise<WebFingerResult> {
  let domain: string;
  let storeSlug: string;
  let webfingerUrl: string;

  if (identifier.includes("://")) {
    // Direct URL: extract domain and slug
    let url: URL;
    try {
      url = new URL(identifier);
    } catch {
      throw new RemoteStoreError("Invalid store URL");
    }
    if (url.protocol !== "https:") {
      throw new RemoteStoreError("Only HTTPS store URLs are allowed");
    }
    domain = url.host;
    const match = url.pathname.match(/^\/ap\/stores\/([^/]+)$/);
    if (match) {
      storeSlug = decodeURIComponent(match[1]);
    } else {
      throw new RemoteStoreError("Invalid store URL format");
    }
    webfingerUrl = `${url.origin}/.well-known/webfinger?resource=${
      encodeURIComponent(identifier)
    }`;
  } else if (identifier.includes("@")) {
    // acct format: store-slug@domain
    const atIndex = identifier.lastIndexOf("@");
    storeSlug = identifier.slice(0, atIndex);
    domain = identifier.slice(atIndex + 1);
    if (!storeSlug || !domain) {
      throw new RemoteStoreError(
        "Invalid store identifier: slug and domain must not be empty",
      );
    }
    webfingerUrl = `https://${domain}/.well-known/webfinger?resource=${
      encodeURIComponent(`acct:${identifier}`)
    }`;
  } else {
    throw new RemoteStoreError(
      'Invalid store identifier. Use "slug@domain" or a full URL.',
    );
  }

  // apFetch validates the URL against SSRF before fetching
  const response = await apFetch(webfingerUrl, JRD_ACCEPT);
  if (!response.ok) {
    throw new RemoteStoreError(
      "WebFinger resolution failed for the specified store",
    );
  }

  const jrd = await response.json() as {
    links?: Array<{ rel: string; type?: string; href?: string }>;
  };

  const selfLink = jrd.links?.find(
    (l) => l.rel === "self" && l.type === "application/activity+json" && l.href,
  );
  if (!selfLink?.href) {
    throw new RemoteStoreError(
      "No ActivityPub actor link found for the specified store",
    );
  }

  return {
    actorUrl: selfLink.href,
    domain,
    storeSlug,
  };
}

/**
 * Fetch an ActivityPub store actor from its URL.
 */
export async function fetchRemoteStoreActor(
  actorUrl: string,
): Promise<RemoteStoreActor> {
  const response = await apFetch(actorUrl);
  if (!response.ok) {
    throw new RemoteStoreError("Failed to fetch remote store actor");
  }

  const body = await response.json() as JsonObject;

  const icon = body.icon as { type?: string; url?: string } | null | undefined;
  const typeRaw = body.type;
  const type = Array.isArray(typeRaw)
    ? typeRaw.map((entry) => String(entry))
    : typeof typeRaw === "string"
    ? typeRaw
    : "Service";

  return {
    id: String(body.id ?? actorUrl),
    type: type ?? "Service",
    preferredUsername: String(body.preferredUsername ?? ""),
    name: String(body.name ?? ""),
    summary: String(body.summary ?? ""),
    url: String(body.url ?? actorUrl),
    icon: icon?.url ? { type: icon.type ?? "Image", url: icon.url } : null,
    inbox: String(body.inbox ?? ""),
    outbox: String(body.outbox ?? ""),
    followers: String(body.followers ?? ""),
    publicKey: body.publicKey
      ? {
        id: String((body.publicKey as JsonObject).id ?? ""),
        owner: String((body.publicKey as JsonObject).owner ?? ""),
        publicKeyPem: String((body.publicKey as JsonObject).publicKeyPem ?? ""),
      }
      : null,
    // New spec: plain field names via JSON-LD context
    inventory: extractField(body, "inventory"),
    search: extractField(body, "search"),
    repositorySearch: extractField(body, "repositorySearch"),
    // Legacy: fall back to tkg: prefixed fields for older remotes
    repositories: extractField(body, "inventory") ||
      extractTkgField(body, "repositories"),
  };
}

/**
 * Fetch repositories from a remote store.
 */
export async function fetchRemoteRepositories(
  repositoriesUrl: string,
  options: { page?: number; limit?: number; expand?: boolean } = {},
): Promise<RemoteCollection> {
  const url = new URL(repositoriesUrl);
  if (options.page) url.searchParams.set("page", String(options.page));
  if (options.limit) url.searchParams.set("limit", String(options.limit));
  if (options.expand) url.searchParams.set("expand", "object");

  const response = await apFetch(url.toString());
  if (!response.ok) {
    throw new RemoteStoreError(
      "Failed to fetch repositories from remote store",
    );
  }

  const body = await response.json() as JsonObject;
  return parseCollection(body);
}

/**
 * Fetch a canonical remote Repository actor by its ActivityPub actor URL.
 */
export async function fetchRemoteRepositoryActor(
  actorUrl: string,
): Promise<RemoteRepository> {
  const response = await apFetch(actorUrl);
  if (!response.ok) {
    throw new RemoteStoreError("Failed to fetch remote repository actor");
  }

  const body = await response.json() as JsonObject;
  return parseRepositoryObject(body);
}

/**
 * Search repositories in a remote store.
 */
export async function searchRemoteRepositories(
  searchUrl: string,
  query: string,
  options: { page?: number; limit?: number; expand?: boolean } = {},
): Promise<RemoteCollection> {
  const url = new URL(searchUrl);
  url.searchParams.set("q", query);
  if (options.page) url.searchParams.set("page", String(options.page));
  if (options.limit) url.searchParams.set("limit", String(options.limit));
  if (options.expand) url.searchParams.set("expand", "object");

  const response = await apFetch(url.toString());
  if (!response.ok) {
    throw new RemoteStoreError("Failed to search repositories on remote store");
  }

  const body = await response.json() as JsonObject;
  return parseCollection(body);
}

/**
 * Fetch the outbox of a remote store (activities).
 * Unlike fetchRemoteRepositories, this preserves the activity wrapper
 * so callers can access activityId, activityType, and published.
 */
export async function fetchRemoteOutbox(
  outboxUrl: string,
  options: { page?: number; limit?: number } = {},
): Promise<RemoteOutboxResult> {
  const url = new URL(outboxUrl);
  if (options.page) url.searchParams.set("page", String(options.page));
  if (options.limit) url.searchParams.set("limit", String(options.limit));

  const response = await apFetch(url.toString());
  if (!response.ok) {
    throw new RemoteStoreError("Failed to fetch outbox from remote store");
  }

  const body = await response.json() as JsonObject;
  return parseOutbox(body);
}

// --- Exported helpers ---

/** Extract a plain field or a JSON-LD @id wrapper. */
export function extractField(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = body[field];
  if (typeof value === "string") return value;
  if (
    Array.isArray(value) && value.length > 0 && typeof value[0] === "string"
  ) return value[0];
  if (
    typeof value === "object" && value !== null &&
    "@id" in (value as JsonObject)
  ) {
    return String((value as JsonObject)["@id"]);
  }
  return undefined;
}

/** Extract a tkg:-prefixed field (legacy format), falling back to plain field. */
export function extractTkgField(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  const tkgKey = `tkg:${field}`;
  return extractField(body, tkgKey) ?? extractField(body, field);
}

function parseCollection(body: Record<string, unknown>): RemoteCollection {
  const orderedItems = Array.isArray(body.orderedItems)
    ? body.orderedItems.map(parseRepositoryOrActivity)
    : undefined;

  return {
    id: String(body.id ?? ""),
    type: String(body.type ?? "OrderedCollection"),
    totalItems: Number(body.totalItems ?? 0),
    orderedItems,
    first: typeof body.first === "string" ? body.first : undefined,
    next: typeof body.next === "string" ? body.next : undefined,
  };
}

function parseRepositoryOrActivity(
  item: unknown,
): RemoteRepository {
  if (typeof item === "string") {
    return parseRepositoryReference(item);
  }
  if (!isJsonObject(item)) {
    return parseRepositoryObject({});
  }

  // If it's an activity (Create/Update), extract the object
  const type = String(item.type ?? "");
  if (
    type === "Create" || type === "Update" || type === "Add" ||
    type === "Remove"
  ) {
    const obj = item.object;
    if (typeof obj === "string") {
      return parseRepositoryReference(obj, String(item.published ?? ""));
    }
    if (isJsonObject(obj)) {
      return parseRepositoryObject(obj, String(item.published ?? ""));
    }
  }
  return parseRepositoryObject(item);
}

function parseRepositoryObject(
  obj: Record<string, unknown>,
  fallbackPublished?: string,
): RemoteRepository {
  // New spec: cloneUri is an array
  const cloneUriRaw = obj.cloneUri;
  const cloneUri = Array.isArray(cloneUriRaw)
    ? cloneUriRaw.filter((v): v is string => typeof v === "string")
    : undefined;

  return {
    id: String(obj.id ?? ""),
    type: obj.type as string | string[],
    name: String(obj.name ?? ""),
    summary: String(obj.summary ?? ""),
    url: String(obj.url ?? ""),
    published: String(obj.published ?? fallbackPublished ?? ""),
    updated: String(obj.updated ?? obj.published ?? fallbackPublished ?? ""),
    // New spec fields
    attributedTo: typeof obj.attributedTo === "string"
      ? obj.attributedTo
      : undefined,
    inbox: typeof obj.inbox === "string" ? obj.inbox : undefined,
    outbox: typeof obj.outbox === "string" ? obj.outbox : undefined,
    followers: typeof obj.followers === "string" ? obj.followers : undefined,
    cloneUri: cloneUri,
    stores: typeof obj.stores === "string" ? obj.stores : undefined,
    defaultBranchRef: typeof obj.defaultBranchRef === "string"
      ? obj.defaultBranchRef
      : undefined,
    defaultBranchHash: typeof obj.defaultBranchHash === "string"
      ? obj.defaultBranchHash
      : undefined,
    // Legacy tkg: fields for backward compatibility
    owner: extractTkgField(obj, "owner"),
    visibility: extractTkgField(obj, "visibility"),
    defaultBranch: extractTkgField(obj, "defaultBranch"),
    cloneUrl: extractTkgField(obj, "cloneUrl") ?? cloneUri?.[0],
    browseUrl: extractTkgField(obj, "browseUrl") ??
      (typeof obj.url === "string" ? obj.url : undefined),
  };
}

function parseOutbox(body: Record<string, unknown>): RemoteOutboxResult {
  const rawItems = Array.isArray(body.orderedItems)
    ? body.orderedItems
    : undefined;

  const activities = rawItems?.flatMap((item): RemoteActivity[] => {
    if (!isJsonObject(item)) return [];

    const activityId = String(item.id ?? "");
    const activityType = String(item.type ?? "Update");
    const published = String(item.published ?? "");

    return [{
      activityId,
      activityType,
      published,
      object: parseRepositoryOrActivity(item),
    }];
  });

  return {
    id: String(body.id ?? ""),
    type: String(body.type ?? "OrderedCollection"),
    totalItems: Number(body.totalItems ?? 0),
    activities,
    first: typeof body.first === "string" ? body.first : undefined,
    next: typeof body.next === "string" ? body.next : undefined,
  };
}

function parseRepositoryReference(
  actorUrl: string,
  fallbackPublished = "",
): RemoteRepository {
  return {
    id: actorUrl,
    type: "Repository",
    name: "",
    summary: "",
    url: actorUrl,
    published: fallbackPublished,
    updated: fallbackPublished,
    cloneUrl: undefined,
    browseUrl: actorUrl,
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
