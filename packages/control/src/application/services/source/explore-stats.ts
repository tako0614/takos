// ---------------------------------------------------------------------------
// Rating / stats helpers for takopack packages
// ---------------------------------------------------------------------------

import type { Database } from '../../../infra/db/index.ts';
import type { TakopackRatingStats, PackageWithTakopack } from './explore-package-types.ts';

export async function getTakopackRatingStats(
  _db: Database,
  repoIds: string[],
): Promise<Map<string, TakopackRatingStats>> {
  const map = new Map<string, TakopackRatingStats>();
  for (const repoId of repoIds) {
    map.set(repoId, {
      rating_avg: null,
      rating_count: 0,
    });
  }

  return map;
}

export async function getTakopackRatingSummary(
  _db: Database,
  _repoId: string,
): Promise<TakopackRatingStats> {
  return {
    rating_avg: null,
    rating_count: 0,
  };
}

export async function fetchPublishStatuses(
  _db: Database,
  _packages: PackageWithTakopack[],
): Promise<Map<string, string>> {
  return new Map<string, string>();
}
