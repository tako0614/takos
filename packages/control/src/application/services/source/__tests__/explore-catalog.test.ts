import { assertEquals } from "jsr:@std/assert";

import type { Env } from "../../../../shared/types/index.ts";
import { listCatalogItems } from "../explore-catalog.ts";
import { filterDeployablePackageReleases } from "../explore-packages.ts";
import { sourceServiceDeps } from "../deps.ts";
import {
  bundleDeployments,
  groupDeploymentSnapshots,
  repoReleaseAssets,
  repoReleases,
  repositories,
} from "../../../../infra/db/index.ts";

function createCatalogDb(fixtures: {
  repos: Array<Record<string, unknown>>;
  releases: Array<Record<string, unknown>>;
  assets: Array<Record<string, unknown>>;
  deployments: Array<Record<string, unknown>>;
  snapshots?: Array<Record<string, unknown>>;
}): Env["DB"] {
  const rowsByTable = new Map<unknown, Array<Record<string, unknown>>>([
    [repositories, fixtures.repos],
    [repoReleases, fixtures.releases],
    [repoReleaseAssets, fixtures.assets],
    [bundleDeployments, fixtures.deployments],
    [groupDeploymentSnapshots, fixtures.snapshots ?? []],
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

async function withDeployManifestAvailability<T>(
  available: boolean,
  fn: () => Promise<T>,
): Promise<T> {
  return await withDeployManifestPath(
    available ? ".takos/app.yml" : null,
    fn,
  );
}

async function withDeployManifestPath<T>(
  manifestPath: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  const hasManifest = manifestPath !== null;
  const manifestName = manifestPath ? manifestPath.split("/").at(-1)! : null;
  const originalGitStore = sourceServiceDeps.gitStore;
  (sourceServiceDeps as {
    gitStore: typeof sourceServiceDeps.gitStore;
  }).gitStore = {
    ...sourceServiceDeps.gitStore,
    getCommitData: (async () => ({
      tree: "tree-1",
    } as unknown)) as typeof sourceServiceDeps.gitStore.getCommitData,
    listDirectory:
      (async (_bucket: unknown, _treeSha: string, path = "") =>
        path === ".takos"
          ? hasManifest && manifestName
            ? [{ name: manifestName, mode: "100644", sha: "blob-1" }]
            : []
          : [
            { name: ".takos", mode: "040000", sha: "tree-2" },
          ]) as typeof sourceServiceDeps.gitStore.listDirectory,
    getBlobAtPath:
      (async () =>
        hasManifest
          ? new Uint8Array([1])
          : null) as typeof sourceServiceDeps.gitStore.getBlobAtPath,
  };

  try {
    return await fn();
  } finally {
    (sourceServiceDeps as {
      gitStore: typeof sourceServiceDeps.gitStore;
    }).gitStore = originalGitStore;
  }
}

Deno.test("listCatalogItems treats public non-draft releases as deployable apps without package assets", async () => {
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
    snapshots: [
      {
        id: "group-snapshot-1",
        sourceRepoId: "repo-app",
        sourceResolvedRepoId: "repo-app",
        sourceVersion: null,
        sourceTag: "v1.0.0",
        sourceRef: "v1.0.0",
        manifestJson: JSON.stringify({ version: "1.0.0" }),
        createdAt: "2026-01-06T00:00:00.000Z",
        deployedAt: "2026-01-06T00:00:00.000Z",
      },
    ],
  });

  await withDeployManifestAvailability(true, async () => {
    const gitObjects = {} as Env["GIT_OBJECTS"];
    const allItems = await listCatalogItems(db, {
      sort: "stars",
      limit: 20,
      offset: 0,
      type: "all",
      certifiedOnly: false,
      gitObjects,
    });
    assertEquals(allItems.items.map((item) => item.repo.id), [
      "repo-app",
      "repo-only",
    ]);
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
    assertEquals(repoOnly.items.map((item) => item.repo.id), [
      "repo-app",
      "repo-only",
    ]);
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
    assertEquals(deployable.items.map((item) => item.repo.id), ["repo-app"]);

    const certifiedOnly = await listCatalogItems(db, {
      sort: "stars",
      limit: 20,
      offset: 0,
      type: "all",
      certifiedOnly: true,
      gitObjects,
    });
    assertEquals(certifiedOnly.items.map((item) => item.repo.id), ["repo-app"]);

    const installed = await listCatalogItems(db, {
      sort: "stars",
      limit: 20,
      offset: 0,
      type: "deployable-app",
      certifiedOnly: false,
      spaceId: "space-1",
      gitObjects,
    });
    assertEquals(
      installed.items[0]?.installation?.group_deployment_snapshot_id,
      "group-snapshot-1",
    );
    assertEquals(installed.items[0]?.installation?.installed_version, "1.0.0");
  });
});

Deno.test("listCatalogItems marks repository packages installed by source URL and release tag", async () => {
  const db = createCatalogDb({
    repos: [{
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
    }],
    releases: [{
      id: "release-app",
      repoId: "repo-app",
      tag: "v1.0.0",
      commitSha: "commit-1",
      description: "First release",
      publishedAt: "2026-01-04T00:00:00.000Z",
      repoName: "deployable-app",
    }],
    assets: [],
    deployments: [],
    snapshots: [{
      id: "group-snapshot-1",
      sourceRepoId: null,
      sourceResolvedRepoId: null,
      sourceRepositoryUrl: "https://takos.jp/git/space-1/deployable-app.git",
      sourceVersion: null,
      sourceTag: null,
      sourceRef: "v1.0.0",
      sourceRefType: "tag",
      manifestJson: JSON.stringify({ version: "1.0.0" }),
      createdAt: "2026-01-06T00:00:00.000Z",
      deployedAt: "2026-01-06T00:00:00.000Z",
    }],
  });

  await withDeployManifestAvailability(true, async () => {
    const result = await listCatalogItems(db, {
      sort: "stars",
      limit: 20,
      offset: 0,
      type: "deployable-app",
      certifiedOnly: false,
      spaceId: "space-1",
      gitObjects: {} as Env["GIT_OBJECTS"],
      repositoryBaseUrl: "takos.jp",
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
    assertEquals(
      item.installation?.group_deployment_snapshot_id,
      "group-snapshot-1",
    );
    assertEquals(item.installation?.installed_version, "1.0.0");
  });
});

Deno.test("listCatalogItems requires .takos/app.yml when git objects are available", async () => {
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

  await withDeployManifestAvailability(false, async () => {
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

Deno.test("listCatalogItems accepts .takos/app.yaml when git objects are available", async () => {
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

  await withDeployManifestPath(".takos/app.yaml", async () => {
    const deployable = await listCatalogItems(db, {
      sort: "stars",
      limit: 20,
      offset: 0,
      type: "deployable-app",
      certifiedOnly: false,
      gitObjects: {} as Env["GIT_OBJECTS"],
    });
    assertEquals(deployable.items.map((item) => item.repo.id), ["repo-app"]);
  });
});

Deno.test("filterDeployablePackageReleases keeps only manifest-backed releases", async () => {
  const originalGitStore = sourceServiceDeps.gitStore;
  (sourceServiceDeps as {
    gitStore: typeof sourceServiceDeps.gitStore;
  }).gitStore = {
    ...sourceServiceDeps.gitStore,
    getCommitData: (async (_bucket: unknown, sha: string) => ({
      tree: sha === "commit-a" ? "tree-1" : "tree-2",
    } as unknown)) as typeof sourceServiceDeps.gitStore.getCommitData,
    listDirectory:
      (async (_bucket: unknown, treeSha: string, path = "") =>
        path === ".takos" && treeSha === "tree-1"
          ? [{ name: "app.yaml", mode: "100644", sha: "blob-1" }]
          : path === ".takos"
          ? []
          : [{
            name: ".takos",
            mode: "040000",
            sha: treeSha,
          }]) as typeof sourceServiceDeps.gitStore.listDirectory,
    getBlobAtPath:
      (async (_bucket: unknown, treeSha: string, filePath: string) =>
        treeSha === "tree-1" && filePath === ".takos/app.yaml"
          ? new Uint8Array([1])
          : null) as typeof sourceServiceDeps.gitStore.getBlobAtPath,
  };

  try {
    const deployable = await filterDeployablePackageReleases(
      {} as Env["DB"],
      {} as Env["GIT_OBJECTS"],
      [
        { repoId: "repo-a", tag: "v1.0.0", commitSha: "commit-a" },
        { repoId: "repo-b", tag: "v2.0.0", commitSha: "commit-b" },
      ],
    );

    assertEquals(deployable, [
      { repoId: "repo-a", tag: "v1.0.0", commitSha: "commit-a" },
    ]);
  } finally {
    (sourceServiceDeps as {
      gitStore: typeof sourceServiceDeps.gitStore;
    }).gitStore = originalGitStore;
  }
});

Deno.test("listCatalogItems marks release catalog entries unavailable when git objects are missing", async () => {
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

Deno.test("listCatalogItems includes default app distribution entries in the catalog", async () => {
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
    defaultAppEntries: [{
      name: "takos-docs",
      title: "Docs",
      repositoryUrl: "https://github.com/tako0614/takos-docs.git",
      ref: "main",
      refType: "branch",
      preinstall: true,
      backendName: "cloudflare",
      envName: "staging",
    }],
    now: "2026-04-22T00:00:00.000Z",
  });

  assertEquals(result.total, 1);
  const item = result.items[0]!;
  assertEquals(item.repo.id, "default-app:takos-docs");
  assertEquals(item.repo.name, "Docs");
  assertEquals(item.repo.catalog_origin, "default_app");
  assertEquals(item.package.available, true);
  assertEquals(item.package.app_id, "takos-docs");
  assertEquals(item.package.certified, true);
  assertEquals(item.package.publish_status, "approved");
  assertEquals(item.source, {
    kind: "git_ref",
    repository_url: "https://github.com/tako0614/takos-docs.git",
    ref: "main",
    ref_type: "branch",
    backend: "cloudflare",
    env: "staging",
  });
});

Deno.test("listCatalogItems marks default app entries installed by matching source URL and ref", async () => {
  const db = createCatalogDb({
    repos: [],
    releases: [],
    assets: [],
    deployments: [],
    snapshots: [{
      id: "default-docs-snapshot",
      sourceRepoId: null,
      sourceResolvedRepoId: null,
      sourceRepositoryUrl: "https://github.com/tako0614/takos-docs.git",
      sourceVersion: null,
      sourceTag: null,
      sourceRef: "main",
      sourceRefType: "branch",
      manifestJson: JSON.stringify({ version: "1.2.3" }),
      createdAt: "2026-04-22T01:00:00.000Z",
    }],
  });

  const result = await listCatalogItems(db, {
    sort: "stars",
    limit: 20,
    offset: 0,
    type: "deployable-app",
    certifiedOnly: false,
    spaceId: "space-1",
    defaultAppEntries: [{
      name: "takos-docs",
      title: "Docs",
      repositoryUrl: "https://github.com/tako0614/takos-docs.git",
      ref: "main",
      refType: "branch",
      preinstall: true,
    }],
    now: "2026-04-22T00:00:00.000Z",
  });

  assertEquals(
    result.items[0]?.installation?.group_deployment_snapshot_id,
    "default-docs-snapshot",
  );
  assertEquals(result.items[0]?.installation?.installed_version, "1.2.3");
});
