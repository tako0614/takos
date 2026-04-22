import type { Env } from "../../../shared/types/index.ts";
import type { SnapshotTree } from "./models.ts";
import { SnapshotCompressor } from "./snapshot-compressor.ts";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import { logError } from "../../../shared/utils/logger.ts";

/**
 * Handles R2 (TENANT_SOURCE) storage operations for snapshot trees and blobs.
 */
export class SnapshotStorage {
  private compressor: SnapshotCompressor;

  constructor(
    private env: Env,
    private spaceId: string,
    compressor?: SnapshotCompressor,
  ) {
    this.compressor = compressor ?? new SnapshotCompressor();
  }

  /** Ensure TENANT_SOURCE is available, throw otherwise. */
  private requireStorage(): NonNullable<Env["TENANT_SOURCE"]> {
    if (!this.env.TENANT_SOURCE) {
      throw new Error("Storage not configured (TENANT_SOURCE)");
    }
    return this.env.TENANT_SOURCE;
  }

  // ── Tree operations ──────────────────────────────────────────────

  /** Build the R2 key for a snapshot tree. */
  buildTreeKey(snapshotId: string): string {
    return `trees/${this.spaceId}/${snapshotId}.json.gz`;
  }

  /** Put a compressed tree into R2 and return the key. */
  async putTree(
    snapshotId: string,
    tree: SnapshotTree,
  ): Promise<{ treeKey: string; uncompressedSize: number }> {
    const storage = this.requireStorage();
    const treeKey = this.buildTreeKey(snapshotId);
    const jsonData = JSON.stringify(tree);
    const compressedData = await this.compressor.compress(jsonData);

    await storage.put(treeKey, compressedData, {
      httpMetadata: {
        contentType: "application/json",
        contentEncoding: "gzip",
      },
      customMetadata: {
        "snapshot-id": snapshotId,
        "workspace-id": this.spaceId,
        "uncompressed-size": String(jsonData.length),
      },
    });

    return { treeKey, uncompressedSize: jsonData.length };
  }

  /** Get a tree from R2, decompressing if needed. Returns null if not found. */
  async getTree(treeKey: string): Promise<SnapshotTree | null> {
    const storage = this.requireStorage();
    const object = await storage.get(treeKey);
    if (!object) return null;

    if (treeKey.endsWith(".gz")) {
      const compressedData = await object.arrayBuffer();
      const jsonData = await this.compressor.decompress(compressedData);
      return JSON.parse(jsonData) as SnapshotTree;
    }

    return await object.json<SnapshotTree>();
  }

  /** Delete a tree from R2. */
  async deleteTree(treeKey: string): Promise<void> {
    await this.env.TENANT_SOURCE?.delete(treeKey);
  }

  /** Validate that a tree key matches the expected prefix for a snapshot. */
  validateTreeKeyIntegrity(treeKey: string, snapshotId: string): boolean {
    const expectedKeyPrefix = `trees/${this.spaceId}/${snapshotId}`;
    return treeKey.startsWith(expectedKeyPrefix);
  }

  // ── Blob operations ──────────────────────────────────────────────

  /** Build the R2 key for a blob. */
  private buildBlobKey(hash: string): string {
    return `blobs/${this.spaceId}/${hash}`;
  }

  /** Check if a blob exists in R2. */
  async blobExists(hash: string): Promise<boolean> {
    const storage = this.requireStorage();
    const existing = await storage.head(this.buildBlobKey(hash));
    return existing !== null;
  }

  /** Put a blob into R2. */
  async putBlob(hash: string, content: string, size: number): Promise<void> {
    const storage = this.requireStorage();
    await storage.put(this.buildBlobKey(hash), content, {
      customMetadata: {
        "workspace-id": this.spaceId,
        "size": String(size),
      },
    });
  }

  /** Get blob content from R2, with integrity verification. Returns null if not found or integrity check fails. */
  async getBlob(hash: string): Promise<string | null> {
    if (!this.env.TENANT_SOURCE) {
      return null;
    }

    const blob = await this.env.TENANT_SOURCE.get(this.buildBlobKey(hash));
    if (!blob) {
      return null;
    }

    const content = await blob.text();
    const actualHash = await computeSHA256(content);
    if (actualHash !== hash) {
      logError(
        `Blob integrity check failed for ${this.spaceId}: expected ${hash}, got ${actualHash}`,
        undefined,
        { module: "services/sync/snapshot" },
      );
      return null;
    }

    return content;
  }

  /** Delete blobs from R2 by their hashes. */
  async deleteBlobs(hashes: string[]): Promise<void> {
    if (hashes.length === 0 || !this.env.TENANT_SOURCE) return;
    const blobKeys = hashes.map((hash) => this.buildBlobKey(hash));
    await this.env.TENANT_SOURCE.delete(blobKeys);
  }
}
