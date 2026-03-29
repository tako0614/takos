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
        dependencies?: Array<{
            repo: string;
            version: string;
        }>;
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
export declare function toReleaseAsset(row: ReleaseAssetRow): ReleaseAsset;
export declare function toReleaseAssets(rows: ReleaseAssetRow[]): ReleaseAsset[];
export {};
//# sourceMappingURL=repo-release-assets.d.ts.map