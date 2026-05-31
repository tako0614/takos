import type {
  ObjectStoreBinding,
  SqlDatabaseBinding,
} from "takos-api-contract/shared/types";
import {
  listCatalogItems,
  resolveCatalogAccountsInstallationsReadConfig,
} from "../../../../worker/application/services/source/explore-catalog.ts";
import type {
  CatalogResult,
  CatalogSort,
  CatalogType,
} from "../../../../worker/application/services/source/explore-types.ts";
import {
  type DefaultAppDistributionEnv,
  resolveDefaultAppDistributionForBootstrap,
} from "../../../../worker/application/services/source/default-app-distribution.ts";
import { normalizeSimpleFilter, parsePagination } from "./query.ts";

// `ExploreCatalogEnv` must be a structural superset of the env shapes its
// dependencies require so call sites can pass `env` without a cast. The
// default-app distribution resolver pulls a wide set of `TAKOS_DEFAULT_APP_*`
// keys, so we extend that shape here rather than re-listing fields.
export type ExploreCatalogEnv =
  & DefaultAppDistributionEnv
  & {
    DB: SqlDatabaseBinding;
    GIT_OBJECTS?: ObjectStoreBinding;
    ADMIN_DOMAIN?: string;
    OIDC_DISCOVERY_URL?: string;
    OIDC_ISSUER_URL?: string;
    TAKOSUMI_ACCOUNTS_INTERNAL_URL?: string;
    TAKOSUMI_ACCOUNTS_TOKEN?: string;
    TAKOSUMI_ACCOUNTS_URL?: string;
  };

export type ExploreCatalogContext = {
  spaceId?: string;
  userId?: string;
};

export const exploreCatalogRouteDeps = {
  listCatalogItems,
  resolveCatalogAccountsInstallationsReadConfig,
  resolveDefaultAppDistributionForBootstrap,
};

export class ExploreCatalogInputError extends Error {}

const EXPLORE_CATEGORIES = new Set([
  "app",
  "service",
  "library",
  "template",
  "social",
]);

export async function listExploreCatalog(
  env: ExploreCatalogEnv,
  url: string,
  context: ExploreCatalogContext = {},
): Promise<CatalogResult> {
  const query = new URL(url).searchParams;
  const filters = parseExploreFilters(query);
  validateExploreFilters(query, filters);
  parseTags(query.get("tags"));

  return await exploreCatalogRouteDeps.listCatalogItems(env.DB, {
    sort: parseCatalogSort(query.get("sort")),
    type: parseCatalogType(query.get("type")),
    ...parsePagination(query, { limit: 20, maxLimit: 50 }),
    searchQuery: query.get("q")?.trim() || "",
    ...filters,
    tagsRaw: query.get("tags") ?? undefined,
    certifiedOnly: query.get("certified_only") === "true",
    spaceId: context.spaceId,
    userId: context.userId,
    gitObjects: env.GIT_OBJECTS,
    repositoryBaseUrl: env.ADMIN_DOMAIN,
    defaultAppEntries: await exploreCatalogRouteDeps
      .resolveDefaultAppDistributionForBootstrap(env),
    accountsInstallations: exploreCatalogRouteDeps
      .resolveCatalogAccountsInstallationsReadConfig(env) ?? undefined,
  });
}

function parseCatalogSort(value: string | null): CatalogSort {
  const sort = value?.trim().toLowerCase() || "trending";
  if (
    sort === "trending" ||
    sort === "new" ||
    sort === "stars" ||
    sort === "updated" ||
    sort === "downloads"
  ) return sort;
  throw new ExploreCatalogInputError("Invalid sort");
}

function parseCatalogType(value: string | null): CatalogType {
  const type = value?.trim().toLowerCase() || "all";
  if (type === "all" || type === "repo" || type === "deployable-app") {
    return type;
  }
  throw new ExploreCatalogInputError("Invalid type");
}

function parseExploreFilters(
  query: URLSearchParams,
): {
  category?: string;
  language?: string;
  license?: string;
  since?: string;
} {
  const makeError = (message: string) => new ExploreCatalogInputError(message);
  return {
    category: normalizeSimpleFilter(query.get("category"), {
      maxLen: 32,
      pattern: /^[a-z0-9_-]+$/,
    }, makeError),
    language: normalizeSimpleFilter(query.get("language"), {
      maxLen: 64,
      pattern: /^[a-z0-9][a-z0-9+_.-]*$/,
    }, makeError),
    license: normalizeSimpleFilter(query.get("license"), {
      maxLen: 64,
      pattern: /^[a-z0-9][a-z0-9+_.-]*$/,
    }, makeError),
    since: parseSinceDateToIsoStart(query.get("since")),
  };
}

function validateExploreFilters(
  query: URLSearchParams,
  filters: ReturnType<typeof parseExploreFilters>,
): void {
  if (filters.category && !EXPLORE_CATEGORIES.has(filters.category)) {
    throw new ExploreCatalogInputError("Invalid category");
  }
  if (query.get("since") && !filters.since) {
    throw new ExploreCatalogInputError("Invalid since (expected YYYY-MM-DD)");
  }
}

function parseTags(value: string | null): string[] {
  const tags = (value || "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);
  for (const tag of tags) {
    if (tag.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/.test(tag)) {
      throw new ExploreCatalogInputError(
        "Invalid tags (expected comma-separated tag slugs)",
      );
    }
  }
  return tags;
}

function parseSinceDateToIsoStart(value: string | null): string | undefined {
  if (!value) return undefined;
  const raw = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const iso = `${raw}T00:00:00.000Z`;
  return Number.isFinite(Date.parse(iso)) ? iso : undefined;
}
