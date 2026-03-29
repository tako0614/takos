import { getDb } from '../../../infra/db';
export declare function sanitizeReleaseAssetFilename(fileName: string): string;
export declare function buildAttachmentDisposition(fileName: string): string;
/** Fetch a release with its assets and author in separate queries */
export declare function fetchReleaseWithDetails(db: ReturnType<typeof getDb>, releaseId: string): Promise<{
    repoReleaseAssets: {
        createdAt: string;
        id: string;
        releaseId: string;
        assetKey: string;
        name: string;
        contentType: string | null;
        sizeBytes: number | null;
        checksumSha256: string | null;
        downloadCount: number;
        bundleFormat: string | null;
        bundleMetaJson: string | null;
    }[];
    authorAccount: {
        id: string;
        name: string;
        picture: string | null;
    } | null;
    updatedAt: string;
    createdAt: string;
    id: string;
    repoId: string;
    tag: string;
    name: string | null;
    description: string | null;
    commitSha: string | null;
    isPrerelease: boolean;
    isDraft: boolean;
    downloads: number;
    authorAccountId: string | null;
    publishedAt: string | null;
} | null>;
//# sourceMappingURL=release-shared.d.ts.map