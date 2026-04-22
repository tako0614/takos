import { Hono } from "hono";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import * as gitStore from "../../../application/services/git-smart/index.ts";
import { getContentTypeFromPath } from "../../../shared/utils/content-type.ts";
import { checkRepoAccess } from "../../../application/services/source/repos.ts";
import {
  encodeBase64,
  readableCommitErrorResponse,
  toGitBucket,
} from "./routes.ts";
import {
  BadRequestError,
  InternalError,
  isAppError,
  NotFoundError,
} from "takos-common/errors";
import { logError } from "../../../shared/utils/logger.ts";
import { requireFound, requireParam } from "../validation-utils.ts";
import {
  type RepoContext,
  requireBucket,
  throwIfTreeFlattenLimit,
  warnDegradedCommit,
} from "./git-shared.ts";

async function handleRepoTreeRequest(c: RepoContext) {
  const user = c.get("user");
  const repoId = requireParam(c.req.param("repoId"), "repoId");
  const ref = requireParam(c.req.param("ref"), "ref");
  const wildcardPath = c.req.param("*") || "";
  const queryPath = c.req.query("path") || "";
  const path = (wildcardPath || queryPath).replace(/^\/+/, "");

  requireFound(
    await checkRepoAccess(c.env, repoId, user?.id, undefined, {
      allowPublicRead: true,
    }),
    "Repository",
  );

  try {
    const bucket = toGitBucket(requireBucket(c));

    const resolvedCommit = await gitStore.resolveReadableCommitFromRef(
      c.env.DB,
      bucket,
      repoId,
      ref,
    );
    if (!resolvedCommit.ok) {
      return readableCommitErrorResponse(c, ref, resolvedCommit);
    }
    const commit = resolvedCommit.commit;

    warnDegradedCommit(resolvedCommit, repoId, ref);

    const entries = requireFound(
      await gitStore.listDirectory(bucket, commit.tree, path),
      "Path",
    );

    return c.json({
      path,
      ref,
      resolved_commit_sha: resolvedCommit.resolvedCommitSha,
      ref_commit_sha: resolvedCommit.refCommitSha,
      entries: entries.map((e) => ({
        name: e.name,
        type: e.mode === gitStore.FILE_MODES.DIRECTORY ? "directory" : "file",
        mode: e.mode,
        oid: e.sha,
      })),
    });
  } catch (err) {
    if (isAppError(err)) throw err;
    logError("Failed to get tree", err, { module: "routes/repos/git" });
    throw new InternalError("Failed to get file tree");
  }
}

async function handleRepoBlobRequest(c: RepoContext) {
  const user = c.get("user");
  const repoId = requireParam(c.req.param("repoId"), "repoId");
  const ref = requireParam(c.req.param("ref"), "ref");
  const wildcardPath = c.req.param("*") || "";
  const queryPath = c.req.query("path") || "";
  const path = (wildcardPath || queryPath).replace(/^\/+/, "");

  if (!path) {
    throw new BadRequestError("File path is required");
  }

  requireFound(
    await checkRepoAccess(c.env, repoId, user?.id, undefined, {
      allowPublicRead: true,
    }),
    "Repository",
  );

  try {
    const bucket = toGitBucket(requireBucket(c));

    const resolvedCommit = await gitStore.resolveReadableCommitFromRef(
      c.env.DB,
      bucket,
      repoId,
      ref,
    );
    if (!resolvedCommit.ok) {
      return readableCommitErrorResponse(c, ref, resolvedCommit);
    }
    const commit = resolvedCommit.commit;

    warnDegradedCommit(resolvedCommit, repoId, ref);

    const entry = await gitStore.getEntryAtPath(bucket, commit.tree, path);
    if (!entry || entry.type !== "blob") {
      throw new NotFoundError("File");
    }
    const blob = requireFound(
      await gitStore.getBlob(bucket, entry.sha),
      "File",
    );

    const isBinary = blob.some((byte) => byte === 0);
    const mimeType = getContentTypeFromPath(path);

    return c.json({
      path,
      ref,
      resolved_commit_sha: resolvedCommit.resolvedCommitSha,
      ref_commit_sha: resolvedCommit.refCommitSha,
      content: isBinary ? encodeBase64(blob) : new TextDecoder().decode(blob),
      size: blob.length,
      is_binary: isBinary,
      encoding: isBinary ? "base64" : "utf-8",
      mime_type: mimeType,
    });
  } catch (err) {
    if (isAppError(err)) throw err;
    logError("Failed to get blob", err, { module: "routes/repos/git" });
    throw new InternalError("Failed to get file content");
  }
}

