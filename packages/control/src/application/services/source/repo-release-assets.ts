import { safeJsonParseOrDefault } from '../../../shared/utils';

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
    created_at: (row.createdAt == null ? null : typeof row.createdAt === 'string' ? row.createdAt : row.createdAt.toISOString()),
  };
}

export function toReleaseAssets(rows: ReleaseAssetRow[]): ReleaseAsset[] {
  return rows.map(toReleaseAsset);
}
