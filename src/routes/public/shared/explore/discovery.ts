import type { SqlDatabaseBinding } from "takos-api-contract/shared/types";
import {
  accounts,
  getDb,
  repositories,
  repoStars,
} from "../../../../worker/infra/db/index.ts";
import {
  listExploreRepos as listExploreReposService,
  listNewRepos,
  listRecentRepos,
  listTrendingRepos,
} from "../../../../worker/application/services/source/explore.ts";
import type { ExploreReposResult } from "../../../../worker/application/services/source/explore-types.ts";
import { checkRepoAccess } from "../../../../worker/application/services/source/repos.ts";
import {
  normalizeSimpleFilter,
  type Pagination,
  parsePagination as parseSharedPagination,
} from "./query.ts";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  like,
  ne,
  or,
  sql,
} from "drizzle-orm";

export type ExploreDiscoveryEnv = {
  DB: SqlDatabaseBinding;
};

export type ExploreUserListResult = {
  users: Array<{
    username: string;
    name: string;
    avatar_url: string | null;
    public_repo_count: number;
  }>;
  has_more: boolean;
};

export type ExploreUserDetailResult = {
  user: {
    username: string;
    name: string;
    avatar_url: string | null;
    bio: string | null;
  };
  repositories: Array<{
    id: string;
    name: string;
    description: string | null;
    visibility: string;
    stars: number;
    forks: number;
    created_at: string | Date;
    updated_at: string | Date;
    space: {
      slug: string;
      name: string | null;
    };
    owner: {
      username: string;
      name: string;
      avatar_url: string | null;
    };
    is_starred: boolean;
  }>;
};

export type ExploreRepoDetailResult = {
  repository: {
    id: string;
    name: string;
    description: string | null;
    visibility: string;
    default_branch: string;
    stars: number;
    forks: number;
    created_at: string | Date;
    updated_at: string | Date;
  };
  space: {
    id: string;
    name: string | null;
  };
  owner: {
    id: string;
    name: string | null;
    username: string;
    avatar_url: string | null;
  };
  is_starred: boolean;
};

type ExploreFilters = {
  category?: string;
  language?: string;
  license?: string;
  since?: string;
};

type RepoByNameLookup = {
  id: string;
  name: string;
  description: string | null;
  visibility: string;
  default_branch: string;
  stars: number;
  forks: number;
  created_at: string;
  updated_at: string;
  space_id: string;
  workspace_name: string;
  owner_id: string;
  owner_name: string;
  owner_username: string;
  owner_avatar_url: string | null;
};

export const exploreDiscoveryRouteDeps = {
  checkRepoAccess,
  listExploreRepos: listExploreReposService,
  listNewRepos,
  listRecentRepos,
  listTrendingRepos,
  queryExploreRepoById,
  queryExploreRepoByName,
  queryExploreUser,
  queryExploreUsers,
};

export class ExploreDiscoveryInputError extends Error {}

export class ExploreDiscoveryNotFoundError extends Error {}

const EXPLORE_CATEGORIES = new Set([
  "app",
  "service",
  "library",
  "template",
  "social",
]);

export async function listExploreRepoSearch(
  db: SqlDatabaseBinding,
  url: string,
  userId?: string,
): Promise<ExploreReposResult> {
  const query = new URL(url).searchParams;
  const filters = parseExploreFilters(query);
  validateExploreFilters(query, filters);
  return await exploreDiscoveryRouteDeps.listExploreRepos(db, {
    sort: query.get("sort") || "stars",
    order: query.get("order") || "desc",
    ...parsePagination(query),
    searchQuery: query.get("q")?.trim() || "",
    ...filters,
    userId,
  });
}

export async function listExploreRepoTrend(
  db: SqlDatabaseBinding,
  url: string,
  userId?: string,
): Promise<ExploreReposResult> {
  const query = new URL(url).searchParams;
  const filters = parseExploreFilters(query);
  validateExploreFilters(query, filters);
  return await exploreDiscoveryRouteDeps.listTrendingRepos(db, {
    ...parsePagination(query),
    ...filters,
    userId,
  });
}

export async function listExploreRepoNew(
  db: SqlDatabaseBinding,
  url: string,
  userId?: string,
): Promise<ExploreReposResult> {
  const query = new URL(url).searchParams;
  const filters = parseExploreFilters(query);
  validateExploreFilters(query, filters);
  return await exploreDiscoveryRouteDeps.listNewRepos(db, {
    ...parsePagination(query),
    ...filters,
    userId,
  });
}

export async function listExploreRepoRecent(
  db: SqlDatabaseBinding,
  url: string,
  userId?: string,
): Promise<ExploreReposResult> {
  const query = new URL(url).searchParams;
  const filters = parseExploreFilters(query);
  validateExploreFilters(query, filters);
  return await exploreDiscoveryRouteDeps.listRecentRepos(db, {
    ...parsePagination(query),
    ...filters,
    userId,
  });
}

export async function listExploreUsers(
  db: SqlDatabaseBinding,
  url: string,
): Promise<ExploreUserListResult> {
  return await exploreDiscoveryRouteDeps.queryExploreUsers(
    db,
    new URL(url).searchParams,
  );
}

