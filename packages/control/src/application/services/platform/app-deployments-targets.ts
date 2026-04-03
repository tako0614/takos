import { and, eq } from "drizzle-orm";
import { accounts, getDb, repositories } from "../../../infra/db/index.ts";
import { BadRequestError, NotFoundError } from "takos-common/errors";
import type { Env } from "../../../shared/types/index.ts";
import { checkRepoAccess } from "../source/repos.ts";
import * as gitStore from "../git-smart/index.ts";
import { fetchPackFromRemote } from "../git-smart/client/fetch-pack.ts";
import { fetchRemoteRefs } from "../git-smart/client/fetch-refs.ts";
import { readPackfileAsync } from "../git-smart/protocol/packfile-reader.ts";
import {
  type AppManifest,
  parseAppManifestYaml,
  selectAppManifestPathFromRepo,
} from "../source/app-manifest.ts";
import {
  buildTakosRepositoryUrl,
  normalizeRepoPath,
  normalizeRepoRef,
  normalizeRepositoryUrl,
  parseTakosRepositoryUrl,
  type RepoRefType,
  repositoryUrlKey,
} from "./app-deployment-source.ts";
import { fetchRepositoryArchive } from "./remote-repo-archive.ts";
import { getRemoteFetchLimits } from "./remote-fetch-config.ts";
import {
  hasRemoteCapability,
  shouldTryContentReducingFallback,
  supportsRemoteBloblessFallback,
} from "./remote-fetch-policy.ts";
import type {
  AppDeploymentRow,
  AppDeploymentSource,
  RepositoryLocatorRow,
  ResolvedGitTarget,
} from "./app-deployments-model.ts";

function getGitBucket(env: Env) {
  return env.GIT_OBJECTS || null;
}

async function fetchMissingRemoteBlob(
  env: Env,
  target: ResolvedGitTarget,
  blobSha: string,
): Promise<Uint8Array | null> {
  if (target.archiveFiles || target.resolvedRepoId) return null;
  if (!target.remoteCapabilities) return null;
  if (
    !hasRemoteCapability(
      target.remoteCapabilities,
      "allow-reachable-sha1-in-want",
    )
  ) {
    return null;
  }

  const bucket = getGitBucket(env);
  if (!bucket) throw new BadRequestError("Git storage is not configured");
  const limits = getRemoteFetchLimits(env);

  const existing = await gitStore.getBlob(bucket, blobSha);
  if (existing) return existing;

  const packfile = await fetchPackFromRemote(
    target.repositoryUrl,
    null,
    [blobSha],
    [],
    {
      maxPackfileBytes: limits.blobPack.maxPackfileBytes,
      advertisedCapabilities: target.remoteCapabilities,
    },
  );
  await readPackfileAsync(packfile, bucket, limits.blobPack.readLimits);
  return await gitStore.getBlob(bucket, blobSha);
}

export async function readRepoBlobAtTarget(
  env: Env,
  target: ResolvedGitTarget,
  filePath: string,
): Promise<Uint8Array | null> {
  if (target.archiveFiles) {
    return target.archiveFiles.get(normalizeRepoPath(filePath)) ?? null;
  }

  if (!target.treeSha) return null;
  const bucket = getGitBucket(env);
  if (!bucket) throw new BadRequestError("Git storage is not configured");
  const entry = await gitStore.getEntryAtPath(
    bucket,
    target.treeSha,
    normalizeRepoPath(filePath),
  );
  if (!entry || entry.type !== "blob") return null;
  let blob = await gitStore.getBlob(bucket, entry.sha);
  if (blob) return blob;

  blob = await fetchMissingRemoteBlob(env, target, entry.sha);
  return blob;
}

export async function readRepoTextFileAtTarget(
  env: Env,
  target: ResolvedGitTarget,
  filePath: string,
): Promise<string | null> {
  const blob = await readRepoBlobAtTarget(env, target, filePath);
  if (!blob) return null;
  return new TextDecoder().decode(blob);
}

