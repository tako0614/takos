import type { Env } from "../../../shared/types/index.ts";

const DEFAULT_TCS_STORE_ORIGINS = ["https://store.takosumi.com"] as const;
const MAX_STORE_ORIGINS = 4;
const MAX_LISTINGS_PER_STORE = 100;
const MAX_RESPONSE_BYTES = 256 * 1024;
const STORE_TIMEOUT_MS = 2_500;
const STORE_READ_ATTEMPTS = 2;

export interface TcsStoreListing {
  readonly id: string;
  readonly scope: string;
  readonly slug: string;
  readonly source: { readonly git: string };
  readonly suggestedName: string;
  readonly name: { readonly ja: string; readonly en: string };
  readonly description: { readonly ja: string; readonly en: string };
  readonly badge: { readonly ja: string; readonly en: string };
  readonly iconUrl?: string;
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly badges?: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The catalog that supplied presentation metadata, never install authority. */
  readonly storeOrigin: string;
}

export interface TcsStoreDiscoveryResult {
  readonly items: readonly TcsStoreListing[];
  readonly warnings: readonly string[];
}

export interface TcsStoreDiscoveryOptions {
  readonly query?: string;
  readonly category?: string;
  readonly limit: number;
  readonly certifiedOnly?: boolean;
}

type CapsuleStoreEnv = Pick<Env, "TAKOS_CAPSULE_STORE_URLS">;

