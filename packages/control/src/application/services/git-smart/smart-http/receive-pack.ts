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

import type {
  D1Database,
  R2Bucket,
} from "../../../../shared/types/bindings.ts";
import {
  encodePktLine,
  encodeSideBandData,
  flushPkt,
  type parsePktLines as _parsePktLines,
  type pktLineText as _pktLineText,
} from "../protocol/pkt-line.ts";
import { readPackfileAsync } from "../protocol/packfile-reader.ts";
import { getCommit, indexCommit, isAncestor } from "../core/commit-index.ts";
import {
  createBranch,
  createTag,
  deleteBranch,
  deleteTag,
  getBranch,
  isValidRefName,
  updateBranch,
} from "../core/refs.ts";
import { concatBytes } from "../core/sha1.ts";
import type { Buffer as _Buffer } from "node:buffer";

const ZERO_SHA = "0000000000000000000000000000000000000000";
const MAX_REFS_UPDATED_PER_PUSH = 50;
const MAX_OBJECTS_PER_PUSH = 200000;
const MAX_PUSH_PACKFILE_BYTES = 90 * 1024 * 1024;
const MAX_PUSH_INFLATED_TOTAL = 720 * 1024 * 1024;
const MAX_OBJECT_INFLATED = 256 * 1024 * 1024;
const MAX_DELTA_RESULT_INFLATED = 64 * 1024 * 1024;
const MAX_DELTA_CHAIN_DEPTH = 50;

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
export async function handleReceivePackFromStream(
  db: D1Database,
  bucket: R2Bucket,
  repoId: string,
  stream: ReadableStream<Uint8Array>,
  maxBodyBytes: number = MAX_PUSH_PACKFILE_BYTES,
): Promise<{ response: Uint8Array; updatedRefs: RefCommand[] }> {
  const { commands, packfileData } = await readReceivePackStream(
    stream,
    maxBodyBytes,
  );
  return processReceivePack(db, bucket, repoId, commands, packfileData);
}

/**
 * Buffer-based receive-pack: accepts a pre-read Uint8Array body.
 * Delegates to processReceivePack after parsing.
 */
export async function handleReceivePack(
  db: D1Database,
  bucket: R2Bucket,
  repoId: string,
  body: Uint8Array,
): Promise<{ response: Uint8Array; updatedRefs: RefCommand[] }> {
  const { commands, packfileData } = parseReceivePackBody(body);
  return processReceivePack(db, bucket, repoId, commands, packfileData);
}

/**
 * Shared processing logic for both buffer and streaming paths.
 * @internal
 */
