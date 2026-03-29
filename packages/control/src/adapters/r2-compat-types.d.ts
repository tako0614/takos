import type { R2Object } from '../../shared/types/bindings.ts';
export interface R2Objects {
    objects: R2Object[];
    truncated: boolean;
    cursor?: string;
    delimitedPrefixes: string[];
}
/** Matches the shape of Cloudflare R2Checksums without requiring the abstract class import. */
export interface R2ChecksumsLike {
    readonly md5?: ArrayBuffer;
    readonly sha1?: ArrayBuffer;
    readonly sha256?: ArrayBuffer;
    readonly sha384?: ArrayBuffer;
    readonly sha512?: ArrayBuffer;
    toJSON(): Record<string, string | undefined>;
}
/** Matches the shape of Cloudflare R2HTTPMetadata. */
export interface R2HTTPMetadataLike {
    contentType?: string;
    contentLanguage?: string;
    contentDisposition?: string;
    contentEncoding?: string;
    cacheControl?: string;
    cacheExpiry?: Date;
}
/** Matches the Cloudflare R2Range type. */
export interface R2RangeLike {
    offset: number;
    length?: number;
}
//# sourceMappingURL=r2-compat-types.d.ts.map