const gitFiles = new Hono<AuthenticatedRouteEnv>()
  .get("/repos/:repoId/tree/:ref/*", handleRepoTreeRequest)
  .get("/repos/:repoId/tree/:ref", handleRepoTreeRequest)
  .get("/repos/:repoId/blob/:ref/*", handleRepoBlobRequest)
  .get("/repos/:repoId/blob/:ref", handleRepoBlobRequest)
  .get("/repos/:repoId/diff/:baseHead", async (c) => {
    const user = c.get("user");
    const repoId = c.req.param("repoId");
    const baseHead = c.req.param("baseHead");

    const match = baseHead.match(/^(.+?)(\.{2,3})(.+)$/);
    if (!match) {
      throw new BadRequestError(
        "Invalid diff format. Use base...head or base..head",
      );
    }

    const [, base, , head] = match;

    requireFound(
      await checkRepoAccess(c.env, repoId, user?.id, undefined, {
        allowPublicRead: true,
      }),
      "Repository",
    );

    try {
      const bucket = toGitBucket(requireBucket(c));

      const baseResolved = await gitStore.resolveReadableCommitFromRef(
        c.env.DB,
        bucket,
        repoId,
        base,
      );
      if (!baseResolved.ok) {
        return readableCommitErrorResponse(c, base, baseResolved);
      }

      const headResolved = await gitStore.resolveReadableCommitFromRef(
        c.env.DB,
        bucket,
        repoId,
        head,
      );
      if (!headResolved.ok) {
        return readableCommitErrorResponse(c, head, headResolved);
      }

      const baseCommit = baseResolved.commit;
      const headCommit = headResolved.commit;

      const baseFiles = await gitStore.flattenTree(bucket, baseCommit.tree);
      const headFiles = await gitStore.flattenTree(bucket, headCommit.tree);

      const baseMap = new Map(baseFiles.map((f) => [f.path, f.sha]));
      const headMap = new Map(headFiles.map((f) => [f.path, f.sha]));

      const files: Array<{
        path: string;
        status: "added" | "modified" | "deleted";
        additions: number;
        deletions: number;
      }> = [];

      for (const [path, sha] of headMap) {
        const baseSha = baseMap.get(path);
        if (!baseSha) {
          files.push({ path, status: "added", additions: 1, deletions: 0 });
        } else if (baseSha !== sha) {
          files.push({ path, status: "modified", additions: 1, deletions: 1 });
        }
      }

      for (const [path] of baseMap) {
        if (!headMap.has(path)) {
          files.push({ path, status: "deleted", additions: 0, deletions: 1 });
        }
      }

      files.sort((a, b) => a.path.localeCompare(b.path));

      const stats = {
        total_additions: files.reduce((sum, f) => sum + f.additions, 0),
        total_deletions: files.reduce((sum, f) => sum + f.deletions, 0),
        files_changed: files.length,
      };

      return c.json({
        base,
        head,
        base_resolved_commit_sha: baseResolved.resolvedCommitSha,
        head_resolved_commit_sha: headResolved.resolvedCommitSha,
        files,
        stats,
      });
    } catch (err) {
      throwIfTreeFlattenLimit(err, "compute diff");
      if (isAppError(err)) throw err;
      logError("Failed to get diff", err, { module: "routes/repos/git" });
      throw new InternalError("Failed to get diff");
    }
  });

export default gitFiles;
