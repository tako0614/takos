import { Hono } from "hono";
import {
  type GitCreateRepositoryRequest,
  type GitFetchExternalRepositoryRequest,
  type GitFetchExternalRepositoryResponse,
  type GitImportExternalRepositoryRequest,
  type GitImportExternalRepositoryResponse,
  type GitRepositorySummary,
  type GitResolveSourceRequest,
  type GitResolveSourceResponse,
  type GitSourceSnapshotRequest,
  type GitUpdateRepositoryRequest,
  TAKOS_GIT_INTERNAL_PATHS,
} from "takos-git-contract";
import {
  canAccessRepositoryOwner,
  readInternalAuth,
  repositoryAccessDenied,
} from "./auth.ts";
import {
  bytesToArrayBuffer,
  configuredStorageReady,
  createConfiguredBareRepository,
  isLiteralObjectId,
  notImplemented,
  readConfiguredGitPrettyObject,
  readConfiguredGitRawObject,
  readConfiguredGitRefs,
  repositoryNotFound,
  runRepositoryHardeningBackfillOnce,
  writeConfiguredGitRefs,
} from "./git.ts";
import {
  canReadRepository,
  canWriteRepository,
  createRepositoryStorage,
  deleteRepository,
  findRepository,
  listRepositoryRefs,
  normalizeRefs,
  readRepositories,
  repositoryDetail,
  repositoryRefs,
  repositorySummary,
  requireRepositoryRead,
  requireRepositoryWrite,
  resolveStoredRef,
  type StoredGitRepository,
  upsertRepository,
} from "./repo-store.ts";
import {
  buildBlobResponse,
  buildCommitResponse,
  buildCommitsResponse,
  buildCompareResponse,
  buildSourceSnapshot,
  buildTreeResponse,
  gitObjectTooLarge,
  maxGitBlobBytes,
  resolveConfiguredGitRef,
  verifyLiteralSourceCommit,
} from "./response-builders.ts";
import {
  importExternalRemoteIntoConfiguredRepository,
  removeConfiguredRepositoryDirectory,
} from "./external-import.ts";
import { registerPullRequestRoutes } from "./routes-pull-requests.ts";
import { handleSmartHttp, isGitSmartHttpPath } from "./smart-http.ts";
import {
  repositoryOwnerSpaceId,
  validateExternalFetchRequest,
  validateExternalImportRequest as validateExternalImportRequestBase,
  validateRepositoryMetadata as validateRepositoryMetadataBase,
} from "./validation.ts";

const app: Hono = new Hono();
app.get("/health", (c) => c.json({ ok: true, service: "takos-git" }));

app.get("/ready", (c) => {
  if (configuredStorageReady()) {
    return c.json({ ok: true, service: "takos-git" });
  }
  return c.json({
    ok: false,
    service: "takos-git",
    error:
      "TAKOS_GIT_REPOSITORY_ROOT is required outside dev in-memory metadata mode",
    code: "git_storage_not_configured",
  }, 503);
});

app.get(TAKOS_GIT_INTERNAL_PATHS.repositories, async (c) => {
  const auth = await readInternalAuth(c.req.raw);
  if (!auth.ok) return c.json({ error: auth.error }, 401);
  if (!configuredStorageReady()) {
    return c.json(notImplemented("git_repository_root_not_configured"), 501);
  }

  const summaries: GitRepositorySummary[] = (await readRepositories())
    .filter((repository) => canReadRepository(auth, repository))
    .map(repositorySummary);
  return c.json({ repositories: summaries });
});

