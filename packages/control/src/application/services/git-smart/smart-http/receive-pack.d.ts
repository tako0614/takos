/**
 * Git Smart HTTP — receive-pack (push).
 *
 * 1. Parse ref update commands (old-sha new-sha refname)
 * 2. Receive and parse packfile
 * 3. Store objects in R2
 * 4. Index new commits in D1
 * 5. Update refs with CAS semantics
 * 6. Return report-status response
 */
import type { D1Database, R2Bucket } from '../../../../shared/types/bindings.ts';
interface RefCommand {
    oldSha: string;
    newSha: string;
    refName: string;
}
/**
 * Streaming receive-pack: reads pkt-line commands and packfile data
 * incrementally from a ReadableStream, enforcing byte limits during read.
 * Avoids loading the full request body before validation.
 */
export declare function handleReceivePackFromStream(db: D1Database, bucket: R2Bucket, repoId: string, stream: ReadableStream<Uint8Array>, maxBodyBytes?: number): Promise<{
    response: Uint8Array;
    updatedRefs: RefCommand[];
}>;
/**
 * Buffer-based receive-pack: accepts a pre-read Uint8Array body.
 * Delegates to processReceivePack after parsing.
 */
export declare function handleReceivePack(db: D1Database, bucket: R2Bucket, repoId: string, body: Uint8Array): Promise<{
    response: Uint8Array;
    updatedRefs: RefCommand[];
}>;
/**
 * Shared processing logic for both buffer and streaming paths.
 * @internal
 */
export declare function processReceivePack(db: D1Database, bucket: R2Bucket, repoId: string, commands: RefCommand[], packfileData: Uint8Array | null): Promise<{
    response: Uint8Array;
    updatedRefs: RefCommand[];
}>;
/** @internal */
export declare function readPackObjectCount(packfileData: Uint8Array): number;
/** @internal */
export declare function parseReceivePackBody(body: Uint8Array): {
    commands: RefCommand[];
    packfileData: Uint8Array | null;
};
/** @internal */
export declare function applyRefCommand(db: D1Database, bucket: R2Bucket, repoId: string, cmd: RefCommand): Promise<string>;
/**
 * Walk commit ancestry and index any unindexed commits.
 * @internal
 */
export declare function indexCommitsWalk(db: D1Database, bucket: R2Bucket, repoId: string, sha: string, maxDepth?: number): Promise<void>;
/**
 * Streaming parser: reads pkt-line commands and packfile data from a
 * ReadableStream, enforcing byte limits during the read itself.
 *
 * The stream is consumed incrementally — pkt-line commands are parsed as
 * bytes arrive, and the packfile portion is accumulated with a running
 * byte counter that aborts the read early if the limit is exceeded.
 *
 * @internal
 */
export declare function readReceivePackStream(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<{
    commands: RefCommand[];
    packfileData: Uint8Array | null;
}>;
/**
 * Attempt to parse pkt-line commands from accumulated buffer.
 * Returns null if the buffer doesn't yet contain a complete set
 * of commands (no flush packet found).
 * @internal
 */
export declare function tryParsePktLineCommands(buffer: Uint8Array): {
    commands: RefCommand[];
    endOffset: number;
} | null;
/** @internal */
export declare function buildReportStatus(unpackStatus: string, refResults: Array<{
    refName: string;
    status: string;
}>): Uint8Array;
export {};
//# sourceMappingURL=receive-pack.d.ts.map