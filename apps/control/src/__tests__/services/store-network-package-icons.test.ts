import { assertEquals } from "jsr:@std/assert";

import { resolvePackageIconsForRepos } from "@/application/services/store-network/package-icons.ts";
import { repoReleaseAssets, repoReleases } from "@/infra/db/index.ts";

class MockSelectQuery {
  private table: unknown;

  constructor(private readonly db: MockDb) {}

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

  async all<T = unknown>(): Promise<T[]> {
    if (this.table === repoReleases) {
      return this.db.releaseRows as T[];
    }
    if (this.table === repoReleaseAssets) {
      return this.db.assetRows as T[];
    }
    return [];
  }
}

class MockDb {
  constructor(
    readonly releaseRows: Array<Record<string, unknown>>,
    readonly assetRows: Array<Record<string, unknown>>,
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
}

Deno.test("resolvePackageIconsForRepos returns latest release primary asset icons", async () => {
  const db = new MockDb(
    [
      { id: "release-latest", repoId: "repo-1" },
      { id: "release-old", repoId: "repo-1" },
      { id: "release-invalid", repoId: "repo-2" },
      { id: "release-remote", repoId: "repo-3" },
    ],
    [
      {
        releaseId: "release-latest",
        bundleMetaJson: JSON.stringify({ icon: " /icons/latest.svg " }),
      },
      {
        releaseId: "release-latest",
        bundleMetaJson: JSON.stringify({ icon: "/icons/secondary.svg" }),
      },
      {
        releaseId: "release-old",
        bundleMetaJson: JSON.stringify({ icon: "/icons/old.svg" }),
      },
      {
        releaseId: "release-invalid",
        bundleMetaJson: JSON.stringify({ icon: 42 }),
      },
      {
        releaseId: "release-remote",
        bundleMetaJson: JSON.stringify({
          icon: "https://cdn.test/app.png",
        }),
      },
    ],
  );

  const icons = await resolvePackageIconsForRepos(
    db as never,
    ["repo-1", "repo-2", "repo-3", "repo-1"],
  );

  assertEquals(icons.get("repo-1"), "/icons/latest.svg");
  assertEquals(icons.has("repo-2"), false);
  assertEquals(icons.get("repo-3"), "https://cdn.test/app.png");
});
