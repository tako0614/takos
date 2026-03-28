import type { Env } from '../../../shared/types';
import type { Snapshot, SnapshotTree, BlobFetcher } from './models';
import { generateId, now, toIsoString } from '../../../shared/utils';
import { computeSHA256 } from '../../../shared/utils/hash';
import { getDb, snapshots, blobs, files, sessions, sessionFiles, accounts } from '../../../infra/db';
import { eq, and, inArray, lte, lt, ne, sql } from 'drizzle-orm';
import { logError, logInfo, logWarn } from '../../../shared/utils/logger';
import { SnapshotStorage } from './snapshot-storage';

/** Extract non-empty blob hashes from a snapshot tree. */
function extractTreeHashes(tree: SnapshotTree): string[] {
    return Object.values(tree).map(entry => entry.hash).filter(Boolean);
}

/** Parse a JSON-encoded parent ID array, returning [] on failure. */
function parseParentIds(raw: string | null, snapshotId?: string): string[] {
    if (!raw) return [];
    try {
        return JSON.parse(raw) as string[];
    } catch (err) {
        if (snapshotId) {
            logError(`Failed to parse parent_ids for snapshot ${snapshotId}`, err, { module: 'services/sync/snapshot' });
        }
        return [];
    }
}

export class SnapshotManager {
    private storage: SnapshotStorage;

    constructor(
        private env: Env,
        private spaceId: string,
        storage?: SnapshotStorage,
    ) {
        this.storage = storage ?? new SnapshotStorage(env, spaceId);
    }

    /**
     * Create a new snapshot from a tree.
     * Creates snapshot in 'pending' status; call completeSnapshot() after
     * successful DB updates to mark as 'complete'.
     */
    async createSnapshot(
        tree: SnapshotTree,
        parentIds: string[],
        message?: string,
        author: 'user' | 'ai' = 'ai'
    ): Promise<Snapshot> {
        const db = getDb(this.env.DB);
        const snapshotId = generateId();

        const { treeKey } = await this.storage.putTree(snapshotId, tree);

        const timestamp = now();
        await db.insert(snapshots)
            .values({
                id: snapshotId,
                accountId: this.spaceId,
                parentIds: JSON.stringify(parentIds),
                treeKey: treeKey,
                message: message || null,
                author,
                status: 'pending',
                createdAt: timestamp,
            })
            .run();

        const blobHashes = extractTreeHashes(tree);
        if (blobHashes.length > 0) {
            await this.increaseBlobRefcount(blobHashes);
        }

        return {
            id: snapshotId,
            space_id: this.spaceId,
            parent_ids: parentIds,
            tree_key: treeKey,
            message,
            author,
            status: 'pending',
            created_at: timestamp
        };
    }

    /**
     * Mark a pending snapshot as complete after related DB updates have succeeded.
     */
    async completeSnapshot(snapshotId: string): Promise<void> {
        const db = getDb(this.env.DB);
        const result = await db.update(snapshots)
            .set({ status: 'complete' })
            .where(
                and(
                    eq(snapshots.id, snapshotId),
                    eq(snapshots.accountId, this.spaceId),
                    eq(snapshots.status, 'pending'),
                )
            )
            .run();

        if ((result.meta.changes ?? 0) === 0) {
            logWarn(`Snapshot ${snapshotId} was not in pending status or not found`, { module: 'services/sync/snapshot' });
        }
    }

