import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { User } from "../../../../shared/types/index.ts";
import {
  accounts,
  authIdentities,
  authSessions,
  getDb,
  sessionsRevoked,
} from "../../../../infra/db/index.ts";
import { openSqliteSqlDatabase } from "../../../../local-platform/persistent-d1.ts";
import type { ServerSqlDatabase } from "../../../../local-platform/persistent-d1.ts";
import { EMBEDDED_MIGRATIONS } from "../../../../platform/migrations/migration-set.ts";
import { runPendingMigrations } from "../../../../platform/migrations/runtime-migrations.ts";
import { buildDataSubjectExport } from "../privacy-rights.ts";

let directory: string;
let database: ServerSqlDatabase;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "takos-privacy-rights-"));
  database = await openSqliteSqlDatabase(join(directory, "privacy.sqlite"));
  const migrationStatus = await runPendingMigrations(database, {
    migrations: EMBEDDED_MIGRATIONS,
  });
  expect(migrationStatus.state).toBe("ready");
  expect(migrationStatus.applied).toBe(EMBEDDED_MIGRATIONS.length);
});

afterEach(async () => {
  database.close();
  await rm(directory, { force: true, recursive: true });
});

function makeUser(id: string): User {
  return {
    id,
    email: `${id}@example.test`,
    name: `User ${id}`,
    username: id,
    bio: null,
    picture: null,
    trust_tier: "new",
    setup_completed: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

async function insertAccount(user: User): Promise<void> {
  await getDb(database).insert(accounts).values({
    id: user.id,
    type: "user",
    name: user.name,
    slug: user.username,
    email: user.email,
    trustTier: user.trust_tier,
    setupCompleted: user.setup_completed,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  });
}

describe("buildDataSubjectExport", () => {
  test("exports app-local auth metadata and owned revocations without secrets or cross-subject rows", async () => {
    const owner = makeUser("privacy-owner");
    const other = makeUser("privacy-other");
    await insertAccount(owner);
    await insertAccount(other);

    await getDb(database).insert(authIdentities).values({
      id: "owner-identity-link-id",
      userId: owner.id,
      provider: "takosumi-accounts",
      providerSub: "provider-subject-secret-sentinel",
      emailSnapshot: owner.email,
      emailKind: "verified",
      linkedAt: "2026-01-02T00:00:00.000Z",
      lastLoginAt: "2026-01-03T00:00:00.000Z",
      refreshTokenEnc: "refresh-ciphertext-secret-sentinel",
      accessTokenEnc: "access-ciphertext-secret-sentinel",
    });
    await getDb(database).insert(authSessions).values({
      id: "owner-app-local-session-mirror-id",
      accountId: owner.id,
      tokenHash: "session-token-hash-secret-sentinel",
      userAgent: "Takos test client",
      ipAddress: "192.0.2.10",
      expiresAt: "2026-02-01T00:00:00.000Z",
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    await getDb(database).insert(sessionsRevoked).values([
      {
        sessionId: "owner-revoked-session-id-secret-sentinel",
        userId: owner.id,
        revokedAt: "2026-01-04T00:00:00.000Z",
        reason: "logout",
        expiresAt: "2026-02-01T00:00:00.000Z",
      },
      {
        sessionId: "other-revoked-session-id-secret-sentinel",
        userId: other.id,
        revokedAt: "2026-01-05T00:00:00.000Z",
        reason: "rotation",
        expiresAt: "2026-02-02T00:00:00.000Z",
      },
      {
        sessionId: "orphan-revoked-session-id-secret-sentinel",
        userId: null,
        revokedAt: "2026-01-06T00:00:00.000Z",
        reason: "logout",
        expiresAt: null,
      },
    ]);

    const before = await Promise.all([
      getDb(database).select().from(authIdentities).all(),
      getDb(database).select().from(authSessions).all(),
      getDb(database).select().from(sessionsRevoked).all(),
    ]);
    const exported = await buildDataSubjectExport(database, owner);
    const after = await Promise.all([
      getDb(database).select().from(authIdentities).all(),
      getDb(database).select().from(authSessions).all(),
      getDb(database).select().from(sessionsRevoked).all(),
    ]);
    const serialized = JSON.stringify(exported);

    expect(exported.auth.identities).toEqual([{
      id: "owner-identity-link-id",
      provider: "takosumi-accounts",
      email_snapshot: owner.email,
      email_kind: "verified",
      linked_at: "2026-01-02T00:00:00.000Z",
      last_login_at: "2026-01-03T00:00:00.000Z",
    }]);
    expect(exported.auth.sessions).toEqual([{
      id: "owner-app-local-session-mirror-id",
      user_agent: "Takos test client",
      ip_address: "192.0.2.10",
      expires_at: "2026-02-01T00:00:00.000Z",
      created_at: "2026-01-02T00:00:00.000Z",
    }]);
    expect(exported.auth.revocations).toEqual([{
      revoked_at: "2026-01-04T00:00:00.000Z",
      reason: "logout",
      expires_at: "2026-02-01T00:00:00.000Z",
    }]);
    for (const secret of [
      "provider-subject-secret-sentinel",
      "refresh-ciphertext-secret-sentinel",
      "access-ciphertext-secret-sentinel",
      "session-token-hash-secret-sentinel",
      "owner-revoked-session-id-secret-sentinel",
      "other-revoked-session-id-secret-sentinel",
      "orphan-revoked-session-id-secret-sentinel",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain("other-revoked-session");
    expect(serialized).not.toContain("orphan-revoked-session");
    expect(after).toEqual(before);
  });
});