app.post(TAKOS_GIT_INTERNAL_PATHS.repositories, async (c) => {
  const auth = await readInternalAuth(c.req.raw);
  if (!auth.ok) return c.json({ error: auth.error }, 401);

  const request = await c.req.json<Partial<GitCreateRepositoryRequest>>();
  const invalid = validateRepositoryMetadata(request, true);
  if (invalid) return c.json(invalid, 400);
  const ownerSpaceId = repositoryOwnerSpaceId(request);
  if (!ownerSpaceId) {
    return c.json({
      error: "ownerSpaceId must be a non-empty Takos space id",
      code: "invalid_repository_owner_space",
    }, 400);
  }
  if (!canAccessRepositoryOwner(auth, ownerSpaceId, "write")) {
    return c.json(repositoryAccessDenied(request.id!), 403);
  }
  const storedRepositories = await readRepositories();
  if (storedRepositories.some((repository) => repository.id === request.id!)) {
    return c.json({
      error: "repository already exists",
      code: "git_repository_already_exists",
      repositoryId: request.id,
    }, 409);
  }
  const createResult = await createRepositoryStorage(request.id!, {
    defaultBranch: request.defaultBranch ?? "main",
    mode: request.initialization?.mode ?? "default",
  });
  if (!createResult.ok) return c.json(createResult.body, createResult.status);

  const now = new Date().toISOString();
  const repository: StoredGitRepository = {
    id: request.id!,
    name: request.name!,
    ownerSpaceId,
    defaultBranch: request.defaultBranch ?? "main",
    refs: normalizeRefs(request.refs)!,
    createdAt: now,
    updatedAt: now,
  };
  if (request.refs !== undefined) {
    const refsResult = await writeConfiguredGitRefs(
      repository.id,
      repositoryRefs(repository),
    );
    if (!refsResult.ok && refsResult.status !== 501) {
      return c.json(refsResult.body, refsResult.status);
    }
  }
  await upsertRepository(repository);
  return c.json({ repository: repositoryDetail(repository) }, 201);
});

app.post(TAKOS_GIT_INTERNAL_PATHS.importExternalRepository, async (c) => {
  const auth = await readInternalAuth(c.req.raw);
  if (!auth.ok) return c.json({ error: auth.error }, 401);

  const request = await c.req
    .json<Partial<GitImportExternalRepositoryRequest>>()
    .catch(() => undefined);
  const invalid = validateExternalImportRequest(request);
  if (invalid) return c.json(invalid, 400);
  if ("actor" in request!) {
    return c.json({
      error: "actor context must be provided by signed internal headers",
      code: "invalid_external_import_request",
    }, 400);
  }

  const ownerSpaceId = repositoryOwnerSpaceId(request!);
  if (!canAccessRepositoryOwner(auth, ownerSpaceId!, "write")) {
    return c.json(repositoryAccessDenied(request!.id!), 403);
  }
  const storedRepositories = await readRepositories();
  if (storedRepositories.some((repository) => repository.id === request!.id!)) {
    return c.json({
      error: "repository already exists",
      code: "git_repository_already_exists",
      repositoryId: request!.id,
    }, 409);
  }

  const createResult = await createConfiguredBareRepository(request!.id!, {
    defaultBranch: request!.defaultBranch ?? "main",
    mode: "bare",
  });
  if (!createResult.ok) {
    return c.json(createResult.body, createResult.status);
  }

  const now = new Date().toISOString();
  const pendingRepository: StoredGitRepository = {
    id: request!.id!,
    name: request!.name!,
    ownerSpaceId: ownerSpaceId!,
    defaultBranch: request!.defaultBranch ?? "main",
    refs: new Map(),
    createdAt: now,
    updatedAt: now,
  };
  await upsertRepository(pendingRepository);

  try {
    const imported = await importExternalRemoteIntoConfiguredRepository({
      repositoryId: request!.id!,
      remoteUrl: request!.remoteUrl!,
      authHeader: request!.authHeader ?? null,
      requestedDefaultBranch: request!.defaultBranch,
      previousRefs: [],
    });
    if (!imported.ok) {
      await removeConfiguredRepositoryDirectory(request!.id!);
      // Roll back only the row we just created; leave other repositories
      // (possibly created concurrently) untouched.
      await deleteRepository(request!.id!);
      return c.json(imported.body, imported.status);
    }

    const repository: StoredGitRepository = {
      ...pendingRepository,
      defaultBranch: imported.defaultBranch,
      refs: normalizeRefs(imported.refs)!,
      updatedAt: new Date().toISOString(),
    };
    await upsertRepository(repository);

    const response: GitImportExternalRepositoryResponse = {
      repository: repositoryDetail(repository),
      remoteUrl: request!.remoteUrl!,
      defaultBranch: imported.defaultBranch,
      branchCount: imported.branchCount,
      tagCount: imported.tagCount,
      commitCount: imported.commitCount,
    };
    return c.json(response, 201);
  } catch (error) {
    await removeConfiguredRepositoryDirectory(request!.id!);
    // Roll back only the row we just created.
    await deleteRepository(request!.id!);
    return c.json({
      error: error instanceof Error ? error.message : "external import failed",
      code: "git_external_import_failed",
      repositoryId: request!.id,
    }, 422);
  }
});

