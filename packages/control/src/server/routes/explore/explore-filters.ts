import { eq, ne, and, or, desc, asc, like, inArray, sql } from 'drizzle-orm';
import { accounts, repositories, repoReleases, repoReleaseAssets } from '../../../infra/db/schema';
import type { Database } from '../../../infra/db';
import { badRequest, type AnyAppContext } from '../shared/route-auth';

export interface ReleaseAsset {
  id: string;
  name: string;
  content_type: string;
  size: number;
  r2_key: string;
  download_count: number;
  bundle_format?: string;
  bundle_meta?: {
    name?: string;
    app_id?: string;
    version: string;
    description?: string;
    icon?: string;
    category?: 'app' | 'service' | 'library' | 'template' | 'social';
    tags?: string[];
    dependencies?: Array<{ repo: string; version: string }>;
  };
  created_at: string;
}

export type RepoByNameLookup = {
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

export interface ExploreFilterParams {
  category: string | undefined;
  language: string | undefined;
  license: string | undefined;
  since: string | undefined;
}

export const EXPLORE_CATEGORIES = ['app', 'service', 'library', 'template', 'social'] as const;

export const CATEGORY_FILTER_OPTS = { maxLen: 32, pattern: /^[a-z0-9_-]+$/ } as const;
export const LANG_LICENSE_FILTER_OPTS = { maxLen: 64, pattern: /^[a-z0-9][a-z0-9+_.-]*$/ } as const;

export function normalizeSimpleFilter(
  value: string | undefined,
  opts: { maxLen: number; pattern: RegExp }
): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (!v) return undefined;
  if (v.length > opts.maxLen) return undefined;
  if (!opts.pattern.test(v)) return undefined;
  return v;
}

export function parseSinceDateToIsoStart(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const raw = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const iso = `${raw}T00:00:00.000Z`;
  if (!Number.isFinite(Date.parse(iso))) return undefined;
  return iso;
}

export function parseExploreFilters(c: { req: { query: (key: string) => string | undefined } }): ExploreFilterParams {
  return {
    category: normalizeSimpleFilter(c.req.query('category'), CATEGORY_FILTER_OPTS),
    language: normalizeSimpleFilter(c.req.query('language'), LANG_LICENSE_FILTER_OPTS),
    license: normalizeSimpleFilter(c.req.query('license'), LANG_LICENSE_FILTER_OPTS),
    since: parseSinceDateToIsoStart(c.req.query('since')),
  };
}

export function validateExploreFilters(
  c: AnyAppContext,
  filters: ExploreFilterParams,
): Response | null {
  if (filters.category && !(EXPLORE_CATEGORIES as ReadonlyArray<string>).includes(filters.category)) {
    return badRequest(c, 'Invalid category');
  }
  if (c.req.query('since') && !filters.since) {
    return badRequest(c, 'Invalid since (expected YYYY-MM-DD)');
  }
  return null;
}

export function parseTags(
  c: AnyAppContext,
  tagsRaw: string | undefined,
): { tags: string[] } | { error: Response } {
  const tags = (tagsRaw || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);
  for (const tag of tags) {
    if (tag.length > 64 || !/^[a-z0-9][a-z0-9_-]*$/.test(tag)) {
      return { error: badRequest(c, 'Invalid tags (expected comma-separated tag slugs)') };
    }
  }
  return { tags };
}

export async function findRepoByUsernameAndName(
  db: Database,
  username: string,
  repoName: string
) {
  const cleanUsername = username.trim().toLowerCase();
  const cleanRepoName = repoName.trim().toLowerCase();

  const results = await db.all<RepoByNameLookup>(sql`
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

  return results[0] ?? null;
}

export async function buildCatalogSuggestions(
  db: Database,
  q: string,
  limit: number,
) {
  const [userRows, repoRows] = await Promise.all([
    db.select({
      slug: accounts.slug,
      name: accounts.name,
      picture: accounts.picture,
    }).from(accounts).where(
      and(
        ne(accounts.slug, ''),
        or(like(accounts.slug, `%${q}%`), like(accounts.name, `%${q}%`)),
      )
    ).orderBy(asc(accounts.slug)).limit(limit).all(),
    db.select({
      id: repositories.id,
      name: repositories.name,
      description: repositories.description,
      stars: repositories.stars,
      updatedAt: repositories.updatedAt,
      accountId: repositories.accountId,
      accountSlug: accounts.slug,
      accountName: accounts.name,
      accountPicture: accounts.picture,
    }).from(repositories)
      .leftJoin(accounts, eq(repositories.accountId, accounts.id))
      .where(
        and(
          eq(repositories.visibility, 'public'),
          or(like(repositories.name, `%${q}%`), like(repositories.description, `%${q}%`)),
        )
      )
      .orderBy(desc(repositories.stars), desc(repositories.updatedAt))
      .limit(limit)
      .all(),
  ]);

  return {
    users: userRows
      .filter((user) => !!user.slug)
      .map((user) => ({
        username: user.slug as string,
        name: user.name,
        avatar_url: user.picture,
      })),
    repos: repoRows.flatMap((repo) => {
      const ownerSlug = repo.accountSlug || repo.accountId;
      if (!ownerSlug) return [];
      return [{
        id: repo.id,
        name: repo.name,
        description: repo.description,
        stars: repo.stars,
        updated_at: repo.updatedAt,
        owner: {
          username: ownerSlug,
          name: repo.accountName,
          avatar_url: repo.accountPicture || null,
        },
      }];
    }),
  };
}

export async function loadReleasesWithAssets(
  db: Database,
  repoId: string,
  opts: {
    includePrerelease?: boolean;
    limit?: number;
  } = {},
) {
  const conditions = [
    eq(repoReleases.repoId, repoId),
    eq(repoReleases.isDraft, false),
  ];
  if (!opts.includePrerelease) {
    conditions.push(eq(repoReleases.isPrerelease, false));
  }

  const releaseRows = await db
    .select()
    .from(repoReleases)
    .where(and(...conditions))
    .orderBy(desc(repoReleases.publishedAt))
    .limit(opts.limit ?? 100)
    .all();

  const releaseIds = releaseRows.map((r) => r.id);
  const allAssets =
    releaseIds.length > 0
      ? await db
          .select()
          .from(repoReleaseAssets)
          .where(inArray(repoReleaseAssets.releaseId, releaseIds))
          .orderBy(asc(repoReleaseAssets.createdAt))
          .all()
      : [];

  const assetsByRelease = new Map<string, typeof allAssets>();
  for (const asset of allAssets) {
    const list = assetsByRelease.get(asset.releaseId) ?? [];
    list.push(asset);
    assetsByRelease.set(asset.releaseId, list);
  }

  return releaseRows.map((r) => ({
    ...r,
    repoReleaseAssets: assetsByRelease.get(r.id) ?? [],
  }));
}
