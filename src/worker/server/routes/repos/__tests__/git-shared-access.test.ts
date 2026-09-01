import { test } from "bun:test";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
} from "@takos/test/assert";
import { NotFoundError } from "@takos/worker-platform-utils/errors";

import {
  requireRepoAdmin,
  requireRepoRead,
  requireRepoWrite,
} from "../git-shared.ts";
import { hasRepoWriteAccess } from "../shared.ts";

// An id containing characters outside the opaque-id alphabet makes
// `checkRepoAccess` short-circuit to `null` before any DB access, so these
// tests stay dependency-free while still exercising the helper prologues.
const INVALID_REPO_ID = "!! not a real id !!";
const env = { DB: undefined as never };

test("only owner access can mutate a repository", () => {
  assertEquals(hasRepoWriteAccess("owner"), true);
  assertEquals(hasRepoWriteAccess("public-read"), false);
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
