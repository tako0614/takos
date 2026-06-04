import { test } from "bun:test";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
} from "@takos/test/assert";
import { NotFoundError } from "@takos/worker-platform-utils/errors";

import {
  ADMIN_ROLES,
  requireRepoAdmin,
  requireRepoRead,
  requireRepoWrite,
  WRITE_ROLES,
} from "../git-shared.ts";
import { hasWriteRole } from "../shared.ts";

// An id containing characters outside the opaque-id alphabet makes
// `checkRepoAccess` short-circuit to `null` before any DB access, so these
// tests stay dependency-free while still exercising the helper prologues.
const INVALID_REPO_ID = "!! not a real id !!";
const env = { DB: undefined as never };

test("role sets are the single source of write/admin policy", () => {
  assertEquals([...WRITE_ROLES], ["owner", "admin", "editor"]);
  assertEquals([...ADMIN_ROLES], ["owner", "admin"]);
});

test("hasWriteRole agrees with WRITE_ROLES for every space role", () => {
  for (const role of ["owner", "admin", "editor"] as const) {
    assertEquals(hasWriteRole(role), true);
  }
  assertEquals(hasWriteRole("viewer"), false);
  assertEquals(hasWriteRole(null), false);
  assertEquals(hasWriteRole(undefined), false);
  // Any role that is a member of WRITE_ROLES must be accepted, and only those.
  for (const role of WRITE_ROLES) {
    assertEquals(hasWriteRole(role), true);
  }
});

test("requireRepoRead throws NotFoundError('Repository') on no access", async () => {
  const err = await assertRejects(() =>
    requireRepoRead(env, INVALID_REPO_ID, "user-1")
  );
  assertInstanceOf(err, NotFoundError);
  assertEquals(err.message, "Repository not found");
});

test("requireRepoWrite throws NotFoundError('Repository') on no access", async () => {
  const err = await assertRejects(() =>
    requireRepoWrite(env, INVALID_REPO_ID, "user-1")
  );
  assertInstanceOf(err, NotFoundError);
  assertEquals(err.message, "Repository not found");
});

test("requireRepoAdmin throws NotFoundError('Repository') on no access", async () => {
  const err = await assertRejects(() =>
    requireRepoAdmin(env, INVALID_REPO_ID, "user-1")
  );
  assertInstanceOf(err, NotFoundError);
  assertEquals(err.message, "Repository not found");
});
