import { test } from "bun:test";
import assert from "node:assert/strict";
// Bun migration: redirected from "node:sqlite" (unavailable in Bun 1.3.14) to
// the bun:sqlite-backed DatabaseSync shim. Same class name and surface.
import { DatabaseSync } from "../shims/node-sqlite.ts";
import app from "./index.ts";
import {
  TAKOS_GIT_CAPABILITIES,
  TAKOS_GIT_INTERNAL_PATHS,
  type TakosActorContext,
} from "takos-git-contract";
import { signTakosumiInternalRequest as signTakosInternalRequest } from "takosumi-contract/internal/rpc";
import { applyHardenedConfigToExistingRepo } from "./git.ts";
import { isSafeAuthHeader } from "./validation.ts";

const actor: TakosActorContext = {
  actorAccountId: "acct_1",
  roles: ["owner"],
  requestId: "req_1",
  spaceId: "space_1",
};

test("readiness distinguishes liveness from configured storage", async () => {
  const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
  const originalDevInMemory = Deno.env.get("TAKOS_GIT_DEV_IN_MEMORY_METADATA");
  Deno.env.delete("TAKOS_GIT_REPOSITORY_ROOT");
  Deno.env.delete("TAKOS_GIT_DEV_IN_MEMORY_METADATA");
  try {
    const health = await app.request("/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ok: true,
      service: "takos-git",
    });

    const notReady = await app.request("/ready");
    assert.equal(notReady.status, 503);
    assert.equal((await notReady.json()).code, "git_storage_not_configured");

    Deno.env.set("TAKOS_GIT_DEV_IN_MEMORY_METADATA", "true");
    const ready = await app.request("/ready");
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), {
      ok: true,
      service: "takos-git",
    });
  } finally {
    restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    restoreEnv("TAKOS_GIT_DEV_IN_MEMORY_METADATA", originalDevInMemory);
  }
});

test("source resolver accepts literal 40-hex commit ids", async () => {
  const sourceRef = "0123456789abcdef0123456789abcdef01234567";
  const response = await signedResolveRequest({
    repositoryId: "repo_1",
    sourceRef,
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    repositoryId: "repo_1",
    sourceRef,
    resolvedCommit: sourceRef,
  });
});

test("source resolver request body does not carry actor context", async () => {
  const sourceRef = "0123456789abcdef0123456789abcdef01234567";
  const response = await signedResolveRequest({
    repositoryId: "repo_1",
    sourceRef,
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    repositoryId: "repo_1",
    sourceRef,
    resolvedCommit: sourceRef,
  });
});

test("source resolver rejects actor context in request body", async () => {
  const response = await signedResolveRequest({
    repositoryId: "repo_1",
    sourceRef: "0123456789abcdef0123456789abcdef01234567",
    includeBodyActor: true,
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(body, {
    error:
      "repositoryId and sourceRef are required; actor context must be provided by signed internal headers",
    code: "invalid_source_resolution_request",
  });
});

test("source resolver accepts literal 64-hex commit ids", async () => {
  const sourceRef =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const response = await signedResolveRequest({
    repositoryId: "repo_1",
    sourceRef,
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    repositoryId: "repo_1",
    sourceRef,
    resolvedCommit: sourceRef,
  });
});

test("source resolver rejects branch or tag refs as unresolved", async () => {
  for (const sourceRef of ["main", "v1.0.0"]) {
    const response = await signedResolveRequest({
      repositoryId: "repo_1",
      sourceRef,
    });
    const body = await response.json();

    assert.equal(response.status, 422);
    assert.deepEqual(body, {
      error: "sourceRef could not be resolved to a commit in this repository",
      code: "git_ref_resolution_not_configured",
      repositoryId: "repo_1",
      sourceRef,
    });
  }
});

test("source resolver requires configured storage outside dev in-memory mode", async () => {
  const response = await signedResolveRequest({
    repositoryId: "repo_1",
    sourceRef: "0123456789abcdef0123456789abcdef01234567",
    devInMemoryMetadata: false,
  });

  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), {
    error: "not implemented or not configured in takos-git",
    code: "git_repository_root_not_configured",
  });
});

test("repository metadata rejects account-owned request shape", async () => {
  const create = await signedRequest({
    method: "POST",
    path: TAKOS_GIT_INTERNAL_PATHS.repositories,
    body: JSON.stringify({
      id: `metadata-${crypto.randomUUID()}`,
      name: "Account Owned",
      ownerAccountId: "space_1",
    }),
  });

  assert.equal(create.status, 400);
  assert.deepEqual(await create.json(), {
    error: "ownerAccountId is not supported; use ownerSpaceId",
    code: "invalid_repository_metadata_request",
  });

  const repositoryId = `metadata-${crypto.randomUUID()}`;
  const current = await signedRequest({
    method: "POST",
    path: TAKOS_GIT_INTERNAL_PATHS.repositories,
    body: JSON.stringify({
      id: repositoryId,
      name: "Space Owned",
      ownerSpaceId: "space_1",
    }),
  });
  assert.equal(current.status, 201);

  const update = await signedRequest({
    method: "PATCH",
    path: TAKOS_GIT_INTERNAL_PATHS.repository(repositoryId),
    body: JSON.stringify({
      ownerAccountId: "space_1",
    }),
  });

  assert.equal(update.status, 400);
  assert.deepEqual(await update.json(), {
    error: "ownerAccountId is not supported; use ownerSpaceId",
    code: "invalid_repository_metadata_request",
  });
});

test("repository metadata creation initializes an on-disk bare repository", async () => {
  const root = await Deno.makeTempDir();
  const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
  Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", root);
  try {
    const repositoryId = `metadata-${crypto.randomUUID()}`;
    const create = await signedRequest({
      method: "POST",
      path: TAKOS_GIT_INTERNAL_PATHS.repositories,
      body: JSON.stringify({
        id: repositoryId,
        name: "Metadata Only",
        ownerSpaceId: "space_1",
      }),
    });

    assert.equal(create.status, 201);
    assert.equal(
      (await Deno.stat(`${root}/${repositoryId}.git`)).isDirectory,
      true,
    );
    assert.equal(
      await git([
        "--git-dir",
        `${root}/${repositoryId}.git`,
        "rev-parse",
        "--is-bare-repository",
      ]),
      "true\n",
    );

    const refs = await signedRequest({
      method: "GET",
      path: TAKOS_GIT_INTERNAL_PATHS.repositoryRefs(repositoryId),
    });
    assert.equal(refs.status, 200);
    const refsBody = await refs.json();
    assert.equal(refsBody.repositoryId, repositoryId);
    assert.equal(refsBody.refs.length, 1);
    assert.equal(refsBody.refs[0].name, "refs/heads/main");
    assert.match(refsBody.refs[0].target, /^[0-9a-f]{40}$/);

    const resolved = await signedResolveRequest({
      repositoryId,
      sourceRef: "main",
    });
    const resolvedBody = await resolved.json();
    assert.equal(resolved.status, 200);
    assert.equal(resolvedBody.repositoryId, repositoryId);
    assert.equal(resolvedBody.sourceRef, "main");
    assert.equal(resolvedBody.resolvedRef, "refs/heads/main");
    assert.match(resolvedBody.resolvedCommit, /^[0-9a-f]{40}$/);
  } finally {
    restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    await Deno.remove(root, { recursive: true });
  }
});