export async function listRepoPaths(
  env: Env,
  target: ResolvedGitTarget,
): Promise<string[]> {
  if (target.archiveFiles) {
    return Array.from(target.archiveFiles.keys()).sort();
  }

  if (!target.treeSha) return [];
  const bucket = getGitBucket(env);
  if (!bucket) throw new BadRequestError("Git storage is not configured");
  const entries = await gitStore.flattenTree(bucket, target.treeSha, "", {
    skipSymlinks: true,
  });
  return entries.map((entry) => entry.path);
}

export async function resolveRepositoryLocatorById(
  env: Env,
  repoId: string,
): Promise<RepositoryLocatorRow | null> {
  const db = getDb(env.DB);
  return await db.select({
    repoId: repositories.id,
    accountId: repositories.accountId,
    accountSlug: accounts.slug,
    name: repositories.name,
    visibility: repositories.visibility,
    defaultBranch: repositories.defaultBranch,
    remoteCloneUrl: repositories.remoteCloneUrl,
  }).from(repositories)
    .innerJoin(accounts, eq(repositories.accountId, accounts.id))
    .where(eq(repositories.id, repoId))
    .get() ?? null;
}

async function resolveKnownRepositoryByUrl(
  env: Env,
  repositoryUrl: string,
): Promise<RepositoryLocatorRow | null> {
  const db = getDb(env.DB);
  const takosUrl = parseTakosRepositoryUrl(env, repositoryUrl);
  if (takosUrl) {
    return await db.select({
      repoId: repositories.id,
      accountId: repositories.accountId,
      accountSlug: accounts.slug,
      name: repositories.name,
      visibility: repositories.visibility,
      defaultBranch: repositories.defaultBranch,
      remoteCloneUrl: repositories.remoteCloneUrl,
    }).from(repositories)
      .innerJoin(accounts, eq(repositories.accountId, accounts.id))
      .where(and(
        eq(accounts.slug, takosUrl.ownerSlug),
        eq(repositories.name, takosUrl.repoName),
      ))
      .get() ?? null;
  }

  return await db.select({
    repoId: repositories.id,
    accountId: repositories.accountId,
    accountSlug: accounts.slug,
    name: repositories.name,
    visibility: repositories.visibility,
    defaultBranch: repositories.defaultBranch,
    remoteCloneUrl: repositories.remoteCloneUrl,
  }).from(repositories)
    .innerJoin(accounts, eq(repositories.accountId, accounts.id))
    .where(eq(repositories.remoteCloneUrl, repositoryUrl))
    .get() ?? null;
}

async function resolveRepoTargetById(
  env: Env,
  input: {
    spaceId: string;
    userId: string;
    repoId: string;
    repositoryUrl: string;
    ref?: string;
    refType?: RepoRefType;
    allowPublicRead?: boolean;
  },
): Promise<ResolvedGitTarget> {
  const repoId = String(input.repoId || "").trim();
  if (!repoId) {
    throw new BadRequestError("repository_url did not resolve to a repository");
  }

  const repoAccess = await checkRepoAccess(
    env,
    repoId,
    input.userId,
    input.allowPublicRead ? undefined : ["owner", "admin", "editor"],
    { allowPublicRead: input.allowPublicRead === true },
  );
  if (!repoAccess) {
    throw new NotFoundError("Repository");
  }
  if (!input.allowPublicRead && repoAccess.spaceId !== input.spaceId) {
    throw new BadRequestError("Repository must belong to this workspace");
  }

  const refType = input.refType || "branch";
  const ref = normalizeRepoRef(
    refType,
    String(input.ref || "").trim() ||
      (refType === "branch" ? repoAccess.repo.default_branch || "main" : ""),
  );

  const bucket = getGitBucket(env);
  if (!bucket) throw new BadRequestError("Git storage is not configured");

  const commitSha = refType === "commit"
    ? ref
    : await gitStore.resolveRef(env.DB, repoId, ref);
  if (!commitSha) {
    throw new NotFoundError(`Ref not found: ${ref}`);
  }
  const commit = await gitStore.getCommitData(bucket, commitSha);
  if (!commit) {
    throw new NotFoundError(`Commit not found: ${commitSha}`);
  }

  return {
    repositoryUrl: input.repositoryUrl,
    normalizedRepositoryUrl: repositoryUrlKey(input.repositoryUrl),
    ref,
    refType,
    commitSha,
    treeSha: commit.tree,
    resolvedRepoId: repoId,
    archiveFiles: null,
    remoteCapabilities: null,
  };
}

