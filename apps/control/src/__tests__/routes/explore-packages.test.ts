import { Hono } from "hono";
import { isAppError } from "takos-common/errors";
import { assertEquals, assertObjectMatch } from "jsr:@std/assert";

import type { Env } from "@/types";
import explore from "@/routes/explore";
import { sourceServiceDeps } from "../../../../../packages/control/src/application/services/source/deps.ts";
import {
  repoReleaseAssets,
  repoReleases,
} from "../../../../../packages/control/src/infra/db/index.ts";

class MockSelectQuery {
  private table: unknown;
  private limitValue = Number.POSITIVE_INFINITY;
  private offsetValue = 0;

  constructor(private readonly db: MockD1Database) {}

  from(table: unknown) {
    this.table = table;
    return this;
  }

  where() {
    return this;
  }

  orderBy() {
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  offset(value: number) {
    this.offsetValue = value;
    return this;
  }

  async all<T = unknown>(): Promise<T[]> {
    if (this.table === repoReleases) {
      this.db.releaseOffsets.push(this.offsetValue);
      const page = this.db.releaseRows.slice(
        this.offsetValue,
        this.offsetValue + this.limitValue,
      );
      this.db.nextAssetReleaseId = this.db.deployableReleaseIds.find((id) =>
        page.some((release) =>
          release.id === id
        )
      ) ?? null;
      return page as T[];
    }

    if (this.table === repoReleaseAssets) {
      const rows = this.db.nextAssetReleaseId
        ? (this.db.assetsByReleaseId.get(this.db.nextAssetReleaseId) ?? [])
        : [];
      this.db.nextAssetReleaseId = null;
      return rows as T[];
    }

    return [] as T[];
  }

  async get<T = unknown>(): Promise<T | null> {
    const rows = await this.all<T>();
    return rows[0] ?? null;
  }
}

class MockD1Database {
  releaseOffsets: number[] = [];
  nextAssetReleaseId: string | null = null;

  constructor(
    readonly releaseRows: Array<Record<string, unknown>>,
    readonly assetsByReleaseId: Map<string, Array<Record<string, unknown>>>,
    readonly deployableReleaseIds: string[],
    readonly repoRow: Record<string, unknown>,
  ) {}

  select() {
    return new MockSelectQuery(this);
  }

  insert() {
    return this;
  }

  update() {
    return this;
  }

  delete() {
    return this;
  }

  async all<T = unknown>(_query: unknown): Promise<T[]> {
    return [this.repoRow] as T[];
  }

  prepare() {
    return {
      bind() {
        return this;
      },
      async first() {
        return null;
      },
      async all() {
        return { results: [], success: true, meta: {} };
      },
      async run() {
        return {
          success: true,
          meta: { changes: 0, last_row_id: 0, duration: 0 },
        };
      },
      async raw() {
        return [];
      },
    };
  }

  exec() {
    return Promise.resolve({ count: 0, duration: 0 });
  }

  batch<T>(statements: Array<{ run: () => Promise<T> }>): Promise<T[]> {
    return Promise.all(statements.map((statement) => statement.run()));
  }

  withSession() {
    return {
      prepare: () => this.prepare(),
      batch: <T>(statements: Array<{ run: () => Promise<T> }>) =>
        this.batch(statements),
      getBookmark: () => null,
    };
  }

  dump() {
    return Promise.resolve(new ArrayBuffer(0));
  }
}

function createUserEnv(db: MockD1Database): Env {
  return {
    DB: db as unknown as Env["DB"],
    GIT_OBJECTS: {} as Env["GIT_OBJECTS"],
    ADMIN_DOMAIN: "admin.takos.test",
  } as unknown as Env;
}

function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(
        error.toResponse(),
        error.statusCode as
          | 400
          | 401
          | 403
          | 404
          | 409
          | 410
          | 422
          | 429
          | 500
          | 501
          | 502
          | 503
          | 504,
      );
    }
    throw error;
  });
  app.route("/api", explore);
  return app;
}

