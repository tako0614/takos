import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import type { Env } from "../../../../shared/types/index.ts";
import { listCatalogItems } from "../explore-catalog.ts";
import { sourceServiceDeps } from "../deps.ts";
import {
  bundleDeployments,
  repoReleaseAssets,
  repoReleases,
  repositories,
} from "../../../../infra/db/index.ts";

function createCatalogDb(fixtures: {
  repos: Array<Record<string, unknown>>;
  releases: Array<Record<string, unknown>>;
  assets: Array<Record<string, unknown>>;
  deployments: Array<Record<string, unknown>>;
}): Env["DB"] {
  const rowsByTable = new Map<unknown, Array<Record<string, unknown>>>([
    [repositories, fixtures.repos],
    [repoReleases, fixtures.releases],
    [repoReleaseAssets, fixtures.assets],
    [bundleDeployments, fixtures.deployments],
  ]);

  const query = {
    from(table: unknown) {
      const rows = rowsByTable.get(table) ?? [];
      return {
        innerJoin() {
          return this;
        },
        where() {
          return this;
        },
        orderBy() {
          return this;
        },
        limit() {
          return this;
        },
        offset() {
          return this;
        },
        async all() {
          return rows;
        },
        async get() {
          return rows[0] ?? null;
        },
      };
    },
  };

  return {
    select() {
      return query as never;
    },
  } as unknown as Env["DB"];
}

async function withInstallableCapsuleAvailability<T>(
  available: boolean,
  fn: () => Promise<T>,
): Promise<T> {
  return await withInstallableCapsulePath(available ? "outputs.tf" : null, fn);
}

async function withInstallableCapsulePath<T>(
  capsulePath: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  const hasCapsule = capsulePath !== null;
  const originalGitStore = sourceServiceDeps.gitStore;
  (
    sourceServiceDeps as {
      gitStore: typeof sourceServiceDeps.gitStore;
    }
  ).gitStore = {
    ...sourceServiceDeps.gitStore,
    getCommitData: (async () =>
      ({
        tree: "tree-1",
      }) as unknown) as typeof sourceServiceDeps.gitStore.getCommitData,
    listDirectory: (async (_bucket: unknown, _treeSha: string, path = "") =>
      path === ""
        ? hasCapsule && capsulePath
          ? [{ name: capsulePath, mode: "100644", sha: "blob-1" }]
          : []
        : []) as typeof sourceServiceDeps.gitStore.listDirectory,
    getBlobAtPath: (async (
      _bucket: unknown,
      _treeSha: string,
      filePath: string,
    ) =>
      hasCapsule && filePath === capsulePath
        ? new Uint8Array([1])
        : null) as typeof sourceServiceDeps.gitStore.getBlobAtPath,
  };

  try {
    return await fn();
  } finally {
    (
      sourceServiceDeps as {
        gitStore: typeof sourceServiceDeps.gitStore;
      }
    ).gitStore = originalGitStore;
  }
}

