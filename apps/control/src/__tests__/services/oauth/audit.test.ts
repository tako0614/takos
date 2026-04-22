import type { D1Database } from "@cloudflare/workers-types";

import { assert, assertEquals } from "jsr:@std/assert";

function createMockDrizzleDb() {
  const values = ((..._args: unknown[]) => {
    values.calls.push(_args);
    return values;
  }) as any;
  values.calls = [] as unknown[][];
  const insert = ((..._args: unknown[]) => {
    insert.calls.push(_args);
    return chain;
  }) as any;
  insert.calls = [] as unknown[][];
  const chain = { values };
  return {
    select: () => chain,
    insert,
    update: () => chain,
    delete: () => chain,
    _: { chain },
  };
}

const db = createMockDrizzleDb();
const d1 = db as unknown as D1Database;
(globalThis as typeof globalThis & { __takosDbMock?: unknown }).__takosDbMock =
  db as never;

const mocks = {
  getDb: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
import { logOAuthEvent } from "@/services/oauth/audit";
import type { OAuthAuditEvent } from "@/services/oauth/audit";

Deno.test("logOAuthEvent - inserts an audit log entry with all fields", async () => {
  /* mocks cleared (no-op in Deno) */ db.insert.calls.length = 0;
  db._.chain.values.calls.length = 0;
  mocks.getDb = (() => db) as any;
  await logOAuthEvent(d1, {
    userId: "user-1",
    clientId: "client-1",
    eventType: "authorize_approved",
    ipAddress: "127.0.0.1",
    userAgent: "test-agent",
    details: { redirect_uri: "https://example.com/cb" },
  });

  assertEquals(db.insert.calls.length, 1);
  const insertChain = db._.chain;
  assertEquals(insertChain.values.calls.length, 1);

  const values = insertChain.values.calls[0]![0] as Record<string, unknown>;
  assertEquals(values.accountId, "user-1");
  assertEquals(values.clientId, "client-1");
  assertEquals(values.eventType, "authorize_approved");
  assertEquals(values.ipAddress, "127.0.0.1");
  assertEquals(values.userAgent, "test-agent");
  assertEquals(JSON.parse(values.details as string), {
    redirect_uri: "https://example.com/cb",
  });
  assert(values.id);
  assert(values.createdAt);
});
Deno.test("logOAuthEvent - stores null for optional fields when not provided", async () => {
  /* mocks cleared (no-op in Deno) */ db.insert.calls.length = 0;
  db._.chain.values.calls.length = 0;
  mocks.getDb = (() => db) as any;
  await logOAuthEvent(d1, {
    eventType: "token_issued",
  });

  const values = db._.chain.values.calls[0]![0] as Record<string, unknown>;
  assertEquals(values.accountId, null);
  assertEquals(values.clientId, null);
  assertEquals(values.ipAddress, null);
  assertEquals(values.userAgent, null);
  assertEquals(values.details, "{}");
});
Deno.test("logOAuthEvent - handles all defined event types", () => {
  /* mocks cleared (no-op in Deno) */ db.insert.calls.length = 0;
  db._.chain.values.calls.length = 0;
  mocks.getDb = (() => db) as any;
  // Type-level check: ensure all event types are valid strings
  const allEvents: OAuthAuditEvent[] = [
    "authorize_approved",
    "authorize_denied",
    "authorize_auto_approved",
    "device_code_issued",
    "device_auto_approved",
    "device_approved",
    "device_denied",
    "consent_granted",
    "consent_revoked",
    "token_issued",
    "token_refreshed",
    "token_revoked",
    "token_reuse_detected",
    "token_family_revoked",
    "client_registered",
    "client_updated",
    "client_deleted",
  ];
  assertEquals(allEvents.length, 17);
});