    /**
     * Mark a pending snapshot as failed and clean up.
     * Call this if DB updates fail after snapshot creation.
     */
    async failSnapshot(snapshotId: string): Promise<void> {
        const db = getDb(this.env.DB);
        const snapshot = await this.getSnapshot(snapshotId);
        if (!snapshot || snapshot.status !== 'pending') {
            return;
        }

        try {
            const tree = await this.getTree(snapshotId);
            const hashes = extractTreeHashes(tree);

            if (hashes.length > 0) {
                await this.decreaseBlobRefcount(hashes);
            }

            await this.storage.deleteTree(snapshot.tree_key);

            await db.delete(snapshots)
                .where(eq(snapshots.id, snapshotId))
                .run();

            logInfo(`Cleaned up failed snapshot ${snapshotId}`, { module: 'services/sync/snapshot' });
        } catch (err) {
            logError(`Failed to clean up snapshot ${snapshotId}`, err, { module: 'services/sync/snapshot' });
            await db.update(snapshots)
                .set({ status: 'failed' })
                .where(eq(snapshots.id, snapshotId))
                .run();
        }
    }

    /**
     * Clean up old pending/failed snapshots (call periodically or on startup).
     */
    async cleanupPendingSnapshots(maxAgeMinutes: number = 30): Promise<number> {
        const db = getDb(this.env.DB);
        const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();

        const oldSnapshots = await db.select({ id: snapshots.id })
            .from(snapshots)
            .where(
                and(
                    eq(snapshots.accountId, this.spaceId),
                    inArray(snapshots.status, ['pending', 'failed']),
                    lt(snapshots.createdAt, cutoff),
                )
            )
            .all();

        let cleaned = 0;
        for (const s of oldSnapshots) {
            await this.failSnapshot(s.id);
            cleaned++;
        }

        return cleaned;
    }

    /**  Get a snapshot by ID. */
    async getSnapshot(snapshotId: string): Promise<Snapshot | null> {
        const db = getDb(this.env.DB);
        const snapshot = await db.select()
            .from(snapshots)
            .where(
                and(
                    eq(snapshots.id, snapshotId),
                    eq(snapshots.accountId, this.spaceId),
                )
            )
            .get();

        if (!snapshot) return null;

        return {
            id: snapshot.id,
            space_id: snapshot.accountId,
            parent_ids: parseParentIds(snapshot.parentIds, snapshotId),
            tree_key: snapshot.treeKey,
            message: snapshot.message ?? undefined,
            author: (snapshot.author as 'user' | 'ai' | null) ?? undefined,
            status: snapshot.status as 'pending' | 'complete' | 'failed',
            created_at: toIsoString(snapshot.createdAt),
        };
    }

    /** Validate tree structure (checks a sample of entries). */
    private validateTree(tree: unknown): tree is SnapshotTree {
        if (typeof tree !== 'object' || tree === null) {
            return false;
        }
        const entries = Object.entries(tree as Record<string, unknown>);
        for (const [path, entry] of entries.slice(0, 10)) {
            if (typeof path !== 'string' || path.length === 0) return false;
            if (typeof entry !== 'object' || entry === null) return false;
            const e = entry as Record<string, unknown>;
            if (typeof e.hash !== 'string') return false;
            if (typeof e.type !== 'string') return false;
        }
        return true;
    }

    /** Get the tree for a snapshot (with integrity verification). */
    async getTree(snapshotId: string): Promise<SnapshotTree> {
        const db = getDb(this.env.DB);
        const snapshot = await this.getSnapshot(snapshotId);
        if (!snapshot) {
            throw new Error(`Snapshot not found: ${snapshotId}`);
        }

        let tree: SnapshotTree | null;
        try {
            tree = await this.storage.getTree(snapshot.tree_key);
        } catch (parseError) {
            // Re-throw configuration errors (e.g. missing TENANT_SOURCE)
            if (parseError instanceof Error && parseError.message.includes('not configured')) {
                throw parseError;
            }
            logError(`Failed to parse tree JSON for snapshot ${snapshotId}`, parseError, { module: 'services/sync/snapshot' });
            return {};
        }

        if (!tree) {
            logError(`Tree object not found for snapshot ${snapshotId}: ${snapshot.tree_key}`, undefined, { module: 'services/sync/snapshot' });
            try {
                await db.delete(snapshots)
                    .where(eq(snapshots.id, snapshotId))
                    .run();
                logInfo(`Cleaned up orphaned snapshot record: ${snapshotId}`, { module: 'services/sync/snapshot' });
            } catch (cleanupError) {
                logError(`Failed to cleanup orphaned snapshot`, cleanupError, { module: 'services/sync/snapshot' });
            }
            return {};
        }

        if (!this.validateTree(tree)) {
            logError(`Invalid tree structure for snapshot ${snapshotId}`, undefined, { module: 'services/sync/snapshot' });
            return {};
        }

        if (!this.storage.validateTreeKeyIntegrity(snapshot.tree_key, snapshotId)) {
            logError(`Snapshot integrity check failed: tree_key ${snapshot.tree_key} does not match expected prefix`, undefined, { module: 'services/sync/snapshot' });
            return {};
        }

        return tree;
    }