export async function processReceivePack(
  db: D1Database,
  bucket: R2Bucket,
  repoId: string,
  commands: RefCommand[],
  packfileData: Uint8Array | null,
): Promise<{ response: Uint8Array; updatedRefs: RefCommand[] }> {
  if (commands.length > MAX_REFS_UPDATED_PER_PUSH) {
    return {
      response: buildReportStatus(
        "too many ref updates",
        commands.map((c) => ({
          refName: c.refName,
          status: "ng ref-update limit exceeded",
        })),
      ),
      updatedRefs: [],
    };
  }

  if (commands.length === 0) {
    return {
      response: buildReportStatus("ok", []),
      updatedRefs: [],
    };
  }

  // Process packfile if present (not present for delete-only pushes)
  if (packfileData && packfileData.length > 0) {
    if (packfileData.length > MAX_PUSH_PACKFILE_BYTES) {
      return {
        response: buildReportStatus(
          "packfile too large",
          commands.map((c) => ({
            refName: c.refName,
            status: "ng packfile-size limit exceeded",
          })),
        ),
        updatedRefs: [],
      };
    }

    try {
      const objectCount = readPackObjectCount(packfileData);
      if (objectCount > MAX_OBJECTS_PER_PUSH) {
        return {
          response: buildReportStatus(
            "too many objects",
            commands.map((c) => ({
              refName: c.refName,
              status: "ng object-count limit exceeded",
            })),
          ),
          updatedRefs: [],
        };
      }

      await readPackfileAsync(packfileData, bucket, {
        maxObjectCount: MAX_OBJECTS_PER_PUSH,
        maxInflatedTotal: MAX_PUSH_INFLATED_TOTAL,
        maxObjectInflated: MAX_OBJECT_INFLATED,
        maxDeltaResultInflated: MAX_DELTA_RESULT_INFLATED,
        maxDeltaChainDepth: MAX_DELTA_CHAIN_DEPTH,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      return {
        response: buildReportStatus(
          errorMsg,
          commands.map((c) => ({
            refName: c.refName,
            status: "ng unpack failed",
          })),
        ),
        updatedRefs: [],
      };
    }
  }

  // Index new commits
  const newCommitShas = new Set<string>();
  for (const cmd of commands) {
    if (cmd.newSha !== ZERO_SHA) {
      newCommitShas.add(cmd.newSha);
    }
  }

  for (const sha of newCommitShas) {
    await indexCommitsWalk(db, bucket, repoId, sha);
  }

  // Apply ref updates
  const results: Array<{ refName: string; status: string }> = [];
  const updatedRefs: RefCommand[] = [];

  for (const cmd of commands) {
    try {
      const result = await applyRefCommand(db, bucket, repoId, cmd);
      results.push({ refName: cmd.refName, status: result });
      if (result === "ok") {
        updatedRefs.push(cmd);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      results.push({ refName: cmd.refName, status: `ng ${errorMsg}` });
    }
  }

  return {
    response: buildReportStatus("ok", results),
    updatedRefs,
  };
}

/** @internal */
export function readPackObjectCount(packfileData: Uint8Array): number {
  if (packfileData.length < 12) {
    throw new Error("Incomplete pack header");
  }

  const signature = new TextDecoder().decode(packfileData.subarray(0, 4));
  if (signature !== "PACK") {
    throw new Error("Invalid packfile signature");
  }

  return (
    (packfileData[8] << 24) |
    (packfileData[9] << 16) |
    (packfileData[10] << 8) |
    packfileData[11]
  ) >>> 0;
}

/** @internal */
export function parseReceivePackBody(body: Uint8Array): {
  commands: RefCommand[];
  packfileData: Uint8Array | null;
} {
  const commands: RefCommand[] = [];
  let offset = 0;

  // Parse pkt-line commands until flush
  while (offset < body.length) {
    if (offset + 4 > body.length) break;

    const hexStr = new TextDecoder().decode(body.subarray(offset, offset + 4));
    const length = parseInt(hexStr, 16);

    if (length === 0) {
      offset += 4;
      break; // Flush packet — end of commands
    }

    if (length < 4 || offset + length > body.length) break;

    const lineData = new TextDecoder().decode(
      body.subarray(offset + 4, offset + length),
    );
    offset += length;

    // Parse: "<old-sha> <new-sha> <refname>[\0capabilities]"
    const line = lineData.replace(/\n$/, "");
    const nullIdx = line.indexOf("\0");
    const refLine = nullIdx !== -1 ? line.substring(0, nullIdx) : line;

    const parts = refLine.split(" ");
    if (parts.length >= 3) {
      commands.push({
        oldSha: parts[0],
        newSha: parts[1],
        refName: parts.slice(2).join(" "),
      });
    }
  }

  // Remaining data is the packfile
  const packfileData = offset < body.length ? body.subarray(offset) : null;

  return { commands, packfileData };
}

/** @internal */
export async function applyRefCommand(
  db: D1Database,
  bucket: R2Bucket,
  repoId: string,
  cmd: RefCommand,
): Promise<string> {
  const { oldSha, newSha, refName } = cmd;

  if (refName.startsWith("refs/heads/")) {
    const branchName = refName.slice("refs/heads/".length);

    // Validate ref name
    if (!isValidRefName(branchName)) {
      return "ng invalid ref name";
    }

    if (newSha === ZERO_SHA) {
      // Delete branch — deleteBranch already checks is_protected
      const result = await deleteBranch(db, repoId, branchName);
      return result.success ? "ok" : `ng ${result.error}`;
    }

    if (oldSha === ZERO_SHA) {
      // Create branch
      const result = await createBranch(db, repoId, branchName, newSha);
      return result.success ? "ok" : `ng ${result.error}`;
    }

    // Update branch — check protected branch and fast-forward
    const branch = await getBranch(db, repoId, branchName);
    if (branch?.is_protected) {
      return "ng protected branch";
    }

    // Fast-forward check: oldSha must be ancestor of newSha
    const isFastForward = await isAncestor(db, bucket, repoId, oldSha, newSha);
    if (!isFastForward) {
      return "ng non-fast-forward update rejected";
    }

    const result = await updateBranch(db, repoId, branchName, oldSha, newSha);
    return result.success ? "ok" : `ng ${result.error}`;
  }

  if (refName.startsWith("refs/tags/")) {
    const tagName = refName.slice("refs/tags/".length);

    // Validate ref name
    if (!isValidRefName(tagName)) {
      return "ng invalid ref name";
    }

    if (newSha === ZERO_SHA) {
      const result = await deleteTag(db, repoId, tagName);
      return result.success ? "ok" : `ng ${result.error}`;
    }

    const result = await createTag(db, repoId, tagName, newSha);
    return result.success ? "ok" : `ng ${result.error}`;
  }

  return "ng unsupported ref type";
}

/**
 * Walk commit ancestry and index any unindexed commits.
 * @internal
 */
export async function indexCommitsWalk(
  db: D1Database,
  bucket: R2Bucket,
  repoId: string,
  sha: string,
  maxDepth = 100,
): Promise<void> {
  const visited = new Set<string>();
  const queue: string[] = [sha];
  let depth = 0;

  while (queue.length > 0 && depth < maxDepth) {
    const currentSha = queue.shift()!;
    if (visited.has(currentSha) || currentSha === ZERO_SHA) continue;
    visited.add(currentSha);
    depth++;

    const commit = await getCommit(db, bucket, repoId, currentSha);
    if (commit) {
      // Already indexed, but check parents
      await indexCommit(db, repoId, commit);
      for (const parent of commit.parents) {
        if (!visited.has(parent)) queue.push(parent);
      }
    }
  }
}

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
export async function readReceivePackStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<{ commands: RefCommand[]; packfileData: Uint8Array | null }> {
  const reader = stream.getReader();
  const commands: RefCommand[] = [];

  // Accumulate bytes in a buffer for incremental pkt-line parsing
  let buffer: Uint8Array = new Uint8Array(0);
  let totalBytes = 0;
  let commandsParsed = false;
  let commandsEndOffset = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new Error(
          `Push body size ${totalBytes} exceeds limit of ${maxBytes}`,
        );
      }

      // Append chunk to buffer
      buffer = concatBytes(
        buffer,
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      );

      // Try to parse pkt-line commands from accumulated buffer
      if (!commandsParsed) {
        const parseResult = tryParsePktLineCommands(buffer);
        if (parseResult) {
          commands.push(...parseResult.commands);
          commandsEndOffset = parseResult.endOffset;
          commandsParsed = true;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // If commands were never fully parsed (no flush received), parse what we have
  if (!commandsParsed) {
    const parseResult = tryParsePktLineCommands(buffer);
    if (parseResult) {
      commands.push(...parseResult.commands);
      commandsEndOffset = parseResult.endOffset;
    }
  }

  // Extract packfile data from remaining bytes after commands
  const packfileData = commandsEndOffset < buffer.length
    ? buffer.subarray(commandsEndOffset)
    : null;

  return { commands, packfileData };
}

/**
 * Attempt to parse pkt-line commands from accumulated buffer.
 * Returns null if the buffer doesn't yet contain a complete set
 * of commands (no flush packet found).
 * @internal
 */
export function tryParsePktLineCommands(
  buffer: Uint8Array,
): { commands: RefCommand[]; endOffset: number } | null {
  const commands: RefCommand[] = [];
  let offset = 0;
  const decoder = new TextDecoder();

  while (offset < buffer.length) {
    if (offset + 4 > buffer.length) return null; // Need more data

    const hexStr = decoder.decode(buffer.subarray(offset, offset + 4));
    const length = parseInt(hexStr, 16);

    if (length === 0) {
      // Flush packet — end of commands
      offset += 4;
      return { commands, endOffset: offset };
    }

    if (length < 4) {
      offset += 4;
      continue;
    }

    if (offset + length > buffer.length) return null; // Need more data

    const lineData = decoder.decode(
      buffer.subarray(offset + 4, offset + length),
    );
    offset += length;

    // Parse: "<old-sha> <new-sha> <refname>[\0capabilities]"
    const line = lineData.replace(/\n$/, "");
    const nullIdx = line.indexOf("\0");
    const refLine = nullIdx !== -1 ? line.substring(0, nullIdx) : line;

    const parts = refLine.split(" ");
    if (parts.length >= 3) {
      commands.push({
        oldSha: parts[0],
        newSha: parts[1],
        refName: parts.slice(2).join(" "),
      });
    }
  }

  return null; // Buffer consumed without finding flush
}

/** @internal */
export function buildReportStatus(
  unpackStatus: string,
  refResults: Array<{ refName: string; status: string }>,
): Uint8Array {
  // Build the report-status pkt-lines
  const statusParts: Uint8Array[] = [];

  statusParts.push(encodePktLine(`unpack ${unpackStatus}\n`));

  for (const ref of refResults) {
    if (ref.status === "ok") {
      statusParts.push(encodePktLine(`ok ${ref.refName}\n`));
    } else {
      statusParts.push(encodePktLine(`ng ${ref.refName} ${ref.status}\n`));
    }
  }

  statusParts.push(flushPkt());

  // Wrap in side-band-64k framing (channel 1 = data)
  const statusData = concatBytes(...statusParts);
  const CHUNK_SIZE = 65515;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < statusData.length; i += CHUNK_SIZE) {
    const chunk = statusData.subarray(
      i,
      Math.min(i + CHUNK_SIZE, statusData.length),
    );
    parts.push(encodeSideBandData(1, chunk));
  }
  parts.push(flushPkt());
  return concatBytes(...parts);
}
