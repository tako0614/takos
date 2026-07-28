import { expect, test } from "bun:test";
import {
  deleteEnv,
  getEnv,
  setEnv,
} from "@takos/worker-platform-utils/runtime-env";
import { stub } from "@takos/test/mock";
import { resolveRuntimeHostBinding } from "../runtime-host-resolver.ts";

const RUNTIME_URL_KEYS = [
  "TAKOS_RUNTIME_HOST_URL",
  "TAKOS_LOCAL_RUNTIME_HOST_URL",
  "TAKOS_LOCAL_RUNTIME_URL",
] as const;

async function withRuntimeUrlEnv(
  values: Partial<Record<(typeof RUNTIME_URL_KEYS)[number], string>>,
  run: () => Promise<void>,
): Promise<void> {
  const previous = Object.fromEntries(
    RUNTIME_URL_KEYS.map((key) => [key, getEnv(key)]),
  ) as Record<(typeof RUNTIME_URL_KEYS)[number], string | undefined>;
  for (const key of RUNTIME_URL_KEYS) {
    const value = values[key];
    if (value === undefined) deleteEnv(key);
    else setEnv(key, value);
  }
  try {
    await run();
  } finally {
    for (const key of RUNTIME_URL_KEYS) {
      const value = previous[key];
      if (value === undefined) deleteEnv(key);
      else setEnv(key, value);
    }
  }
}

test("configured Node runtime host becomes a forwarding service binding", async () => {
  await withRuntimeUrlEnv(
    { TAKOS_RUNTIME_HOST_URL: "http://runtime.internal/base/" },
    async () => {
      let received: Request | undefined;
      const fetchStub = stub(
        globalThis,
        "fetch",
        async (input: RequestInfo | URL, init?: RequestInit) => {
          received = input instanceof Request
            ? input
            : new Request(input, init);
          return Response.json({ ok: true }, { status: 201 });
        },
      );
      try {
        const binding = resolveRuntimeHostBinding();
        expect(binding).toBeDefined();
        const response = await binding!.fetch(
          new Request("http://runtime-host/session/init?attempt=1", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ session_id: "session-1" }),
          }),
        );

        expect(response.status).toBe(201);
        expect(received?.url).toBe(
          "http://runtime.internal/base/session/init?attempt=1",
        );
        expect(await received?.json()).toEqual({ session_id: "session-1" });
      } finally {
        fetchStub.restore();
      }
    },
  );
});

test("Node runtime host is absent only when no runtime URL is configured", async () => {
  await withRuntimeUrlEnv({}, async () => {
    expect(resolveRuntimeHostBinding()).toBeUndefined();
  });
});