app.get("/internal/repositories/:repositoryId", async (c) => {
  const auth = await readInternalAuth(c.req.raw);
  if (!auth.ok) return c.json({ error: auth.error }, 401);

  const repository = await findRepository(c.req.param("repositoryId"));
  if (!repository) {
    return c.json(repositoryNotFound(c.req.param("repositoryId")), 404);
  }
  if (!canReadRepository(auth, repository)) {
    return c.json(repositoryAccessDenied(repository.id), 403);
  }
  return c.json({ repository: repositoryDetail(repository) });
});

app.post("/internal/repositories/:repositoryId/fetch-external", async (c) => {
  const auth = await readInternalAuth(c.req.raw);
  if (!auth.ok) return c.json({ error: auth.error }, 401);

  const access = await requireRepositoryWrite(
    auth,
    c.req.param("repositoryId"),
  );
  if (!access.ok) return c.json(access.body, access.status);

  const request = await c.req
    .json<Partial<GitFetchExternalRepositoryRequest>>()
    .catch(() => undefined);
  const invalid = validateExternalFetchRequest(request);
  if (invalid) return c.json(invalid, 400);
  if ("actor" in request!) {
    return c.json({
      error: "actor context must be provided by signed internal headers",
      code: "invalid_external_fetch_request",
    }, 400);
  }

  const refsBefore = repositoryRefs(access.repository);
  const imported = await importExternalRemoteIntoConfiguredRepository({
    repositoryId: access.repository.id,
    remoteUrl: request!.remoteUrl!,
    authHeader: request!.authHeader ?? null,
    requestedDefaultBranch: access.repository.defaultBranch,
    previousRefs: refsBefore,
  });
  if (!imported.ok) return c.json(imported.body, imported.status);

  const repository: StoredGitRepository = {
    ...access.repository,
    defaultBranch: imported.defaultBranch,
    refs: normalizeRefs(imported.refs)!,
    updatedAt: new Date().toISOString(),
  };
  await upsertRepository(repository);

  const response: GitFetchExternalRepositoryResponse = {
    repositoryId: repository.id,
    remoteUrl: request!.remoteUrl!,
    defaultBranch: imported.defaultBranch,
    branchCount: imported.branchCount,
    tagCount: imported.tagCount,
    commitCount: imported.commitCount,
    newCommits: imported.newCommits,
    updatedBranches: imported.updatedBranches,
    newTags: imported.newTags,
    refs: imported.refs,
  };
  return c.json(response);
});

app.get("/internal/repositories/:repositoryId/refs", async (c) => {
  const auth = await readInternalAuth(c.req.raw);
  if (!auth.ok) return c.json({ error: auth.error }, 401);

  const repositoryId = c.req.param("repositoryId");
  const repository = await findRepository(repositoryId);
  if (repository && !canReadRepository(auth, repository)) {
    return c.json(repositoryAccessDenied(repositoryId), 403);
  }
  const gitRefs = await readConfiguredGitRefs(repositoryId);
  if (gitRefs.ok) {
    return c.json({ repositoryId, refs: gitRefs.refs });
  }
  if (gitRefs.status !== 501) return c.json(gitRefs.body, gitRefs.status);

  if (!repository) return c.json(gitRefs.body, 501);
  return c.json({ repositoryId, refs: repositoryRefs(repository) });
});

app.get("/internal/repositories/:repositoryId/branches", async (c) => {
  const auth = await readInternalAuth(c.req.raw);
  if (!auth.ok) return c.json({ error: auth.error }, 401);

  const access = await requireRepositoryRead(auth, c.req.param("repositoryId"));
  if (!access.ok) return c.json(access.body, access.status);
  const result = await listRepositoryRefs(access.repository, "refs/heads/");
  if (!result.ok) return c.json(result.body, result.status);
  return c.json(result.response);
});

app.get("/internal/repositories/:repositoryId/tags", async (c) => {
  const auth = await readInternalAuth(c.req.raw);
  if (!auth.ok) return c.json({ error: auth.error }, 401);

  const access = await requireRepositoryRead(auth, c.req.param("repositoryId"));
  if (!access.ok) return c.json(access.body, access.status);
  const result = await listRepositoryRefs(access.repository, "refs/tags/");
  if (!result.ok) return c.json(result.body, result.status);
  return c.json(result.response);
});

app.get("/internal/repositories/:repositoryId/tree", async (c) => {
  const auth = await readInternalAuth(c.req.raw);
  if (!auth.ok) return c.json({ error: auth.error }, 401);
  const access = await requireRepositoryRead(auth, c.req.param("repositoryId"));
  if (!access.ok) return c.json(access.body, access.status);
  const result = await buildTreeResponse({
    repository: access.repository,
    sourceRef: c.req.query("ref") || access.repository.defaultBranch,
    path: c.req.query("path") || ".",
  });
  if (!result.ok) return c.json(result.body, result.status);
  return c.json(result.response);
});

