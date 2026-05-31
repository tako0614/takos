import { assertEquals, assertNotEquals } from "@std/assert";
import { spaceCrudDeps } from "@/application/services/identity/space-crud.ts";
import { spaceMemberDeps } from "@/application/services/identity/space-members.ts";
import { spaceModelDeps } from "@/application/services/identity/space-models.ts";
import { noopDep } from "@test/dep-stubs";

type AnyMockFn = (...args: unknown[]) => unknown;

interface DrizzleMockState {
  get: AnyMockFn;
  all: AnyMockFn;
  chain?: DrizzleMockChain;
}

interface DrizzleMockChain {
  from(): DrizzleMockChain;
  where(): DrizzleMockChain;
  orderBy(): DrizzleMockChain;
  limit(): DrizzleMockChain;
  set(): DrizzleMockChain;
  values(): DrizzleMockChain;
  returning(): DrizzleMockChain;
  innerJoin(): DrizzleMockChain;
  get: AnyMockFn;
  all: AnyMockFn;
}

function createMockDrizzleDb() {
  const state: DrizzleMockState = {
    get: noopDep("drizzleMock.get"),
    all: noopDep("drizzleMock.all"),
  };
  const chain: DrizzleMockChain = {
    from() {
      return chain;
    },
    where() {
      return chain;
    },
    orderBy() {
      return chain;
    },
    limit() {
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
    innerJoin() {
      return chain;
    },
    get: (...args: unknown[]) => state.get(...args),
    all: (...args: unknown[]) => state.all(...args),
  };
  state.chain = chain;
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: state,
  };
}

const db = createMockDrizzleDb();

type GetDbStub = (...args: never[]) => object;
const mocks: { getDb: GetDbStub } = {
  getDb: noopDep<GetDbStub>("spaceCrudDeps.getDb"),
};

function setSpaceCrudGetDb(target: object): void {
  const erased: (...args: never[]) => object = () => target;
  spaceCrudDeps.getDb = erased as typeof spaceCrudDeps.getDb;
}

function setSpaceMemberGetDb(target: object): void {
  const erased: (...args: never[]) => object = () => target;
  spaceMemberDeps.getDb = erased as typeof spaceMemberDeps.getDb;
}

function setSpaceModelGetDb(target: object): void {
  const erased: (...args: never[]) => object = () => target;
  spaceModelDeps.getDb = erased as typeof spaceModelDeps.getDb;
}

// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  getRepositoryById,
  getUserByEmail,
  getWorkspaceByIdOrSlug,
  getWorkspaceModelSettings,
} from "@/services/identity/spaces";
import { noopSqlDatabaseBinding } from "@test/binding-stubs";

Deno.test("spaces service (Drizzle) - getWorkspaceByIdOrSlug - returns mapped workspace when found by id", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = () => db;
  setSpaceCrudGetDb(db);
  db._.get = async () => ({
    id: "ws-1",
    type: "team",
    name: "My Team",
    slug: "my-team",
    description: "A team workspace",
    ownerAccountId: "user-1",
    headSnapshotId: null,
    aiModel: "gpt-5.4-nano",
    modelBackend: "openai",
    securityPosture: "standard",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  });

  const ws = await getWorkspaceByIdOrSlug(
    noopSqlDatabaseBinding(),
    "ws-1",
  );

  assertNotEquals(ws, null);
  assertEquals(ws!.id, "ws-1");
  assertEquals(ws!.kind, "team");
  assertEquals(ws!.name, "My Team");
  assertEquals(ws!.slug, "my-team");
  assertEquals(ws!.owner_principal_id, "user-1");
  assertEquals(ws!.ai_model, "gpt-5.4-nano");
  assertEquals(ws!.model_backend, "openai");
  assertEquals(ws!.security_posture, "standard");
});
Deno.test("spaces service (Drizzle) - getWorkspaceByIdOrSlug - returns null when not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = () => db;
  setSpaceCrudGetDb(db);
  db._.get = async () => null;

  const ws = await getWorkspaceByIdOrSlug(
    noopSqlDatabaseBinding(),
    "nonexistent",
  );
  assertEquals(ws, null);
});
Deno.test("spaces service (Drizzle) - getWorkspaceByIdOrSlug - maps user type to user kind", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = () => db;
  setSpaceCrudGetDb(db);
  db._.get = async () => ({
    id: "user-1",
    type: "user",
    name: "Alice",
    slug: "alice",
    description: null,
    ownerAccountId: null,
    headSnapshotId: null,
    aiModel: null,
    modelBackend: null,
    securityPosture: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const ws = await getWorkspaceByIdOrSlug(
    noopSqlDatabaseBinding(),
    "alice",
  );
  assertEquals(ws!.kind, "user");
  // When ownerAccountId is null, owner_principal_id defaults to workspace id
  assertEquals(ws!.owner_principal_id, "user-1");
});
Deno.test("spaces service (Drizzle) - getWorkspaceByIdOrSlug - maps restricted_egress security posture", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = () => db;
  setSpaceCrudGetDb(db);
  db._.get = async () => ({
    id: "ws-secure",
    type: "team",
    name: "Secure Team",
    slug: "secure",
    description: null,
    ownerAccountId: "user-1",
    headSnapshotId: null,
    aiModel: null,
    modelBackend: null,
    securityPosture: "restricted_egress",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const ws = await getWorkspaceByIdOrSlug(
    noopSqlDatabaseBinding(),
    "ws-secure",
  );
  assertEquals(ws!.security_posture, "restricted_egress");
});

Deno.test("spaces service (Drizzle) - getWorkspaceModelSettings - returns model settings when found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = () => db;
  setSpaceModelGetDb(db);
  db._.get = async () => ({
    ai_model: "gpt-5.4-nano",
    model_backend: "openai",
    security_posture: "standard",
  });

  const settings = await getWorkspaceModelSettings(
    noopSqlDatabaseBinding(),
    "ws-1",
  );
  assertEquals(settings, {
    ai_model: "gpt-5.4-nano",
    model_backend: "openai",
    security_posture: "standard",
  });
});
Deno.test("spaces service (Drizzle) - getWorkspaceModelSettings - returns null when not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = () => db;
  setSpaceModelGetDb(db);
  db._.get = async () => null;

  const settings = await getWorkspaceModelSettings(
    noopSqlDatabaseBinding(),
    "ws-1",
  );
  assertEquals(settings, null);
});
Deno.test("spaces service (Drizzle) - getWorkspaceModelSettings - returns null for invalid space ID", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = () => db;
  setSpaceModelGetDb(db);
  const settings = await getWorkspaceModelSettings(
    noopSqlDatabaseBinding(),
    "",
  );
  assertEquals(settings, null);
});