    /** Create a tree from current workspace files table. */
    async createTreeFromWorkspace(): Promise<SnapshotTree> {
        const db = getDb(this.env.DB);
        const fileRows = await db.select({
            path: files.path,
            sha256: files.sha256,
            size: files.size,
        })
            .from(files)
            .where(
                and(
                    eq(files.accountId, this.spaceId),
                    ne(files.origin, 'system'),
                )
            )
            .all();

        const tree: SnapshotTree = {};

        for (const file of fileRows) {
            tree[file.path] = {
                hash: file.sha256 || '', // Should not be null for source files
                mode: 0o644, // Default to non-executable
                type: 'file',
                size: file.size
            };
        }

        return tree;
    }

    /** Create a blob fetcher for this workspace (with integrity check). */
    createBlobFetcher(): BlobFetcher {
        return async (hash: string): Promise<string | null> => {
            return this.storage.getBlob(hash);
        };
    }

    /** Write a blob and return its hash and size. Refcount starts at 1. */
    async writeBlob(content: string): Promise<{ hash: string; size: number }> {
        const db = getDb(this.env.DB);
        const hash = await computeSHA256(content);
        const size = new TextEncoder().encode(content).length;

        const exists = await this.storage.blobExists(hash);
        if (!exists) {
            await this.storage.putBlob(hash, content, size);
        }

        const existingBlob = await db.select()
            .from(blobs)
            .where(
                and(
                    eq(blobs.accountId, this.spaceId),
                    eq(blobs.hash, hash),
                )
            )
            .get();
        if (existingBlob) {
            await db.update(blobs)
                .set({ refcount: sql`${blobs.refcount} + 1` })
                .where(
                    and(
                        eq(blobs.accountId, this.spaceId),
                        eq(blobs.hash, hash),
                    )
                )
                .run();
        } else {
            try {
                await db.insert(blobs)
                    .values({
                        accountId: this.spaceId,
                        hash: hash,
                        size: size,
                        isBinary: false,
                        refcount: 1,
                        createdAt: now(),
                    })
                    .run();
            } catch {
                await db.update(blobs)
                    .set({ refcount: sql`${blobs.refcount} + 1` })
                    .where(
                        and(
                            eq(blobs.accountId, this.spaceId),
                            eq(blobs.hash, hash),
                        )
                    )
                    .run();
            }
        }

        return { hash, size };
    }

    /** Increase refcount for blobs included in a snapshot. */
    async increaseBlobRefcount(hashes: string[]): Promise<void> {
        if (hashes.length === 0) return;

        const db = getDb(this.env.DB);
        for (const hash of hashes) {
            await db.update(blobs)
                .set({ refcount: sql`${blobs.refcount} + 1` })
                .where(
                    and(
                        eq(blobs.accountId, this.spaceId),
                        eq(blobs.hash, hash),
                    )
                )
                .run();
        }
    }