app.get("/internal/repositories/:repositoryId/blob", async (c) => {
  const auth = await readInternalAuth(c.req.raw);
  if (!auth.ok) return c.json({ error: auth.error }, 401);
  const access = await requireRepositoryRead(auth, c.req.param("repositoryId"));
  if (!access.ok) return c.json(access.body, access.status);
  const result = await buildBlobResponse({
    repository: access.repository,
    sourceRef: c.req.query("ref") || access.repository.defaultBranch,
    path: c.req.query("path") || "",
  });
  if (!result.ok) return c.json(result.body, result.status);
  return c.json(result.response);
});

app.get(
  "/internal/repositories/:repositoryId/commits",
  async (c) => {
    const auth = await readInternalAuth(c.req.raw);
    if (!auth.ok) return c.json({ error: auth.error }, 401);
    const access = await requireRepositoryRead(
      auth,
      c.req.param("repositoryId"),
    );
    if (!access.ok) return c.json(access.body, access.status);
    const limit = Number(c.req.query("limit") ?? "50");
    const offset = Number(c.req.query("offset") ?? "0");
    const result = await buildCommitsResponse({
      repository: access.repository,
      sourceRef: c.req.query("ref") || access.repository.defaultBranch,
      path: c.req.query("path") || undefined,
      limit: Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 50,
      offset: Number.isInteger(offset) ? Math.max(offset, 0) : 0,
    });
    if (!result.ok) return c.json(result.body, result.status);
    return c.json(result.response);
  },
);

app.get(
  "/internal/repositories/:repositoryId/commits/:commitish",
  async (c) => {
    const auth = await readInternalAuth(c.req.raw);
    if (!auth.ok) return c.json({ error: auth.error }, 401);
    const access = await requireRepositoryRead(
      auth,
      c.req.param("repositoryId"),
    );
    if (!access.ok) return c.json(access.body, access.status);
    const result = await buildCommitResponse({
      repository: access.repository,
      sourceRef: c.req.param("commitish"),
    });
    if (!result.ok) return c.json(result.body, result.status);
    return c.json(result.response);
  },
);

app.get(
  "/internal/repositories/:repositoryId/compare",
  async (c) => {
    const auth = await readInternalAuth(c.req.raw);
    if (!auth.ok) return c.json({ error: auth.error }, 401);
    const access = await requireRepositoryRead(
      auth,
      c.req.param("repositoryId"),
    );
    if (!access.ok) return c.json(access.body, access.status);
    const baseRef = c.req.query("base");
    const headRef = c.req.query("head");
    if (!baseRef || !headRef) {
      return c.json({
        error: "base and head query parameters are required",
        code: "invalid_git_compare_request",
        repositoryId: access.repository.id,
      }, 400);
    }
    const result = await buildCompareResponse({
      repository: access.repository,
      baseRef,
      headRef,
    });
    if (!result.ok) return c.json(result.body, result.status);
    return c.json(result.response);
  },
);

app.patch("/internal/repositories/:repositoryId", async (c) => {
  const auth = await readInternalAuth(c.req.raw);
  if (!auth.ok) return c.json({ error: auth.error }, 401);

  const repositoryId = c.req.param("repositoryId");
  const repository = await findRepository(repositoryId);
  if (!repository) return c.json(repositoryNotFound(repositoryId), 404);
  if (!canWriteRepository(auth, repository)) {
    return c.json(repositoryAccessDenied(repositoryId), 403);
  }

  const request = await c.req.json<Partial<GitUpdateRepositoryRequest>>();
  const invalid = validateRepositoryMetadata(request, false);
  if (invalid) return c.json(invalid, 400);
  if (
    repositoryOwnerSpaceId(request) &&
    !canAccessRepositoryOwner(auth, repositoryOwnerSpaceId(request)!, "write")
  ) {
    return c.json(repositoryAccessDenied(repositoryId), 403);
  }

  if (typeof request.name === "string") repository.name = request.name;
  const nextOwnerSpaceId = repositoryOwnerSpaceId(request);
  if (nextOwnerSpaceId) {
    repository.ownerSpaceId = nextOwnerSpaceId;
  }
  if (typeof request.defaultBranch === "string") {
    repository.defaultBranch = request.defaultBranch;
  }
  if (request.refs !== undefined) {
    repository.refs = normalizeRefs(request.refs)!;
    const refsResult = await writeConfiguredGitRefs(
      repository.id,
      repositoryRefs(repository),
    );
    if (!refsResult.ok && refsResult.status !== 501) {
      return c.json(refsResult.body, refsResult.status);
    }
  }
  repository.updatedAt = new Date().toISOString();
  await upsertRepository(repository);
  return c.json({ repository: repositoryDetail(repository) });
});