export async function listTcsStoreListings(
  env: CapsuleStoreEnv,
  options: TcsStoreDiscoveryOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<TcsStoreDiscoveryResult> {
  // TCS curation badges are server-local and are not a portable trust claim.
  if (options.certifiedOnly === true) return { items: [], warnings: [] };
  const origins = parseStoreOrigins(env.TAKOS_CAPSULE_STORE_URLS);
  const query = options.query?.trim().toLowerCase();
  const category = options.category?.trim().toLowerCase();
  const settled = await Promise.all(
    origins.map(async (origin) => {
      try {
        return {
          origin,
          items: await readStorePageWithRetry(origin, fetchImpl),
        } as const;
      } catch {
        return { origin, items: undefined } as const;
      }
    }),
  );

  const warnings: string[] = [];
  const bySource = new Map<string, TcsStoreListing>();
  for (const result of settled) {
    if (!result.items) {
      warnings.push(`capsule store unavailable: ${result.origin}`);
      continue;
    }
    for (const item of result.items) {
      if (category && item.category?.toLowerCase() !== category) continue;
      if (query && !listingMatchesQuery(item, query)) continue;
      const sourceKey = canonicalGitDiscoveryKey(item.source.git);
      if (!sourceKey || bySource.has(sourceKey)) continue;
      bySource.set(sourceKey, item);
      if (bySource.size >= options.limit) break;
    }
    if (bySource.size >= options.limit) break;
  }
  return { items: [...bySource.values()], warnings };
}

async function readStorePageWithRetry(
  origin: string,
  fetchImpl: typeof fetch,
): Promise<readonly TcsStoreListing[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < STORE_READ_ATTEMPTS; attempt += 1) {
    try {
      return await readStorePage(origin, fetchImpl);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function parseStoreOrigins(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TCS_STORE_ORIGINS;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("TAKOS_CAPSULE_STORE_URLS must be a JSON array");
  }
  if (!Array.isArray(value) || value.length > MAX_STORE_ORIGINS) {
    throw new Error(
      `TAKOS_CAPSULE_STORE_URLS must contain at most ${MAX_STORE_ORIGINS} origins`,
    );
  }
  const origins = value.map(normalizeStoreOrigin);
  if (new Set(origins).size !== origins.length) {
    throw new Error("TAKOS_CAPSULE_STORE_URLS contains duplicate origins");
  }
  return origins;
}

function normalizeStoreOrigin(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new Error("capsule store origin must be a bounded HTTPS URL");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("capsule store origin must be a valid HTTPS URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("capsule store origin must be a credential-free HTTPS URL");
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.toString().replace(/\/$/u, "");
}

async function readStorePage(
  origin: string,
  fetchImpl: typeof fetch,
): Promise<readonly TcsStoreListing[]> {
  const url = new URL(`${origin}/tcs/v2/listings`);
  url.searchParams.set("limit", String(MAX_LISTINGS_PER_STORE));
  url.searchParams.set("sort", "updated");
  url.searchParams.set("locale", "en");
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`TCS read failed with ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("TCS response exceeds the byte limit");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("TCS response exceeds the byte limit");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("TCS response is not JSON");
  }
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("TCS response has an invalid page envelope");
  }
  if (value.items.length > MAX_LISTINGS_PER_STORE) {
    throw new Error("TCS response exceeds the listing limit");
  }
  return value.items.map((item) => parseListing(item, origin));
}

function parseListing(value: unknown, storeOrigin: string): TcsStoreListing {
  if (!isRecord(value) || !isRecord(value.source)) {
    throw new Error("TCS listing is not an object");
  }
  const id = boundedString(value.id, 256);
  const scope = boundedString(value.scope, 128);
  const slug = boundedString(value.slug, 128);
  const suggestedName = boundedString(value.suggestedName, 128);
  const git = canonicalGitDiscoveryKey(value.source.git);
  const name = localizedText(value.name);
  const description = localizedText(value.description);
  const badge = localizedText(value.badge);
  const createdAt = boundedString(value.createdAt, 64);
  const updatedAt = boundedString(value.updatedAt, 64);
  if (
    !id ||
    !scope ||
    !slug ||
    !suggestedName ||
    !git ||
    !name ||
    !description ||
    !badge ||
    !createdAt ||
    !updatedAt
  ) {
    throw new Error("TCS listing has invalid required fields");
  }
  const category = optionalBoundedString(value.category, 128);
  const iconUrl = optionalHttpsUrl(value.iconUrl);
  const tags = optionalStringArray(value.tags, 32, 64);
  const badges = optionalStringArray(value.badges, 16, 64);
  return {
    id,
    scope,
    slug,
    source: { git },
    suggestedName,
    name,
    description,
    badge,
    ...(iconUrl ? { iconUrl } : {}),
    ...(category ? { category } : {}),
    ...(tags ? { tags } : {}),
    ...(badges ? { badges } : {}),
    createdAt,
    updatedAt,
    storeOrigin,
  };
}

function listingMatchesQuery(item: TcsStoreListing, query: string): boolean {
  return [
    item.scope,
    item.slug,
    item.suggestedName,
    item.name.ja,
    item.name.en,
    item.description.ja,
    item.description.en,
    item.source.git,
    ...(item.tags ?? []),
  ].some((candidate) => candidate.toLowerCase().includes(query));
}

export function canonicalGitDiscoveryKey(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2_048) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return undefined;
  }
  const path = url.pathname.replace(/\/+$/u, "").replace(/\.git$/iu, "");
  if (!path || path === "/") return undefined;
  url.pathname = path;
  return url.toString().replace(/\/$/u, "");
}

function localizedText(
  value: unknown,
): { readonly ja: string; readonly en: string } | undefined {
  if (!isRecord(value)) return undefined;
  const ja = boundedString(value.ja, 512);
  const en = boundedString(value.en, 512);
  return ja && en ? { ja, en } : undefined;
}

function optionalHttpsUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const normalized = canonicalGitDiscoveryKey(value);
  if (normalized) return normalized;
  if (typeof value !== "string" || value.length > 2_048) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function optionalStringArray(
  value: unknown,
  maxItems: number,
  maxLength: number,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) return undefined;
  const items = value.map((item) => boundedString(item, maxLength));
  return items.every((item): item is string => item !== undefined)
    ? items
    : undefined;
}

function optionalBoundedString(
  value: unknown,
  maxLength: number,
): string | undefined {
  return value === undefined ? undefined : boundedString(value, maxLength);
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f]/u.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