export async function readExploreUser(
  db: SqlDatabaseBinding,
  username: string,
  userId?: string,
): Promise<ExploreUserDetailResult> {
  const result = await exploreDiscoveryRouteDeps.queryExploreUser(
    db,
    username,
    userId,
  );
  if (!result) throw new ExploreDiscoveryNotFoundError("User not found");
  return result;
}

export async function readExploreRepoByName(
  env: ExploreDiscoveryEnv,
  username: string,
  repoName: string,
  userId?: string,
): Promise<ExploreRepoDetailResult> {
  const result = await exploreDiscoveryRouteDeps.queryExploreRepoByName(
    env,
    username,
    repoName,
    userId,
  );
  if (!result) {
    throw new ExploreDiscoveryNotFoundError("Repository not found");
  }
  return result;
}

export async function readExploreRepoById(
  db: SqlDatabaseBinding,
  repoId: string,
  userId?: string,
): Promise<ExploreRepoDetailResult> {
  const result = await exploreDiscoveryRouteDeps.queryExploreRepoById(
    db,
    repoId,
    userId,
  );
  if (!result) {
    throw new ExploreDiscoveryNotFoundError("Repository not found");
  }
  return result;
}

async function queryExploreUsers(
  dbBinding: SqlDatabaseBinding,
  query: URLSearchParams,
): Promise<ExploreUserListResult> {
  const db = getDb(dbBinding);
  const searchQuery = query.get("q")?.trim() || "";
  const { limit, offset } = parsePagination(query);

  const conditions = [ne(accounts.slug, "")];
  if (searchQuery) {
    const searchClause = or(
      like(accounts.slug, `%${searchQuery}%`),
      like(accounts.name, `%${searchQuery}%`),
    );
    if (searchClause) conditions.push(searchClause);
  }

  const users = await db.select({
    id: accounts.id,
    slug: accounts.slug,
    name: accounts.name,
    picture: accounts.picture,
  }).from(accounts)
    .where(and(...conditions))
    .orderBy(asc(accounts.slug))
    .limit(limit + 1)
    .offset(offset)
    .all();

  const paginatedUsers = users.slice(0, limit).filter((user) => user.slug);
  const userIds = paginatedUsers.map((user) => user.id);

  const repoCounts = userIds.length > 0
    ? await db.select({
      accountId: repositories.accountId,
      count: count(),
    }).from(repositories)
      .where(
        and(
          eq(repositories.visibility, "public"),
          inArray(repositories.accountId, userIds),
        ),
      )
      .groupBy(repositories.accountId)
      .all()
    : [];
  const repoCountMap = new Map(
    repoCounts.map((row) => [row.accountId, row.count]),
  );

  return {
    users: paginatedUsers.flatMap((user) => {
      const publicRepoCount = repoCountMap.get(user.id) ?? 0;
      if (publicRepoCount <= 0) return [];
      return [{
        username: user.slug as string,
        name: user.name,
        avatar_url: user.picture,
        public_repo_count: publicRepoCount,
      }];
    }),
    has_more: users.length > limit,
  };
}

async function queryExploreUser(
  dbBinding: SqlDatabaseBinding,
  username: string,
  userId?: string,
): Promise<ExploreUserDetailResult | null> {
  const db = getDb(dbBinding);
  const normalizedUsername = username.toLowerCase();
  const user = await db.select({
    id: accounts.id,
    slug: accounts.slug,
    name: accounts.name,
    picture: accounts.picture,
    bio: accounts.bio,
  }).from(accounts).where(eq(accounts.slug, normalizedUsername)).get();

  if (!user) return null;

  const repos = await db.select({
    id: repositories.id,
    name: repositories.name,
    description: repositories.description,
    visibility: repositories.visibility,
    stars: repositories.stars,
    forks: repositories.forks,
    createdAt: repositories.createdAt,
    updatedAt: repositories.updatedAt,
    accountId: accounts.id,
    accountName: accounts.name,
    accountSlug: accounts.slug,
  }).from(repositories)
    .leftJoin(accounts, eq(repositories.accountId, accounts.id))
    .where(
      and(
        eq(repositories.visibility, "public"),
        eq(repositories.accountId, user.id),
      ),
    )
    .orderBy(desc(repositories.stars))
    .all();

  let starredRepoIds = new Set<string>();
  if (userId && repos.length > 0) {
    const stars = await db.select({ repoId: repoStars.repoId }).from(repoStars)
      .where(
        and(
          eq(repoStars.accountId, userId),
          inArray(repoStars.repoId, repos.map((repo) => repo.id)),
        ),
      ).all();
    starredRepoIds = new Set(stars.map((star) => star.repoId));
  }

  return {
    user: {
      username: user.slug,
      name: user.name,
      avatar_url: user.picture,
      bio: user.bio,
    },
    repositories: repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      description: repo.description,
      visibility: repo.visibility,
      stars: repo.stars,
      forks: repo.forks,
      created_at: repo.createdAt,
      updated_at: repo.updatedAt,
      space: {
        slug: repo.accountSlug || repo.accountId || "",
        name: repo.accountName,
      },
      owner: {
        username: user.slug,
        name: user.name,
        avatar_url: user.picture,
      },
      is_starred: starredRepoIds.has(repo.id),
    })),
  };
}

