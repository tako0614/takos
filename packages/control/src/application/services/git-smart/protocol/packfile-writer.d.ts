/**
 * Packfile writer — generates a git packfile from a list of object SHAs.
 *
 * Format:
 *   - Header: "PACK" + version(2) + object_count(4 bytes BE)
 *   - Objects: type+size VLE header + zlib-deflated content
 *   - Trailer: SHA-1 checksum of entire pack
 *
 * Phase 1: No delta compression (undeltified objects only).
 */
import type { R2Bucket } from '../../../../shared/types/bindings.ts';
/**
 * Write a packfile containing the given objects.
 * Returns the complete packfile as a Uint8Array.
 */
export declare function writePackfile(bucket: R2Bucket, shas: string[]): Promise<Uint8Array>;
//# sourceMappingURL=packfile-writer.d.ts.map