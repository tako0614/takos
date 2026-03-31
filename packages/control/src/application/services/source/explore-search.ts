// ---------------------------------------------------------------------------
// Database query helpers for package exploration
// ---------------------------------------------------------------------------

import { repoReleases, repoReleaseAssets, repositories, accounts } from '../../../infra/db/index.ts';
import { eq, and, desc, asc, like, sql } from 'drizzle-orm';
import { toReleaseAssets } from './repo-release-assets.ts';
import type { Database } from '../../../infra/db/index.ts';
import type { ReleaseRow, PackageWithTakopack } from './explore-package-types.ts';

export async function queryReleasesWithRepo(
  db: Database,
  opts: {
    searchQuery?: string;
    orderByColumn: 'updatedAt' | 'createdAt' | 'downloads';
    limit: number;
    offset: number;
  },
): Promise<ReleaseRow[]> {
  const { searchQuery, orderByColumn, limit, offset } = opts;

  const orderMap = {
    updatedAt: desc(repoReleases.updatedAt),
    createdAt: desc(repoReleases.createdAt),
    downloads: desc(repoReleases.downloads),
  } as const;

  const conditions = [
    eq(repoReleases.isDraft, false),
    eq(repoReleases.isPrerelease, false),
    eq(repositories.visibility, 'public'),
  ];

  if (searchQuery) {
    conditions.push(
      sql`(${like(repositories.name, `%${searchQuery}%`)} OR ${like(repositories.description, `%${searchQuery}%`)})`,
    );
  }

  const rows = await db
    .select({
      id: repoReleases.id,
      tag: repoReleases.tag,
      description: repoReleases.description,
      publishedAt: repoReleases.publishedAt,
      repoId: repositories.id,
      repoName: repositories.name,
      repoDescription: repositories.description,
      repoStars: repositories.stars,
      accountId: accounts.id,
      accountSlug: accounts.slug,
      accountName: accounts.name,
      accountPicture: accounts.picture,
    })
    .from(repoReleases)
    .innerJoin(repositories, eq(repoReleases.repoId, repositories.id))
    .innerJoin(accounts, eq(repositories.accountId, accounts.id))
    .where(and(...conditions))
    .orderBy(orderMap[orderByColumn])
    .limit(limit)
    .offset(offset)
    .all();

  return rows;
}

export async function loadAssetsForReleases(
  db: Database,
  releaseIds: string[],
): Promise<Map<string, ReturnType<typeof toReleaseAssets>>> {
  if (releaseIds.length === 0) return new Map();

  const assetRows = await db
    .select()
    .from(repoReleaseAssets)
    .where(sql`${repoReleaseAssets.releaseId} IN (${sql.join(releaseIds.map(id => sql`${id}`), sql`, `)})`)
    .orderBy(asc(repoReleaseAssets.createdAt))
    .all();

  const grouped = new Map<string, typeof assetRows>();
  for (const row of assetRows) {
    const arr = grouped.get(row.releaseId) ?? [];
    arr.push(row);
    grouped.set(row.releaseId, arr);
  }

  const result = new Map<string, ReturnType<typeof toReleaseAssets>>();
  for (const [releaseId, rows] of grouped) {
    result.set(releaseId, toReleaseAssets(rows));
  }
  return result;
}

export function buildPackagesFromRows(
  releaseRows: ReleaseRow[],
  assetsByRelease: Map<string, ReturnType<typeof toReleaseAssets>>,
): PackageWithTakopack[] {
  return releaseRows
    .map((row) => {
      const assets = assetsByRelease.get(row.id) ?? [];
      const takopackAssets = assets.filter((a) => a.bundle_format === 'takopack');
      if (takopackAssets.length === 0) return null;

      return {
        release: {
          id: row.id,
          publishedAt: row.publishedAt,
          description: row.description,
          tag: row.tag,
          repository: {
            id: row.repoId,
            name: row.repoName,
            description: row.repoDescription,
            stars: row.repoStars,
            account: {
              id: row.accountId,
              slug: row.accountSlug,
              name: row.accountName,
              picture: row.accountPicture,
            },
          },
        },
        primaryAsset: takopackAssets[0],
        totalDownloads: takopackAssets.reduce((sum, a) => sum + (a.download_count || 0), 0),
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
}