async function queryExploreRepoByName(
  env: ExploreDiscoveryEnv,
  username: string,
  repoName: string,
  userId?: string,
): Promise<ExploreRepoDetailResult | null> {
  const db = getDb(env.DB);
  const cleanUsername = username.trim().toLowerCase();
  const cleanRepoName = repoName.trim().toLowerCase();

  const rows = await db.all<RepoByNameLookup>(sql`
    SELECT
      r.id AS id,
      r.name AS name,
      r.description AS description,
      r.visibility AS visibility,
      r.default_branch AS default_branch,
      r.stars AS stars,
      r.forks AS forks,
      r.created_at AS created_at,
      r.updated_at AS updated_at,
      a.id AS space_id,
      a.name AS workspace_name,
      a.id AS owner_id,
      a.name AS owner_name,
      a.slug AS owner_username,
      a.picture AS owner_avatar_url
    FROM repositories r
    JOIN accounts a ON a.id = r.account_id
    WHERE lower(r.name) = ${cleanRepoName}
      AND lower(a.slug) = ${cleanUsername}
    LIMIT 1
  `);
  const repo = rows[0] ?? null;

  if (!repo) return null;
  if (repo.visibility !== "public") {
    if (!userId) return null;
    const repoAccess = await exploreDiscoveryRouteDeps.checkRepoAccess(
      env,
      repo.id,
      userId,
    );
    if (!repoAccess) return null;
  }

  let isStarred = false;
  if (userId) {
    const star = await db.select().from(repoStars).where(
      and(eq(repoStars.accountId, userId), eq(repoStars.repoId, repo.id)),
    ).get();
    isStarred = !!star;
  }

  return {
    repository: {
      id: repo.id,
      name: repo.name,
      description: repo.description,
      visibility: repo.visibility,
      default_branch: repo.default_branch,
      stars: repo.stars,
      forks: repo.forks,
      created_at: repo.created_at,
      updated_at: repo.updated_at,
    },
    space: {
      id: repo.space_id,
      name: repo.workspace_name,
    },
    owner: {
      id: repo.owner_id,
      name: repo.owner_name,
      username: repo.owner_username,
      avatar_url: repo.owner_avatar_url,
    },
    is_starred: isStarred,
  };
}

async function queryExploreRepoById(
  dbBinding: SqlDatabaseBinding,
  repoId: string,
  userId?: string,
): Promise<ExploreRepoDetailResult | null> {
  const db = getDb(dbBinding);
  const result = await db.select({
    id: repositories.id,
    name: repositories.name,
    description: repositories.description,
    visibility: repositories.visibility,
    defaultBranch: repositories.defaultBranch,
    stars: repositories.stars,
    forks: repositories.forks,
    createdAt: repositories.createdAt,
    updatedAt: repositories.updatedAt,
    accountId: accounts.id,
    accountSlug: accounts.slug,
    accountName: accounts.name,
    accountPicture: accounts.picture,
  }).from(repositories)
    .leftJoin(accounts, eq(repositories.accountId, accounts.id))
    .where(
      and(eq(repositories.id, repoId), eq(repositories.visibility, "public")),
    )
    .get();

  if (!result) return null;

  let isStarred = false;
  if (userId) {
    const star = await db.select().from(repoStars).where(
      and(eq(repoStars.accountId, userId), eq(repoStars.repoId, repoId)),
    ).get();
    isStarred = !!star;
  }

  return {
    repository: {
      id: result.id,
      name: result.name,
      description: result.description,
      visibility: result.visibility,
      default_branch: result.defaultBranch,
      stars: result.stars,
      forks: result.forks,
      created_at: result.createdAt,
      updated_at: result.updatedAt,
    },
    space: {
      id: result.accountId ?? "",
      name: result.accountName,
    },
    owner: {
      id: result.accountId ?? "",
      name: result.accountName,
      username: result.accountSlug || result.accountId || "",
      avatar_url: result.accountPicture,
    },
    is_starred: isStarred,
  };
}

function parseExploreFilters(query: URLSearchParams): ExploreFilters {
  const makeError = (message: string) =>
    new ExploreDiscoveryInputError(message);
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
  filters: ExploreFilters,
): void {
  if (filters.category && !EXPLORE_CATEGORIES.has(filters.category)) {
    throw new ExploreDiscoveryInputError("Invalid category");
  }
  if (query.get("since") && !filters.since) {
    throw new ExploreDiscoveryInputError(
      "Invalid since (expected YYYY-MM-DD)",
    );
  }
}

function parseSinceDateToIsoStart(value: string | null): string | undefined {
  if (!value) return undefined;
  const raw = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const iso = `${raw}T00:00:00.000Z`;
  return Number.isFinite(Date.parse(iso)) ? iso : undefined;
}

function parsePagination(query: URLSearchParams): Pagination {
  return parseSharedPagination(query, { limit: 20, maxLimit: 100 });
}
