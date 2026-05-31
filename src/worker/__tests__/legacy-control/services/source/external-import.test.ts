// deno-lint-ignore-file no-explicit-any no-import-prefix no-unversioned-import
import { assertEquals, assertExists } from "@std/assert";

import {
  type ImportExternalRepoInput,
  importExternalRepository,
} from "@/application/services/source/external-import.ts";
import type { TakosGitClient } from "@/application/services/takos-git/client.ts";
import { branches, repoRemotes, repositories, tags } from "@/infra/db/index.ts";
import { asTestDatabase } from "@test/db-stubs";

type InsertRecord = {
  table: unknown;
  value: Record<string, unknown>;
};

function createFakeDb() {
  const inserts: InsertRecord[] = [];
  const deletes: unknown[] = [];

  const chain = (step: { get?: unknown } = {}) => {
    const value: any = {
      from() {
        return value;
      },
      where() {
        return value;
      },
      values(input: Record<string, unknown>) {
        value._value = input;
        return value;
      },
      set() {
        return value;
      },
      get: async () => step.get ?? null,
      all: async () => [],
      run: async () => ({ success: true }),
      catch: async () => undefined,
    };
    return value;
  };

  const db = asTestDatabase({
    select() {
      return chain({ get: null });
    },
    insert(table: unknown) {
      const current = chain();
      current.values = (input: Record<string, unknown>) => {
        inserts.push({ table, value: input });
        return current;
      };
      return current;
    },
    delete(table: unknown) {
      deletes.push(table);
      return chain();
    },
    update() {
      return chain();
    },
  });

  return { db, inserts, deletes };
}

Deno.test("external import delegates Git ingestion to takos-git and mirrors app metadata", async () => {
  const { db, inserts, deletes } = createFakeDb();
  const calls: ImportExternalRepoInput[] = [];
  const gitClient = {
    async importExternalRepository(request) {
      calls.push({
        accountId: request.ownerSpaceId,
        url: request.remoteUrl,
        name: request.name,
        authHeader: request.authHeader,
      });
      return {
        repository: {
          id: request.id,
          name: request.name,
          ownerSpaceId: request.ownerSpaceId,
          defaultBranch: "main",
          refs: [
            { name: "refs/heads/main", target: "a".repeat(40) },
            { name: "refs/tags/v1.0.0", target: "a".repeat(40) },
          ],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        remoteUrl: request.remoteUrl,
        defaultBranch: "main",
        branchCount: 1,
        tagCount: 1,
        commitCount: 1,
      };
    },
  } as TakosGitClient;

  const result = await importExternalRepository(db, gitClient, {
    accountId: "space_1",
    url: "https://example.com/owner/repo.git",
    name: "repo",
    authHeader: "Bearer token",
  });

  assertEquals(result.name, "repo");
  assertEquals(result.defaultBranch, "main");
  assertEquals(calls[0], {
    accountId: "space_1",
    url: "https://example.com/owner/repo.git",
    name: "repo",
    authHeader: "Bearer token",
  });
  assertExists(inserts.find((insert) => insert.table === repositories));
  assertEquals(
    inserts.filter((insert) => insert.table === branches).length,
    1,
  );
  assertEquals(inserts.filter((insert) => insert.table === tags).length, 1);
  assertExists(inserts.find((insert) => insert.table === repoRemotes));
  assertEquals(deletes, [branches, tags]);
});