test("listCatalogItems treats public non-draft releases as deployable apps without package assets", async () => {
  const db = createCatalogDb({
    repos: [
      {
        id: "repo-app",
        name: "deployable-app",
        description: "A deployable app",
        defaultBranch: "main",
        stars: 25,
        forks: 3,
        primaryLanguage: "TypeScript",
        license: "MIT",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
        accountId: "space-1",
        accountName: "Space 1",
        accountSlug: "space-1",
        accountPicture: null,
      },
      {
        id: "repo-only",
        name: "plain-repo",
        description: "No release",
        defaultBranch: "main",
        stars: 5,
        forks: 0,
        primaryLanguage: "TypeScript",
        license: "Apache-2.0",
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-04T00:00:00.000Z",
        accountId: "space-1",
        accountName: "Space 1",
        accountSlug: "space-1",
        accountPicture: null,
      },
    ],
    releases: [
      {
        id: "release-app",
        repoId: "repo-app",
        tag: "v1.0.0",
        commitSha: "commit-1",
        description: "First release",
        publishedAt: "2026-01-04T00:00:00.000Z",
        repoName: "deployable-app",
      },
    ],
    assets: [
      {
        id: "asset-app",
        releaseId: "release-app",
        assetKey: "asset-key",
        name: "deployable-app.zip",
        contentType: "application/zip",
        sizeBytes: 1234,
        downloadCount: 42,
        bundleFormat: null,
        bundleMetaJson: null,
        createdAt: "2026-01-04T00:00:00.000Z",
      },
    ],
    deployments: [
      {
        id: "bundle-deployment-1",
        sourceRepoId: "repo-app",
        sourceTag: "v1.0.0",
        sourceAssetId: "asset-app",
        version: "0.9.0",
        rolloutState: JSON.stringify({ status: "completed" }),
        deployedAt: "2026-01-05T00:00:00.000Z",
      },
    ],
  });

  await withInstallableCapsuleAvailability(true, async () => {
    const gitObjects = {} as Env["GIT_OBJECTS"];
    const allItems = await listCatalogItems(db, {
      sort: "stars",
      limit: 20,
      offset: 0,
      type: "all",
      certifiedOnly: false,
      gitObjects,
    });
    assertEquals(
      allItems.items.map((item) => item.repo.id),
      ["repo-app", "repo-only"],
    );
    assertEquals(allItems.items[0]?.package.available, true);
    assertEquals(allItems.items[0]?.package.latest_version, "v1.0.0");
    assertEquals(allItems.items[0]?.package.publish_status, "approved");
    assertEquals(allItems.items[0]?.package.certified, true);
    assertEquals(allItems.items[1]?.package.available, false);
    assertEquals(allItems.items[1]?.package.publish_status, "none");

    const repoOnly = await listCatalogItems(db, {
      sort: "stars",
      limit: 20,
      offset: 0,
      type: "repo",
      certifiedOnly: false,
      gitObjects,
    });
    assertEquals(
      repoOnly.items.map((item) => item.repo.id),
      ["repo-app", "repo-only"],
    );
    assertEquals(repoOnly.items[0]?.package.available, true);
    assertEquals(repoOnly.items[1]?.package.available, false);

    const deployable = await listCatalogItems(db, {
      sort: "stars",
      limit: 20,
      offset: 0,
      type: "deployable-app",
      certifiedOnly: false,
      gitObjects,
    });
    assertEquals(
      deployable.items.map((item) => item.repo.id),
      ["repo-app"],
    );

    const certifiedOnly = await listCatalogItems(db, {
      sort: "stars",
      limit: 20,
      offset: 0,
      type: "all",
      certifiedOnly: true,
      gitObjects,
    });
    assertEquals(
      certifiedOnly.items.map((item) => item.repo.id),
      ["repo-app"],
    );

    const installed = await listCatalogItems(db, {
      sort: "stars",
      limit: 20,
      offset: 0,
      type: "deployable-app",
      certifiedOnly: false,
      spaceId: "space-1",
      gitObjects,
      repositoryBaseUrl: "takos.jp",
      accountsInstallations: {
        baseUrl: "https://accounts.internal",
        fetch: async () =>
          Response.json({
            installations: [
              {
                id: "inst_repo_app",
                app_id: "deployable-app",
                status: "installed",
                runtime_mode: "shared-cell",
                source: {
                  url: "https://takos.jp/git/space-1/deployable-app.git",
                  ref: "v1.0.0",
                  commit: "commit-1",
                },
                created_at: "2026-01-06T00:00:00.000Z",
                updated_at: "2026-01-06T00:00:00.000Z",
              },
            ],
          }),
      },
    });
    assertEquals(installed.items[0]?.installation?.installed, true);
    assertEquals(installed.items[0]?.installation?.installed_version, "v1.0.0");
  });
});

test("listCatalogItems marks repository packages installed from Accounts ledger source URL and release tag", async () => {
  const db = createCatalogDb({
    repos: [
      {
        id: "repo-app",
        name: "deployable-app",
        description: "A deployable app",
        defaultBranch: "main",
        stars: 25,
        forks: 3,
        primaryLanguage: "TypeScript",
        license: "MIT",
        remoteCloneUrl: "https://github.com/acme/deployable-app.git",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
        accountId: "space-1",
        accountName: "Space 1",
        accountSlug: "space-1",
        accountPicture: null,
      },
    ],
    releases: [
      {
        id: "release-app",
        repoId: "repo-app",
        tag: "v1.0.0",
        commitSha: "commit-1",
        description: "First release",
        publishedAt: "2026-01-04T00:00:00.000Z",
        repoName: "deployable-app",
      },
    ],
    assets: [],
    deployments: [],
  });

  await withInstallableCapsuleAvailability(true, async () => {
    const result = await listCatalogItems(db, {
      sort: "stars",
      limit: 20,
      offset: 0,
      type: "deployable-app",
      certifiedOnly: false,
      spaceId: "space-1",
      gitObjects: {} as Env["GIT_OBJECTS"],
      repositoryBaseUrl: "takos.jp",
      accountsInstallations: {
        baseUrl: "https://accounts.internal",
        fetch: async () =>
          Response.json({
            installations: [
              {
                id: "inst_repo_app",
                app_id: "deployable-app",
                status: "installed",
                runtime_mode: "shared-cell",
                source: {
                  url: "https://takos.jp/git/space-1/deployable-app.git",
                  ref: "v1.0.0",
                  commit: "commit-1",
                },
                created_at: "2026-01-06T00:00:00.000Z",
                updated_at: "2026-01-06T00:00:00.000Z",
              },
            ],
          }),
      },
    });

    const item = result.items[0]!;
    assertEquals(item.source, {
      kind: "git_ref",
      repository_url: "https://takos.jp/git/space-1/deployable-app.git",
      ref: "v1.0.0",
      ref_type: "tag",
      backend: null,
      env: "staging",
    });
    assertEquals(item.installation?.installed, true);
    assertEquals(item.installation?.installed_version, "v1.0.0");
    assertEquals(item.installation?.installation_id, "inst_repo_app");
  });
});

