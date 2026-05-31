import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { type Client, createClient } from "@libsql/client";

import { strict as assert } from "node:assert";
import { test } from "bun:test";
import { ensureServerMigrations } from "../../../../src/worker/local-platform/d1-migrations.ts";

const appRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const migrationsDir = join(appRoot, "db/migrations-control/migrations");

test("retired auth boundary migrations drop app-owned tables without losing Accounts identities", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "takos-retired-auth-boundary-"));
  const partialMigrationsDir = join(tempDir, "migrations-before-boundary");
  const dbPath = join(tempDir, "control.sqlite");
  const client = createClient({ url: `file:${dbPath}` });

  try {
    await copyMigrationsUpTo(63, partialMigrationsDir);
    await ensureServerMigrations(client, partialMigrationsDir);
    await seedRetiredBoundaryRows(client);

    await ensureServerMigrations(client, migrationsDir);

    for (
      const tableName of [
        "oauth_clients",
        "oauth_authorization_codes",
        "oauth_tokens",
        "auth_services",
        "billing_accounts",
        "billing_transactions",
        "account_password_credentials",
        "personal_access_tokens",
        "pat_revoked",
      ]
    ) {
      assert.deepStrictEqual(
        await tableExists(client, tableName),
        false,
        `${tableName} should be retired by the boundary migrations`,
      );
    }

    for (
      const tableName of [
        "accounts",
        "auth_identities",
        "auth_sessions",
        "sessions",
      ]
    ) {
      assert.deepStrictEqual(
        await tableExists(client, tableName),
        true,
        `${tableName} should survive the boundary migrations`,
      );
    }

    assert.deepStrictEqual(
      await scalar(
        client,
        "SELECT email FROM accounts WHERE id = ?",
        ["acct_legacy"],
      ),
      "owner@example.test",
    );
    assert.deepStrictEqual(
      await scalar(
        client,
        "SELECT provider_sub FROM auth_identities WHERE user_id = ?",
        ["acct_legacy"],
      ),
      "oidc-subject",
    );
    assert.deepStrictEqual(
      await scalar(
        client,
        "SELECT token_hash FROM auth_sessions WHERE account_id = ?",
        ["acct_legacy"],
      ),
      "sha256:session",
    );
    assert.deepStrictEqual(await columnExists(client, "accounts", "google_sub"), false);
    assert.deepStrictEqual(
      await columnExists(client, "accounts", "takos_auth_id"),
      false,
    );
  } finally {
    client.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function copyMigrationsUpTo(
  maxPrefix: number,
  destination: string,
): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(migrationsDir)) {
    if (!entry.endsWith(".sql")) continue;
    const prefix = Number(entry.slice(0, 4));
    if (!Number.isInteger(prefix) || prefix > maxPrefix) continue;
    await copyFile(join(migrationsDir, entry), join(destination, entry));
  }
}

async function seedRetiredBoundaryRows(client: Client): Promise<void> {
  await client.execute({
    sql: `
      INSERT INTO accounts (
        id, type, status, name, slug, email, google_sub, takos_auth_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      "acct_legacy",
      "user",
      "active",
      "Legacy Owner",
      "legacy-owner",
      "owner@example.test",
      "google-subject",
      "takos-auth-subject",
    ],
  });
  await client.execute({
    sql: `
      INSERT INTO auth_identities (
        id, user_id, provider, provider_sub, email_snapshot, email_kind,
        linked_at, last_login_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      "ident_legacy",
      "acct_legacy",
      "takosumi",
      "oidc-subject",
      "owner@example.test",
      "verified",
      "2026-05-12T00:00:00.000Z",
      "2026-05-12T00:00:00.000Z",
    ],
  });
  await client.execute({
    sql: `
      INSERT INTO auth_sessions (id, account_id, token_hash, expires_at)
      VALUES (?, ?, ?, ?)
    `,
    args: [
      "authsess_legacy",
      "acct_legacy",
      "sha256:session",
      "2026-06-12T00:00:00.000Z",
    ],
  });
  await client.execute({
    sql: `
      INSERT INTO auth_services (id, name, domain, api_key_hash)
      VALUES (?, ?, ?, ?)
    `,
    args: ["authsvc_legacy", "Legacy OAuth", "auth.example.test", "sha256:key"],
  });
  await client.execute({
    sql: `
      INSERT INTO billing_plans (id, name, display_name, is_default)
      VALUES (?, ?, ?, ?)
    `,
    args: ["plan_legacy", "legacy", "Legacy", 1],
  });
  await client.execute({
    sql: `
      INSERT INTO billing_accounts (id, account_id, plan_id, status)
      VALUES (?, ?, ?, ?)
    `,
    args: ["bill_legacy", "acct_legacy", "plan_legacy", "active"],
  });
  await client.execute({
    sql: `
      INSERT INTO billing_transactions (
        id, billing_account_id, type, amount_cents, balance_after_cents
      ) VALUES (?, ?, ?, ?, ?)
    `,
    args: ["txn_legacy", "bill_legacy", "credit", 1000, 1000],
  });
  await client.execute({
    sql: `
      INSERT INTO oauth_clients (
        id, client_id, name, client_secret_hash, redirect_uris, allowed_scopes,
        owner_account_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      "oauth_client_legacy",
      "legacy-client",
      "Legacy Client",
      "sha256:client",
      "[]",
      "openid profile",
      "acct_legacy",
    ],
  });
  await client.execute({
    sql: `
      INSERT INTO personal_access_tokens (
        id, account_id, name, token_hash, token_prefix, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
    args: [
      "pat_legacy",
      "acct_legacy",
      "Legacy PAT",
      "sha256:pat",
      "tak_pat_legacy",
      "2026-05-12T00:00:00.000Z",
    ],
  });
}

async function tableExists(
  client: Client,
  tableName: string,
): Promise<boolean> {
  const result = await client.execute({
    sql:
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    args: [tableName],
  });
  return result.rows.length > 0;
}

async function columnExists(
  client: Client,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const result = await client.execute(`PRAGMA table_info("${tableName}")`);
  return result.rows.some((row) => String(row.name) === columnName);
}

async function scalar(
  client: Client,
  sql: string,
  args: Array<string | number | null>,
): Promise<unknown> {
  const result = await client.execute({ sql, args });
  return result.rows[0]?.[0];
}
