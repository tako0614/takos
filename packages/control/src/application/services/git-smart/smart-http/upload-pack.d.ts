/**
 * Git Smart HTTP — upload-pack (clone/fetch).
 *
 * 1. Parse client's want/have lines
 * 2. Compute objects to send (want reachable - have reachable)
 * 3. Generate packfile
 * 4. Send response with side-band-64k framing
 */
import type { D1Database, R2Bucket } from '../../../../shared/types/bindings.ts';
export declare function handleUploadPack(db: D1Database, bucket: R2Bucket, repoId: string, body: Uint8Array): Promise<Uint8Array>;
//# sourceMappingURL=upload-pack.d.ts.map