    /** Decrease refcount for blobs and delete those that reach zero. */
    async decreaseBlobRefcount(hashes: string[]): Promise<void> {
        if (hashes.length === 0) return;

        const db = getDb(this.env.DB);

        for (const hash of hashes) {
            await db.update(blobs)
                .set({ refcount: sql`${blobs.refcount} - 1` })
                .where(
                    and(
                        eq(blobs.accountId, this.spaceId),
                        eq(blobs.hash, hash),
                        sql`${blobs.refcount} > 0`,
                    )
                )
                .run();
        }

        const blobsToDelete = await db.select({ hash: blobs.hash })
            .from(blobs)
            .where(
                and(
                    eq(blobs.accountId, this.spaceId),
                    inArray(blobs.hash, hashes),
                    lte(blobs.refcount, 0),
                )
            )
            .all();

        const deletedHashes = blobsToDelete.map(b => b.hash);

        if (deletedHashes.length > 0) {
            await db.delete(blobs)
                .where(
                    and(
                        eq(blobs.accountId, this.spaceId),
                        inArray(blobs.hash, deletedHashes),
                        lte(blobs.refcount, 0),
                    )
                )
                .run();

            await this.storage.deleteBlobs(deletedHashes);
        }
    }

    /** Get all snapshots reachable from a head snapshot (DAG traversal). */
    private static readonly MAX_DAG_DEPTH = 10_000;
    private static readonly BATCH_SIZE = 1000;

    async getReachableSnapshots(headSnapshotId: string): Promise<Set<string>> {
        const db = getDb(this.env.DB);
        const reachable = new Set<string>();
        let toFetch = [headSnapshotId];

        let iterations = 0;

        while (toFetch.length > 0) {
            if (iterations >= SnapshotManager.MAX_DAG_DEPTH) {
                logWarn(`DAG traversal limit reached (${SnapshotManager.MAX_DAG_DEPTH} snapshots) for workspace ${this.spaceId}`, { module: 'services/sync/snapshot' });
                break;
            }

            const idsToFetch = toFetch.filter(id => !reachable.has(id));
            if (idsToFetch.length === 0) break;

            const batchIds = idsToFetch.slice(0, SnapshotManager.BATCH_SIZE);
            iterations += batchIds.length;

            const snapshotRows = await db.select({
                id: snapshots.id,
                parentIds: snapshots.parentIds,
            })
                .from(snapshots)
                .where(
                    and(
                        eq(snapshots.accountId, this.spaceId),
                        inArray(snapshots.id, batchIds),
                    )
                )
                .all();

            const nextToFetch: string[] = [];

            for (const snapshot of snapshotRows) {
                reachable.add(snapshot.id);

                const parentIds = parseParentIds(snapshot.parentIds);

                for (const parentId of parentIds) {
                    if (!reachable.has(parentId)) {
                        nextToFetch.push(parentId);
                    }
                }
            }

            toFetch = nextToFetch;
        }

        return reachable;
    }

