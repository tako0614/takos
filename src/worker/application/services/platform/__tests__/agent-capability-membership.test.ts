import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import {
  resolveAllowedCapabilities,
  resolveWorkspaceAuthority,
} from "../capabilities.ts";
import {
  assertRunExecutionAccess,
  getRunBootstrap,
  resolveExecutionUserIdForRun,
} from "../../../../runtime/container-hosts/executor-run-state.ts";
import { AuthorizationError } from "@takos/worker-platform-utils/errors";

async function withMembershipDb(
  run: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<void>,
) {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      owner_account_id TEXT,
      security_posture TEXT NOT NULL DEFAULT 'standard',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE account_memberships (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE auth_identities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_sub TEXT NOT NULL UNIQUE
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      requester_account_id TEXT,
      status TEXT,
      input TEXT,
      thread_id TEXT,
      agent_type TEXT
    );
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL
    );
    INSERT INTO accounts (id, type, status, name, slug, owner_account_id) VALUES
      ('workspace', 'team', 'active', 'Workspace', 'workspace', 'owner'),
      ('second-workspace', 'team', 'active', 'Second', 'second-workspace', 'member'),
      ('revoked-workspace', 'team', 'active', 'Revoked', 'revoked', 'owner'),
      ('owner', 'user', 'active', 'Owner', 'owner', 'owner'),
      ('member', 'user', 'active', 'Member', 'member', 'member'),
      ('forged-owner', 'user', 'active', 'Forged', 'forged-owner', 'forged-owner'),
      ('removed', 'user', 'active', 'Removed', 'removed', 'removed'),
      ('suspended', 'user', 'suspended', 'Suspended', 'suspended', 'suspended');
    INSERT INTO account_memberships
      (id, account_id, member_id, role, status) VALUES
      ('membership-owner', 'workspace', 'owner', 'owner', 'active'),
      ('membership-second-owner', 'second-workspace', 'member', 'owner', 'active'),
      ('membership-active', 'workspace', 'member', 'editor', 'active'),
      ('membership-forged-owner', 'workspace', 'forged-owner', 'owner', 'active'),
      ('membership-suspended-principal', 'workspace', 'suspended', 'owner', 'active'),
      ('membership-revoked-owner', 'revoked-workspace', 'owner', 'owner', 'suspended');
    INSERT INTO runs (
      id, account_id, requester_account_id, status, input, thread_id, agent_type
    ) VALUES
      ('run-owner', 'workspace', 'owner', 'queued', '{}', 'thread-workspace', 'default'),
      ('run-second-owner', 'second-workspace', 'member', 'queued', '{}', 'thread-second', 'default'),
      ('run-editor', 'workspace', 'member', 'queued', '{}', 'thread-workspace', 'default'),
      ('run-forged-owner', 'workspace', 'forged-owner', 'queued', '{}', 'thread-workspace', 'default'),
      ('run-revoked-owner', 'revoked-workspace', 'owner', 'queued', '{}', 'thread-revoked', 'default'),
      ('run-legacy-null', 'workspace', NULL, 'queued', '{}', 'thread-workspace', 'default');
    INSERT INTO threads (id, account_id) VALUES
      ('thread-workspace', 'workspace'),
      ('thread-second', 'second-workspace'),
      ('thread-revoked', 'revoked-workspace');
    INSERT INTO auth_identities (id, user_id, provider, provider_sub) VALUES
      ('identity-owner', 'owner', 'oidc', 'https://accounts.example.test#owner-subject'),
      ('identity-second', 'member', 'oidc', 'https://accounts.example.test#second-subject');
  `);
  try {
    await run(drizzle(client, { schema }));
  } finally {
    client.close();
  }
}

test("agent capability authority requires the active matching Principal owner witness", async () => {
  await withMembershipDb(async (db) => {
    expect(await resolveWorkspaceAuthority(db, "workspace", "owner")).toBe(
      "owner",
    );
    expect(
      await resolveWorkspaceAuthority(db, "workspace", "member"),
    ).toBeNull();
    expect(
      await resolveWorkspaceAuthority(db, "workspace", "forged-owner"),
    ).toBeNull();
    expect(
      await resolveWorkspaceAuthority(db, "workspace", "removed"),
    ).toBeNull();
    expect(
      await resolveWorkspaceAuthority(db, "workspace", "suspended"),
    ).toBeNull();
    expect(
      await resolveWorkspaceAuthority(db, "revoked-workspace", "owner"),
    ).toBeNull();
  });
});

test("agent capabilities grant no authority from non-owner legacy memberships", async () => {
  await withMembershipDb(async (db) => {
    for (const userId of ["member", "forged-owner", "suspended", "removed"]) {
      await expect(
        resolveAllowedCapabilities({ db, spaceId: "workspace", userId }),
      ).rejects.toThrow("no longer has access");
    }

    await expect(
      resolveAllowedCapabilities({
        db,
        spaceId: "revoked-workspace",
        userId: "owner",
      }),
    ).rejects.toThrow("no longer has access");
  });
});

test("queued runs revalidate the requester as the active Workspace owner", async () => {
  await withMembershipDb(async (db) => {
    const env = {
      DB: db,
      OIDC_ISSUER_URL: "https://accounts.example.test",
      OIDC_OWNER_SUBJECT: "owner-subject",
    } as never;
    await expect(
      assertRunExecutionAccess(env, "run-owner"),
    ).resolves.toEqual({ userId: "owner" });

    for (const runId of [
      "run-editor",
      "run-forged-owner",
      "run-revoked-owner",
    ]) {
      await expect(
        assertRunExecutionAccess(env, runId),
      ).rejects.toBeInstanceOf(AuthorizationError);
    }
  });
});

test("legacy queued and active runs require the pinned instance owner even in their own Workspace", async () => {
  await withMembershipDb(async (db) => {
    const env = {
      DB: db,
      OIDC_ISSUER_URL: "https://accounts.example.test",
      OIDC_OWNER_SUBJECT: "owner-subject",
    } as never;
    expect(await resolveWorkspaceAuthority(db, "second-workspace", "member")).toBe("owner");
    await expect(assertRunExecutionAccess(env, "run-second-owner"))
      .rejects.toThrow("not the active instance owner");
    await expect(getRunBootstrap(env, "run-second-owner"))
      .rejects.toThrow("not the active instance owner");
    await expect(getRunBootstrap(env, "run-owner"))
      .resolves.toMatchObject({ userId: "owner", spaceId: "workspace" });
    await expect(assertRunExecutionAccess({ DB: db } as never, "run-owner"))
      .rejects.toThrow("not the active instance owner");
    await expect(assertRunExecutionAccess({ DB: db, OIDC_ISSUER_URL: "https://accounts.example.test", OIDC_OWNER_SUBJECT: "second-subject" } as never, "run-owner"))
      .rejects.toThrow("not the active instance owner");
  });
});

test("a legacy Run without an explicit requester cannot reach queue or tool bootstrap", async () => {
  await withMembershipDb(async (db) => {
    const env = { DB: db } as never;

    for (const operation of [
      () => resolveExecutionUserIdForRun(env, "run-legacy-null"),
      () => assertRunExecutionAccess(env, "run-legacy-null"),
      () => getRunBootstrap(env, "run-legacy-null"),
    ]) {
      await expect(operation()).rejects.toBeInstanceOf(AuthorizationError);
    }
  });
});
