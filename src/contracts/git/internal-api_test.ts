import assert from "node:assert/strict";
import {
  TAKOS_GIT_CAPABILITIES,
  TAKOS_GIT_INTERNAL_PATHS,
} from "./internal-api.ts";

Deno.test("Git contract exposes only Git-owned paths and capabilities", () => {
  assert.equal(TAKOS_GIT_INTERNAL_PATHS.repositories, "/internal/repositories");
  assert.equal(
    TAKOS_GIT_INTERNAL_PATHS.importExternalRepository,
    "/internal/repositories/import-external",
  );
  assert.equal(
    TAKOS_GIT_INTERNAL_PATHS.repository("repo/one"),
    "/internal/repositories/repo%2Fone",
  );
  assert.equal(
    TAKOS_GIT_INTERNAL_PATHS.fetchExternalRepository("repo/one"),
    "/internal/repositories/repo%2Fone/fetch-external",
  );
  assert.equal(
    TAKOS_GIT_INTERNAL_PATHS.repositoryRefs("repo/one"),
    "/internal/repositories/repo%2Fone/refs",
  );
  assert.equal(
    TAKOS_GIT_INTERNAL_PATHS.repositoryBranches("repo/one"),
    "/internal/repositories/repo%2Fone/branches",
  );
  assert.equal(
    TAKOS_GIT_INTERNAL_PATHS.repositoryTags("repo/one"),
    "/internal/repositories/repo%2Fone/tags",
  );
  assert.equal(
    TAKOS_GIT_INTERNAL_PATHS.object("repo/one", "abc123"),
    "/internal/objects/repo%2Fone/abc123",
  );
  assert.equal(
    TAKOS_GIT_INTERNAL_PATHS.rawObject("repo/one", "abc123"),
    "/internal/objects/repo%2Fone/abc123/raw",
  );
  assert.equal(
    TAKOS_GIT_INTERNAL_PATHS.repositoryTree("repo/one"),
    "/internal/repositories/repo%2Fone/tree",
  );
  assert.equal(
    TAKOS_GIT_INTERNAL_PATHS.repositoryBlob("repo/one"),
    "/internal/repositories/repo%2Fone/blob",
  );
  assert.equal(
    TAKOS_GIT_INTERNAL_PATHS.repositoryCommits("repo/one"),
    "/internal/repositories/repo%2Fone/commits",
  );
  assert.equal(
    TAKOS_GIT_INTERNAL_PATHS.repositoryCommit("repo/one", "main"),
    "/internal/repositories/repo%2Fone/commits/main",
  );
  assert.equal(
    TAKOS_GIT_INTERNAL_PATHS.repositoryCompare("repo/one"),
    "/internal/repositories/repo%2Fone/compare",
  );
  assert.equal(
    TAKOS_GIT_INTERNAL_PATHS.pullRequests("repo/one"),
    "/internal/repositories/repo%2Fone/pull-requests",
  );
  assert.equal(
    TAKOS_GIT_INTERNAL_PATHS.pullRequest("repo/one", 12),
    "/internal/repositories/repo%2Fone/pull-requests/12",
  );
  assert.equal(
    TAKOS_GIT_INTERNAL_PATHS.pullRequestDiff("repo/one", 12),
    "/internal/repositories/repo%2Fone/pull-requests/12/diff",
  );
  assert.equal(
    TAKOS_GIT_INTERNAL_PATHS.pullRequestComments("repo/one", 12),
    "/internal/repositories/repo%2Fone/pull-requests/12/comments",
  );
  assert.equal(
    TAKOS_GIT_INTERNAL_PATHS.pullRequestReviews("repo/one", 12),
    "/internal/repositories/repo%2Fone/pull-requests/12/reviews",
  );
  assert.equal(
    TAKOS_GIT_INTERNAL_PATHS.pullRequestMerge("repo/one", 12),
    "/internal/repositories/repo%2Fone/pull-requests/12/merge",
  );
  assert.deepEqual(TAKOS_GIT_CAPABILITIES, {
    repoRead: "git.repo.read",
    repoWrite: "git.repo.write",
    repoImport: "git.repo.import",
    objectRead: "git.object.read",
    refResolve: "git.ref.resolve",
    sourceSnapshot: "git.source.snapshot",
    prRead: "git.pr.read",
    prWrite: "git.pr.write",
    prMerge: "git.pr.merge",
  });
});
