// Tests for the /health probe on the takos-worker API surface.
//
// Pre-Pass-6 the endpoint always returned `{ ok: true }` regardless of
// downstream state. These tests assert that:
//
// - a healthy D1 binding plus no upstream config returns 200 / "ok",
// - a missing D1 binding turns the response into 503 / "degraded",
// - an unreachable Takosumi Accounts upstream turns it into 503,
// - a healthy upstream contributes to a 200 response.

import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'bun:test';
import app from "./index.ts";
import type { ApiBindings } from "./shared/api/bindings.ts";

interface FakeStatement {
  bind(...args: unknown[]): FakeStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  raw<T = unknown>(): Promise<T[]>;
  run(): Promise<{ success: boolean; meta: { changes: number } }>;
}

function makeHealthyDb(): NonNullable<ApiBindings["DB"]> {
  const stmt = (): FakeStatement => {
    const s: FakeStatement = {
      bind: () => s,
      first: <T>() => Promise.resolve({ ok: 1 } as unknown as T),
      all: <T>() => Promise.resolve({ results: [{ ok: 1 }] as unknown as T[] }),
      raw: <T>() => Promise.resolve([[1]] as unknown as T[]),
      run: () => Promise.resolve({ success: true, meta: { changes: 0 } }),
    };
    return s;
  };
  return {
    prepare: () => stmt(),
    batch: () => Promise.resolve([]),
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  } as unknown as NonNullable<ApiBindings["DB"]>;
}

function makeBindings(overrides: Partial<ApiBindings> = {}): ApiBindings {
  return {
    DB: makeHealthyDb(),
    ...overrides,
  } as ApiBindings;
}

test("/health returns 200 with the DB check when no upstream is configured", async () => {
  const response = await app.request(
    "/health",
    {},
    makeBindings(),
  );

  deepStrictEqual(response.status, 200);
  const body = await response.json() as {
    ok: boolean;
    status: string;
    service: string;
    checks: {
      db: { ok: boolean };
      takosumiAccounts: { skipped?: boolean };
    };
  };
  deepStrictEqual(body.ok, true);
  deepStrictEqual(body.status, "ok");
  deepStrictEqual(body.service, "takos-worker");
  deepStrictEqual(body.checks.db.ok, true);
  deepStrictEqual(body.checks.takosumiAccounts.skipped, true);
});

test("/health returns 503 when the D1 binding is missing", async () => {
  const response = await app.request(
    "/health",
    {},
    makeBindings({ DB: undefined }),
  );

  deepStrictEqual(response.status, 503);
  const body = await response.json() as {
    ok: boolean;
    status: string;
    checks: { db: { ok: boolean; reason: string } };
  };
  deepStrictEqual(body.ok, false);
  deepStrictEqual(body.status, "degraded");
  deepStrictEqual(body.checks.db.ok, false);
});

test("/health surfaces a failing Takosumi Accounts probe as 503", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = (input) => {
    requestedUrl = String(input);
    return Promise.resolve(new Response("upstream down", { status: 502 }));
  };
  try {
    const response = await app.request(
      "/health",
      {},
      makeBindings({
        TAKOSUMI_ACCOUNTS_INTERNAL_URL: "https://accounts.example.test",
      }),
    );

    deepStrictEqual(response.status, 503);
    const body = await response.json() as {
      ok: boolean;
      checks: {
        db: { ok: boolean };
        takosumiAccounts: { ok: boolean; reason?: string };
      };
    };
    deepStrictEqual(body.ok, false);
    deepStrictEqual(body.checks.db.ok, true);
    deepStrictEqual(body.checks.takosumiAccounts.ok, false);
    deepStrictEqual(requestedUrl, "https://accounts.example.test/healthz");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("/health returns 200 when both DB and Takosumi Accounts respond", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  try {
    const response = await app.request(
      "/health",
      {},
      makeBindings({
        TAKOSUMI_ACCOUNTS_INTERNAL_URL: "https://accounts.example.test",
      }),
    );

    deepStrictEqual(response.status, 200);
    const body = await response.json() as {
      ok: boolean;
      checks: {
        db: { ok: boolean };
        takosumiAccounts: { ok: boolean };
      };
    };
    deepStrictEqual(body.ok, true);
    deepStrictEqual(body.checks.db.ok, true);
    deepStrictEqual(body.checks.takosumiAccounts.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
