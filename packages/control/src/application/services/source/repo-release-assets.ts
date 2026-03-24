import { safeJsonParseOrDefault, toIsoString } from '../../../shared/utils';
import type { ReleaseAsset } from '../takopack/types';

type ReleaseAssetRow = {
  id: string;
  assetKey: string;
  name: string;
  contentType: string | null;
  sizeBytes: number | null;
  downloadCount: number;
  bundleFormat: string | null;
  bundleMetaJson: string | null;
  createdAt: string | Date;
};

export function toReleaseAsset(row: ReleaseAssetRow): ReleaseAsset {
  const bundleMeta = row.bundleMetaJson
    ? safeJsonParseOrDefault<ReleaseAsset['bundle_meta'] | undefined>(row.bundleMetaJson, undefined)
    : undefined;
  return {
    id: row.id,
    name: row.name,
    content_type: row.contentType || 'application/octet-stream',
    size: row.sizeBytes ?? 0,
    r2_key: row.assetKey,
    download_count: row.downloadCount,
    bundle_format: row.bundleFormat || undefined,
    bundle_meta: bundleMeta,
    created_at: toIsoString(row.createdAt),
  };
}

export function toReleaseAssets(rows: ReleaseAssetRow[]): ReleaseAsset[] {
  return rows.map(toReleaseAsset);
}
