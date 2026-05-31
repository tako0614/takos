import type {
  ObjectStoreBinding,
  SqlDatabaseBinding,
} from "takos-api-contract/shared/types";
import {
  type ExplorePackageLatestDto,
  type ExplorePackageReviewsResult,
  type ExplorePackageVersionDto,
  listExplorePackageVersions,
  loadExplorePackageReviews,
  loadLatestExplorePackage,
  searchPackages,
  suggestPackages,
} from "../../../../worker/application/services/source/explore-packages.ts";
import type {
  SearchPackagesParams,
  SearchPackagesResult,
  SuggestPackageDto,
  SuggestPackagesParams,
} from "../../../../worker/application/services/source/explore-package-types.ts";
import { normalizeSimpleFilter, parsePagination } from "./query.ts";

export const explorePackageRouteDeps = {
  listExplorePackageVersions,
  loadExplorePackageReviews,
  loadLatestExplorePackage,
  searchPackages,
  suggestPackages,
};

export class ExplorePackageInputError extends Error {}

export class ExplorePackageNotFoundError extends Error {}

export type ExplorePackageEnv = {
  DB: SqlDatabaseBinding;
  GIT_OBJECTS?: ObjectStoreBinding;
  ADMIN_DOMAIN?: string;
};

const EXPLORE_CATEGORIES = new Set([
  "app",
  "service",
  "library",
  "template",
  "social",
]);

export async function listExplorePackages(
  db: SqlDatabaseBinding,
  url: string,
): Promise<SearchPackagesResult> {
  return await explorePackageRouteDeps.searchPackages(
    db,
    parseSearchPackagesParams(new URL(url).searchParams),
  );
}

export async function suggestExplorePackages(
  db: SqlDatabaseBinding,
  url: string,
): Promise<{ packages: SuggestPackageDto[] }> {
  const params = parseSuggestPackagesParams(new URL(url).searchParams);
  if (!params.query) return { packages: [] };
  return {
    packages: await explorePackageRouteDeps.suggestPackages(db, params),
  };
}

export async function readLatestExplorePackage(
  env: ExplorePackageEnv,
  username: string,
  repoName: string,
): Promise<{ package: ExplorePackageLatestDto }> {
  const result = await explorePackageRouteDeps.loadLatestExplorePackage(
    env.DB,
    {
      username,
      repoName,
      gitObjects: env.GIT_OBJECTS,
      repositoryBaseUrl: env.ADMIN_DOMAIN,
    },
  );
  if (!result.ok) {
    throw new ExplorePackageNotFoundError(`${result.resource} not found`);
  }
  return { package: result.package };
}

export async function readExplorePackageVersions(
  env: ExplorePackageEnv,
  username: string,
  repoName: string,
): Promise<{ versions: ExplorePackageVersionDto[] }> {
  const result = await explorePackageRouteDeps.listExplorePackageVersions(
    env.DB,
    {
      username,
      repoName,
      gitObjects: env.GIT_OBJECTS,
      repositoryBaseUrl: env.ADMIN_DOMAIN,
    },
  );
  if (!result.ok) {
    throw new ExplorePackageNotFoundError(`${result.resource} not found`);
  }
  return { versions: result.versions };
}

export async function readExplorePackageReviews(
  db: SqlDatabaseBinding,
  repoId: string,
): Promise<ExplorePackageReviewsResult> {
  const result = await explorePackageRouteDeps.loadExplorePackageReviews(
    db,
    repoId,
  );
  if (!result.ok) {
    throw new ExplorePackageNotFoundError(`${result.resource} not found`);
  }
  return result.body;
}

function parseSearchPackagesParams(
  query: URLSearchParams,
): SearchPackagesParams {
  const category = parseCategory(query.get("category"));
  const tags = parseTags(query.get("tags"));
  return {
    searchQuery: query.get("q")?.trim() || "",
    sortParamRaw: query.get("sort")?.trim().toLowerCase() || "popular",
    ...parsePagination(query, { limit: 20, maxLimit: 100 }),
    category,
    tags,
    certifiedOnly: query.get("certified_only") === "true",
  };
}

function parseSuggestPackagesParams(
  query: URLSearchParams,
): SuggestPackagesParams {
  return {
    query: query.get("q")?.trim() || "",
    limit: parsePagination(query, { limit: 10, maxLimit: 20 }).limit,
    category: parseCategory(query.get("category")),
    tags: parseTags(query.get("tags")),
  };
}

function parseCategory(value: string | null): string | undefined {
  const category = normalizeSimpleFilter(value, {
    maxLen: 32,
    pattern: /^[a-z0-9_-]+$/,
  }, (message) => new ExplorePackageInputError(message));
  if (!category) return undefined;
  if (!EXPLORE_CATEGORIES.has(category)) {
    throw new ExplorePackageInputError("Invalid category");
  }
  return category;
}

function parseTags(value: string | null): string[] {
  const tags = (value || "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);
  for (const tag of tags) {
    if (tag.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/.test(tag)) {
      throw new ExplorePackageInputError(
        "Invalid tags (expected comma-separated tag slugs)",
      );
    }
  }
  return tags;
}
