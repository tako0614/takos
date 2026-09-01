import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";

import * as schema from "../../../../infra/db/schema.ts";
import { resolveAllowedCapabilities } from "../capabilities.ts";
import { selectEffectiveRunCapabilities } from "../../../tools/executor-setup.ts";

async function withMembershipDb(
  run: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<void>,
) {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      picture TEXT,
      bio TEXT,
      email TEXT,
      trust_tier TEXT NOT NULL,
      setup_completed INTEGER NOT NULL,
      default_repository_id TEXT,
      head_snapshot_id TEXT,
      ai_model TEXT,
      model_backend TEXT,
      security_posture TEXT NOT NULL DEFAULT 'standard',
      owner_account_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
    INSERT INTO accounts (
      id, type, status, name, slug, trust_tier, setup_completed,
      security_posture, owner_account_id, created_at, updated_at
    ) VALUES
      ('workspace', 'team', 'active', 'Workspace', 'workspace', 'trusted', 1,
       'standard', 'owner', 't0', 't0'),
      ('owner', 'user', 'active', 'Owner', 'owner', 'trusted', 1,
       'standard', NULL, 't0', 't0'),
      ('member', 'user', 'active', 'Member', 'member', 'trusted', 1,
       'standard', NULL, 't0', 't0'),
      ('removed', 'user', 'active', 'Removed', 'removed', 'trusted', 1,
       'standard', NULL, 't0', 't0'),
      ('suspended', 'user', 'active', 'Suspended', 'suspended', 'trusted', 1,
       'standard', NULL, 't0', 't0');
    INSERT INTO account_memberships
      (id, account_id, member_id, role, status) VALUES
      ('membership-owner', 'workspace', 'owner', 'owner', 'active'),
      ('membership-active', 'workspace', 'member', 'editor', 'active'),
      ('membership-suspended', 'workspace', 'suspended', 'viewer', 'suspended');
  `);
  try {
    await run(drizzle(client, { schema }));
  } finally {
    client.close();
  }
}

test("agent capabilities accept only the private Workspace owner", async () => {
  await withMembershipDb(async (db) => {
    await expect(resolveAllowedCapabilities({
      db,
      spaceId: "workspace",
      userId: "owner",
    })).resolves.toBeDefined();
    for (const userId of ["member", "removed", "suspended"]) {
      await expect(resolveAllowedCapabilities({
        db,
        spaceId: "workspace",
        userId,
      })).rejects.toThrow("no longer has access");
    }
  });
});

test("agent capabilities fail closed after Workspace owner proof revocation", async () => {
  await withMembershipDb(async (db) => {
    await expect(
      resolveAllowedCapabilities({
        db,
        spaceId: "workspace",
        userId: "removed",
      }),
    ).rejects.toThrow("no longer has access");
  });
});

test("restricted egress applies to the private Workspace owner", async () => {
  await withMembershipDb(async (db) => {
    await db.update(schema.accounts).set({
      securityPosture: "restricted_egress",
    }).where(eq(schema.accounts.id, "workspace"));

    const { ctx, allowed } = await resolveAllowedCapabilities({
      db,
      spaceId: "workspace",
      userId: "owner",
    });

    expect(ctx).toEqual({
      securityPosture: "restricted_egress",
    });
    expect(allowed.has("storage.write")).toBe(true);
    expect(allowed.has("egress.http")).toBe(false);
  });
});

test("tool capabilities can only narrow across frozen Grant and live policy", () => {
  const liveStandard = new Set([
    "storage.read",
    "storage.write",
    "egress.http",
  ] as const);
  expect(Array.from(selectEffectiveRunCapabilities(
    liveStandard,
    ["storage.read"],
  )).sort()).toEqual(["storage.read"]);

  const liveRestricted = new Set([
    "storage.read",
    "storage.write",
  ] as const);
  expect(Array.from(selectEffectiveRunCapabilities(
    liveRestricted,
    ["storage.read", "egress.http"],
  )).sort()).toEqual(["storage.read"]);
});
