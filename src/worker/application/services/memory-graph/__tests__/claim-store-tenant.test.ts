import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import { createClient, type Client } from "@libsql/client";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import type { ClaimInsert } from "../graph-models.ts";
import { upsertClaim } from "../claim-store.ts";

/**
 * Security guard: the claim `id` is caller-supplied (from the untrusted execution
 * container) while `account_id` is forced to the token-bound run's tenant. The
 * UPSERT conflict-update is scoped to `account_id = excluded.account_id`, so a
 * forged id that belongs to ANOTHER tenant's claim must NOT be overwritten or
 * re-homed into the attacker's tenant.
 */

// Minimal D1-shaped binding over a libsql client — upsertClaim only uses
// prepare().bind().run().
function d1(client: Client): SqlDatabaseBinding {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            run: async () => {
              await client.execute({ sql, args: args as never[] });
              return { success: true };
            },
          };
        },
      };
    },
  } as unknown as SqlDatabaseBinding;
}

async function makeDb(): Promise<Client> {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE memory_claims (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      claim_type TEXT, subject TEXT, predicate TEXT, object TEXT,
      confidence REAL, status TEXT, superseded_by TEXT,
      source_run_id TEXT, created_at TEXT, updated_at TEXT
    );
  `);
  return client;
}

function claim(over: Partial<ClaimInsert>): ClaimInsert {
  return {
    id: "claim_x",
    accountId: "space_v",
    claimType: "fact",
    subject: "s",
    predicate: "p",
    object: "o",
    ...over,
  } as ClaimInsert;
}

test("upsertClaim does NOT overwrite a claim owned by a different account (forged id)", async () => {
  const client = await makeDb();
  await client.execute(
    `INSERT INTO memory_claims (id, account_id, claim_type, subject, predicate, object, confidence, status, created_at, updated_at)
     VALUES ('claim_x','space_victim','fact','orig_s','orig_p','orig_o',0.9,'active','t0','t0')`,
  );

  // Attacker run (different tenant) tries to hijack claim_x.
  await upsertClaim(
    d1(client),
    claim({
      id: "claim_x",
      accountId: "space_attacker",
      subject: "hijacked",
      object: "evil",
    }),
  );

  const r = await client.execute(
    "SELECT account_id, subject, object FROM memory_claims WHERE id = 'claim_x'",
  );
  assertEquals(r.rows.length, 1);
  assertEquals(r.rows[0].account_id, "space_victim"); // not re-homed
  assertEquals(r.rows[0].subject, "orig_s"); // not overwritten
  assertEquals(r.rows[0].object, "orig_o");
});

test("upsertClaim updates the same tenant's claim and inserts a new id", async () => {
  const client = await makeDb();
  await upsertClaim(d1(client), claim({ id: "claim_y", subject: "v1" }));
  await upsertClaim(d1(client), claim({ id: "claim_y", subject: "v2" })); // same-tenant update
  await upsertClaim(d1(client), claim({ id: "claim_z", subject: "new" })); // new id insert

  const y = await client.execute(
    "SELECT subject FROM memory_claims WHERE id='claim_y'",
  );
  assertEquals(y.rows[0].subject, "v2");
  const z = await client.execute(
    "SELECT subject FROM memory_claims WHERE id='claim_z'",
  );
  assertEquals(z.rows[0].subject, "new");
});