test("listCatalogItems requires an OpenTofu Capsule source when git objects are available", async () => {
  const db = createCatalogDb({
    repos: [
      {
        id: "repo-app",
        name: "deployable-app",
        description: "A deployable app",
        defaultBranch: "main",
        stars: 25,
        forks: 3,
        primaryLanguage: "TypeScript",
        license: "MIT",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
        accountId: "space-1",
        accountName: "Space 1",
        accountSlug: "space-1",
        accountPicture: null,
      },
    ],
    releases: [
      {
        id: "release-app",
        repoId: "repo-app",
        tag: "v1.0.0",
        commitSha: "commit-1",
        description: "First release",
        publishedAt: "2026-01-04T00:00:00.000Z",
        repoName: "deployable-app",
      },
    ],
    assets: [],
    deployments: [],
  });

  await withInstallableCapsuleAvailability(false, async () => {
    const deployable = await listCatalogItems(db, {
      sort: "stars",
      limit: 20,
      offset: 0,
      type: "deployable-app",
      certifiedOnly: false,
      gitObjects: {} as Env["GIT_OBJECTS"],
    });
    assertEquals(deployable.items, []);
  });
});

test("listCatalogItems accepts outputs.tf when git objects are available", async () => {
  const db = createCatalogDb({
    repos: [
      {
        id: "repo-app",
        name: "deployable-app",
        description: "A deployable app",
        defaultBranch: "main",
        stars: 25,
        forks: 3,
        primaryLanguage: "TypeScript",
        license: "MIT",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
        accountId: "space-1",
        accountName: "Space 1",
        accountSlug: "space-1",
        accountPicture: null,
      },
    ],
    releases: [
      {
        id: "release-app",
        repoId: "repo-app",
        tag: "v1.0.0",
        commitSha: "commit-1",
        description: "First release",
        publishedAt: "2026-01-04T00:00:00.000Z",
        repoName: "deployable-app",
      },
    ],
    assets: [],
    deployments: [],
  });

  await withInstallableCapsulePath("outputs.tf", async () => {
    const deployable = await listCatalogItems(db, {
      sort: "stars",
      limit: 20,
      offset: 0,
      type: "deployable-app",
      certifiedOnly: false,
      gitObjects: {} as Env["GIT_OBJECTS"],
    });
    assertEquals(
      deployable.items.map((item) => item.repo.id),
      ["repo-app"],
    );
  });
});

test("listCatalogItems marks release catalog entries unavailable when git objects are missing", async () => {
  const db = createCatalogDb({
    repos: [
      {
        id: "repo-app",
        name: "deployable-app",
        description: "A deployable app",
        defaultBranch: "main",
        stars: 25,
        forks: 3,
        primaryLanguage: "TypeScript",
        license: "MIT",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
        accountId: "space-1",
        accountName: "Space 1",
        accountSlug: "space-1",
        accountPicture: null,
      },
    ],
    releases: [
      {
        id: "release-app",
        repoId: "repo-app",
        tag: "v1.0.0",
        commitSha: "commit-1",
        description: "First release",
        publishedAt: "2026-01-04T00:00:00.000Z",
        repoName: "deployable-app",
      },
    ],
    assets: [],
    deployments: [],
  });

  const deployable = await listCatalogItems(db, {
    sort: "stars",
    limit: 20,
    offset: 0,
    type: "deployable-app",
    certifiedOnly: false,
  });
  assertEquals(deployable.items, []);
});

