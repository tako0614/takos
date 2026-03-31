// ---------------------------------------------------------------------------
// Filtering and sorting logic for takopack packages
// ---------------------------------------------------------------------------

import type { PackageWithTakopack, TakopackRatingStats } from './explore-package-types.ts';

export const SORT_ALIASES: Record<string, string> = { popular: 'downloads', new: 'created' };

export function filterPackages(
  packages: PackageWithTakopack[],
  category: string | undefined,
  tags: string[],
): PackageWithTakopack[] {
  let filtered = packages;

  if (category) {
    filtered = filtered.filter((p) => p.primaryAsset.bundle_meta?.category === category);
  }
  if (tags.length > 0) {
    filtered = filtered.filter((p) => {
      const pkgTags = (p.primaryAsset.bundle_meta?.tags || [])
        .map((t) => String(t || '').trim().toLowerCase())
        .filter(Boolean);
      if (pkgTags.length === 0) return false;
      return tags.every((tag) => pkgTags.includes(tag));
    });
  }

  return filtered;
}

export function sortPackages(
  packages: PackageWithTakopack[],
  sortParam: string,
  sortParamRaw: string,
  ratingStatsByRepoId: Map<string, TakopackRatingStats>,
): void {
  if (sortParam === 'rating') {
    packages.sort((a, b) => {
      const ra = ratingStatsByRepoId.get(a.release.repository.id);
      const rb = ratingStatsByRepoId.get(b.release.repository.id);
      const avga = ra?.rating_avg ?? -1;
      const avgb = rb?.rating_avg ?? -1;
      if (avga !== avgb) return avgb - avga;
      const cnta = ra?.rating_count ?? 0;
      const cntb = rb?.rating_count ?? 0;
      if (cnta !== cntb) return cntb - cnta;
      if (a.totalDownloads !== b.totalDownloads) return b.totalDownloads - a.totalDownloads;
      return getPublishedMs(b) - getPublishedMs(a);
    });
  } else if (sortParamRaw === 'trending') {
    const nowMs = Date.now();
    packages.sort((a, b) => {
      const aMs = getPublishedMs(a);
      const bMs = getPublishedMs(b);
      const aAgeDays = aMs ? Math.max(0, (nowMs - aMs) / (1000 * 60 * 60 * 24)) : 3650;
      const bAgeDays = bMs ? Math.max(0, (nowMs - bMs) / (1000 * 60 * 60 * 24)) : 3650;
      const aStars = a.release.repository.stars || 0;
      const bStars = b.release.repository.stars || 0;
      const aScore = (Math.log10(a.totalDownloads + 1) + Math.log10(aStars + 1)) / (aAgeDays + 2);
      const bScore = (Math.log10(b.totalDownloads + 1) + Math.log10(bStars + 1)) / (bAgeDays + 2);
      if (aScore !== bScore) return bScore - aScore;
      if (a.totalDownloads !== b.totalDownloads) return b.totalDownloads - a.totalDownloads;
      return bMs - aMs;
    });
  } else if (sortParam === 'downloads') {
    packages.sort((a, b) => {
      if (a.totalDownloads !== b.totalDownloads) return b.totalDownloads - a.totalDownloads;
      return getPublishedMs(b) - getPublishedMs(a);
    });
  } else if (sortParam === 'created') {
    packages.sort((a, b) => {
      const pa = getPublishedMs(a);
      const pb = getPublishedMs(b);
      if (pa !== pb) return pb - pa;
      return b.totalDownloads - a.totalDownloads;
    });
  }
}

export function getPublishedMs(pkg: PackageWithTakopack): number {
  return pkg.release.publishedAt ? new Date(pkg.release.publishedAt).getTime() : 0;
}
