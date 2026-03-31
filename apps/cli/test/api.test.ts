import { assert, assertEquals } from "jsr:@std/assert";
import { stub } from "jsr:@std/testing/mock";

import { api } from "../src/lib/api.ts";

type EnvMap = Record<string, string | undefined>;

async function withEnv<T>(vars: EnvMap, fn: () => Promise<T> | T): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, Deno.env.get(key));
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
  }
}

function installFetchResponse(
  body: BodyInit | null,
  init?: ResponseInit,
): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(body, init)) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

Deno.test("api client - treats 204 responses as success", async () => {
  await withEnv(
    {
      TAKOS_TOKEN: "test-token",
      TAKOS_API_URL: "https://takos.jp",
      TAKOS_API_TIMEOUT_MS: "30000",
    },
    async () => {
      const restoreFetch = installFetchResponse(null, { status: 204 });
      try {
        const result = await api<void>("/api/empty");

        assertEquals(result.ok, true);
        if (result.ok) {
          assertEquals(result.data, undefined);
        }
      } finally {
        restoreFetch();
      }
    },
  );
});

Deno.test("api client - treats 2xx responses with empty body as success", async () => {
  await withEnv(
    {
      TAKOS_TOKEN: "test-token",
      TAKOS_API_URL: "https://takos.jp",
      TAKOS_API_TIMEOUT_MS: "30000",
    },
    async () => {
      const restoreFetch = installFetchResponse("", { status: 200 });
      try {
        const result = await api<void>("/api/empty");

        assertEquals(result.ok, true);
        if (result.ok) {
          assertEquals(result.data, undefined);
        }
      } finally {
        restoreFetch();
      }
    },
  );
});

Deno.test("api client - uses configured default timeout when request timeout is omitted", async () => {
  await withEnv(
    {
      TAKOS_TOKEN: "test-token",
      TAKOS_API_URL: "https://takos.jp",
      TAKOS_API_TIMEOUT_MS: "12345",
    },
    async () => {
      const restoreFetch = installFetchResponse("{}", { status: 200 });
      const timeouts: Array<number | undefined> = [];
      const setTimeoutStub = stub(
        globalThis,
        "setTimeout",
        ((...args: unknown[]) => {
          timeouts.push(args[1] as number | undefined);
          return 0 as unknown as number;
        }) as typeof setTimeout,
      );

      try {
        await api("/api/timeout-default");
        assertEquals(timeouts.includes(12345), true);
      } finally {
        setTimeoutStub.restore();
        restoreFetch();
      }
    },
  );
});

Deno.test("api client - prefers per-request timeout over configured default", async () => {
  await withEnv(
    {
      TAKOS_TOKEN: "test-token",
      TAKOS_API_URL: "https://takos.jp",
      TAKOS_API_TIMEOUT_MS: "12345",
    },
    async () => {
      const restoreFetch = installFetchResponse("{}", { status: 200 });
      const timeouts: Array<number | undefined> = [];
      const setTimeoutStub = stub(
        globalThis,
        "setTimeout",
        ((...args: unknown[]) => {
          timeouts.push(args[1] as number | undefined);
          return 0 as unknown as number;
        }) as typeof setTimeout,
      );

      try {
        await api("/api/timeout-override", { timeout: 987 });
        assertEquals(timeouts.includes(987), true);
      } finally {
        setTimeoutStub.restore();
        restoreFetch();
      }
    },
  );
});

Deno.test("api client - returns error from non-2xx JSON payloads", async () => {
  await withEnv(
    {
      TAKOS_TOKEN: "test-token",
      TAKOS_API_URL: "https://takos.jp",
      TAKOS_API_TIMEOUT_MS: "30000",
    },
    async () => {
      const restoreFetch = installFetchResponse(
        JSON.stringify({ error: "Invalid API key" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
      try {
        const result = await api("/api/protected");
        assertEquals(result, { ok: false, error: "Invalid API key" });
      } finally {
        restoreFetch();
      }
    },
  );
});

Deno.test("api client - falls back to status text for non-2xx non-JSON payloads", async () => {
  await withEnv(
    {
      TAKOS_TOKEN: "test-token",
      TAKOS_API_URL: "https://takos.jp",
      TAKOS_API_TIMEOUT_MS: "30000",
    },
    async () => {
      const restoreFetch = installFetchResponse("<html>failure</html>", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "Content-Type": "text/html" },
      });
      try {
        const result = await api("/api/protected");
        assertEquals(result, { ok: false, error: "Bad Gateway" });
      } finally {
        restoreFetch();
      }
    },
  );
});

Deno.test("api client - maps AbortError to timeout message", async () => {
  await withEnv(
    {
      TAKOS_TOKEN: "test-token",
      TAKOS_API_URL: "https://takos.jp",
      TAKOS_API_TIMEOUT_MS: "30000",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        const abortError = new Error("The operation was aborted");
        abortError.name = "AbortError";
        throw abortError;
      }) as typeof fetch;

      try {
        const result = await api("/api/slow");
        assertEquals(result, { ok: false, error: "Request timed out" });
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

Deno.test("api client - sanitizes generic network errors", async () => {
  await withEnv(
    {
      TAKOS_TOKEN: "test-token",
      TAKOS_API_URL: "https://takos.jp",
      TAKOS_API_TIMEOUT_MS: "30000",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        throw new Error("Error: connect ECONNREFUSED /home/alice/.ssh/id_rsa");
      }) as typeof fetch;

      try {
        const result = await api("/api/network");

        assertEquals(result.ok, false);
        if (!result.ok) {
          assertEquals(
            result.error,
            "Network error: connect ECONNREFUSED [path]",
          );
          assert(!result.error.includes("/home/alice"));
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

Deno.test("api client - returns an error for invalid JSON in successful responses", async () => {
  await withEnv(
    {
      TAKOS_TOKEN: "test-token",
      TAKOS_API_URL: "https://takos.jp",
      TAKOS_API_TIMEOUT_MS: "30000",
    },
    async () => {
      const restoreFetch = installFetchResponse("{invalid json", {
        status: 200,
      });
      try {
        const result = await api("/api/invalid-json");
        assertEquals(result, {
          ok: false,
          error: "Invalid response from server",
        });
      } finally {
        restoreFetch();
      }
    },
  );
});