test("repository metadata creation can initialize an empty bare repository", async () => {
  const root = await Deno.makeTempDir();
  const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
  Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", root);
  try {
    const repositoryId = `bare-${crypto.randomUUID()}`;
    const create = await signedRequest({
      method: "POST",
      path: TAKOS_GIT_INTERNAL_PATHS.repositories,
      body: JSON.stringify({
        id: repositoryId,
        name: "Bare Metadata Only",
        ownerSpaceId: "space_1",
        initialization: { mode: "bare" },
      }),
    });

    assert.equal(create.status, 201);
    const refs = await signedRequest({
      method: "GET",
      path: TAKOS_GIT_INTERNAL_PATHS.repositoryRefs(repositoryId),
    });
    assert.deepEqual(await refs.json(), {
      repositoryId,
      refs: [],
    });

    const resolved = await signedResolveRequest({
      repositoryId,
      sourceRef: "main",
    });
    assert.equal(resolved.status, 422);
    assert.deepEqual(await resolved.json(), {
      error: "sourceRef could not be resolved to a commit in this repository",
      code: "git_ref_resolution_not_configured",
      repositoryId,
      sourceRef: "main",
    });
  } finally {
    restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    await Deno.remove(root, { recursive: true });
  }
});

test("external import creates a Git-owned bare repository from a remote", async () => {
  const root = await Deno.makeTempDir();
  const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
  const originalAllowLocal = Deno.env.get(
    "TAKOS_GIT_DEV_ALLOW_LOCAL_REMOTE_URL",
  );
  Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", root);
  // The fixture uses an on-disk bare repository as the remote, which is
  // rejected by the protocol allowlist by default. Opt in for the test.
  Deno.env.set("TAKOS_GIT_DEV_ALLOW_LOCAL_REMOTE_URL", "true");
  try {
    const remote = await createRemoteFixture(root);
    const repositoryId = `imported-${crypto.randomUUID()}`;
    const response = await signedRequest({
      method: "POST",
      path: TAKOS_GIT_INTERNAL_PATHS.importExternalRepository,
      capabilities: [TAKOS_GIT_CAPABILITIES.repoImport],
      body: JSON.stringify({
        id: repositoryId,
        name: "Imported Repository",
        ownerSpaceId: "space_1",
        remoteUrl: remote.barePath,
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 201, JSON.stringify(body));
    assert.equal(body.repository.id, repositoryId);
    assert.equal(body.defaultBranch, "main");
    assert.equal(body.branchCount, 1);
    assert.equal(body.tagCount, 1);
    assert.equal(body.commitCount, 1);
    assert.deepEqual(
      body.repository.refs.map((ref: { name: string }) => ref.name).sort(),
      ["refs/heads/main", "refs/tags/v1.0.0"],
    );
    assert.equal(
      await git([
        "--git-dir",
        `${root}/${repositoryId}.git`,
        "rev-parse",
        "main",
      ]),
      `${remote.initialCommit}\n`,
    );
  } finally {
    restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    restoreEnv(
      "TAKOS_GIT_DEV_ALLOW_LOCAL_REMOTE_URL",
      originalAllowLocal,
    );
    await Deno.remove(root, { recursive: true });
  }
});

test("external import rejects unsupported remote protocols", async () => {
  const root = await Deno.makeTempDir();
  const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
  Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", root);
  try {
    const cases = [
      "file:///tmp/evil.git",
      "ext::sh -c id",
      "git://example.com/path",
      "ssh://example.com/path",
      "http://example.com/repo.git",
    ];
    for (const remoteUrl of cases) {
      const response = await signedRequest({
        method: "POST",
        path: TAKOS_GIT_INTERNAL_PATHS.importExternalRepository,
        capabilities: [TAKOS_GIT_CAPABILITIES.repoImport],
        body: JSON.stringify({
          id: `rejected-${crypto.randomUUID()}`,
          name: "Rejected Repository",
          ownerSpaceId: "space_1",
          remoteUrl,
        }),
      });
      const body = await response.json();
      assert.equal(
        response.status,
        400,
        `${remoteUrl}: ${JSON.stringify(body)}`,
      );
      assert.match(body.code, /^unsupported_remote_protocol/);
    }
  } finally {
    restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    await Deno.remove(root, { recursive: true });
  }
});

test("external import rejects remoteUrl hosts that resolve to private IPs", async () => {
  const root = await Deno.makeTempDir();
  const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
  Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", root);
  try {
    const cases = [
      "https://10.0.0.1/repo.git",
      "https://192.168.1.1/repo.git",
      "https://169.254.169.254/latest/meta-data/",
      "https://[::1]/repo.git",
      // DNS hostname that resolves to a loopback address. `localhost`
      // resolves to 127.0.0.1 / ::1, so DNS-resolve-then-validate must
      // reject it even though it is not an IP literal (SSRF guard).
      "https://localhost/repo.git",
      // SSH-shorthand IPv6 loopback in an abbreviated form: must be
      // canonicalized before the loopback check (previously bypassed).
      "git@[0::1]:repo.git",
    ];
    for (const remoteUrl of cases) {
      const response = await signedRequest({
        method: "POST",
        path: TAKOS_GIT_INTERNAL_PATHS.importExternalRepository,
        capabilities: [TAKOS_GIT_CAPABILITIES.repoImport],
        body: JSON.stringify({
          id: `rejected-${crypto.randomUUID()}`,
          name: "Rejected Repository",
          ownerSpaceId: "space_1",
          remoteUrl,
        }),
      });
      const body = await response.json();
      assert.equal(
        response.status,
        400,
        `${remoteUrl}: ${JSON.stringify(body)}`,
      );
      assert.equal(body.code, "unsupported_remote_protocol_host");
    }
  } finally {
    restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    await Deno.remove(root, { recursive: true });
  }
});

test("external fetch updates Git-owned refs from a remote", async () => {
  const root = await Deno.makeTempDir();
  const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
  const originalAllowLocal = Deno.env.get(
    "TAKOS_GIT_DEV_ALLOW_LOCAL_REMOTE_URL",
  );
  Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", root);
  Deno.env.set("TAKOS_GIT_DEV_ALLOW_LOCAL_REMOTE_URL", "true");
  try {
    const remote = await createRemoteFixture(root);
    const repositoryId = `fetch-${crypto.randomUUID()}`;
    const create = await signedRequest({
      method: "POST",
      path: TAKOS_GIT_INTERNAL_PATHS.importExternalRepository,
      capabilities: [TAKOS_GIT_CAPABILITIES.repoImport],
      body: JSON.stringify({
        id: repositoryId,
        name: "Fetch Repository",
        ownerSpaceId: "space_1",
        remoteUrl: remote.barePath,
      }),
    });
    assert.equal(create.status, 201, await create.text());

    await Deno.writeTextFile(`${remote.workPath}/CHANGELOG.md`, "changes\n");
    await git(["-C", remote.workPath, "add", "CHANGELOG.md"]);
    await git(["-C", remote.workPath, "commit", "-m", "add changelog"]);
    await git(["-C", remote.workPath, "push", "origin", "main"]);
    const nextCommit = (await git(["-C", remote.workPath, "rev-parse", "HEAD"]))
      .trim();

    const response = await signedRequest({
      method: "POST",
      path: TAKOS_GIT_INTERNAL_PATHS.fetchExternalRepository(repositoryId),
      capabilities: [TAKOS_GIT_CAPABILITIES.repoImport],
      body: JSON.stringify({ remoteUrl: remote.barePath }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.repositoryId, repositoryId);
    assert.equal(body.newCommits, 1);
    assert.deepEqual(body.updatedBranches, ["main"]);
    assert.equal(
      await git([
        "--git-dir",
        `${root}/${repositoryId}.git`,
        "rev-parse",
        "main",
      ]),
      `${nextCommit}\n`,
    );
  } finally {
    restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    restoreEnv(
      "TAKOS_GIT_DEV_ALLOW_LOCAL_REMOTE_URL",
      originalAllowLocal,
    );
    await Deno.remove(root, { recursive: true });
  }
});

test("repository metadata persists under configured repository root", async () => {
  const root = await Deno.makeTempDir();
  const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
  Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", root);
  try {
    const repositoryId = `durable-${crypto.randomUUID()}`;
    const create = await signedRequest({
      method: "POST",
      path: TAKOS_GIT_INTERNAL_PATHS.repositories,
      body: JSON.stringify({
        id: repositoryId,
        name: "Durable Metadata",
        ownerSpaceId: "space_1",
      }),
    });

    assert.equal(create.status, 201);
    assert.equal(
      (await Deno.stat(`${root}/.takos/containers/git.sqlite`)).isFile,
      true,
    );

    const list = await signedRequest({
      method: "GET",
      path: TAKOS_GIT_INTERNAL_PATHS.repositories,
    });
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), {
      repositories: [{
        id: repositoryId,
        name: "Durable Metadata",
        ownerSpaceId: "space_1",
        defaultBranch: "main",
      }],
    });
  } finally {
    restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    await Deno.remove(root, { recursive: true });
  }
});

test("source resolver resolves refs from configured bare repository root", async () => {
  await withBareRepository(async (fixture) => {
    const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
    Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", fixture.root);
    try {
      const response = await signedResolveRequest({
        repositoryId: fixture.repositoryId,
        sourceRef: "main",
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(body, {
        repositoryId: fixture.repositoryId,
        sourceRef: "main",
        resolvedCommit: fixture.commit,
        resolvedRef: "refs/heads/main",
      });
    } finally {
      restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    }
  });
});

test("source resolver verifies literal commits against configured bare repository root", async () => {
  await withBareRepository(async (fixture) => {
    const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
    Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", fixture.root);
    try {
      const response = await signedResolveRequest({
        repositoryId: fixture.repositoryId,
        sourceRef: fixture.commit,
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(body, {
        repositoryId: fixture.repositoryId,
        sourceRef: fixture.commit,
        resolvedCommit: fixture.commit,
      });
    } finally {
      restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    }
  });
});

test("source resolver rejects missing literal commits when repository root is configured", async () => {
  await withBareRepository(async (fixture) => {
    const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
    Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", fixture.root);
    try {
      const missingCommit = "f".repeat(40);
      const response = await signedResolveRequest({
        repositoryId: fixture.repositoryId,
        sourceRef: missingCommit,
      });
      const body = await response.json();

      assert.equal(response.status, 422);
      assert.deepEqual(body, {
        error: "literal commit id was not found in repository",
        code: "git_commit_not_found",
        repositoryId: fixture.repositoryId,
        objectId: missingCommit,
      });
    } finally {
      restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    }
  });
});

test("refs endpoint lists refs from configured bare repository root", async () => {
  await withBareRepository(async (fixture) => {
    const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
    Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", fixture.root);
    try {
      const response = await signedRequest({
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.repositoryRefs(fixture.repositoryId),
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(body, {
        repositoryId: fixture.repositoryId,
        refs: [
          { name: "refs/heads/feature/docs", target: fixture.featureCommit },
          { name: "refs/heads/main", target: fixture.commit },
          { name: "refs/tags/v1.0.0", target: fixture.commit },
        ],
      });
    } finally {
      restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    }
  });
});

test("object endpoint returns git cat-file pretty output from configured bare repository root", async () => {
  await withBareRepository(async (fixture) => {
    const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
    Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", fixture.root);
    try {
      const response = await signedRequest({
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.object(
          fixture.repositoryId,
          fixture.commit,
        ),
      });

      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get("x-takos-git-object-id"),
        fixture.commit,
      );
      assert.equal(response.headers.get("x-takos-git-object-type"), "commit");
      assert.equal(
        response.headers.get("x-takos-git-object-format"),
        "git-cat-file-pretty",
      );
      const text = await response.text();
      assert.match(text, /^tree [0-9a-f]{40}$/m);
      assert.match(text, /^author Takos Test <test@example\.com> /m);
      assert.match(text, /\n\ninitial\n$/);
    } finally {
      restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    }
  });
});

test("raw object endpoint returns git cat-file raw content", async () => {
  await withBareRepository(async (fixture) => {
    const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
    Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", fixture.root);
    try {
      const response = await signedRequest({
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.rawObject(
          fixture.repositoryId,
          fixture.blob,
        ),
      });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-takos-git-object-id"), fixture.blob);
      assert.equal(response.headers.get("x-takos-git-object-type"), "blob");
      assert.equal(
        response.headers.get("x-takos-git-object-format"),
        "git-cat-file-raw",
      );
      assert.equal(await response.text(), "hello from takos-git\n");
    } finally {
      restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    }
  });
});

test("repository browsing APIs return tree, blob, and commits", async () => {
  await withBareRepository(async (fixture) => {
    const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
    Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", fixture.root);
    try {
      const tree = await signedRequest({
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.repositoryTree(fixture.repositoryId),
        requestPath: `${
          TAKOS_GIT_INTERNAL_PATHS.repositoryTree(fixture.repositoryId)
        }?ref=main&path=.`,
      });
      assert.equal(tree.status, 200);
      const treeBody = await tree.json();
      assert.equal(treeBody.repositoryId, fixture.repositoryId);
      assert.equal(treeBody.resolvedCommit, fixture.commit);
      assert.deepEqual(treeBody.entries, [{
        path: "README.md",
        name: "README.md",
        mode: "100644",
        type: "blob",
        objectId: fixture.blob,
        size: 21,
      }]);

      const blob = await signedRequest({
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.repositoryBlob(fixture.repositoryId),
        requestPath: `${
          TAKOS_GIT_INTERNAL_PATHS.repositoryBlob(fixture.repositoryId)
        }?ref=main&path=README.md`,
      });
      assert.equal(blob.status, 200);
      const blobBody = await blob.json();
      assert.equal(blobBody.objectId, fixture.blob);
      assert.equal(blobBody.encoding, "utf-8");
      assert.equal(blobBody.content, "hello from takos-git\n");

      const commits = await signedRequest({
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.repositoryCommits(fixture.repositoryId),
        requestPath: `${
          TAKOS_GIT_INTERNAL_PATHS.repositoryCommits(fixture.repositoryId)
        }?ref=main&limit=1`,
      });
      assert.equal(commits.status, 200);
      const commitsBody = await commits.json();
      assert.equal(commitsBody.commits.length, 1);
      assert.equal(commitsBody.commits[0].sha, fixture.commit);
      assert.equal(commitsBody.commits[0].message, "initial");

      const pagedCommits = await signedRequest({
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.repositoryCommits(fixture.repositoryId),
        requestPath: `${
          TAKOS_GIT_INTERNAL_PATHS.repositoryCommits(fixture.repositoryId)
        }?ref=feature/docs&limit=1&offset=1`,
      });
      assert.equal(pagedCommits.status, 200);
      const pagedCommitsBody = await pagedCommits.json();
      assert.equal(pagedCommitsBody.commits.length, 1);
      assert.equal(pagedCommitsBody.commits[0].sha, fixture.commit);
      assert.equal(pagedCommitsBody.commits[0].message, "initial");

      const branches = await signedRequest({
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.repositoryBranches(
          fixture.repositoryId,
        ),
      });
      assert.equal(branches.status, 200);
      assert.deepEqual((await branches.json()).refs, [
        { name: "refs/heads/feature/docs", target: fixture.featureCommit },
        { name: "refs/heads/main", target: fixture.commit },
      ]);

      const tags = await signedRequest({
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.repositoryTags(fixture.repositoryId),
      });
      assert.equal(tags.status, 200);
      assert.deepEqual((await tags.json()).refs, [
        { name: "refs/tags/v1.0.0", target: fixture.commit },
      ]);

      const commit = await signedRequest({
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.repositoryCommit(
          fixture.repositoryId,
          fixture.commit,
        ),
      });
      assert.equal(commit.status, 200);
      assert.equal((await commit.json()).commit.sha, fixture.commit);

      const compare = await signedRequest({
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.repositoryCompare(fixture.repositoryId),
        requestPath: `${
          TAKOS_GIT_INTERNAL_PATHS.repositoryCompare(fixture.repositoryId)
        }?base=main&head=feature/docs`,
      });
      assert.equal(compare.status, 200);
      const compareBody = await compare.json();
      assert.equal(compareBody.baseCommit, fixture.commit);
      assert.equal(compareBody.headCommit, fixture.featureCommit);
      assert.equal(compareBody.aheadBy, 1);
      assert.equal(compareBody.behindBy, 0);
      assert.deepEqual(compareBody.files, [{
        path: "GUIDE.md",
        status: "added",
      }]);
    } finally {
      restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    }
  });
});

test("blob API enforces configured response size limit", async () => {
  await withBareRepository(async (fixture) => {
    const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
    const originalLimit = Deno.env.get("TAKOS_GIT_MAX_BLOB_BYTES");
    Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", fixture.root);
    Deno.env.set("TAKOS_GIT_MAX_BLOB_BYTES", "1");
    try {
      const blob = await signedRequest({
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.repositoryBlob(fixture.repositoryId),
        requestPath: `${
          TAKOS_GIT_INTERNAL_PATHS.repositoryBlob(fixture.repositoryId)
        }?ref=main&path=README.md`,
      });
      assert.equal(blob.status, 413);
      const body = await blob.json();
      assert.equal(body.code, "git_object_too_large");
      assert.equal(body.objectId, fixture.blob);
      assert.equal(body.maxBytes, 1);
    } finally {
      restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
      restoreEnv("TAKOS_GIT_MAX_BLOB_BYTES", originalLimit);
    }
  });
});

test("pull request metadata persists comments and reviews in sqlite", async () => {
  const root = await Deno.makeTempDir();
  const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
  Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", root);
  try {
    const repositoryId = `pr-${crypto.randomUUID()}`;
    const createRepository = await signedRequest({
      method: "POST",
      path: TAKOS_GIT_INTERNAL_PATHS.repositories,
      body: JSON.stringify({
        id: repositoryId,
        name: "Pull Requests",
        ownerSpaceId: "space_1",
      }),
    });
    assert.equal(createRepository.status, 201);

    const createPr = await signedRequest({
      method: "POST",
      path: TAKOS_GIT_INTERNAL_PATHS.pullRequests(repositoryId),
      body: JSON.stringify({
        title: "Add docs",
        description: "Document the repository",
        headBranch: "feature/docs",
        baseBranch: "main",
        runId: "run_1",
      }),
    });
    assert.equal(createPr.status, 201);
    const created = await createPr.json();
    assert.equal(created.pullRequest.repositoryId, repositoryId);
    assert.equal(created.pullRequest.number, 1);
    assert.equal(created.pullRequest.status, "open");
    assert.equal(created.pullRequest.authorAccountId, "acct_1");

    const comment = await signedRequest({
      method: "POST",
      path: TAKOS_GIT_INTERNAL_PATHS.pullRequestComments(repositoryId, 1),
      body: JSON.stringify({
        body: "Looks good",
        path: "README.md",
        line: 1,
      }),
    });
    assert.equal(comment.status, 201);

    const review = await signedRequest({
      method: "POST",
      path: TAKOS_GIT_INTERNAL_PATHS.pullRequestReviews(repositoryId, 1),
      body: JSON.stringify({
        status: "approved",
        body: "Ship it",
        analysis: "No blocking findings",
      }),
    });
    assert.equal(review.status, 201);

    const update = await signedRequest({
      method: "PATCH",
      path: TAKOS_GIT_INTERNAL_PATHS.pullRequest(repositoryId, 1),
      body: JSON.stringify({ status: "merged" }),
    });
    assert.equal(update.status, 200);
    const updated = await update.json();
    assert.equal(updated.pullRequest.status, "merged");
    assert.match(updated.pullRequest.mergedAt, /^\d{4}-\d{2}-\d{2}T/);

    const get = await signedRequest({
      method: "GET",
      path: TAKOS_GIT_INTERNAL_PATHS.pullRequest(repositoryId, 1),
    });
    assert.equal(get.status, 200);
    const detail = await get.json();
    assert.equal(detail.pullRequest.comments.length, 1);
    assert.equal(detail.pullRequest.comments[0].body, "Looks good");
    assert.equal(detail.pullRequest.reviews.length, 1);
    assert.equal(detail.pullRequest.reviews[0].status, "approved");

    const list = await signedRequest({
      method: "GET",
      path: `${
        TAKOS_GIT_INTERNAL_PATHS.pullRequests(repositoryId)
      }?status=merged`,
    });
    assert.equal(list.status, 200);
    assert.equal((await list.json()).pullRequests.length, 1);

    const database = new DatabaseSync(`${root}/.takos/containers/git.sqlite`);
    try {
      const migration = database.prepare(
        "SELECT applied_at FROM schema_migrations WHERE version = 1",
      ).get();
      assert.ok(migration);
    } finally {
      database.close();
    }
  } finally {
    restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    await Deno.remove(root, { recursive: true });
  }
});

test("pull request diff returns hunked file changes", async () => {
  await withBareRepository(async (fixture) => {
    const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
    Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", fixture.root);
    try {
      const createPr = await signedRequest({
        method: "POST",
        path: TAKOS_GIT_INTERNAL_PATHS.pullRequests(fixture.repositoryId),
        body: JSON.stringify({
          title: "Add guide",
          headBranch: "feature/docs",
          baseBranch: "main",
        }),
      });
      assert.equal(createPr.status, 201);

      const diff = await signedRequest({
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.pullRequestDiff(
          fixture.repositoryId,
          1,
        ),
      });
      assert.equal(diff.status, 200);
      const body = await diff.json();
      assert.equal(body.repositoryId, fixture.repositoryId);
      assert.equal(body.pullRequestNumber, 1);
      assert.equal(body.baseCommit, fixture.commit);
      assert.equal(body.headCommit, fixture.featureCommit);
      assert.deepEqual(body.stats, {
        totalAdditions: 1,
        totalDeletions: 0,
        filesChanged: 1,
      });
      assert.equal(body.files.length, 1);
      assert.equal(body.files[0].path, "GUIDE.md");
      assert.equal(body.files[0].status, "added");
      assert.equal(body.files[0].additions, 1);
      assert.equal(body.files[0].deletions, 0);
      assert.deepEqual(body.files[0].hunks[0].lines, [{
        type: "addition",
        content: "guide",
        newLine: 1,
      }]);
    } finally {
      restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    }
  });
});

test("pull request merge fast-forwards base branch and marks PR merged", async () => {
  await withBareRepository(async (fixture) => {
    const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
    Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", fixture.root);
    try {
      const createPr = await signedRequest({
        method: "POST",
        path: TAKOS_GIT_INTERNAL_PATHS.pullRequests(fixture.repositoryId),
        body: JSON.stringify({
          title: "Add guide",
          headBranch: "feature/docs",
          baseBranch: "main",
        }),
      });
      assert.equal(createPr.status, 201);

      const merge = await signedRequest({
        method: "POST",
        path: TAKOS_GIT_INTERNAL_PATHS.pullRequestMerge(
          fixture.repositoryId,
          1,
        ),
        body: JSON.stringify({
          mergeMethod: "ff-only",
          expectedHead: fixture.featureCommit,
        }),
      });
      assert.equal(merge.status, 200);
      const body = await merge.json();
      assert.equal(body.merged, true);
      assert.equal(body.method, "ff-only");
      assert.equal(body.baseCommit, fixture.commit);
      assert.equal(body.headCommit, fixture.featureCommit);
      assert.equal(body.pullRequest.status, "merged");

      const main = await git([
        "--git-dir",
        `${fixture.root}/${fixture.repositoryId}.git`,
        "rev-parse",
        "refs/heads/main",
      ]);
      assert.equal(main.trim(), fixture.featureCommit);
    } finally {
      restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    }
  });
});

test("repository owner authorization rejects other actor spaces", async () => {
  const root = await Deno.makeTempDir();
  const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
  Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", root);
  try {
    const repositoryId = `authz-${crypto.randomUUID()}`;
    const createRepository = await signedRequest({
      method: "POST",
      path: TAKOS_GIT_INTERNAL_PATHS.repositories,
      body: JSON.stringify({
        id: repositoryId,
        name: "Authz",
        ownerSpaceId: "space_1",
      }),
    });
    assert.equal(createRepository.status, 201);

    const denied = await signedRequest({
      method: "GET",
      path: TAKOS_GIT_INTERNAL_PATHS.repository(repositoryId),
      actorOverride: {
        actorAccountId: "acct_2",
        roles: ["owner"],
        requestId: "req_2",
        spaceId: "space_2",
      },
    });
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), {
      error: "repository access denied",
      code: "git_repository_access_denied",
      repositoryId,
    });
  } finally {
    restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    await Deno.remove(root, { recursive: true });
  }
});

test("source snapshot pins refs to commit and tree digest", async () => {
  await withBareRepository(async (fixture) => {
    const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
    Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", fixture.root);
    try {
      const response = await signedRequest({
        method: "POST",
        path: TAKOS_GIT_INTERNAL_PATHS.sourceSnapshot,
        capabilities: [TAKOS_GIT_CAPABILITIES.sourceSnapshot],
        body: JSON.stringify({
          repositoryId: fixture.repositoryId,
          sourceRef: "main",
        }),
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.kind, "git");
      assert.equal(body.repositoryId, fixture.repositoryId);
      assert.equal(body.sourceRef, "main");
      assert.equal(body.resolvedRef, "refs/heads/main");
      assert.equal(body.commitSha, fixture.commit);
      assert.match(body.digest, /^[0-9a-f]{64}$/);
      assert.equal(body.files.length, 1);
      assert.deepEqual(body.files[0], {
        path: "README.md",
        mode: "100644",
        type: "blob",
        objectId: fixture.blob,
        size: 21,
      });
    } finally {
      restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    }
  });
});

test("source snapshot enforces configured file and manifest limits", async () => {
  await withBareRepository(async (fixture) => {
    const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
    const originalFileLimit = Deno.env.get(
      "TAKOS_GIT_MAX_SOURCE_SNAPSHOT_FILES",
    );
    const originalManifestLimit = Deno.env.get(
      "TAKOS_GIT_MAX_SOURCE_SNAPSHOT_MANIFEST_BYTES",
    );
    Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", fixture.root);
    try {
      Deno.env.set("TAKOS_GIT_MAX_SOURCE_SNAPSHOT_FILES", "0");
      const tooManyFiles = await signedRequest({
        method: "POST",
        path: TAKOS_GIT_INTERNAL_PATHS.sourceSnapshot,
        capabilities: [TAKOS_GIT_CAPABILITIES.sourceSnapshot],
        body: JSON.stringify({
          repositoryId: fixture.repositoryId,
          sourceRef: "main",
        }),
      });
      assert.equal(tooManyFiles.status, 422);
      assert.equal(
        (await tooManyFiles.json()).code,
        "git_source_snapshot_file_limit_exceeded",
      );

      restoreEnv("TAKOS_GIT_MAX_SOURCE_SNAPSHOT_FILES", originalFileLimit);
      Deno.env.set("TAKOS_GIT_MAX_SOURCE_SNAPSHOT_MANIFEST_BYTES", "1");
      const manifestTooLarge = await signedRequest({
        method: "POST",
        path: TAKOS_GIT_INTERNAL_PATHS.sourceSnapshot,
        capabilities: [TAKOS_GIT_CAPABILITIES.sourceSnapshot],
        body: JSON.stringify({
          repositoryId: fixture.repositoryId,
          sourceRef: "main",
          manifestPath: "README.md",
        }),
      });
      assert.equal(manifestTooLarge.status, 422);
      assert.equal(
        (await manifestTooLarge.json()).code,
        "git_source_snapshot_manifest_too_large",
      );
    } finally {
      restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
      restoreEnv("TAKOS_GIT_MAX_SOURCE_SNAPSHOT_FILES", originalFileLimit);
      restoreEnv(
        "TAKOS_GIT_MAX_SOURCE_SNAPSHOT_MANIFEST_BYTES",
        originalManifestLimit,
      );
    }
  });
});

test("smart HTTP rejects unauthenticated clone/fetch discovery", async () => {
  await withBareRepository(async (fixture) => {
    const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
    const originalSecret = Deno.env.get("TAKOS_INTERNAL_SERVICE_SECRET");
    Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", fixture.root);
    Deno.env.set("TAKOS_INTERNAL_SERVICE_SECRET", "test-secret");
    try {
      const response = await app.request(
        `/${fixture.repositoryId}.git/info/refs?service=git-upload-pack`,
      );
      const body = await response.json();

      assert.equal(response.status, 401);
      assert.deepEqual(body, { error: "missing internal signature" });
    } finally {
      restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
      restoreEnv("TAKOS_INTERNAL_SERVICE_SECRET", originalSecret);
    }
  });
});

test("smart HTTP rejects unauthenticated push endpoint", async () => {
  await withBareRepository(async (fixture) => {
    const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
    const originalSecret = Deno.env.get("TAKOS_INTERNAL_SERVICE_SECRET");
    Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", fixture.root);
    Deno.env.set("TAKOS_INTERNAL_SERVICE_SECRET", "test-secret");
    try {
      const response = await app.request(
        `/${fixture.repositoryId}.git/git-receive-pack`,
        {
          method: "POST",
          headers: {
            "content-type": "application/x-git-receive-pack-request",
          },
          body: "",
        },
      );
      const body = await response.json();

      assert.equal(response.status, 401);
      assert.deepEqual(body, { error: "missing internal signature" });
    } finally {
      restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
      restoreEnv("TAKOS_INTERNAL_SERVICE_SECRET", originalSecret);
    }
  });
});

test("smart HTTP serves signed clone/fetch discovery", async () => {
  await withBareRepository(async (fixture) => {
    const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
    Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", fixture.root);
    try {
      const path = `/${fixture.repositoryId}.git/info/refs`;
      const response = await signedRequest({
        method: "GET",
        path,
        requestPath: `${path}?service=git-upload-pack`,
      });
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(
        response.headers.get("content-type") ?? "",
        /^application\/x-git-upload-pack-advertisement/,
      );
      assert.match(body, /# service=git-upload-pack/);
    } finally {
      restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
    }
  });
});

test("smart HTTP rejects normal git clients because they cannot sign internal requests", async () => {
  await withBareRepository(async (fixture) => {
    const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
    const originalSecret = Deno.env.get("TAKOS_INTERNAL_SERVICE_SECRET");
    Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", fixture.root);
    Deno.env.set("TAKOS_INTERNAL_SERVICE_SECRET", "test-secret");
    const server = Deno.serve({
      hostname: "127.0.0.1",
      port: 0,
      onListen() {},
    }, app.fetch);
    try {
      const cloneDir = await Deno.makeTempDir();
      try {
        const addr = server.addr as Deno.NetAddr;
        const remoteUrl =
          `http://127.0.0.1:${addr.port}/${fixture.repositoryId}.git`;
        const clone = await gitOutput(["clone", remoteUrl, cloneDir]);

        assert.equal(clone.success, false);
        assert.match(
          `${clone.stdout}\n${clone.stderr}`,
          /Authentication failed|The requested URL returned error: 401|could not read Username/,
        );
      } finally {
        await Deno.remove(cloneDir, { recursive: true });
      }
    } finally {
      await server.shutdown();
      restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
      restoreEnv("TAKOS_INTERNAL_SERVICE_SECRET", originalSecret);
    }
  });
});

test("smart HTTP supports git CLI clone, push, and fetch through a signed app proxy", async () => {
  await withBareRepository(async (fixture) => {
    const originalRoot = Deno.env.get("TAKOS_GIT_REPOSITORY_ROOT");
    const originalSecret = Deno.env.get("TAKOS_INTERNAL_SERVICE_SECRET");
    Deno.env.set("TAKOS_GIT_REPOSITORY_ROOT", fixture.root);
    Deno.env.set("TAKOS_INTERNAL_SERVICE_SECRET", "test-secret");
    const server = signedSmartHttpProxy();
    try {
      const addr = server.addr as Deno.NetAddr;
      const remoteUrl =
        `http://127.0.0.1:${addr.port}/${fixture.repositoryId}.git`;
      const cloneDir = await Deno.makeTempDir();
      const fetchDir = await Deno.makeTempDir();
      try {
        await git(["clone", remoteUrl, cloneDir]);
        assert.equal(
          await Deno.readTextFile(`${cloneDir}/README.md`),
          "hello from takos-git\n",
        );

        await git(["-C", cloneDir, "config", "user.email", "test@example.com"]);
        await git(["-C", cloneDir, "config", "user.name", "Takos Test"]);
        await Deno.writeTextFile(
          `${cloneDir}/README.md`,
          "hello from takos-git\nupdated through smart http\n",
        );
        await git(["-C", cloneDir, "add", "README.md"]);
        await git(["-C", cloneDir, "commit", "-m", "update over smart http"]);
        await git(["-C", cloneDir, "push", "origin", "main"]);

        await git(["-C", fetchDir, "init"]);
        await git(["-C", fetchDir, "remote", "add", "origin", remoteUrl]);
        await git(["-C", fetchDir, "fetch", "origin", "main"]);
        const fetchedCommit = (await git([
          "-C",
          fetchDir,
          "rev-parse",
          "FETCH_HEAD",
        ])).trim();
        const remoteCommit = (await git([
          "--git-dir",
          `${fixture.root}/${fixture.repositoryId}.git`,
          "rev-parse",
          "refs/heads/main",
        ])).trim();
        assert.equal(fetchedCommit, remoteCommit);
      } finally {
        await Deno.remove(cloneDir, { recursive: true });
        await Deno.remove(fetchDir, { recursive: true });
      }
    } finally {
      await server.shutdown();
      restoreEnv("TAKOS_GIT_REPOSITORY_ROOT", originalRoot);
      restoreEnv("TAKOS_INTERNAL_SERVICE_SECRET", originalSecret);
    }
  });
});

test("production Dockerfile installs git CLI for Smart HTTP", async () => {
  const dockerfile = await Deno.readTextFile(
    new URL("../Dockerfile", import.meta.url),
  );
  assert.match(dockerfile, /apt-get install[^\n]+ git(?:\s|$)/);
  assert.match(dockerfile, /CMD \["bun", "src\/index\.ts"\]/);
  assert.doesNotMatch(dockerfile, /--allow-run=git/);
});

test("source resolver still requires internal signature auth", async () => {
  const originalSecret = Deno.env.get("TAKOS_INTERNAL_SERVICE_SECRET");
  Deno.env.set("TAKOS_INTERNAL_SERVICE_SECRET", "test-secret");
  try {
    const response = await app.request(TAKOS_GIT_INTERNAL_PATHS.resolveSource, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositoryId: "repo_1",
        sourceRef: "0123456789abcdef0123456789abcdef01234567",
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.deepEqual(body, { error: "missing internal signature" });
  } finally {
    restoreEnv("TAKOS_INTERNAL_SERVICE_SECRET", originalSecret);
  }
});

test("source resolver rejects stale signed internal requests", async () => {
  const response = await signedResolveRequest({
    repositoryId: "repo_1",
    sourceRef: "0123456789abcdef0123456789abcdef01234567",
    timestamp: "2000-01-01T00:00:00.000Z",
  });
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.deepEqual(body, { error: "invalid internal signature" });
});

test("source resolver rejects wrong internal caller", async () => {
  const response = await signedResolveRequest({
    repositoryId: "repo_1",
    sourceRef: "0123456789abcdef0123456789abcdef01234567",
    caller: "unknown-service",
  });
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.deepEqual(body, { error: "invalid internal caller" });
});

test("source resolver accepts takosumi internal caller", async () => {
  const sourceRef = "0123456789abcdef0123456789abcdef01234567";
  const response = await signedResolveRequest({
    repositoryId: "repo_1",
    sourceRef,
    caller: "takosumi",
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    repositoryId: "repo_1",
    sourceRef,
    resolvedCommit: sourceRef,
  });
});

test("source resolver rejects wrong internal audience", async () => {
  const response = await signedResolveRequest({
    repositoryId: "repo_1",
    sourceRef: "0123456789abcdef0123456789abcdef01234567",
    audience: "takosumi",
  });
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.deepEqual(body, { error: "invalid internal signature" });
});

test("isSafeAuthHeader rejects Unicode line separators", () => {
  // U+0085 NEL, U+2028 LINE SEPARATOR, U+2029 PARAGRAPH SEPARATOR are
  // header-smuggling vectors that bypass ASCII-only control filters.
  assert.equal(isSafeAuthHeader("tokenextra"), false);
  assert.equal(isSafeAuthHeader("token extra"), false);
  assert.equal(isSafeAuthHeader("token extra"), false);
  // Clean ASCII tokens still pass.
  assert.equal(isSafeAuthHeader("Bearer abc123"), true);
});

test("applyHardenedConfigToExistingRepo backfills receive/transfer/hooks config",
  async () => {
    const root = await Deno.makeTempDir();
    try {
      const repoPath = `${root}/legacy.git`;
      await git(["init", "--bare", repoPath]);
      // Confirm the legacy repo starts without our hardening keys.
      const before = await gitOutput([
        "--git-dir",
        repoPath,
        "config",
        "--get",
        "receive.denyNonFastForwards",
      ]);
      assert.equal(before.success, false);

      const applied = await applyHardenedConfigToExistingRepo(repoPath);
      assert.equal(applied, true);

      for (
        const [key, expected] of [
          ["receive.denyNonFastForwards", "true"],
          ["receive.denyDeletes", "true"],
          ["transfer.fsckObjects", "true"],
          ["core.hooksPath", "/dev/null"],
        ] as const
      ) {
        const got = await gitOutput([
          "--git-dir",
          repoPath,
          "config",
          "--get",
          key,
        ]);
        assert.equal(got.success, true, `missing config ${key}`);
        assert.equal(got.stdout.trim(), expected);
      }

      // Marker file records that backfill ran so the boot walk can skip
      // this repository on subsequent restarts.
      const markerStat = await Deno.stat(
        `${repoPath}/.takos-hardening-applied`,
      );
      assert.equal(markerStat.isFile, true);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

async function signedResolveRequest(input: {
  readonly repositoryId: string;
  readonly sourceRef: string;
  readonly timestamp?: string;
  readonly caller?: string;
  readonly audience?: string;
  readonly includeBodyActor?: boolean;
  readonly devInMemoryMetadata?: boolean;
}): Promise<Response> {
  return await signedRequest({
    method: "POST",
    path: TAKOS_GIT_INTERNAL_PATHS.resolveSource,
    caller: input.caller,
    audience: input.audience,
    capabilities: [TAKOS_GIT_CAPABILITIES.refResolve],
    body: JSON.stringify({
      ...(input.includeBodyActor ? { actor } : {}),
      repositoryId: input.repositoryId,
      sourceRef: input.sourceRef,
    }),
    timestamp: input.timestamp,
    devInMemoryMetadata: input.devInMemoryMetadata,
  });
}

async function signedRequest(input: {
  readonly method: string;
  readonly path: string;
  readonly requestPath?: string;
  readonly body?: string;
  readonly timestamp?: string;
  readonly caller?: string;
  readonly audience?: string;
  readonly capabilities?: readonly string[];
  readonly actorOverride?: TakosActorContext;
  readonly devInMemoryMetadata?: boolean;
}): Promise<Response> {
  const originalSecret = Deno.env.get("TAKOS_INTERNAL_SERVICE_SECRET");
  const originalCallers = Deno.env.get("TAKOS_GIT_INTERNAL_CALLERS");
  const originalDevInMemory = Deno.env.get("TAKOS_GIT_DEV_IN_MEMORY_METADATA");
  Deno.env.set("TAKOS_INTERNAL_SERVICE_SECRET", "test-secret");
  Deno.env.set("TAKOS_GIT_INTERNAL_CALLERS", "takos-worker,takosumi");
  if (input.devInMemoryMetadata ?? true) {
    Deno.env.set("TAKOS_GIT_DEV_IN_MEMORY_METADATA", "true");
  } else {
    Deno.env.delete("TAKOS_GIT_DEV_IN_MEMORY_METADATA");
  }
  try {
    const body = input.body ?? "";
    const requestPath = input.requestPath ?? input.path;
    const requestUrl = new URL(requestPath, "https://git.internal");
    const signed = await signTakosInternalRequest({
      method: input.method,
      path: requestUrl.pathname,
      query: requestUrl.search,
      body,
      timestamp: input.timestamp ?? new Date().toISOString(),
      secret: "test-secret",
      actor: input.actorOverride ?? actor,
      caller: input.caller ?? "takos-worker",
      audience: input.audience ?? "takos-git",
      capabilities: input.capabilities ??
        defaultCapabilities(input.method, input.path),
    });
    return await app.request(requestPath, {
      method: input.method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...signed.headers,
      },
      ...(body ? { body } : {}),
    });
  } finally {
    restoreEnv("TAKOS_INTERNAL_SERVICE_SECRET", originalSecret);
    restoreEnv("TAKOS_GIT_INTERNAL_CALLERS", originalCallers);
    restoreEnv("TAKOS_GIT_DEV_IN_MEMORY_METADATA", originalDevInMemory);
  }
}

function defaultCapabilities(method: string, path: string): readonly string[] {
  const verb = method.toUpperCase();
  if (path.includes("/git-receive-pack")) {
    return [TAKOS_GIT_CAPABILITIES.repoWrite];
  }
  if (path.includes("/git-upload-pack") || path.includes(".git")) {
    return [TAKOS_GIT_CAPABILITIES.repoRead];
  }
  if (
    path === TAKOS_GIT_INTERNAL_PATHS.importExternalRepository ||
    path.includes("/fetch-external")
  ) {
    return [TAKOS_GIT_CAPABILITIES.repoImport];
  }
  if (path.startsWith("/internal/objects/")) {
    return [TAKOS_GIT_CAPABILITIES.objectRead];
  }
  if (path.includes("/pull-requests")) {
    if (verb === "GET") return [TAKOS_GIT_CAPABILITIES.prRead];
    if (path.endsWith("/merge")) return [TAKOS_GIT_CAPABILITIES.prMerge];
    return [TAKOS_GIT_CAPABILITIES.prWrite];
  }
  if (path === TAKOS_GIT_INTERNAL_PATHS.resolveSource) {
    return [TAKOS_GIT_CAPABILITIES.refResolve];
  }
  if (path === TAKOS_GIT_INTERNAL_PATHS.sourceSnapshot) {
    return [TAKOS_GIT_CAPABILITIES.sourceSnapshot];
  }
  if (path.includes("/refs") || verb === "GET") {
    return [TAKOS_GIT_CAPABILITIES.repoRead];
  }
  return [TAKOS_GIT_CAPABILITIES.repoWrite];
}

function signedSmartHttpProxy(): Deno.HttpServer {
  return Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    onListen() {},
  }, async (request) => {
    const url = new URL(request.url);
    const body = new Uint8Array(await request.arrayBuffer());
    const signed = await signTakosInternalRequest({
      method: request.method,
      path: url.pathname,
      query: url.search,
      body,
      actor,
      caller: "takos-worker",
      audience: "takos-git",
      capabilities: smartHttpCapabilities(url),
      timestamp: new Date().toISOString(),
      secret: "test-secret",
    });
    const headers = new Headers(signed.headers);
    copyHeader(request.headers, headers, "content-type");
    copyHeader(request.headers, headers, "accept");
    headers.set("content-length", String(body.byteLength));
    return await app.fetch(
      new Request(request.url, {
        method: request.method,
        headers,
        body: body.byteLength > 0 ? body : undefined,
      }),
    );
  });
}

function smartHttpCapabilities(url: URL): readonly string[] {
  if (
    url.pathname.endsWith("/git-receive-pack") ||
    url.searchParams.get("service") === "git-receive-pack"
  ) {
    return [TAKOS_GIT_CAPABILITIES.repoWrite];
  }
  return [TAKOS_GIT_CAPABILITIES.repoRead];
}

function copyHeader(source: Headers, target: Headers, name: string): void {
  const value = source.get(name);
  if (value) target.set(name, value);
}

async function withBareRepository(
  fn: (fixture: {
    root: string;
    repositoryId: string;
    commit: string;
    featureCommit: string;
    blob: string;
  }) => Promise<void>,
) {
  const root = await Deno.makeTempDir();
  try {
    const repositoryId = "repo_fixture";
    const barePath = `${root}/${repositoryId}.git`;
    const workPath = `${root}/work`;
    await git(["init", "--bare", barePath]);
    await git(["init", workPath]);
    await git(["-C", workPath, "config", "user.email", "test@example.com"]);
    await git(["-C", workPath, "config", "user.name", "Takos Test"]);
    await Deno.writeTextFile(
      `${workPath}/README.md`,
      "hello from takos-git\n",
    );
    await git(["-C", workPath, "add", "README.md"]);
    await git(["-C", workPath, "commit", "-m", "initial"]);
    await git(["-C", workPath, "branch", "-M", "main"]);
    await git(["-C", workPath, "remote", "add", "origin", barePath]);
    await git(["-C", workPath, "push", "origin", "main"]);
    await git(["-C", workPath, "tag", "v1.0.0"]);
    await git(["-C", workPath, "push", "origin", "v1.0.0"]);
    await git(["-C", workPath, "checkout", "-b", "feature/docs"]);
    await Deno.writeTextFile(`${workPath}/GUIDE.md`, "guide\n");
    await git(["-C", workPath, "add", "GUIDE.md"]);
    await git(["-C", workPath, "commit", "-m", "add guide"]);
    await git(["-C", workPath, "push", "origin", "feature/docs"]);
    await git([
      "--git-dir",
      barePath,
      "symbolic-ref",
      "HEAD",
      "refs/heads/main",
    ]);
    const featureCommit = await git(["-C", workPath, "rev-parse", "HEAD"]);
    const commit = await git(["-C", workPath, "rev-parse", "main"]);
    const blob = await git(["-C", workPath, "rev-parse", "main:README.md"]);
    await Deno.mkdir(`${root}/.takos`, { recursive: true });
    const now = new Date().toISOString();
    await Deno.writeTextFile(
      `${root}/.takos/repositories.json`,
      JSON.stringify({
        repositories: [{
          id: repositoryId,
          name: "Fixture Repository",
          ownerSpaceId: "space_1",
          defaultBranch: "main",
          refs: [
            { name: "refs/heads/main", target: commit.trim() },
            {
              name: "refs/heads/feature/docs",
              target: featureCommit.trim(),
            },
            { name: "refs/tags/v1.0.0", target: commit.trim() },
          ],
          createdAt: now,
          updatedAt: now,
        }],
      }),
    );
    await fn({
      root,
      repositoryId,
      commit: commit.trim(),
      featureCommit: featureCommit.trim(),
      blob: blob.trim(),
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function createRemoteFixture(root: string): Promise<{
  barePath: string;
  workPath: string;
  initialCommit: string;
}> {
  const barePath = `${root}/remote-${crypto.randomUUID()}.git`;
  const workPath = `${root}/remote-work-${crypto.randomUUID()}`;
  await git(["init", "--bare", barePath]);
  await git(["init", workPath]);
  await git(["-C", workPath, "config", "user.email", "test@example.com"]);
  await git(["-C", workPath, "config", "user.name", "Takos Test"]);
  await Deno.writeTextFile(`${workPath}/README.md`, "hello\n");
  await git(["-C", workPath, "add", "README.md"]);
  await git(["-C", workPath, "commit", "-m", "initial"]);
  await git(["-C", workPath, "branch", "-M", "main"]);
  await git(["-C", workPath, "remote", "add", "origin", barePath]);
  await git(["-C", workPath, "push", "origin", "main"]);
  await git(["-C", workPath, "tag", "v1.0.0"]);
  await git(["-C", workPath, "push", "origin", "v1.0.0"]);
  await git(["--git-dir", barePath, "symbolic-ref", "HEAD", "refs/heads/main"]);
  const initialCommit = (await git(["-C", workPath, "rev-parse", "HEAD"]))
    .trim();
  return { barePath, workPath, initialCommit };
}

async function git(args: string[]): Promise<string> {
  const output = await gitOutput(args);
  if (!output.success) {
    throw new Error(output.stderr);
  }
  return output.stdout;
}

async function gitOutput(
  args: string[],
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const output = await new Deno.Command("git", {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    success: output.success,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) Deno.env.delete(key);
  else Deno.env.set(key, value);
}
