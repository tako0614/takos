import type { Env } from "@/types";

import { emitRunUsageEvent } from "@/services/offload/usage-client";

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";

function createNotifierMock(fakeId: { toString: () => string }) {
  const idFromName = ((name: string) => {
    idFromName.calls.push([name]);
    return fakeId;
  }) as any;
  idFromName.calls = [] as unknown[][];
  const get = ((id: unknown) => {
    get.calls.push([id]);
    return { fetch };
  }) as any;
  get.calls = [] as unknown[][];
  const requests: Request[] = [];
  const fetch = async (request: Request) => {
    requests.push(request);
    return new Response("ok");
  };
  return { idFromName, get, requests };
}

Deno.test("emitRunUsageEvent - is a no-op when TAKOS_OFFLOAD is not configured", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = { TAKOS_OFFLOAD: undefined } as unknown as Env;
  // Should not throw
  await emitRunUsageEvent(env, {
    runId: "r1",
    meterType: "llm_tokens_input",
    units: 10,
  });
});
Deno.test("emitRunUsageEvent - is a no-op when RUN_NOTIFIER namespace is not configured", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = {
    TAKOS_OFFLOAD: {} as unknown,
    RUN_NOTIFIER: undefined,
  } as unknown as Env;

  await emitRunUsageEvent(env, {
    runId: "r1",
    meterType: "llm_tokens_input",
    units: 10,
  });
});
Deno.test("emitRunUsageEvent - is a no-op when runId is empty", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const ns = createNotifierMock({ toString: () => "fake-id" });

  const env = {
    TAKOS_OFFLOAD: {} as unknown,
    RUN_NOTIFIER: ns,
  } as unknown as Env;

  await emitRunUsageEvent(env, {
    runId: "",
    meterType: "exec_seconds",
    units: 5,
  });
  assertEquals(ns.requests.length, 0);
});
Deno.test("emitRunUsageEvent - sends a POST /usage request to the durable object stub", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const fakeId = { toString: () => "fake-id" };
  const ns = createNotifierMock(fakeId);

  const env = {
    TAKOS_OFFLOAD: {} as unknown,
    RUN_NOTIFIER: ns,
  } as unknown as Env;

  await emitRunUsageEvent(env, {
    runId: "run-123",
    meterType: "llm_tokens_input",
    units: 1000,
    referenceType: "completion",
    metadata: { model: "gpt-4" },
  });

  assertEquals(ns.idFromName.calls[0], ["run-123"]);
  assertEquals(ns.get.calls[0], [fakeId]);
  assertEquals(ns.requests.length, 1);

  const req = ns.requests[0];
  assertEquals(req.method, "POST");
  assertStringIncludes(req.url, "/usage");
  assertEquals(req.headers.get("Content-Type"), "application/json");
  assertEquals(req.headers.get("X-Takos-Internal-Marker"), "1");

  const body = await req.json() as Record<string, unknown>;
  assertEquals(body.runId, "run-123");
  assertEquals(body.meter_type, "llm_tokens_input");
  assertEquals(body.units, 1000);
  assertEquals(body.reference_type, "completion");
  assertEquals(body.metadata, { model: "gpt-4" });
});
Deno.test("emitRunUsageEvent - sends optional fields as undefined when not provided", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const fakeId = { toString: () => "id" };
  const ns = createNotifierMock(fakeId);

  const env = {
    TAKOS_OFFLOAD: {} as unknown,
    RUN_NOTIFIER: ns,
  } as unknown as Env;

  await emitRunUsageEvent(env, {
    runId: "run-456",
    meterType: "exec_seconds",
    units: 30,
  });

  const req = ns.requests[0];
  const body = await req.json() as Record<string, unknown>;
  assertEquals(body.reference_type, undefined);
  assertEquals(body.metadata, undefined);
});