Deno.test("GET /explore/packages/:username/:repoName/latest scans past the first 10 releases", async () => {
  const releaseRows = Array.from({ length: 11 }, (_, index) => ({
    id: `release-${index + 1}`,
    tag: `v${index + 1}.0.0`,
    commitSha: `commit-${index + 1}`,
    description: `Release ${index + 1}`,
    publishedAt: `2026-03-${String(31 - index).padStart(2, "0")}T00:00:00.000Z`,
  }));
  const assetsByReleaseId = new Map<string, Array<Record<string, unknown>>>([
    [
      "release-11",
      [
        {
          id: "asset-11",
          assetKey: "asset-key-11",
          name: "big-repo.zip",
          contentType: "application/zip",
          sizeBytes: 1024,
          downloadCount: 77,
          bundleFormat: null,
          bundleMetaJson: JSON.stringify({
            app_id: "big-repo",
            version: "11.0.0",
            description: "Deployable release 11",
            icon: "icon-11",
          }),
          createdAt: "2026-03-21T00:00:00.000Z",
        },
      ],
    ],
  ]);
  const repoRow = {
    id: "repo-1",
    name: "big-repo",
    description: "Repository with many releases",
    visibility: "public",
    default_branch: "main",
    stars: 10,
    forks: 1,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-31T00:00:00.000Z",
    space_id: "space-1",
    workspace_name: "Space 1",
    owner_id: "space-1",
    owner_name: "Space 1",
    owner_username: "alice",
    owner_avatar_url: null,
  };
  const db = new MockD1Database(
    releaseRows,
    assetsByReleaseId,
    ["release-11"],
    repoRow,
  );
  const env = createUserEnv(db);
  const app = createApp();

  const originalGitStore = sourceServiceDeps.gitStore;
  (sourceServiceDeps as {
    gitStore: typeof sourceServiceDeps.gitStore;
  }).gitStore = {
    ...sourceServiceDeps.gitStore,
    getCommitData: (async (_bucket: unknown, sha: string) => ({
      tree: sha === "commit-11" ? "tree-11" : `tree-${sha}`,
    } as unknown)) as typeof sourceServiceDeps.gitStore.getCommitData,
    listDirectory:
      (async (_bucket: unknown, treeSha: string, path = "") =>
        treeSha === "tree-11"
          ? path === ".takos"
            ? [{ name: "app.yml", mode: "100644", sha: "blob-11" }]
            : [{ name: ".takos", mode: "040000", sha: "tree-11" }]
          : path === ".takos"
          ? []
          : [{
            name: ".takos",
            mode: "040000",
            sha: treeSha,
          }]) as typeof sourceServiceDeps.gitStore.listDirectory,
    getBlobAtPath:
      (async (_bucket: unknown, treeSha: string, filePath: string) =>
        treeSha === "tree-11" && filePath === ".takos/app.yml"
          ? new Uint8Array([1])
          : null) as typeof sourceServiceDeps.gitStore.getBlobAtPath,
  };

  try {
    const response = await app.fetch(
      new Request("https://takos.jp/api/packages/alice/big-repo/latest", {
        headers: { Authorization: "Bearer test" },
      }),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    assertEquals(db.releaseOffsets, [0, 10]);
    assertObjectMatch(await response.json(), {
      package: {
        name: "big-repo",
        version: "11.0.0",
        repository: {
          id: "repo-1",
          name: "big-repo",
        },
        release: {
          id: "release-11",
          tag: "v11.0.0",
        },
        asset: {
          id: "asset-11",
          name: "big-repo.zip",
          download_count: 77,
        },
      },
    });
  } finally {
    (sourceServiceDeps as {
      gitStore: typeof sourceServiceDeps.gitStore;
    }).gitStore = originalGitStore;
  }
});
