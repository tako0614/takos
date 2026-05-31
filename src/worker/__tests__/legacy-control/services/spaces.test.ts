import { assert, assertEquals } from "@std/assert";
import { spaceCrudDeps } from "@/application/services/identity/space-crud.ts";
import { spaceModelDeps } from "@/application/services/identity/space-models.ts";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { noopDep } from "@test/dep-stubs";

type AnyMockFn = (...args: never[]) => unknown;
const mocks: { getDb: AnyMockFn } = {
  getDb: noopDep("getDb"),
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  getWorkspaceModelSettings,
  listWorkspacesForUser,
} from "@/services/identity/spaces";
import { noopSqlDatabaseBinding } from "@test/binding-stubs";

type DrizzleMockFn = (...args: unknown[]) => unknown;
interface DrizzleMockState {
  all: DrizzleMockFn;
  run: DrizzleMockFn;
}
interface DrizzleMockChain {
  from(): DrizzleMockChain;
  where(): DrizzleMockChain;
  set(): DrizzleMockChain;
  values(): DrizzleMockChain;
  returning(): DrizzleMockChain;
  orderBy(): DrizzleMockChain;
  limit(): DrizzleMockChain;
  offset(): DrizzleMockChain;
  leftJoin(): DrizzleMockChain;
  innerJoin(): DrizzleMockChain;
  onConflictDoUpdate(): DrizzleMockChain;
  onConflictDoNothing(): DrizzleMockChain;
  get: () => Promise<unknown>;
  all: DrizzleMockFn;
  run: DrizzleMockFn;
}

function setSpaceCrudGetDb(target: object): void {
  const erased: (...args: never[]) => object = () => target;
  spaceCrudDeps.getDb = erased as typeof spaceCrudDeps.getDb;
}

function setSpaceModelGetDb(target: object): void {
  const erased: (...args: never[]) => object = () => target;
  spaceModelDeps.getDb = erased as typeof spaceModelDeps.getDb;
}

// `isValidOpaqueId` is a type predicate; tests need to install a permissive
// stub via a function that returns `value is string` rather than `boolean`.
function installAlwaysValidOpaqueIdGuard(): void {
  const truePredicate = (_value: unknown): _value is string => true;
  spaceCrudDeps.isValidOpaqueId = truePredicate;
  spaceModelDeps.isValidOpaqueId = truePredicate;
}

function createDrizzleMock() {
  const getResults: unknown[] = [];
  const state: DrizzleMockState = {
    all: async () => undefined,
    run: () => undefined,
  };
  let selectCalls = 0;
  const chain: DrizzleMockChain = {
    from() {
      return chain;
    },
    where() {
      return chain;
    },
    set() {
      return chain;
    },
    values() {
      return chain;
    },
    returning() {
      return chain;
    },
    orderBy() {
      return chain;
    },
    limit() {
      return chain;
    },
    offset() {
      return chain;
    },
    leftJoin() {
      return chain;
    },
    innerJoin() {
      return chain;
    },
    onConflictDoUpdate() {
      return chain;
    },
    onConflictDoNothing() {
      return chain;
    },
    get: async () => getResults.shift(),
    all: (...args: unknown[]) => state.all(...args),
    run: (...args: unknown[]) => state.run(...args),
  };
  return {
    select: () => {
      selectCalls += 1;
      return chain;
    },
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: Object.assign(state, {
      get: async () => getResults.shift(),
      chain,
      results: getResults,
    }),
    selectCalls: () => selectCalls,
  };
}

Deno.test("spaces service queries - lists spaces for a human principal from the canonical tables", async () => {
  const drizzle = createDrizzleMock();
  mocks.getDb = () => drizzle;
  setSpaceCrudGetDb(drizzle);
  spaceCrudDeps.resolveUserPrincipalId =
    (async () => "user-1") as typeof spaceCrudDeps.resolveUserPrincipalId;
  installAlwaysValidOpaqueIdGuard();

  // Call sequence:
  // 1. resolveUserPrincipalId: select({id}).from(accounts).where().get() -> {id: 'user-1'}
  // 2. listWorkspacesForUser main query: select({...}).from(accountMemberships).innerJoin().where().orderBy().all() -> memberships
  // 3. findLatestRepositoryBySpaceId: select({...}).from(repositories).where().orderBy().limit().get() -> repo
  drizzle._.results.push(
    { id: "repo-1", name: "main", default_branch: "main" },
  );

  drizzle._.all = async () => [
    {
      memberRole: "owner",
      spaceId: "ws-1",
      spaceType: "user",
      spaceName: "User One",
      spaceSlug: "user1",
      spaceOwnerAccountId: "user-1",
      spaceHeadSnapshotId: null,
      spaceSecurityPosture: "restricted_egress",
      spaceCreatedAt: "2026-02-13T00:00:00.000Z",
      spaceUpdatedAt: "2026-02-13T00:00:00.000Z",
    },
  ];

  const result = await listWorkspacesForUser(
    createMockEnv({ DB: noopSqlDatabaseBinding() }),
    "user-1",
  );

  assertEquals(result, [{
    id: "ws-1",
    kind: "user",
    name: "User One",
    slug: "user1",
    owner_principal_id: "user-1",
    automation_principal_id: null,
    head_snapshot_id: null,
    security_posture: "restricted_egress",
    created_at: "2026-02-13T00:00:00.000Z",
    updated_at: "2026-02-13T00:00:00.000Z",
    member_role: "owner",
    repository: {
      id: "repo-1",
      name: "main",
      default_branch: "main",
    },
  }]);
  assert(drizzle.selectCalls() > 0);
});
Deno.test("spaces service queries - reads model settings from spaces", async () => {
  const drizzle = createDrizzleMock();
  mocks.getDb = () => drizzle;
  setSpaceModelGetDb(drizzle);
  // `installAlwaysValidOpaqueIdGuard()` already configures spaceModelDeps.isValidOpaqueId

  drizzle._.results.push({
    ai_model: "gpt-5.4-nano",
    model_backend: "openai",
    security_posture: "standard",
  });

  const result = await getWorkspaceModelSettings(
    noopSqlDatabaseBinding(),
    "ws-1",
  );

  assertEquals(result, {
    ai_model: "gpt-5.4-nano",
    model_backend: "openai",
    security_posture: "standard",
  });
  assert(drizzle.selectCalls() > 0);
});
