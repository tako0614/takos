import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type { Database } from "../../../../infra/db/index.ts";
import type { User } from "../../../../shared/types/index.ts";
import {
  getPrivacyAccessSummary,
  requestAccountDeletion,
  sanitizePrivacyAuthIdentities,
} from "../privacy-rights.ts";

const user: User = {
  id: "user_1",
  email: "user@example.com",
  name: "User",
  username: "user",
  principal_kind: "user",
  bio: null,
  picture: null,
  trust_tier: "normal",
  setup_completed: true,
  created_at: "2026-08-10T00:00:00.000Z",
  updated_at: "2026-08-10T00:00:00.000Z",
};

const TEST_DDL = `
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE account_metadata (
    account_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account_id, key)
  );
  CREATE TABLE auth_sessions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL
  );
`;

async function createFixture() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(TEST_DDL);
  await client.execute(`
    INSERT INTO accounts (id, status, updated_at)
    VALUES ('user_1', 'active', '2026-08-10T00:00:00.000Z')
  `);
  const db = drizzle(client, { schema }) as unknown as Database;
  return { client, db };
}

test("privacy identity export excludes operator-owned OIDC identity and credentials", () => {
  const sourceIdentity = {
    id: "identity_1",
    userId: "user_1",
    provider: "oidc",
    providerSub: "operator-subject",
    emailSnapshot: "operator@example.com",
    emailKind: "verified",
    linkedAt: "2026-08-10T00:00:00.000Z",
    lastLoginAt: "2026-08-10T00:01:00.000Z",
    refreshTokenEnc: "encrypted-refresh-secret",
    accessTokenEnc: "encrypted-access-secret",
    accessTokenExpiresAt: "2026-08-10T01:00:00.000Z",
    tokenScope: "openid profile",
    delegatedWorkspaceId: "workspace_external",
    refreshLeaseId: "lease_secret",
    refreshLeaseExpiresAt: "2026-08-10T00:02:00.000Z",
  };
  const projected = sanitizePrivacyAuthIdentities([sourceIdentity]);

  expect(projected).toEqual([{
    id: "identity_1",
    linked_at: "2026-08-10T00:00:00.000Z",
    last_login_at: "2026-08-10T00:01:00.000Z",
  }]);
  expect(JSON.stringify(projected)).not.toContain("operator-subject");
  expect(JSON.stringify(projected)).not.toContain("secret");
});

test("privacy access reads only deletion status when unrelated metadata is large", async () => {
  const fixture = await createFixture();
  try {
    const rows = Array.from({ length: 101 }, (_, index) =>
      `('user_1', 'unrelated.${index}', 'value', '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z')`
    ).join(",");
    await fixture.client.execute(`
      INSERT INTO account_metadata
        (account_id, key, value, created_at, updated_at)
      VALUES ${rows}
    `);

    const summary = await getPrivacyAccessSummary(fixture.db, user);
    expect(summary.request_status).toEqual({ status: "none" });
  } finally {
    fixture.client.close();
  }
});

test("deletion request is stable across retries and revokes new sessions", async () => {
  const fixture = await createFixture();
  try {
    await fixture.client.executeMultiple(`
      INSERT INTO auth_sessions (id, account_id) VALUES
        ('session_1', 'user_1'),
        ('session_2', 'user_1');
    `);
    const first = await requestAccountDeletion(fixture.db, user, {
      reason: "first reason",
    });
    expect(first.status).toBe("pending");
    expect(first.revoked.auth_sessions).toBe(2);

    await fixture.client.execute(`
      INSERT INTO auth_sessions (id, account_id)
      VALUES ('late_session', 'user_1')
    `);
    const replay = await requestAccountDeletion(fixture.db, user, {
      reason: "must not replace the accepted request",
    });
    expect(replay.request_id).toBe(first.request_id);
    expect(replay.requested_at).toBe(first.requested_at);
    expect(replay.revoked.auth_sessions).toBe(1);

    const account = await fixture.client.execute(
      "SELECT status FROM accounts WHERE id = 'user_1'",
    );
    const sessions = await fixture.client.execute(
      "SELECT id FROM auth_sessions WHERE account_id = 'user_1'",
    );
    const metadata = await fixture.client.execute(`
      SELECT value FROM account_metadata
      WHERE account_id = 'user_1' AND key = 'privacy.deletion_request'
    `);
    expect(account.rows[0]?.status).toBe("pending_deletion");
    expect(sessions.rows).toHaveLength(0);
    expect(JSON.parse(String(metadata.rows[0]?.value)).reason).toBe(
      "first reason",
    );
  } finally {
    fixture.client.close();
  }
});

test("concurrent deletion requests converge on one canonical request", async () => {
  const fixture = await createFixture();
  try {
    const [first, second] = await Promise.all([
      requestAccountDeletion(fixture.db, user, { reason: "first" }),
      requestAccountDeletion(fixture.db, user, { reason: "second" }),
    ]);
    expect(second.request_id).toBe(first.request_id);
    expect(second.requested_at).toBe(first.requested_at);
    const rows = await fixture.client.execute(`
      SELECT value FROM account_metadata
      WHERE account_id = 'user_1' AND key = 'privacy.deletion_request'
    `);
    expect(rows.rows).toHaveLength(1);
    expect(JSON.parse(String(rows.rows[0]?.value)).request_id).toBe(
      first.request_id,
    );
  } finally {
    fixture.client.close();
  }
});

test("deletion request batch rolls every mutation back on account failure", async () => {
  const fixture = await createFixture();
  try {
    await fixture.client.executeMultiple(`
      INSERT INTO auth_sessions (id, account_id)
      VALUES ('session_1', 'user_1');
      CREATE TRIGGER reject_account_deletion
      BEFORE UPDATE ON accounts
      BEGIN
        SELECT RAISE(ABORT, 'test account transition failure');
      END;
    `);
    await expect(requestAccountDeletion(fixture.db, user)).rejects.toThrow();
    expect((await fixture.client.execute(
      "SELECT id FROM auth_sessions WHERE account_id = 'user_1'",
    )).rows).toHaveLength(1);
    expect((await fixture.client.execute(
      "SELECT key FROM account_metadata WHERE account_id = 'user_1'",
    )).rows).toHaveLength(0);
    expect((await fixture.client.execute(
      "SELECT status FROM accounts WHERE id = 'user_1'",
    )).rows[0]?.status).toBe("active");
  } finally {
    fixture.client.close();
  }
});

test("deletion request repairs malformed prior metadata", async () => {
  const fixture = await createFixture();
  try {
    await fixture.client.execute(`
      INSERT INTO account_metadata
        (account_id, key, value, created_at, updated_at)
      VALUES
        ('user_1', 'privacy.deletion_request', '{broken',
         '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z')
    `);
    const result = await requestAccountDeletion(fixture.db, user);
    expect(result.status).toBe("pending");
    expect(result.request_id).toStartWith("dsr_");
  } finally {
    fixture.client.close();
  }
});
