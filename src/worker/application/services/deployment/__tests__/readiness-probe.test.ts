import { test } from "bun:test";
/**
 * Unit tests for the workload readiness probe (Track G).
 *
 * Readiness contract (canonical: readiness-probe.ts):
 *
 * - kernel が deploy 時に workload に対して GET <readiness path> を送る
 * - default path は `/`、manifest の `compute.<name>.readiness` で override 可
 * - **HTTP 200 OK のみ** を ready とみなす
 * - 201/204/3xx (redirect)/4xx/5xx は fail
 * - timeout は hard-coded で 10 秒
 * - 失敗したら deploy fail-fast (workload は起動扱いされず、routing は更新されない)
 */

import { assertEquals, assertStringIncludes } from "@takos/test/assert";

import {
  buildProbeUrl,
  DEFAULT_READINESS_PATH,
  describeReadinessFailure,
  probeWorkerReadiness,
  READINESS_PROBE_TIMEOUT_MS,
  READY_STATUS_CODE,
} from "../readiness-probe.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test("READY_STATUS_CODE is 200 (only HTTP 200 OK is ready)", () => {
  assertEquals(READY_STATUS_CODE, 200);
});

test("READINESS_PROBE_TIMEOUT_MS is hard-coded 10 seconds", () => {
  assertEquals(READINESS_PROBE_TIMEOUT_MS, 10_000);
});

test("DEFAULT_READINESS_PATH defaults to '/'", () => {
  assertEquals(DEFAULT_READINESS_PATH, "/");
});

// ---------------------------------------------------------------------------
// buildProbeUrl
// ---------------------------------------------------------------------------

test("buildProbeUrl joins base + path without duplicate slashes", () => {
  assertEquals(
    buildProbeUrl("https://my-app.example.com", "/"),
    "https://my-app.example.com/",
  );
  assertEquals(
    buildProbeUrl("https://my-app.example.com", "/healthz"),
    "https://my-app.example.com/healthz",
  );
  assertEquals(
    buildProbeUrl("https://my-app.example.com/", "/healthz"),
    "https://my-app.example.com/healthz",
  );
  // Defensive: missing leading slash on path is normalized.
  assertEquals(
    buildProbeUrl("https://my-app.example.com", "healthz"),
    "https://my-app.example.com/healthz",
  );
});

// ---------------------------------------------------------------------------
// probeWorkerReadiness — happy path (200 OK)
// ---------------------------------------------------------------------------

function makeFetchStub(
  response: Response | (() => Response | Promise<Response>),
): typeof fetch {
  return ((_input: string | URL | Request, _init?: RequestInit) => {
    if (typeof response === "function") {
      return Promise.resolve(response());
    }
    return Promise.resolve(response);
  }) as typeof fetch;
}

test("probeWorkerReadiness: HTTP 200 → ready", async () => {
  const outcome = await probeWorkerReadiness({
    baseUrl: "https://example.com",
    path: "/",
    fetchImpl: makeFetchStub(new Response("ok", { status: 200 })),
  });
  assertEquals(outcome, { ok: true, status: 200 });
});

// ---------------------------------------------------------------------------
// probeWorkerReadiness — failures (only 200 is ready)
// ---------------------------------------------------------------------------

test("probeWorkerReadiness: HTTP 201 Created → fail (only 200 is ready)", async () => {
  const outcome = await probeWorkerReadiness({
    baseUrl: "https://example.com",
    path: "/",
    fetchImpl: makeFetchStub(new Response("created", { status: 201 })),
  });
  assertEquals(outcome, { ok: false, reason: "non-200", status: 201 });
});

test("probeWorkerReadiness: HTTP 204 No Content → fail", async () => {
  const outcome = await probeWorkerReadiness({
    baseUrl: "https://example.com",
    path: "/",
    fetchImpl: makeFetchStub(new Response(null, { status: 204 })),
  });
  assertEquals(outcome, { ok: false, reason: "non-200", status: 204 });
});

test("probeWorkerReadiness: HTTP 302 redirect → fail (NOT followed)", async () => {
  // We use redirect: "manual" so the 302 is observed without being followed.
  const outcome = await probeWorkerReadiness({
    baseUrl: "https://example.com",
    path: "/",
    fetchImpl: makeFetchStub(
      new Response(null, {
        status: 302,
        headers: { Location: "https://example.com/login" },
      }),
    ),
  });
  assertEquals(outcome, { ok: false, reason: "non-200", status: 302 });
});

test("probeWorkerReadiness: HTTP 401 Unauthorized → fail", async () => {
  const outcome = await probeWorkerReadiness({
    baseUrl: "https://example.com",
    path: "/",
    fetchImpl: makeFetchStub(new Response("unauthorized", { status: 401 })),
  });
  assertEquals(outcome, { ok: false, reason: "non-200", status: 401 });
});