Deno.test("spaces service (Drizzle) - getUserByEmail - returns mapped user when found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = () => db;
  setSpaceMemberGetDb(db);
  db._.get = async () => ({
    id: "user-1",
    email: "alice@example.com",
    name: "Alice",
    slug: "alice",
    bio: "Hello",
    picture: "https://example.com/avatar.png",
    trustTier: "standard",
    setupCompleted: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const user = await getUserByEmail(
    noopSqlDatabaseBinding(),
    "alice@example.com",
  );
  assertNotEquals(user, null);
  assertEquals(user!.id, "user-1");
  assertEquals(user!.email, "alice@example.com");
  assertEquals(user!.username, "alice");
  assertEquals(user!.principal_id, "user-1");
  assertEquals(user!.principal_kind, "user");
});
Deno.test("spaces service (Drizzle) - getUserByEmail - returns null when user not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = () => db;
  setSpaceMemberGetDb(db);
  db._.get = async () => null;

  const user = await getUserByEmail(
    noopSqlDatabaseBinding(),
    "nonexistent@example.com",
  );
  assertEquals(user, null);
});
Deno.test("spaces service (Drizzle) - getUserByEmail - handles null email field gracefully", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = () => db;
  setSpaceMemberGetDb(db);
  db._.get = async () => ({
    id: "user-1",
    email: null,
    name: "NoEmail",
    slug: "noemail",
    bio: null,
    picture: null,
    trustTier: "standard",
    setupCompleted: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const user = await getUserByEmail(
    noopSqlDatabaseBinding(),
    "test@example.com",
  );
  assertEquals(user!.email, "");
});

Deno.test("spaces service (Drizzle) - getRepositoryById - returns mapped repository when found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = () => db;
  setSpaceCrudGetDb(db);
  db._.get = async () => ({
    id: "repo-1",
    accountId: "ws-1",
    name: "main",
    description: "Default repo",
    visibility: "private",
    defaultBranch: "main",
    forkedFromId: null,
    stars: 0,
    forks: 0,
    gitEnabled: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const repo = await getRepositoryById(
    noopSqlDatabaseBinding(),
    "repo-1",
  );
  assertNotEquals(repo, null);
  assertEquals(repo!.id, "repo-1");
  assertEquals(repo!.space_id, "ws-1");
  assertEquals(repo!.name, "main");
  assertEquals(repo!.default_branch, "main");
  assertEquals(repo!.visibility, "private");
});
Deno.test("spaces service (Drizzle) - getRepositoryById - returns null when not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = () => db;
  setSpaceCrudGetDb(db);
  db._.get = async () => null;

  const repo = await getRepositoryById(
    noopSqlDatabaseBinding(),
    "nonexistent",
  );
  assertEquals(repo, null);
});
