import { assertEquals } from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls, spy } from "jsr:@std/testing/mock";
import { resourceOrphanGcDeps } from "../../../../../packages/control/src/application/services/maintenance/resource-orphan-gc.ts";

const mocks = {
  getDb: ((..._args: any[]) => undefined) as any,
  deleteManagedResource: spy((..._args: any[]) => undefined),
  orphanedResources: [] as Array<{
    id: string;
    type: string;
    providerName: string | null;
    providerResourceId: string | null;
    providerResourceName: string | null;
  }>,
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/resources/lifecycle'
import { gcOrphanedResources } from "@/services/maintenance/resource-orphan-gc";

Deno.test("gcOrphanedResources - reclaims cloudflare and portable orphaned resources through the shared lifecycle path", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = {
    DB: {} as never,
    CF_ACCOUNT_ID: "account",
    CF_API_TOKEN: "token",
    WFP_DISPATCH_NAMESPACE: "dispatch",
  };
  mocks.getDb = (() => ({
    select() {
      return {
        from() {
          return {
            where() {
              return {
                all: async () => mocks.orphanedResources,
              };
            },
          };
        },
      };
    },
    delete() {
      return {
        where() {
          return Promise.resolve();
        },
      };
    },
  })) as any;
  mocks.deleteManagedResource = spy((..._args: any[]) => undefined);
  mocks.orphanedResources = [
    {
      id: "res-cf",
      type: "d1",
      providerName: "cloudflare",
      providerResourceId: "cf-db",
      providerResourceName: "cf-db",
    },
    {
      id: "res-portable",
      type: "kv",
      providerName: "aws",
      providerResourceId: "portable-kv",
      providerResourceName: "portable-kv",
    },
  ];
  resourceOrphanGcDeps.getDb = mocks.getDb;
  resourceOrphanGcDeps.deleteManagedResource = mocks.deleteManagedResource as any;

  const result = await gcOrphanedResources(env);

  assertSpyCalls(mocks.deleteManagedResource, 2);
  assertSpyCallArgs(mocks.deleteManagedResource, 0, [env, {
    type: "d1",
    providerName: "cloudflare",
    providerResourceId: "cf-db",
    providerResourceName: "cf-db",
  }]);
  assertSpyCallArgs(mocks.deleteManagedResource, 1, [env, {
    type: "kv",
    providerName: "aws",
    providerResourceId: "portable-kv",
    providerResourceName: "portable-kv",
  }]);
  assertEquals(result.deleted, 2);
  assertEquals(result.failed, 0);
});
