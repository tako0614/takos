import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import {
  resolveAllowedCapabilities,
  resolveSpaceRole,
} from "../capabilities.ts";

async function withMembershipDb(
  run: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<void>,
) {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      owner_account_id TEXT,
      security_posture TEXT NOT NULL DEFAULT 'standard'
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
    INSERT INTO accounts (id, owner_account_id) VALUES
      ('workspace', 'owner'), ('owner', 'owner'), ('member', 'member'),
      ('removed', 'removed'), ('suspended', 'suspended');
    INSERT INTO account_memberships
      (id, account_id, member_id, role, status) VALUES
      ('membership-active', 'workspace', 'member', 'editor', 'active'),
      ('membership-suspended', 'workspace', 'suspended', 'viewer', 'suspended');
  `);
  try {
    await run(drizzle(client, { schema }));
  } finally {
    client.close();
  }
}

test("agent capability role resolution distinguishes viewer from no access", async () => {
  await withMembershipDb(async (db) => {
    expect(await resolveSpaceRole(db, "workspace", "owner")).toBe("owner");
    expect(await resolveSpaceRole(db, "workspace", "member")).toBe("editor");
    expect(await resolveSpaceRole(db, "workspace", "removed")).toBeNull();
    expect(await resolveSpaceRole(db, "workspace", "suspended")).toBeNull();
  });
});

test("agent capabilities fail closed after Workspace membership revocation", async () => {
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
