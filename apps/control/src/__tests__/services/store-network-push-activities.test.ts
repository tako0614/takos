import { assertEquals } from "jsr:@std/assert";
import { MockD1Database } from "../../../test/integration/setup.ts";
import type { D1Database } from "@cloudflare/workers-types";
import {
  DELETE_REF,
  recordRepoDeleteActivity,
} from "@/application/services/store-network/push-activities.ts";

Deno.test("recordRepoDeleteActivity stores repository snapshot for delete feed entries", async () => {
  const repository = {
    ownerSlug: "alice",
    name: "demo",
    summary: "Demo repo",
    visibility: "public",
    defaultBranch: "main",
    defaultBranchHash: "abc123",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-02T00:00:00.000Z",
  };

  const result = await recordRepoDeleteActivity(
    new MockD1Database() as unknown as D1Database,
    {
      repoId: "repo-1",
      accountId: "space-1",
      repository,
    },
  );

  assertEquals(result.repoId, "repo-1");
  assertEquals(result.accountId, "space-1");
  assertEquals(result.ref, DELETE_REF);
  assertEquals(result.afterSha, "");
  assertEquals(result.commitCount, 0);
  assertEquals(result.repositorySnapshot, repository);
});
