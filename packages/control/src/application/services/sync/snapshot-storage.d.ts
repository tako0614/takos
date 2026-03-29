import type { Env } from '../../../shared/types';
import type { SnapshotTree } from './models';
import { SnapshotCompressor } from './snapshot-compressor';
/**
 * Handles R2 (TENANT_SOURCE) storage operations for snapshot trees and blobs.
 */
export declare class SnapshotStorage {
    private env;
    private spaceId;
    private compressor;
    constructor(env: Env, spaceId: string, compressor?: SnapshotCompressor);
    /** Ensure TENANT_SOURCE is available, throw otherwise. */
    private requireStorage;
    /** Build the R2 key for a snapshot tree. */
    buildTreeKey(snapshotId: string): string;
    /** Put a compressed tree into R2 and return the key. */
    putTree(snapshotId: string, tree: SnapshotTree): Promise<{
        treeKey: string;
        uncompressedSize: number;
    }>;
    /** Get a tree from R2, decompressing if needed. Returns null if not found. */
    getTree(treeKey: string): Promise<SnapshotTree | null>;
    /** Delete a tree from R2. */
    deleteTree(treeKey: string): Promise<void>;
    /** Validate that a tree key matches the expected prefix for a snapshot. */
    validateTreeKeyIntegrity(treeKey: string, snapshotId: string): boolean;
    /** Build the R2 key for a blob. */
    private buildBlobKey;
    /** Check if a blob exists in R2. */
    blobExists(hash: string): Promise<boolean>;
    /** Put a blob into R2. */
    putBlob(hash: string, content: string, size: number): Promise<void>;
    /** Get blob content from R2, with integrity verification. Returns null if not found or integrity check fails. */
    getBlob(hash: string): Promise<string | null>;
    /** Delete blobs from R2 by their hashes. */
    deleteBlobs(hashes: string[]): Promise<void>;
}
//# sourceMappingURL=snapshot-storage.d.ts.map