function resolveRemoteDefaultBranch(
  refs: Array<{ name: string; sha: string }>,
  headTarget: string | null,
): string {
  if (headTarget?.startsWith("refs/heads/")) {
    return headTarget.replace(/^refs\/heads\//, "");
  }
  const main = refs.find((ref) => ref.name === "refs/heads/main");
  if (main) return "main";
  const master = refs.find((ref) => ref.name === "refs/heads/master");
  if (master) return "master";
  const firstBranch = refs.find((ref) => ref.name.startsWith("refs/heads/"));
  if (firstBranch) return firstBranch.name.replace(/^refs\/heads\//, "");
  throw new NotFoundError("Remote default branch");
}

async function resolveRemotePublicTarget(
  env: Env,
  input: {
    repositoryUrl: string;
    ref?: string;
    refType?: RepoRefType;
  },
): Promise<ResolvedGitTarget> {
  const repositoryUrl = normalizeRepositoryUrl(input.repositoryUrl);
  const { refs, headTarget, capabilities } = await fetchRemoteRefs(
    repositoryUrl,
    null,
  );
  if (refs.length === 0) {
    throw new NotFoundError("Remote repository refs");
  }

  const refType = input.refType || "branch";
  const ref = normalizeRepoRef(
    refType,
    String(input.ref || "").trim() ||
      (refType === "branch"
        ? resolveRemoteDefaultBranch(refs, headTarget)
        : ""),
  );

  const refName = refType === "branch"
    ? `refs/heads/${ref}`
    : refType === "tag"
    ? `refs/tags/${ref}`
    : null;
  const commitSha = refType === "commit"
    ? ref
    : refs.find((entry) => entry.name === refName)?.sha ?? null;
  if (!commitSha) {
    throw new NotFoundError(`Ref not found: ${ref}`);
  }

  const bucket = getGitBucket(env);
  if (!bucket) throw new BadRequestError("Git storage is not configured");
  const limits = getRemoteFetchLimits(env);

  try {
    const packfile = await fetchPackFromRemote(
      repositoryUrl,
      null,
      [commitSha],
      [],
      {
        maxPackfileBytes: limits.fullPack.maxPackfileBytes,
        advertisedCapabilities: capabilities,
      },
    );
    await readPackfileAsync(packfile, bucket, limits.fullPack.readLimits);
  } catch (error) {
    if (!shouldTryContentReducingFallback(error)) {
      throw error;
    }
    let lastError = error;

    if (supportsRemoteBloblessFallback(capabilities)) {
      try {
        const bloblessPackfile = await fetchPackFromRemote(
          repositoryUrl,
          null,
          [commitSha],
          [],
          {
            maxPackfileBytes: limits.fullPack.maxPackfileBytes,
            advertisedCapabilities: capabilities,
            filterSpec: "blob:none",
          },
        );
        await readPackfileAsync(
          bloblessPackfile,
          bucket,
          limits.fullPack.readLimits,
        );
        const commit = await gitStore.getCommitData(bucket, commitSha);
        if (!commit) {
          throw new NotFoundError(`Commit not found: ${commitSha}`);
        }
        return {
          repositoryUrl,
          normalizedRepositoryUrl: repositoryUrlKey(repositoryUrl),
          ref,
          refType,
          commitSha,
          treeSha: commit.tree,
          resolvedRepoId: null,
          archiveFiles: null,
          remoteCapabilities: capabilities,
        };
      } catch (bloblessError) {
        if (!shouldTryContentReducingFallback(bloblessError)) {
          throw bloblessError;
        }
        lastError = bloblessError;
      }
    }

    const archiveFiles = await fetchRepositoryArchive(
      repositoryUrl,
      commitSha,
      { maxArchiveBytes: limits.archive.maxArchiveBytes },
    );
    if (archiveFiles) {
      return {
        repositoryUrl,
        normalizedRepositoryUrl: repositoryUrlKey(repositoryUrl),
        ref,
        refType,
        commitSha,
        treeSha: null,
        resolvedRepoId: null,
        archiveFiles,
        remoteCapabilities: capabilities,
      };
    }
    throw lastError;
  }

  const commit = await gitStore.getCommitData(bucket, commitSha);
  if (!commit) {
    throw new NotFoundError(`Commit not found: ${commitSha}`);
  }

  return {
    repositoryUrl,
    normalizedRepositoryUrl: repositoryUrlKey(repositoryUrl),
    ref,
    refType,
    commitSha,
    treeSha: commit.tree,
    resolvedRepoId: null,
    archiveFiles: null,
    remoteCapabilities: capabilities,
  };
}

export async function resolveGitTarget(
  env: Env,
  input: {
    spaceId: string;
    userId: string;
    repositoryUrl: string;
    ref?: string;
    refType?: RepoRefType;
  },
): Promise<ResolvedGitTarget> {
  const repositoryUrl = normalizeRepositoryUrl(input.repositoryUrl);
  const knownRepo = await resolveKnownRepositoryByUrl(env, repositoryUrl);
  if (knownRepo) {
    try {
      return await resolveRepoTargetById(env, {
        spaceId: input.spaceId,
        userId: input.userId,
        repoId: knownRepo.repoId,
        repositoryUrl,
        ref: input.ref,
        refType: input.refType,
        allowPublicRead: knownRepo.visibility === "public",
      });
    } catch (error) {
      if (parseTakosRepositoryUrl(env, repositoryUrl)) {
        throw error;
      }
    }
  }

  return await resolveRemotePublicTarget(env, {
    repositoryUrl,
    ref: input.ref,
    refType: input.refType,
  });
}

export async function readManifestFromRepoTarget(
  env: Env,
  target: ResolvedGitTarget,
): Promise<AppManifest> {
  const manifestPath = selectAppManifestPathFromRepo(
    await listRepoPaths(env, target),
  );
  if (!manifestPath) {
    throw new NotFoundError("App manifest (.takos/app.yml)");
  }

  const rawManifest = await readRepoTextFileAtTarget(env, target, manifestPath);
  if (!rawManifest) {
    throw new NotFoundError(`App manifest not found at ${manifestPath}`);
  }

  try {
    return parseAppManifestYaml(rawManifest);
  } catch (error) {
    throw new BadRequestError(
      error instanceof Error ? error.message : "Invalid app manifest",
    );
  }
}

export async function resolveRepositoryUrlForRow(
  env: Env,
  row: AppDeploymentRow,
): Promise<string | null> {
  if (row.sourceRepositoryUrl) {
    return row.sourceRepositoryUrl;
  }

  const candidateRepoId = row.sourceResolvedRepoId ?? row.sourceRepoId ?? null;
  if (candidateRepoId) {
    const repo = await resolveRepositoryLocatorById(env, candidateRepoId);
    if (repo) {
      return buildTakosRepositoryUrl(env, repo.accountSlug, repo.name);
    }
  }

  if (row.sourceOwner && row.sourceRepoName) {
    return buildTakosRepositoryUrl(env, row.sourceOwner, row.sourceRepoName);
  }

  return null;
}

export async function buildSourceFromRow(
  env: Env,
  row: AppDeploymentRow,
): Promise<AppDeploymentSource> {
  return {
    kind: "git_ref",
    repository_url: await resolveRepositoryUrlForRow(env, row),
    ref: row.sourceRef ?? null,
    ref_type: row.sourceRefType === "branch" || row.sourceRefType === "tag" ||
        row.sourceRefType === "commit"
      ? row.sourceRefType
      : null,
    commit_sha: row.sourceCommitSha ?? null,
    resolved_repo_id: row.sourceResolvedRepoId ?? row.sourceRepoId ?? null,
  };
}