test("listCatalogItems includes default app distribution entries in the catalog", async () => {
  const db = createCatalogDb({
    repos: [],
    releases: [],
    assets: [],
    deployments: [],
  });

  const result = await listCatalogItems(db, {
    sort: "stars",
    limit: 20,
    offset: 0,
    type: "deployable-app",
    certifiedOnly: true,
    searchQuery: "docs",
    tagsRaw: "default-app",
    defaultAppEntries: [
      {
        name: "takos-docs",
        title: "Docs",
        appId: "jp.takos.docs",
        description: "Rich text document editor",
        publisher: "takos",
        homepage: "https://github.com/tako0614/takos-docs",
        icon: "/icons/docs.svg",
        category: "app",
        tags: ["office"],
        repositoryUrl: "https://github.com/tako0614/takos-docs.git",
        ref: "main",
        refType: "branch",
        sourcePath: "outputs.tf",
        runtimeModes: ["shared-cell", "dedicated", "self-hosted"],
        bindings: [
          { name: "auth", type: "identity.oidc", required: true },
          {
            name: "bootstrap",
            type: "auth.bootstrap_token",
            required: true,
          },
        ],
        preinstall: true,
        backendName: "cloudflare",
        envName: "staging",
      },
    ],
    now: "2026-04-22T00:00:00.000Z",
  });

  assertEquals(result.total, 1);
  const item = result.items[0]!;
  assertEquals(item.repo.id, "default-app:takos-docs");
  assertEquals(item.repo.name, "Docs");
  assertEquals(item.repo.catalog_origin, "default_app");
  assertEquals(item.package.available, true);
  assertEquals(item.package.app_id, "jp.takos.docs");
  assertEquals(item.package.description, "Rich text document editor");
  assertEquals(item.package.icon, "/icons/docs.svg");
  assertEquals(item.package.tags.includes("office"), true);
  assertEquals(item.package.certified, true);
  assertEquals(item.package.publish_status, "approved");
  assertEquals(item.installable_app, {
    app_id: "jp.takos.docs",
    name: "Docs",
    description: "Rich text document editor",
    publisher: "takos",
    homepage: "https://github.com/tako0614/takos-docs",
    source_path: "outputs.tf",
    runtime_modes: ["shared-cell", "dedicated", "self-hosted"],
    bindings: [
      { name: "auth", type: "identity.oidc", required: true },
      { name: "bootstrap", type: "auth.bootstrap_token", required: true },
    ],
  });
  assertEquals(item.source, {
    kind: "git_ref",
    repository_url: "https://github.com/tako0614/takos-docs.git",
    ref: "main",
    ref_type: "branch",
    backend: "cloudflare",
    env: "staging",
  });
});

test("listCatalogItems exposes road-to-me as catalog-only InstallableApp", async () => {
  const db = createCatalogDb({
    repos: [],
    releases: [],
    assets: [],
    deployments: [],
  });

  const result = await listCatalogItems(db, {
    sort: "stars",
    limit: 20,
    offset: 0,
    type: "deployable-app",
    certifiedOnly: false,
    searchQuery: "road",
    defaultAppEntries: [
      {
        name: "road-to-me",
        title: "Road to Me",
        appId: "jp.takos.road-to-me",
        description: "AI goal planning app for reverse timeline planning.",
        publisher: "takos",
        homepage: "https://github.com/tako0614/road-to-me",
        category: "app",
        tags: ["planning", "goals"],
        repositoryUrl: "https://github.com/tako0614/road-to-me.git",
        ref: "v0.1.0",
        refType: "tag",
        sourcePath: "outputs.tf",
        runtimeModes: ["dedicated", "self-hosted"],
        bindings: [
          { name: "auth", type: "identity.oidc", required: true },
          { name: "domain", type: "protocol.http.api", required: false },
          {
            name: "bootstrap",
            type: "auth.bootstrap_token",
            required: true,
          },
        ],
        preinstall: false,
      },
    ],
    now: "2026-04-22T00:00:00.000Z",
  });

  assertEquals(result.total, 1);
  const item = result.items[0]!;
  assertEquals(item.repo.id, "default-app:road-to-me");
  assertEquals(item.repo.catalog_origin, "default_app");
  assertEquals(item.package.app_id, "jp.takos.road-to-me");
  assertEquals(item.package.latest_version, "v0.1.0");
  assertEquals(item.installable_app, {
    app_id: "jp.takos.road-to-me",
    name: "Road to Me",
    description: "AI goal planning app for reverse timeline planning.",
    publisher: "takos",
    homepage: "https://github.com/tako0614/road-to-me",
    source_path: "outputs.tf",
    runtime_modes: ["dedicated", "self-hosted"],
    bindings: [
      { name: "auth", type: "identity.oidc", required: true },
      { name: "domain", type: "protocol.http.api", required: false },
      { name: "bootstrap", type: "auth.bootstrap_token", required: true },
    ],
  });
  assertEquals(item.source, {
    kind: "git_ref",
    repository_url: "https://github.com/tako0614/road-to-me.git",
    ref: "v0.1.0",
    ref_type: "tag",
    backend: null,
    env: null,
  });
});