app.post(TAKOS_GIT_INTERNAL_PATHS.sourceSnapshot, async (c) => {
  const auth = await readInternalAuth(c.req.raw);
  if (!auth.ok) return c.json({ error: auth.error }, 401);

  const request = await c.req.json<Partial<GitSourceSnapshotRequest>>();
  if (
    !request || typeof request !== "object" ||
    "actor" in request ||
    typeof request.repositoryId !== "string" ||
    typeof request.sourceRef !== "string"
  ) {
    return c.json({
      error:
        "repositoryId and sourceRef are required; actor context must be provided by signed internal headers",
      code: "invalid_source_snapshot_request",
    }, 400);
  }
  const repository = await findRepository(request.repositoryId);
  if (repository && !canReadRepository(auth, repository)) {
    return c.json(repositoryAccessDenied(request.repositoryId), 403);
  }

  const snapshot = await buildSourceSnapshot({
    repositoryId: request.repositoryId,
    defaultBranch: repository?.defaultBranch ?? "main",
    sourceRef: request.sourceRef,
    path: request.path,
    manifestPath: request.manifestPath,
  });
  if (!snapshot.ok) return c.json(snapshot.body, snapshot.status);
  return c.json(snapshot.response);
});

app.delete("/internal/repositories/:repositoryId", async (c) => {
  const auth = await readInternalAuth(c.req.raw);
  if (!auth.ok) return c.json({ error: auth.error }, 401);

  const repositoryId = c.req.param("repositoryId");
  const repository = await findRepository(repositoryId);
  if (repository && !canWriteRepository(auth, repository)) {
    return c.json(repositoryAccessDenied(repositoryId), 403);
  }
  const removed = await deleteRepository(repositoryId);
  if (!removed) {
    return c.json(repositoryNotFound(repositoryId), 404);
  }
  await removeConfiguredRepositoryDirectory(repositoryId);
  return new Response(null, { status: 204 });
});

app.post(TAKOS_GIT_INTERNAL_PATHS.resolveSource, async (c) => {
  const auth = await readInternalAuth(c.req.raw);
  if (!auth.ok) return c.json({ error: auth.error }, 401);

  const request = await c.req.json<Partial<GitResolveSourceRequest>>();
  if (
    !request || typeof request !== "object" ||
    "actor" in request ||
    typeof request.repositoryId !== "string" ||
    typeof request.sourceRef !== "string"
  ) {
    return c.json({
      error:
        "repositoryId and sourceRef are required; actor context must be provided by signed internal headers",
      code: "invalid_source_resolution_request",
    }, 400);
  }
  const repositoryForAccess = await findRepository(request.repositoryId);
  if (repositoryForAccess && !canReadRepository(auth, repositoryForAccess)) {
    return c.json(repositoryAccessDenied(request.repositoryId), 403);
  }

  if (isLiteralObjectId(request.sourceRef)) {
    const verified = await verifyLiteralSourceCommit(
      request.repositoryId,
      request.sourceRef,
    );
    if (!verified.ok) return c.json(verified.body, verified.status);
    const response: GitResolveSourceResponse = {
      sourceRef: request.sourceRef,
      repositoryId: request.repositoryId,
      resolvedCommit: verified.commit,
    };
    return c.json(response);
  }

  const configuredRef = await resolveConfiguredGitRef(
    request.repositoryId,
    (await findRepository(request.repositoryId))?.defaultBranch ?? "main",
    request.sourceRef,
  );
  if (!configuredRef.ok && configuredRef.status !== 501) {
    return c.json(configuredRef.body, configuredRef.status);
  }

  const repository = await findRepository(request.repositoryId);
  const resolved = configuredRef.ok
    ? configuredRef.resolved
    : (repository
      ? resolveStoredRef(repository, request.sourceRef)
      : undefined);
  if (!resolved) {
    // Fail-closed guard: either the repository storage is not configured
    // (configuredRef returned 501 and there is no in-memory fallback record)
    // or the sourceRef matched no ref in this repository. Both are genuine
    // resolution failures, not unimplemented behaviour.
    return c.json({
      error: "sourceRef could not be resolved to a commit in this repository",
      code: "git_ref_resolution_not_configured",
      repositoryId: request.repositoryId,
      sourceRef: request.sourceRef,
    }, 422);
  }

  const response: GitResolveSourceResponse = {
    sourceRef: request.sourceRef,
    repositoryId: request.repositoryId,
    resolvedCommit: resolved.target,
    resolvedRef: resolved.name,
  };
  return c.json(response);
});