test("probeWorkerReadiness: HTTP 500 Internal Server Error → fail", async () => {
  const outcome = await probeWorkerReadiness({
    baseUrl: "https://example.com",
    path: "/",
    fetchImpl: makeFetchStub(new Response("oops", { status: 500 })),
  });
  assertEquals(outcome, { ok: false, reason: "non-200", status: 500 });
});

// ---------------------------------------------------------------------------
// probeWorkerReadiness — timeout
// ---------------------------------------------------------------------------

test("probeWorkerReadiness: timeout → fail with reason 'timeout'", async () => {
  // The fetch never resolves until aborted.
  const fetchImpl: typeof fetch = ((_input, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      if (signal) {
        signal.addEventListener("abort", () => {
          reject(
            new DOMException("The operation was aborted.", "AbortError"),
          );
        });
      }
    });
  }) as typeof fetch;

  // Use a tiny timeout for the test (100ms) — production code uses
  // READINESS_PROBE_TIMEOUT_MS (10s).
  const outcome = await probeWorkerReadiness({
    baseUrl: "https://example.com",
    path: "/",
    fetchImpl,
    timeoutMs: 100,
  });
  assertEquals(outcome, { ok: false, reason: "timeout" });
});

test("probeWorkerReadiness: external abort cancels the request", async () => {
  const external = new AbortController();
  let observedSignal: AbortSignal | undefined;
  const fetchImpl: typeof fetch = ((_input, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      observedSignal = init?.signal as AbortSignal | undefined;
      observedSignal?.addEventListener("abort", () => {
        reject(
          new DOMException("The operation was aborted.", "AbortError"),
        );
      });
    });
  }) as typeof fetch;

  const pending = probeWorkerReadiness({
    baseUrl: "https://example.com",
    path: "/",
    fetchImpl,
    timeoutMs: 10_000,
    externalSignal: external.signal,
  });
  external.abort();

  const outcome = await pending;
  assertEquals(observedSignal?.aborted, true);
  assertEquals(outcome, { ok: false, reason: "timeout" });
});

// ---------------------------------------------------------------------------
// probeWorkerReadiness — network error
// ---------------------------------------------------------------------------

test("probeWorkerReadiness: network error → fail with reason 'error'", async () => {
  const fetchImpl: typeof fetch = (() => {
    return Promise.reject(new TypeError("connection refused"));
  }) as typeof fetch;

  const outcome = await probeWorkerReadiness({
    baseUrl: "https://example.com",
    path: "/",
    fetchImpl,
  });
  assertEquals(outcome.ok, false);
  if (!outcome.ok) {
    assertEquals(outcome.reason, "error");
    if (outcome.reason === "error") {
      assertStringIncludes(outcome.error, "connection refused");
    }
  }
});

// ---------------------------------------------------------------------------
// probeWorkerReadiness — passes path through correctly
// ---------------------------------------------------------------------------

test("probeWorkerReadiness: uses configured readiness path", async () => {
  let observedUrl = "";
  const fetchImpl: typeof fetch = ((input, _init?: RequestInit) => {
    observedUrl = typeof input === "string" ? input : (input as URL).toString();
    return Promise.resolve(new Response("ok", { status: 200 }));
  }) as typeof fetch;

  await probeWorkerReadiness({
    baseUrl: "https://api.example.com",
    path: "/healthz",
    fetchImpl,
  });
  assertEquals(observedUrl, "https://api.example.com/healthz");
});

test("probeWorkerReadiness: GET method only", async () => {
  let observedMethod = "";
  const fetchImpl: typeof fetch = ((_input, init?: RequestInit) => {
    observedMethod = init?.method ?? "";
    return Promise.resolve(new Response("ok", { status: 200 }));
  }) as typeof fetch;

  await probeWorkerReadiness({
    baseUrl: "https://example.com",
    path: "/",
    fetchImpl,
  });
  assertEquals(observedMethod, "GET");
});

// ---------------------------------------------------------------------------
// describeReadinessFailure
// ---------------------------------------------------------------------------

test("describeReadinessFailure: non-200 message includes status and rule", () => {
  const msg = describeReadinessFailure("https://example.com/", {
    ok: false,
    reason: "non-200",
    status: 401,
  });
  assertStringIncludes(msg, "https://example.com/");
  assertStringIncludes(msg, "401");
  assertStringIncludes(msg, "200");
});

test("describeReadinessFailure: timeout message includes 10s", () => {
  const msg = describeReadinessFailure("https://example.com/", {
    ok: false,
    reason: "timeout",
  });
  assertStringIncludes(msg, "https://example.com/");
  assertStringIncludes(msg, "10s");
});

test("describeReadinessFailure: error message includes underlying error", () => {
  const msg = describeReadinessFailure("https://example.com/", {
    ok: false,
    reason: "error",
    error: "ECONNREFUSED",
  });
  assertStringIncludes(msg, "https://example.com/");
  assertStringIncludes(msg, "ECONNREFUSED");
});
