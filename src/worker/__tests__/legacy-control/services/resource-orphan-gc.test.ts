import { assertEquals } from "@std/assert";
import { assertSpyCallArgs, assertSpyCalls, spy } from "@std/testing/mock";
import { resourceOrphanGcDeps } from "../../../application/services/maintenance/resource-orphan-gc.ts";
import { noopDep } from "@test/dep-stubs";

type GetDbStub = (...args: never[]) => object;
const mocks: {
  getDb: GetDbStub;
  deleteManagedResource: ReturnType<typeof spy<unknown, unknown[], unknown>>;
  orphanedResources: Array<{
    id: string;
    type: string;
    backendName: string | null;
    backingResourceId: string | null;
    backingResourceName: string | null;
  }>;
} = {
  getDb: noopDep<GetDbStub>("resource-orphan-gc.getDb"),
  deleteManagedResource: spy((..._args: unknown[]) => undefined),
  orphanedResources: [],
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
  mocks.getDb = () => ({
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
  });
  mocks.deleteManagedResource = spy((..._args: unknown[]) => undefined);
  mocks.orphanedResources = [
    {
      id: "res-cf",
      type: "d1",
      backendName: "cloudflare",
      backingResourceId: "cf-db",
      backingResourceName: "cf-db",
    },
    {
      id: "res-portable",
      type: "kv",
      backendName: "aws",
      backingResourceId: "portable-kv",
      backingResourceName: "portable-kv",
    },
  ];
  resourceOrphanGcDeps.getDb = mocks.getDb as typeof resourceOrphanGcDeps.getDb;
  resourceOrphanGcDeps.deleteManagedResource = mocks
    .deleteManagedResource as typeof resourceOrphanGcDeps.deleteManagedResource;

  const result = await gcOrphanedResources(env);

  assertSpyCalls(mocks.deleteManagedResource, 2);
  assertSpyCallArgs(mocks.deleteManagedResource, 0, [env, {
    type: "d1",
    backendName: "cloudflare",
    backingResourceId: "cf-db",
    backingResourceName: "cf-db",
  }]);
  assertSpyCallArgs(mocks.deleteManagedResource, 1, [env, {
    type: "kv",
    backendName: "aws",
    backingResourceId: "portable-kv",
    backingResourceName: "portable-kv",
  }]);
  assertEquals(result.deleted, 2);
  assertEquals(result.failed, 0);
});