app.get("/internal/objects/:repositoryId/:objectId", async (c) => {
  const auth = await readInternalAuth(c.req.raw);
  if (!auth.ok) return c.json({ error: auth.error }, 401);
  const repository = await findRepository(c.req.param("repositoryId"));
  if (repository && !canReadRepository(auth, repository)) {
    return c.json(repositoryAccessDenied(repository.id), 403);
  }

  const object = await readConfiguredGitPrettyObject(
    c.req.param("repositoryId"),
    c.req.param("objectId"),
  );
  if (!object.ok) return c.json(object.body, object.status);
  if (object.size > maxGitBlobBytes()) {
    return c.json(gitObjectTooLarge(object.objectId, object.size), 413);
  }
  return new Response(bytesToArrayBuffer(object.prettyContent), {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-takos-git-object-id": object.objectId,
      "x-takos-git-object-type": object.type,
      "x-takos-git-object-size": String(object.size),
      "x-takos-git-object-format": "git-cat-file-pretty",
    },
  });
});

app.get("/internal/objects/:repositoryId/:objectId/raw", async (c) => {
  const auth = await readInternalAuth(c.req.raw);
  if (!auth.ok) return c.json({ error: auth.error }, 401);
  const repository = await findRepository(c.req.param("repositoryId"));
  if (repository && !canReadRepository(auth, repository)) {
    return c.json(repositoryAccessDenied(repository.id), 403);
  }

  const object = await readConfiguredGitRawObject(
    c.req.param("repositoryId"),
    c.req.param("objectId"),
  );
  if (!object.ok) return c.json(object.body, object.status);
  if (object.size > maxGitBlobBytes()) {
    return c.json(gitObjectTooLarge(object.objectId, object.size), 413);
  }
  return new Response(bytesToArrayBuffer(object.content), {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "x-takos-git-object-id": object.objectId,
      "x-takos-git-object-type": object.type,
      "x-takos-git-object-size": String(object.size),
      "x-takos-git-object-format": "git-cat-file-raw",
    },
  });
});

registerPullRequestRoutes(app);

app.all(TAKOS_GIT_INTERNAL_PATHS.objects, async (c) => {
  const auth = await readInternalAuth(c.req.raw);
  if (!auth.ok) return c.json({ error: auth.error }, 401);

  return c.json(notImplemented("git_object_storage_not_implemented"), 501);
});

app.all("/internal/objects/*", async (c) => {
  const auth = await readInternalAuth(c.req.raw);
  if (!auth.ok) return c.json({ error: auth.error }, 401);

  return c.json(notImplemented("git_object_storage_not_implemented"), 501);
});

app.all("*", (c) => {
  const pathname = new URL(c.req.url).pathname;
  if (isGitSmartHttpPath(pathname)) {
    return handleSmartHttp(c.req.raw);
  }
  return c.json({ error: "not found" }, 404);
});

function validateRepositoryMetadata(
  request: Partial<GitCreateRepositoryRequest | GitUpdateRepositoryRequest>,
  requireAll: boolean,
): { error: string; code: string } | undefined {
  return validateRepositoryMetadataBase(request, requireAll, normalizeRefs);
}

function validateExternalImportRequest(
  request: Partial<GitImportExternalRepositoryRequest> | undefined,
): { error: string; code: string } | undefined {
  return validateExternalImportRequestBase(request, normalizeRefs);
}

if (import.meta.main) {
  const port = Number(Deno.env.get("PORT") ?? "8790");
  // Backfill hardened bare-repo config (receive.denyNonFastForwards,
  // receive.denyDeletes, transfer.fsckObjects, core.hooksPath=/dev/null)
  // across every pre-existing repo under TAKOS_GIT_REPOSITORY_ROOT.
  // Runs once per process and writes a `.takos-hardening-applied`
  // marker file in each repo so the walk is cheap on restart.
  runRepositoryHardeningBackfillOnce();
  Deno.serve({ port }, app.fetch);
}

export default app;