    /** Run garbage collection on orphaned blobs and session data. */
    async runGC(): Promise<{ deletedBlobs: number; deletedSnapshots: number; deletedSessionFiles: number }> {
        const db = getDb(this.env.DB);
        let deletedBlobs = 0;
        let deletedSnapshots = 0;
        let deletedSessionFiles = 0;

        // 1. Clean up session_files for merged/discarded/dead sessions
        const sessionsToClean = await db.select({ id: sessions.id })
            .from(sessions)
            .where(
                and(
                    eq(sessions.accountId, this.spaceId),
                    inArray(sessions.status, ['merged', 'discarded', 'dead']),
                )
            )
            .all();

        if (sessionsToClean.length > 0) {
            const sessionIds = sessionsToClean.map(s => s.id);
            const deleteResult = await db.delete(sessionFiles)
                .where(inArray(sessionFiles.sessionId, sessionIds))
                .run();
            deletedSessionFiles = deleteResult.meta.changes ?? 0;
        }

        // 2. Get hashes from running sessions (must protect these blobs)
        const runningSessions = await db.select({ id: sessions.id })
            .from(sessions)
            .where(
                and(
                    eq(sessions.accountId, this.spaceId),
                    eq(sessions.status, 'running'),
                )
            )
            .all();

        const runningSessionIds = runningSessions.map(s => s.id);
        const runningSessionFileRows = runningSessionIds.length > 0
            ? await db.selectDistinct({ hash: sessionFiles.hash })
                .from(sessionFiles)
                .where(inArray(sessionFiles.sessionId, runningSessionIds))
                .all()
            : [];

        const protectedHashes = new Set(runningSessionFileRows.map(f => f.hash));

        // 3. Delete blobs with refcount <= 0 that are NOT used by running sessions
        const orphanedBlobs = await db.select({ hash: blobs.hash })
            .from(blobs)
            .where(
                and(
                    eq(blobs.accountId, this.spaceId),
                    lte(blobs.refcount, 0),
                )
            )
            .all();

        const hashesToDelete: string[] = [];
        for (const blob of orphanedBlobs) {
            if (protectedHashes.has(blob.hash)) {
                continue;
            }
            hashesToDelete.push(blob.hash);
        }

        if (hashesToDelete.length > 0) {
            await this.storage.deleteBlobs(hashesToDelete);
            deletedBlobs = hashesToDelete.length;
        }

        if (hashesToDelete.length > 0) {
            await db.delete(blobs)
                .where(
                    and(
                        eq(blobs.accountId, this.spaceId),
                        lte(blobs.refcount, 0),
                        inArray(blobs.hash, hashesToDelete),
                    )
                )
                .run();
        }

        // 4. Build reachable snapshot set from all heads
        const workspace = await db.select({ headSnapshotId: accounts.headSnapshotId })
            .from(accounts)
            .where(eq(accounts.id, this.spaceId))
            .get();

        const activeSessions = await db.select({
            headSnapshotId: sessions.headSnapshotId,
            baseSnapshotId: sessions.baseSnapshotId,
        })
            .from(sessions)
            .where(
                and(
                    eq(sessions.accountId, this.spaceId),
                    inArray(sessions.status, ['running', 'stopped']),
                )
            )
            .all();

        const headIds: string[] = [];
        if (workspace?.headSnapshotId) {
            headIds.push(workspace.headSnapshotId);
        }
        for (const session of activeSessions) {
            if (session.headSnapshotId) {
                headIds.push(session.headSnapshotId);
            }
            if (session.baseSnapshotId) {
                headIds.push(session.baseSnapshotId);
            }
        }

        const reachable = new Set<string>();
        for (const headId of headIds) {
            const reached = await this.getReachableSnapshots(headId);
            reached.forEach(id => reachable.add(id));
        }

        // 5. Delete merged/discarded sessions
        await db.delete(sessions)
            .where(
                and(
                    eq(sessions.accountId, this.spaceId),
                    inArray(sessions.status, ['merged', 'discarded', 'dead']),
                )
            )
            .run();

        // 6. Delete unreachable snapshots
        const allSnapshots = await db.select({
            id: snapshots.id,
            treeKey: snapshots.treeKey,
        })
            .from(snapshots)
            .where(
                and(
                    eq(snapshots.accountId, this.spaceId),
                    eq(snapshots.status, 'complete'),
                )
            )
            .all();

        for (const s of allSnapshots) {
            if (!reachable.has(s.id)) {
                try {
                    const tree = await this.getTree(s.id);
                    await this.decreaseBlobRefcount(extractTreeHashes(tree));
                } catch {
                    // Tree may already be deleted
                }

                await this.storage.deleteTree(s.treeKey);
                await db.delete(snapshots)
                    .where(eq(snapshots.id, s.id))
                    .run();

                deletedSnapshots++;
            }
        }

        // 7. Cleanup pending/failed snapshots older than 30 minutes
        await this.cleanupPendingSnapshots(30);

        return { deletedBlobs, deletedSnapshots, deletedSessionFiles };
    }
}
