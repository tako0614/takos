import { expect, test } from "bun:test";

import egress from "../egress.ts";

test("notification push loopback egress is disabled by default", async () => {
  const response = await egress.fetch(
    new Request("http://localhost:8787/_matrix/push/v1/notify", {
      method: "POST",
      headers: { "X-Takos-Egress-Mode": "notification-push" },
      body: "{}",
    }),
    {} as never,
  );

  expect(response.status).toBe(400);
});

test("notification push loopback egress requires its mode and explicit development flag", async () => {
  const originalFetch = globalThis.fetch;
  const outbound: Request[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    outbound.push(new Request(input, init));
    return Response.json(
      { rejected: [] },
      { headers: { "Retry-After": "120", "X-Provider-Secret": "hidden" } },
    );
  }) as unknown as typeof fetch;

  try {
    const wrongMode = await egress.fetch(
      new Request("http://127.0.0.1:8787/_matrix/push/v1/notify", {
        method: "POST",
        headers: { "X-Takos-Egress-Mode": "web" },
        body: "{}",
      }),
      {
        TAKOS_NOTIFICATION_PUSH_ALLOW_INSECURE_LOOPBACK: "true",
      } as never,
    );
    expect(wrongMode.status).toBe(400);
    expect(outbound).toHaveLength(0);

    const allowed = await egress.fetch(
      new Request("http://127.0.0.1:8787/_matrix/push/v1/notify", {
        method: "POST",
        headers: {
          Authorization: "Bearer local-development-token",
          "Content-Type": "application/json",
          "X-Takos-Egress-Mode": "notification-push",
          "X-Takos-Space-Id": "workspace-1",
        },
        body: "{}",
      }),
      {
        TAKOS_NOTIFICATION_PUSH_ALLOW_INSECURE_LOOPBACK: "true",
      } as never,
    );

    expect(allowed.status).toBe(200);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]?.url).toBe(
      "http://127.0.0.1:8787/_matrix/push/v1/notify",
    );
    expect(outbound[0]?.redirect).toBe("manual");
    expect(outbound[0]?.headers.get("authorization")).toBe(
      "Bearer local-development-token",
    );
    expect(outbound[0]?.headers.get("x-takos-egress-mode")).toBeNull();
    expect(allowed.headers.get("retry-after")).toBe("120");
    expect(allowed.headers.get("x-provider-secret")).toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