test("listCatalogItems does not infer default app installation without Accounts ledger readback", async () => {
  const db = createCatalogDb({
    repos: [],
    releases: [],
    assets: [],
    deployments: [],
  });

  const result = await listCatalogItems(db, {
    sort: "stars",
    limit: 20,
    offset: 0,
    type: "deployable-app",
    certifiedOnly: false,
    spaceId: "space-1",
    defaultAppEntries: [
      {
        name: "takos-docs",
        title: "Docs",
        repositoryUrl: "https://github.com/tako0614/takos-docs.git",
        ref: "main",
        refType: "branch",
        preinstall: true,
      },
    ],
    now: "2026-04-22T00:00:00.000Z",
  });

  assertEquals(result.items[0]?.installation, undefined);
});

test("listCatalogItems overlays default app installation state from Accounts ledger", async () => {
  const db = createCatalogDb({
    repos: [],
    releases: [],
    assets: [],
    deployments: [],
  });
  const requests: Array<{ url: string; authorization: string | null }> = [];

  const result = await listCatalogItems(db, {
    sort: "stars",
    limit: 20,
    offset: 0,
    type: "deployable-app",
    certifiedOnly: false,
    spaceId: "space-1",
    defaultAppEntries: [
      {
        name: "takos-docs",
        title: "Docs",
        appId: "jp.takos.docs",
        repositoryUrl: "https://github.com/tako0614/takos-docs.git",
        ref: "v1.2.6",
        refType: "tag",
        preinstall: true,
      },
    ],
    accountsInstallations: {
      baseUrl: "https://accounts.internal/base/",
      token: "accounts-token",
      fetch: async (input, init) => {
        const url = input instanceof Request ? input.url : input.toString();
        requests.push({
          url,
          authorization: new Headers(init?.headers).get("authorization"),
        });
        if (url.endsWith("/v1/installation-projections/inst_docs")) {
          // Deploy decision D3: workload services are projected from the
          // installation deployment-output projection.
          return Response.json({
            installation: {
              id: "inst_docs",
              deployment_outputs: [
                {
                  name: "launch_url",
                  kind: "launch_url",
                  value: "https://docs.example.test",
                  sensitive: false,
                },
              ],
            },
          });
        }
        return Response.json({
          installations: [
            {
              id: "inst_docs",
              space_id: "space-1",
              app_id: "jp.takos.docs",
              source: {
                type: "git",
                url: "https://github.com/tako0614/takos-docs.git",
                ref: "v1.2.6",
                commit: "commit-docs",
              },
              mode: "shared-cell",
              status: "ready",
              created_at: "2026-04-22T01:00:00.000Z",
              updated_at: "2026-04-22T01:05:00.000Z",
            },
          ],
        });
      },
    },
    now: "2026-04-22T00:00:00.000Z",
  });

  assertEquals(
    requests[0]?.url,
    "https://accounts.internal/base/v1/installation-projections?space_id=space-1",
  );
  assertEquals(requests[0]?.authorization, "Bearer accounts-token");
  assertEquals(
    requests[1]?.url,
    "https://accounts.internal/base/v1/installation-projections/inst_docs",
  );
  assertEquals(result.items[0]?.installation, {
    installed: true,
    installation_id: "inst_docs",
    app_id: "jp.takos.docs",
    status: "ready",
    runtime_mode: "shared-cell",
    group_id: null,
    group_name: null,
    installed_version: "v1.2.6",
    installed_commit: "commit-docs",
    deployed_at: null,
    installed_at: "2026-04-22T01:00:00.000Z",
    updated_at: "2026-04-22T01:05:00.000Z",
    services: [
      {
        id: "launch_url",
        capability: "deployment.outputs",
        status: "ready",
        endpoint: "https://docs.example.test",
        secret_configured: false,
        token_expires_at: null,
      },
    ],
  });
});
